/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SaveRecord } from './messages';
import {
  deleteRecord,
  getRecord,
  getRecordOrIndexed,
  listRecords,
  putRecord,
  rememberSave,
} from './saveStore';
import { countSaved, isSaved } from './savedIndex';

function record(url: string, at: number, patch: Partial<SaveRecord> = {}): SaveRecord {
  return {
    url,
    title: `Page ${url}`,
    status: 'done',
    tags: ['a'],
    path: 'note.md',
    location: `out/note.md`,
    backend: 'download',
    startedAt: at,
    updatedAt: at,
    ...patch,
  };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('recent list', () => {
  it('keeps only the 30 newest records', async () => {
    for (let i = 0; i < 35; i++) await putRecord(record(`https://ex.com/${i}`, i));

    const recent = await listRecords();
    expect(recent).toHaveLength(30);
    expect(recent[0]!.url).toBe('https://ex.com/34');
    expect(await getRecord('https://ex.com/0')).toBeUndefined();
  });
});

describe('rememberSave', () => {
  it('writes both the recent list and the durable index', async () => {
    await rememberSave(record('https://ex.com/a', 1));
    expect(await getRecord('https://ex.com/a')).toBeDefined();
    expect(await isSaved('https://ex.com/a')).toBe(true);
  });

  it('does not index failures', async () => {
    await rememberSave(record('https://ex.com/a', 1, { status: 'error', error: 'boom' }));
    expect(await getRecord('https://ex.com/a')).toBeDefined();
    expect(await countSaved()).toBe(0);
  });

  it('remembers URLs long after they fall out of the recent list', async () => {
    await rememberSave(record('https://ex.com/old', 0));
    for (let i = 1; i <= 40; i++) await rememberSave(record(`https://ex.com/${i}`, i));

    // This is the bug the index exists for: the recent list has forgotten it…
    expect(await getRecord('https://ex.com/old')).toBeUndefined();
    // …but "have I saved this?" still answers yes.
    expect(await isSaved('https://ex.com/old')).toBe(true);
    expect(await countSaved()).toBe(41);
  });
});

describe('getRecordOrIndexed', () => {
  it('prefers the live record', async () => {
    await rememberSave(record('https://ex.com/a', 1));
    await putRecord(record('https://ex.com/a', 2, { status: 'extracting' }));
    expect((await getRecordOrIndexed('https://ex.com/a'))!.status).toBe('extracting');
  });

  it('rebuilds a done record from the index once history is gone', async () => {
    await rememberSave(record('https://ex.com/old', 500, { path: 'kept.md' }));
    for (let i = 1; i <= 31; i++)
      await putRecord(record(`https://ex.com/${i}`, 1_000 + i));

    const rebuilt = await getRecordOrIndexed('https://ex.com/old');
    expect(rebuilt).toMatchObject({
      status: 'done',
      path: 'kept.md',
      backend: 'download',
      indexed: true,
      updatedAt: 500,
    });
  });

  it('returns undefined for an unknown URL', async () => {
    expect(await getRecordOrIndexed('https://ex.com/nope')).toBeUndefined();
  });
});

describe('deleteRecord', () => {
  it('drops the record and un-indexes the URL', async () => {
    await rememberSave(record('https://ex.com/a', 1));
    await deleteRecord('https://ex.com/a');
    expect(await getRecordOrIndexed('https://ex.com/a')).toBeUndefined();
    expect(await isSaved('https://ex.com/a')).toBe(false);
  });
});
