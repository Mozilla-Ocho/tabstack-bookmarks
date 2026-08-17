/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';
import { isRetryableStatus } from './httpError';
import type { SaveRecord, SaveRequest } from './messages';

/**
 * Saves waiting for another attempt.
 *
 * An import has always retried and resumed; a single save from the popup, the
 * keyboard or the context menu had one chance, so closing a laptop lid mid-save
 * lost the page with nothing but an error line in a list capped at 30.
 *
 * Only failures that could plausibly succeed are queued — `isRetryableStatus`,
 * so a rejected key or an unfetchable URL is not retried at somebody's expense.
 */

const KEY = 'retrySaves';

/** Attempts after the first. Three covers a lid-shut or a flaky café network. */
export const MAX_ATTEMPTS = 3;

/**
 * 1, 5 and 15 minutes. `alarms` will not fire more often than once a minute, so
 * anything shorter would be a lie, and a save nobody is watching can wait.
 */
export function backoffMs(attempts: number): number {
  return [60_000, 300_000, 900_000][attempts] ?? 900_000;
}

export interface PendingSave {
  request: SaveRequest;
  /** How many attempts have already failed. */
  attempts: number;
  /** Epoch ms: when the next attempt is due. */
  nextAt: number;
  /** Why the last attempt failed, for the UI. */
  error: string;
}

export async function listPending(): Promise<PendingSave[]> {
  const stored = await browser.storage.local.get(KEY);
  return (stored[KEY] as PendingSave[] | undefined) ?? [];
}

async function write(pending: PendingSave[]): Promise<void> {
  if (pending.length === 0) {
    await browser.storage.local.remove(KEY);
    return;
  }
  await browser.storage.local.set({ [KEY]: pending });
}

/** Forgets any pending attempt for a URL — because it succeeded, or was cleared. */
export async function dropPending(url: string): Promise<void> {
  const pending = await listPending();
  const left = pending.filter((entry) => entry.request.url !== url);
  if (left.length !== pending.length) await write(left);
}

/**
 * Queues another attempt, or gives up.
 *
 * Returns the entry when it will be retried, and `undefined` when it will not —
 * either the failure is not the retryable kind, or the attempts are used up. The
 * caller can tell the difference between "waiting" and "this is final".
 */
export async function queueRetry(
  record: SaveRecord,
  request: SaveRequest,
  now: number,
): Promise<PendingSave | undefined> {
  if (!isRetryableStatus(record.errorStatus)) {
    await dropPending(request.url);
    return undefined;
  }

  const pending = await listPending();
  const previous = pending.find((entry) => entry.request.url === request.url);
  const attempts = (previous?.attempts ?? 0) + 1;

  if (attempts > MAX_ATTEMPTS) {
    await write(pending.filter((entry) => entry.request.url !== request.url));
    return undefined;
  }

  const entry: PendingSave = {
    // The original request, so a retry saves what was asked for — the edited
    // title, the tags, the note — and not a bare URL.
    request,
    attempts,
    nextAt: now + backoffMs(attempts - 1),
    error: record.error ?? '',
  };

  await write([...pending.filter((e) => e.request.url !== request.url), entry]);
  return entry;
}

/** Everything due at `now`, oldest first. */
export async function duePending(now: number): Promise<PendingSave[]> {
  return (await listPending())
    .filter((entry) => entry.nextAt <= now)
    .sort((a, b) => a.nextAt - b.nextAt);
}

export async function clearPending(): Promise<void> {
  await browser.storage.local.remove(KEY);
}
