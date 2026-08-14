/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookmarkItem } from './bookmarks';
import type { SaveRecord, SaveRequest } from './messages';

vi.mock('./bookmarks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bookmarks')>()),
  collectBookmarks: vi.fn(),
}));
vi.mock('./save', () => ({
  runSave: vi.fn(),
  isSaveableUrl: (url?: string) => /^https?:\/\//.test(url ?? ''),
}));

import { collectBookmarks } from './bookmarks';
import {
  DEFAULT_IMPORT_OPTIONS,
  getJob,
  cancelImport,
  planImport,
  processJob,
  startImport,
} from './importQueue';
import { runSave } from './save';
import { rememberSave } from './saveStore';

const collect = vi.mocked(collectBookmarks);
const save = vi.mocked(runSave);

const ITEMS: BookmarkItem[] = [
  { id: '1', url: 'https://ex.com/a', title: 'A', folders: ['Toolbar', 'Reading'] },
  { id: '2', url: 'https://ex.com/b', title: 'B', folders: ['Toolbar'] },
  { id: '3', url: 'https://ex.com/c', title: 'C', folders: [] },
];

function record(patch: Partial<SaveRecord> = {}): SaveRecord {
  return {
    url: 'https://ex.com/a',
    title: 'A',
    status: 'done',
    tags: [],
    path: 'note.md',
    startedAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

const OPTIONS = { ...DEFAULT_IMPORT_OPTIONS, tags: ['imported'], delayMs: 1_000 };

beforeEach(() => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  vi.useFakeTimers();
  collect.mockResolvedValue(ITEMS);
  save.mockImplementation(async (request: SaveRequest) =>
    record({ url: request.url, title: request.title }),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

/** processJob sleeps between items, so let the fake clock run it out. */
async function drain() {
  const pending = processJob();
  await vi.runAllTimersAsync();
  return pending;
}

describe('planImport', () => {
  it('counts everything by default', async () => {
    expect(await planImport(OPTIONS)).toMatchObject({ skipped: 0 });
    expect((await planImport(OPTIONS)).items).toHaveLength(3);
  });

  it('skips URLs already saved successfully', async () => {
    await rememberSave(record({ url: 'https://ex.com/b', status: 'done' }));
    await rememberSave(record({ url: 'https://ex.com/c', status: 'error' }));

    const plan = await planImport({ ...OPTIONS, skipSaved: true });
    expect(plan.items.map((i) => i.url)).toEqual([
      'https://ex.com/a',
      'https://ex.com/c',
    ]);
    expect(plan.skipped).toBe(1);
  });

  it('still skips URLs saved long ago, past the recent-list cap', async () => {
    await rememberSave(record({ url: 'https://ex.com/a', path: 'a.md' }));
    // Bury it under more saves than the recent list keeps.
    for (let i = 0; i < 40; i++) {
      await rememberSave(record({ url: `https://other.com/${i}`, path: `${i}.md` }));
    }

    const plan = await planImport({ ...OPTIONS, skipSaved: true });
    expect(plan.items.map((i) => i.url)).toEqual([
      'https://ex.com/b',
      'https://ex.com/c',
    ]);
    expect(plan.skipped).toBe(1);
  });

  it('honours the limit', async () => {
    const plan = await planImport({ ...OPTIONS, limit: 2 });
    expect(plan.items).toHaveLength(2);
  });

  it('passes the folder scope through', async () => {
    await planImport({ ...OPTIONS, folderId: 'reading' });
    expect(collect).toHaveBeenCalledWith('reading');
  });
});

describe('processJob', () => {
  it('saves every item with folder and fixed tags', async () => {
    await startImport({ ...OPTIONS, tagsFromFolders: true });
    const job = await drain();

    expect(save).toHaveBeenCalledTimes(3);
    expect(save.mock.calls[0]![0]).toMatchObject({
      url: 'https://ex.com/a',
      tags: ['imported', 'Toolbar', 'Reading'],
      summarize: false,
    });
    expect(job).toMatchObject({ saved: 3, index: 3, running: false, failures: [] });
    expect(job!.finishedAt).toBeDefined();
  });

  it('leaves folder tags out when that is turned off', async () => {
    await startImport({ ...OPTIONS, tagsFromFolders: false });
    await drain();
    expect(save.mock.calls[0]![0].tags).toEqual(['imported']);
  });

  it('records failures and keeps going', async () => {
    save.mockImplementation(async (request: SaveRequest) =>
      request.url === 'https://ex.com/b'
        ? record({ url: request.url, status: 'error', error: 'boom' })
        : record({ url: request.url }),
    );

    await startImport(OPTIONS);
    const job = await drain();

    expect(job).toMatchObject({ saved: 2, index: 3, running: false });
    expect(job!.failures).toEqual([
      { url: 'https://ex.com/b', title: 'B', error: 'boom' },
    ]);
  });

  it('retries a rate-limited item with backoff, then succeeds', async () => {
    let attempts = 0;
    save.mockImplementation(async (request: SaveRequest) => {
      if (request.url !== 'https://ex.com/a') return record({ url: request.url });
      attempts += 1;
      return attempts < 3
        ? record({ url: request.url, status: 'error', error: '429', errorStatus: 429 })
        : record({ url: request.url });
    });

    await startImport(OPTIONS);
    const job = await drain();

    expect(attempts).toBe(3);
    expect(job).toMatchObject({ saved: 3, failures: [] });
  });

  it('gives up on an item after the retry budget', async () => {
    save.mockResolvedValue(
      record({
        status: 'error',
        error: 'Tabstack rate limit hit (429).',
        errorStatus: 429,
      }),
    );

    await startImport({ ...OPTIONS, limit: 1 });
    const job = await drain();

    // 1 initial attempt + 3 retries
    expect(save).toHaveBeenCalledTimes(4);
    expect(job!.failures).toHaveLength(1);
    expect(job!.running).toBe(false);
  });

  it('aborts the whole run when credits run out', async () => {
    save.mockResolvedValue(
      record({ status: 'error', error: 'out of credits (402)', errorStatus: 402 }),
    );

    await startImport(OPTIONS);
    const job = await drain();

    expect(save).toHaveBeenCalledTimes(1);
    expect(job).toMatchObject({ running: false, index: 1 });
    expect(job!.abortReason).toMatch(/402/);
  });

  it('stops between items once cancelled', async () => {
    save.mockImplementation(async (request: SaveRequest) => {
      await cancelImport();
      return record({ url: request.url });
    });

    await startImport(OPTIONS);
    await drain();

    expect(save).toHaveBeenCalledTimes(1);
    const job = await getJob();
    expect(job).toMatchObject({ cancelled: true, running: false });
  });

  it('resumes from the stored index after a restart', async () => {
    await startImport(OPTIONS);
    const started = await getJob();
    // Simulate the event page dying after the first item.
    await fakeBrowser.storage.local.set({
      importJob: { ...started, index: 1, saved: 1 },
    });

    const job = await drain();
    expect(save).toHaveBeenCalledTimes(2);
    expect(job).toMatchObject({ saved: 3, index: 3 });
  });

  it('does nothing when there is no job', async () => {
    expect(await drain()).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it('finishes immediately when nothing matches', async () => {
    collect.mockResolvedValue([]);
    const job = await startImport(OPTIONS);
    expect(job).toMatchObject({ total: 0, running: false });
    expect(job.finishedAt).toBeDefined();
  });
});
