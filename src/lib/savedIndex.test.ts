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
  migrateFromRecent,
  pruneSaved,
  savedUrls,
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

describe('migrateFromRecent', () => {
  it('seeds the index from old recent-save records', async () => {
    const seeded = await migrateFromRecent([
      done('https://ex.com/a', 1),
      done('https://ex.com/b', 2, { status: 'error' }),
    ]);
    expect(seeded).toBe(1);
    expect(await isSaved('https://ex.com/a')).toBe(true);
  });

  it('is a no-op once anything is indexed', async () => {
    await markSaved(done('https://ex.com/a'));
    expect(await migrateFromRecent([done('https://ex.com/b')])).toBe(0);
    expect(await isSaved('https://ex.com/b')).toBe(false);
  });

  /**
   * The background is an event page, so this runs on every wakeup. Deciding by
   * "is the index empty?" meant a full storage scan each time, forever.
   */
  it('runs once per profile, even when the index is still empty', async () => {
    expect(await migrateFromRecent([])).toBe(0);
    expect(await migrateFromRecent([done('https://ex.com/a')])).toBe(0);
    expect(await isSaved('https://ex.com/a')).toBe(false);
  });

  it('does not resurrect entries after the index is deliberately cleared', async () => {
    const recent = [done('https://ex.com/a')];
    expect(await migrateFromRecent(recent)).toBe(1);

    await clearSaved();
    expect(await migrateFromRecent(recent)).toBe(0);
    expect(await countSaved()).toBe(0);
  });
});
