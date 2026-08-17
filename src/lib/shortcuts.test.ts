/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canRebind, rebind, resetShortcut, savedShortcut } from './shortcuts';

/** `commands` is unimplemented in the fake, and differs between browsers. */
function withCommands(api: Record<string, unknown>) {
  fakeBrowser.commands = api as never;
}

beforeEach(() => {
  fakeBrowser.reset();
  withCommands({});
});

describe('savedShortcut', () => {
  it('reports what the save command is bound to', async () => {
    withCommands({
      getAll: vi.fn(async () => [
        { name: 'other', shortcut: 'Ctrl+K' },
        { name: 'save-page', shortcut: 'Alt+Shift+S' },
      ]),
    });
    expect(await savedShortcut()).toBe('Alt+Shift+S');
  });

  it('reports an unbound command as empty rather than missing', async () => {
    withCommands({ getAll: vi.fn(async () => [{ name: 'save-page', shortcut: '' }]) });
    expect(await savedShortcut()).toBe('');
  });

  it('survives a browser with no commands API at all', async () => {
    withCommands({});
    expect(await savedShortcut()).toBe('');
  });

  it('survives the API throwing', async () => {
    withCommands({
      getAll: vi.fn(async () => {
        throw new Error('not available');
      }),
    });
    expect(await savedShortcut()).toBe('');
  });
});

describe('canRebind', () => {
  /** Firefox implements commands.update; Chrome does not, at all. */
  it('is true only where the browser implements update', () => {
    withCommands({ update: vi.fn() });
    expect(canRebind()).toBe(true);

    withCommands({});
    expect(canRebind()).toBe(false);
  });
});

describe('rebind', () => {
  it('asks the browser to bind the save command', async () => {
    const update = vi.fn(async () => {});
    withCommands({ update });

    expect(await rebind('Ctrl+Shift+Y')).toBeUndefined();
    expect(update).toHaveBeenCalledWith({
      name: 'save-page',
      shortcut: 'Ctrl+Shift+Y',
    });
  });

  /**
   * The accepted modifiers and key names are a long, version-dependent list. The
   * browser already knows them; repeating the rules here would only let the two
   * disagree.
   */
  it('passes the browser’s complaint back rather than validating itself', async () => {
    withCommands({
      update: vi.fn(async () => {
        throw new Error('Value Ctrl+Q is an invalid shortcut.');
      }),
    });
    expect(await rebind('Ctrl+Q')).toBe('Value Ctrl+Q is an invalid shortcut.');
  });

  it('says so where rebinding is not possible', async () => {
    withCommands({});
    expect(await rebind('Alt+Shift+S')).toMatch(/does not allow/);
  });
});

describe('resetShortcut', () => {
  it('puts the manifest suggestion back', async () => {
    const reset = vi.fn(async () => {});
    withCommands({ reset });

    expect(await resetShortcut()).toBeUndefined();
    expect(reset).toHaveBeenCalledWith('save-page');
  });

  it('reports a refusal', async () => {
    withCommands({
      reset: vi.fn(async () => {
        throw new Error('nope');
      }),
    });
    expect(await resetShortcut()).toBe('nope');
  });

  it('says so where resetting is not possible', async () => {
    withCommands({});
    expect(await resetShortcut()).toMatch(/does not allow/);
  });
});
