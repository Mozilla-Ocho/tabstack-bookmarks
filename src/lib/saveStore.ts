/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';
import type { SaveRecord } from './messages';
import { forgetSaved, getSaved, markSaved, pruneSaved } from './savedIndex';

const KEY = 'recentSaves';
/** UI history only. The durable "already saved" set lives in savedIndex.ts. */
const MAX = 30;

type Store = Record<string, SaveRecord>;

async function read(): Promise<Store> {
  const stored = await browser.storage.local.get(KEY);
  return (stored[KEY] ?? {}) as Store;
}

export async function getRecord(url: string): Promise<SaveRecord | undefined> {
  return (await read())[url];
}

export async function putRecord(record: SaveRecord): Promise<void> {
  const store = await read();
  store[record.url] = record;

  const entries = Object.entries(store).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  await browser.storage.local.set({ [KEY]: Object.fromEntries(entries.slice(0, MAX)) });
}

/**
 * Final write for a finished save: keeps the UI history and, on success, the
 * durable index that survives beyond the last 30 saves.
 */
export async function rememberSave(record: SaveRecord): Promise<void> {
  await putRecord(record);
  if (record.status !== 'done') return;
  await markSaved(record);
  await pruneSaved();
}

export async function deleteRecord(url: string): Promise<void> {
  const store = await read();
  delete store[url];
  await browser.storage.local.set({ [KEY]: store });
  await forgetSaved(url);
}

/**
 * The in-progress or recent record for a URL, falling back to the durable
 * index so a page saved months ago still shows as saved (and can be updated
 * in place) after it has aged out of the recent list.
 */
export async function getRecordOrIndexed(url: string): Promise<SaveRecord | undefined> {
  const record = await getRecord(url);
  if (record) return record;

  const entry = await getSaved(url);
  if (!entry) return undefined;
  return {
    url: entry.url,
    title: entry.title ?? '',
    status: 'done',
    tags: [],
    path: entry.path,
    location: entry.location,
    backend: entry.backend,
    indexed: true,
    startedAt: entry.savedAt,
    updatedAt: entry.savedAt,
  };
}

export async function listRecords(): Promise<SaveRecord[]> {
  return Object.values(await read()).sort((a, b) => b.updatedAt - a.updatedAt);
}
