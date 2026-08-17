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
  MAX_FAILURES,
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

  /**
   * The expensive case: a bookmark folder full of newsletter links to pages that
   * are already saved. Without canonical comparison every one is extracted again,
   * and charged for again.
   */
  it('skips a bookmark whose only difference is a campaign', async () => {
    collect.mockResolvedValue([
      {
        id: '1',
        url: 'https://ex.com/a?utm_source=newsletter&utm_medium=email',
        title: 'A',
        folders: [],
      },
      { id: '2', url: 'https://ex.com/b?fbclid=abc', title: 'B', folders: [] },
      { id: '3', url: 'https://ex.com/c', title: 'C', folders: [] },
    ]);
    await rememberSave(record({ url: 'https://ex.com/a', path: 'a.md' }));
    await rememberSave(record({ url: 'https://ex.com/b', path: 'b.md' }));

    const plan = await planImport({ ...OPTIONS, skipSaved: true });

    expect(plan.items.map((i) => i.title)).toEqual(['C']);
    expect(plan.skipped).toBe(2);
  });

  it('still imports a bookmark that differs by a real parameter', async () => {
    collect.mockResolvedValue([
      { id: '1', url: 'https://ex.com/watch?v=one', title: 'One', folders: [] },
      { id: '2', url: 'https://ex.com/watch?v=two', title: 'Two', folders: [] },
    ]);
    await rememberSave(record({ url: 'https://ex.com/watch?v=one', path: 'one.md' }));

    const plan = await planImport({ ...OPTIONS, skipSaved: true });
    expect(plan.items.map((i) => i.title)).toEqual(['Two']);
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

  it('retries an item whose request never reached the API', async () => {
    let attempts = 0;
    save.mockImplementation(async (request: SaveRequest) => {
      if (request.url !== 'https://ex.com/a') return record({ url: request.url });
      attempts += 1;
      // Status 0: offline, DNS, dropped connection. A blip mid-run used to fail
      // the item permanently.
      return attempts < 2
        ? record({
            url: request.url,
            status: 'error',
            error: 'Could not reach api.tabstack.ai.',
            errorStatus: 0,
          })
        : record({ url: request.url });
    });

    await startImport(OPTIONS);
    const job = await drain();

    expect(attempts).toBe(2);
    expect(job).toMatchObject({ saved: 3, failures: [] });
  });

  it('does not retry a page the API refuses to fetch', async () => {
    save.mockResolvedValue(
      record({
        status: 'error',
        error: 'Tabstack could not fetch this URL (422).',
        errorStatus: 422,
      }),
    );

    await startImport({ ...OPTIONS, limit: 1 });
    const job = await drain();

    // One attempt, not four: a 422 is about the page, and retrying costs credits.
    expect(save).toHaveBeenCalledTimes(1);
    expect(job!.failures).toHaveLength(1);
  });

  it('stops the run when the destination rejects the token', async () => {
    // GitHub 401, not Tabstack. Each attempt pays for an extraction before it
    // ever tries to store anything, so continuing would bill for every item.
    save.mockResolvedValue(
      record({
        status: 'error',
        error: 'GitHub rejected the token (401).',
        errorStatus: 401,
      }),
    );

    await startImport(OPTIONS);
    const job = await drain();

    expect(save).toHaveBeenCalledTimes(1);
    expect(job).toMatchObject({ running: false, index: 1 });
    expect(job!.abortReason).toMatch(/GitHub rejected the token/);
  });

  it('stops the run after five failures in a row', async () => {
    collect.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        url: `https://ex.com/${i}`,
        title: `Page ${i}`,
        folders: [],
      })),
    );
    // No status at all — a missing API key, a broken backend. Nothing here says
    // "stop", so only the streak breaker can.
    save.mockImplementation(async (request: SaveRequest) =>
      record({
        url: request.url,
        status: 'error',
        error: 'Tabstack API key is missing.',
      }),
    );

    await startImport(OPTIONS);
    const job = await drain();

    expect(save).toHaveBeenCalledTimes(5);
    expect(job).toMatchObject({ running: false, index: 5, saved: 0 });
    expect(job!.abortReason).toMatch(/5 failures in a row/);
    expect(job!.abortReason).toMatch(/API key is missing/);
  });

  it('caps the stored failure list but keeps counting', async () => {
    // The job is one storage key, rewritten and broadcast after every item, so
    // the list cannot grow with the run. The count still has to be right.
    const total = (MAX_FAILURES + 5) * 2;
    collect.mockResolvedValue(
      Array.from({ length: total }, (_, i) => ({
        id: `${i}`,
        url: `https://ex.com/${i}`,
        title: `Page ${i}`,
        folders: [],
      })),
    );
    // Every other item fails, so the streak breaker never trips and the run
    // reaches the end.
    save.mockImplementation(async (request: SaveRequest) => {
      const i = Number(request.url.split('/').at(-1));
      return i % 2 === 0
        ? record({ url: request.url, status: 'error', error: `boom ${i}` })
        : record({ url: request.url });
    });

    await startImport({ ...OPTIONS, delayMs: 0 });
    const job = await drain();

    expect(job).toMatchObject({
      index: total,
      saved: MAX_FAILURES + 5,
      failed: MAX_FAILURES + 5,
    });
    // Oldest dropped, newest kept: the tail is what explains a run.
    expect(job!.failures).toHaveLength(MAX_FAILURES);
    expect(job!.failures.at(-1)!.url).toBe(`https://ex.com/${total - 2}`);
    expect(job!.failures[0]!.url).toBe('https://ex.com/10');
  });

  it('forgives a failure once something saves again', async () => {
    let n = 0;
    // Fail, fail, succeed, fail, fail — never five in a row, so it runs through.
    save.mockImplementation(async (request: SaveRequest) => {
      n += 1;
      return n === 3
        ? record({ url: request.url })
        : record({ url: request.url, status: 'error', error: 'flaky' });
    });
    collect.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `${i}`,
        url: `https://ex.com/${i}`,
        title: `Page ${i}`,
        folders: [],
      })),
    );

    await startImport(OPTIONS);
    const job = await drain();

    expect(job).toMatchObject({ index: 5, saved: 1, consecutiveFailures: 2 });
    expect(job!.abortReason).toBeUndefined();
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
