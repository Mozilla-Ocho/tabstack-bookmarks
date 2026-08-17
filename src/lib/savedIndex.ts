/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';
import type { SaveRecord } from './messages';
import type { BackendId } from './settings';

/**
 * Durable "have I saved this URL?" index.
 *
 * Deliberately separate from the recent-saves list in `saveStore.ts`: that list
 * is capped for the UI, and the import flow's "skip already saved" check must
 * not forget a URL just because 30 newer saves pushed it out.
 *
 * One storage key per URL, so a save is an O(1) write instead of rewriting a
 * map of every bookmark ever saved.
 */

const PREFIX = 'saved:';
/** Trimmed to the oldest entries past this point. */
export const MAX_ENTRIES = 50_000;

/**
 * Counter and flag keys, deliberately outside `PREFIX` so `isEntryKey` and
 * `clearSaved` ignore them.
 */
const WRITES_KEY = 'savedIndexWrites';
const MIGRATED_KEY = 'savedIndexMigrated';

/**
 * Saves between prune sweeps. Pruning reads the entire storage area, so doing
 * it on every save turns a 5,000-bookmark import into 5,000 full-index scans.
 * Overshooting MAX_ENTRIES by this much costs nothing.
 */
export const PRUNE_INTERVAL = 250;

export interface SavedEntry {
  url: string;
  /** Path inside the backend's folder. */
  path: string;
  /** Human-readable final location. */
  location?: string;
  backend?: BackendId;
  title?: string;
  savedAt: number;
}

const keyFor = (url: string) => `${PREFIX}${url}`;

function isEntryKey(key: string): boolean {
  return key.startsWith(PREFIX);
}

/** Records a successful save. Silently ignores anything not yet stored. */
export async function markSaved(record: SaveRecord): Promise<SavedEntry | undefined> {
  if (record.status !== 'done' || !record.path) return undefined;

  const entry: SavedEntry = {
    url: record.url,
    path: record.path,
    location: record.location,
    backend: record.backend,
    // Titles can be long; the index is meant to stay small.
    title: record.title ? record.title.slice(0, 160) : undefined,
    savedAt: record.updatedAt,
  };
  await browser.storage.local.set({ [keyFor(record.url)]: entry });
  return entry;
}

export async function getSaved(url: string): Promise<SavedEntry | undefined> {
  const stored = await browser.storage.local.get(keyFor(url));
  return stored[keyFor(url)] as SavedEntry | undefined;
}

export async function isSaved(url: string): Promise<boolean> {
  return (await getSaved(url)) !== undefined;
}

export async function forgetSaved(url: string): Promise<void> {
  await browser.storage.local.remove(keyFor(url));
}

async function readAll(): Promise<SavedEntry[]> {
  const stored = await browser.storage.local.get(null);
  return Object.entries(stored)
    .filter(([key]) => isEntryKey(key))
    .map(([, value]) => value as SavedEntry)
    .filter((entry) => typeof entry?.url === 'string');
}

/** Every saved URL, for bulk checks like the import planner. */
export async function savedUrls(): Promise<Set<string>> {
  return new Set((await readAll()).map((entry) => entry.url));
}

/** Newest first. */
export async function listSaved(limit?: number): Promise<SavedEntry[]> {
  const entries = (await readAll()).sort((a, b) => b.savedAt - a.savedAt);
  return limit ? entries.slice(0, limit) : entries;
}

export interface SearchResult {
  entries: SavedEntry[];
  /** How many matched, before `limit` was applied. */
  matched: number;
  /** How many are in the index altogether. */
  total: number;
}

/**
 * Substring search over the index, newest first.
 *
 * Reads and filters the whole index rather than keeping a search structure: it is
 * one pass over data already in memory, and the alternative is a second index to
 * keep in sync with the first. `matched` and `total` are what let the page say
 * "showing 50 of 312" instead of implying the list is everything.
 */
export async function searchSaved(query = '', limit?: number): Promise<SearchResult> {
  const all = (await readAll()).sort((a, b) => b.savedAt - a.savedAt);
  const needle = query.trim().toLowerCase();

  const matches = needle
    ? all.filter((entry) =>
        // Location as well as URL and title: "which of these went to the repo?"
        // is a question people ask of a folder they can see.
        [entry.title, entry.url, entry.location].some((field) =>
          field?.toLowerCase().includes(needle),
        ),
      )
    : all;

  return {
    entries: limit ? matches.slice(0, limit) : matches,
    matched: matches.length,
    total: all.length,
  };
}

export async function countSaved(): Promise<number> {
  const stored = await browser.storage.local.get(null);
  return Object.keys(stored).filter(isEntryKey).length;
}

export async function clearSaved(): Promise<void> {
  const stored = await browser.storage.local.get(null);
  await browser.storage.local.remove([
    ...Object.keys(stored).filter(isEntryKey),
    WRITES_KEY,
  ]);
}

/** Drops the oldest entries once the index grows past `max`. */
export async function pruneSaved(max = MAX_ENTRIES): Promise<number> {
  const entries = await listSaved();
  if (entries.length <= max) return 0;
  const doomed = entries.slice(max);
  await browser.storage.local.remove(doomed.map((entry) => keyFor(entry.url)));
  return doomed.length;
}

/**
 * Prunes every `interval` saves rather than on every one. A single-key counter
 * read is trivial; the full-index scan `pruneSaved` needs is not.
 */
export async function maybePruneSaved(
  max = MAX_ENTRIES,
  interval = PRUNE_INTERVAL,
): Promise<number> {
  const stored = await browser.storage.local.get(WRITES_KEY);
  const writes = ((stored[WRITES_KEY] as number | undefined) ?? 0) + 1;

  if (writes < interval) {
    await browser.storage.local.set({ [WRITES_KEY]: writes });
    return 0;
  }

  await browser.storage.local.set({ [WRITES_KEY]: 0 });
  return pruneSaved(max);
}

/**
 * Seeds the index from the recent-saves list, for profiles that saved things
 * before the index existed.
 *
 * Runs at most once per profile, recorded by a flag rather than by "is the index
 * empty?". The background is an event page: it wakes for every save, and
 * `countSaved()` reads the whole storage area, so an empty-index check would pay
 * for a one-time migration on every wakeup forever. The flag also survives a
 * deliberate "clear saved index", which must not be undone by a re-migration.
 */
export async function migrateFromRecent(recent: SaveRecord[]): Promise<number> {
  const stored = await browser.storage.local.get(MIGRATED_KEY);
  if (stored[MIGRATED_KEY]) return 0;

  const empty = (await countSaved()) === 0;
  await browser.storage.local.set({ [MIGRATED_KEY]: true });
  if (!empty) return 0;

  const done = recent.filter((record) => record.status === 'done' && record.path);
  for (const record of done) await markSaved(record);
  return done.length;
}
