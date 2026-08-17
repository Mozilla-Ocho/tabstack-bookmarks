/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SaveRecord } from './messages';
import {
  clearSaved,
  countSaved,
  forgetSaved,
  getSaved,
  isSaved,
  listSaved,
  markSaved,
  maybePruneSaved,
  pruneSaved,
  savedUrls,
  searchSaved,
} from './savedIndex';

function done(url: string, at = 1_000, extra: Partial<SaveRecord> = {}): SaveRecord {
  return {
    url,
    title: 'A page',
    status: 'done',
    tags: [],
    path: '2026-08-14-a-page.md',
    location: `out/${url}`,
    backend: 'github',
    startedAt: at,
    updatedAt: at,
    ...extra,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('markSaved', () => {
  it('stores path, location, backend and time', async () => {
    await markSaved(done('https://ex.com/a', 5_000));
    expect(await getSaved('https://ex.com/a')).toEqual({
      url: 'https://ex.com/a',
      path: '2026-08-14-a-page.md',
      location: 'out/https://ex.com/a',
      backend: 'github',
      title: 'A page',
      savedAt: 5_000,
    });
  });

  it('ignores records that did not finish', async () => {
    await markSaved(done('https://ex.com/a', 1, { status: 'error' }));
    await markSaved(done('https://ex.com/b', 1, { status: 'extracting' }));
    await markSaved({ ...done('https://ex.com/c'), path: undefined });
    expect(await countSaved()).toBe(0);
  });

  it('truncates very long titles', async () => {
    await markSaved(done('https://ex.com/a', 1, { title: 'x'.repeat(400) }));
    expect((await getSaved('https://ex.com/a'))!.title).toHaveLength(160);
  });

  it('overwrites the previous entry for the same URL', async () => {
    await markSaved(done('https://ex.com/a', 1));
    await markSaved(done('https://ex.com/a', 2, { path: 'new.md' }));
    expect(await countSaved()).toBe(1);
    expect((await getSaved('https://ex.com/a'))!.path).toBe('new.md');
  });
});

describe('lookups', () => {
  beforeEach(async () => {
    await markSaved(done('https://ex.com/a', 1));
    await markSaved(done('https://ex.com/b', 3));
    await markSaved(done('https://ex.com/c', 2));
  });

  it('answers isSaved per URL', async () => {
    expect(await isSaved('https://ex.com/b')).toBe(true);
    expect(await isSaved('https://ex.com/zzz')).toBe(false);
  });

  it('returns the whole URL set for bulk checks', async () => {
    expect(await savedUrls()).toEqual(
      new Set(['https://ex.com/a', 'https://ex.com/b', 'https://ex.com/c']),
    );
  });

  it('lists newest first and honours a limit', async () => {
    expect((await listSaved()).map((e) => e.url)).toEqual([
      'https://ex.com/b',
      'https://ex.com/c',
      'https://ex.com/a',
    ]);
    expect(await listSaved(1)).toHaveLength(1);
  });

  it('ignores unrelated storage keys', async () => {
    await fakeBrowser.storage.local.set({ settings: { apiKey: 'k' }, importJob: {} });
    expect(await countSaved()).toBe(3);
    expect((await savedUrls()).size).toBe(3);
  });

  it('forgets one URL without touching the rest', async () => {
    await forgetSaved('https://ex.com/b');
    expect(await isSaved('https://ex.com/b')).toBe(false);
    expect(await countSaved()).toBe(2);
  });

  it('clears only its own keys', async () => {
    await fakeBrowser.storage.local.set({ settings: { apiKey: 'k' } });
    await clearSaved();
    expect(await countSaved()).toBe(0);
    expect((await fakeBrowser.storage.local.get('settings')).settings).toEqual({
      apiKey: 'k',
    });
  });
});

describe('pruneSaved', () => {
  it('drops the oldest entries past the cap', async () => {
    for (let i = 0; i < 5; i++) await markSaved(done(`https://ex.com/${i}`, i));

    expect(await pruneSaved(3)).toBe(2);
    expect((await listSaved()).map((e) => e.url)).toEqual([
      'https://ex.com/4',
      'https://ex.com/3',
      'https://ex.com/2',
    ]);
  });

  it('does nothing under the cap', async () => {
    await markSaved(done('https://ex.com/a'));
    expect(await pruneSaved(10)).toBe(0);
    expect(await countSaved()).toBe(1);
  });
});

describe('tracking parameters', () => {
  /** The point of canonical keys: one page, one entry, however it was shared. */
  it('treats the same page shared three ways as one entry', async () => {
    await markSaved(done('https://ex.com/post?utm_source=newsletter', 1));
    await markSaved(done('https://ex.com/post?fbclid=abc', 2));
    await markSaved(done('https://ex.com/post', 3));

    expect(await countSaved()).toBe(1);
    expect(await savedUrls()).toEqual(new Set(['https://ex.com/post']));
  });

  it('answers isSaved for a URL carrying a campaign it was not saved with', async () => {
    await markSaved(done('https://ex.com/post', 1));

    expect(
      await isSaved('https://ex.com/post?utm_source=twitter&utm_medium=social'),
    ).toBe(true);
    expect(await getSaved('https://ex.com/post?gclid=xyz')).toBeDefined();
  });

  it('still tells apart pages that differ by a real parameter', async () => {
    await markSaved(done('https://ex.com/watch?v=one', 1));
    await markSaved(done('https://ex.com/watch?v=two', 2));
    expect(await countSaved()).toBe(2);
  });

  it('forgets by canonical URL, whatever was passed in', async () => {
    await markSaved(done('https://ex.com/post?utm_source=x', 1));
    await forgetSaved('https://ex.com/post?fbclid=y');
    expect(await countSaved()).toBe(0);
  });
});

describe('searchSaved', () => {
  beforeEach(async () => {
    await markSaved(
      done('https://rust-lang.org/book', 3, {
        title: 'The Rust Book',
        path: 'rust.md',
        location: 'notes/rust.md',
      }),
    );
    await markSaved(
      done('https://example.com/css-grid', 2, {
        title: 'Laying out with CSS Grid',
        path: 'grid.md',
        location: 'notes/grid.md',
      }),
    );
    await markSaved(
      done('https://example.com/archive/old', 1, {
        title: 'Something else',
        path: 'old.md',
        location: 'archive/old.md',
      }),
    );
  });

  it('returns everything, newest first, when there is no query', async () => {
    const result = await searchSaved();
    expect(result.entries.map((e) => e.title)).toEqual([
      'The Rust Book',
      'Laying out with CSS Grid',
      'Something else',
    ]);
    expect(result).toMatchObject({ matched: 3, total: 3 });
  });

  it('matches on the title, case-insensitively', async () => {
    const result = await searchSaved('rust');
    expect(result.entries.map((e) => e.title)).toEqual(['The Rust Book']);
    expect(result).toMatchObject({ matched: 1, total: 3 });
  });

  it('matches on the URL', async () => {
    expect((await searchSaved('css-grid')).entries).toHaveLength(1);
  });

  /** "Which of these went into the archive folder?" is a real question. */
  it('matches on where the file landed', async () => {
    const result = await searchSaved('archive/');
    expect(result.entries.map((e) => e.title)).toEqual(['Something else']);
  });

  it('reports nothing matched rather than falling back to everything', async () => {
    const result = await searchSaved('nothing like this');
    expect(result.entries).toEqual([]);
    expect(result).toMatchObject({ matched: 0, total: 3 });
  });

  it('ignores surrounding whitespace, and treats blank as no query', async () => {
    expect((await searchSaved('  rust  ')).matched).toBe(1);
    expect((await searchSaved('   ')).matched).toBe(3);
  });

  /** The page renders a window of the results; the counts describe the whole. */
  it('limits what it returns without hiding how many matched', async () => {
    const result = await searchSaved('', 2);
    expect(result.entries).toHaveLength(2);
    expect(result).toMatchObject({ matched: 3, total: 3 });
  });

  it('ignores storage that is not part of the index', async () => {
    await fakeBrowser.storage.local.set({
      settings: { apiKey: 'rust' },
      savedIndexWrites: 4,
    });
    expect((await searchSaved()).total).toBe(3);
  });
});

describe('maybePruneSaved', () => {
  it('leaves the index alone until the interval comes round', async () => {
    for (let i = 0; i < 5; i++) await markSaved(done(`https://ex.com/${i}`, i));

    expect(await maybePruneSaved(3, 3)).toBe(0);
    expect(await maybePruneSaved(3, 3)).toBe(0);
    expect(await countSaved()).toBe(5);

    // Third call: prunes down to the cap.
    expect(await maybePruneSaved(3, 3)).toBe(2);
    expect(await countSaved()).toBe(3);
  });

  it('starts counting again after a sweep', async () => {
    for (let i = 0; i < 4; i++) await markSaved(done(`https://ex.com/${i}`, i));
    await maybePruneSaved(2, 1);
    expect(await countSaved()).toBe(2);

    await markSaved(done('https://ex.com/new', 99));
    expect(await maybePruneSaved(2, 2)).toBe(0);
    expect(await maybePruneSaved(2, 2)).toBe(1);
  });

  it('keeps its counter out of the index', async () => {
    await maybePruneSaved(10, 5);
    expect(await countSaved()).toBe(0);
    expect((await savedUrls()).size).toBe(0);
  });
});
