/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';

/**
 * The keyboard shortcut, which the two browsers disagree about completely.
 *
 * Firefox implements `commands.update()`, so the options page can rebind it in
 * place. Chrome does not implement it at all — the only way there is
 * `chrome://extensions/shortcuts`, which an extension may open but not fill in. So
 * this reports what is bound, says which of the two is possible, and leaves the
 * page to render one or the other.
 */

/** Matches the manifest's command name. */
export const SAVE_COMMAND = 'save-page';

/** What the command is currently bound to, or empty when it is unbound. */
export async function savedShortcut(): Promise<string> {
  try {
    const commands = (await browser.commands?.getAll?.()) ?? [];
    return commands.find((command) => command.name === SAVE_COMMAND)?.shortcut ?? '';
  } catch {
    return '';
  }
}

/**
 * `commands.update` is Firefox-only and absent from the shared type, like `reset`.
 */
function updatable():
  ((details: { name: string; shortcut: string }) => Promise<void>) | undefined {
  const update = (browser.commands as unknown as Record<string, unknown> | undefined)
    ?.update;
  return typeof update === 'function'
    ? (update as (details: { name: string; shortcut: string }) => Promise<void>)
    : undefined;
}

/** Whether this browser lets the extension rebind it (Firefox does, Chrome does not). */
export function canRebind(): boolean {
  return updatable() !== undefined;
}

/**
 * Rebinds the shortcut, or explains why not.
 *
 * The browser is the authority on what a valid shortcut is — the accepted
 * modifiers and key names are long, version-dependent lists — so this passes the
 * string through and reports its complaint rather than reimplementing the rules
 * and disagreeing with it.
 */
export async function rebind(shortcut: string): Promise<string | undefined> {
  const update = updatable();
  if (!update) return 'This browser does not allow that.';
  try {
    await update({ name: SAVE_COMMAND, shortcut });
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * `commands.reset` is Firefox-only and absent from the shared type, so it has to
 * be reached for rather than called.
 */
function resettable(): ((name: string) => Promise<void>) | undefined {
  const reset = (browser.commands as unknown as Record<string, unknown> | undefined)
    ?.reset;
  return typeof reset === 'function'
    ? (reset as (name: string) => Promise<void>)
    : undefined;
}

/** Puts the manifest's own suggestion back. */
export async function resetShortcut(): Promise<string | undefined> {
  const reset = resettable();
  if (!reset) return 'This browser does not allow that.';
  try {
    await reset(SAVE_COMMAND);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
