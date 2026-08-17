/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { NETWORK_STATUS } from './httpError';
import type { SaveRecord, SaveRequest } from './messages';
import {
  backoffMs,
  clearPending,
  dropPending,
  duePending,
  listPending,
  MAX_ATTEMPTS,
  queueRetry,
} from './retryQueue';

const NOW = 1_700_000_000_000;

function request(url = 'https://ex.com/a'): SaveRequest {
  return { type: 'save', url, title: 'A Page', tags: ['reading'], note: 'why' };
}

function failed(patch: Partial<SaveRecord> = {}): SaveRecord {
  return {
    url: 'https://ex.com/a',
    title: 'A Page',
    status: 'error',
    tags: [],
    error: 'Could not reach api.tabstack.ai.',
    errorStatus: NETWORK_STATUS,
    startedAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

beforeEach(() => fakeBrowser.reset());

describe('queueRetry', () => {
  it('queues a failure that could succeed later', async () => {
    const entry = await queueRetry(failed(), request(), NOW);

    expect(entry).toMatchObject({ attempts: 1, nextAt: NOW + 60_000 });
    // The whole request, so the retry saves the tags and note that were asked
    // for rather than a bare URL.
    expect(entry!.request).toMatchObject({ tags: ['reading'], note: 'why' });
    expect(await listPending()).toHaveLength(1);
  });

  it.each([401, 402, 404, 422])(
    'does not queue a %i, which cannot succeed',
    async (status) => {
      const entry = await queueRetry(failed({ errorStatus: status }), request(), NOW);
      expect(entry).toBeUndefined();
      expect(await listPending()).toEqual([]);
    },
  );

  it('does not queue a failure with no status, like missing configuration', async () => {
    const entry = await queueRetry(
      failed({ errorStatus: undefined, error: 'Tabstack API key is missing.' }),
      request(),
      NOW,
    );
    expect(entry).toBeUndefined();
  });

  it('backs off further on each attempt', async () => {
    let at = NOW;
    const delays: number[] = [];
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const entry = await queueRetry(failed(), request(), at);
      delays.push(entry!.nextAt - at);
      at = entry!.nextAt;
    }
    expect(delays).toEqual([60_000, 300_000, 900_000]);
  });

  it('gives up after the attempts are used up, and stops holding the entry', async () => {
    let at = NOW;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      at = (await queueRetry(failed(), request(), at))!.nextAt;
    }

    expect(await queueRetry(failed(), request(), at)).toBeUndefined();
    expect(await listPending()).toEqual([]);
  });

  it('keeps one entry per URL, not one per attempt', async () => {
    await queueRetry(failed(), request(), NOW);
    await queueRetry(failed(), request(), NOW + 60_000);
    await queueRetry(
      failed({ url: 'https://ex.com/b' }),
      request('https://ex.com/b'),
      NOW,
    );

    const pending = await listPending();
    expect(pending).toHaveLength(2);
    expect(pending.find((e) => e.request.url === 'https://ex.com/a')!.attempts).toBe(2);
  });

  it('records the last error, so the UI can say what went wrong', async () => {
    await queueRetry(failed({ error: 'first' }), request(), NOW);
    const entry = (await queueRetry(failed({ error: 'second' }), request(), NOW))!;
    expect(entry.error).toBe('second');
  });

  /** A later success has to clear the queue, or it retries a saved page. */
  it('forgets a URL that has since succeeded', async () => {
    await queueRetry(failed(), request(), NOW);
    await dropPending('https://ex.com/a');
    expect(await listPending()).toEqual([]);
  });
});

describe('duePending', () => {
  beforeEach(async () => {
    await queueRetry(failed(), request('https://ex.com/soon'), NOW);
    await queueRetry(
      failed({ url: 'https://ex.com/later' }),
      request('https://ex.com/later'),
      NOW + 600_000,
    );
  });

  it('returns nothing before anything is due', async () => {
    expect(await duePending(NOW)).toEqual([]);
  });

  it('returns what is due, oldest first', async () => {
    const due = await duePending(NOW + 700_000);
    expect(due.map((entry) => entry.request.url)).toEqual([
      'https://ex.com/soon',
      'https://ex.com/later',
    ]);
  });

  it('leaves the not-yet-due alone', async () => {
    const due = await duePending(NOW + 60_000);
    expect(due.map((entry) => entry.request.url)).toEqual(['https://ex.com/soon']);
  });
});

describe('storage shape', () => {
  it('removes its key entirely once the queue empties', async () => {
    await queueRetry(failed(), request(), NOW);
    await dropPending('https://ex.com/a');
    // Not an empty array left behind: the background reads this on every wakeup.
    expect(await fakeBrowser.storage.local.get('retrySaves')).toEqual({});
  });

  it('starts empty, and clears on request', async () => {
    expect(await listPending()).toEqual([]);
    await queueRetry(failed(), request(), NOW);
    await clearPending();
    expect(await listPending()).toEqual([]);
  });
});

describe('backoffMs', () => {
  it('never drops below the one minute alarms can actually deliver', async () => {
    for (let attempts = 0; attempts < 10; attempts++) {
      expect(backoffMs(attempts)).toBeGreaterThanOrEqual(60_000);
    }
  });
});
