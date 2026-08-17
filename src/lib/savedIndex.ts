/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';
import type { SaveRecord } from './messages';
import type { BackendId } from './settings';
import { canonicalUrl } from './url';

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
const CANONICAL_KEY = 'savedIndexCanonical';

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

/**
 * Keys are canonical, so the same page shared through three campaigns is one
 * entry. Lookups canonicalise too, which is what lets a raw tab URL find it.
 */
const keyFor = (url: string) => `${PREFIX}${canonicalUrl(url)}`;

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
  // A canonical key cannot find a legacy one — `saved:…/post` is not
  // `saved:…/post?utm_source=old`, and no single-key read bridges that — so a
  // lookup waits for the re-key rather than racing it. Once it has run this is a
  // single flag read; the alternative was a full scan per lookup, which is the
  // thing this index exists to avoid.
  await canonicaliseSavedKeys();

  const canonical = keyFor(url);
  const stored = await browser.storage.local.get(canonical);
  const hit = stored[canonical] as SavedEntry | undefined;
  if (hit) return hit;

  // Belt and braces: asked for the URL an entry was actually saved with, answer
  // from that key even if the re-key has not touched it.
  const raw = `${PREFIX}${url}`;
  if (raw === canonical) return undefined;
  const legacy = await browser.storage.local.get(raw);
  return legacy[raw] as SavedEntry | undefined;
}

export async function isSaved(url: string): Promise<boolean> {
  return (await getSaved(url)) !== undefined;
}

export async function forgetSaved(url: string): Promise<void> {
  // Both spellings: an entry the migration has not reached yet is still keyed by
  // the URL it was saved with, and "Forget" has to actually forget it.
  await browser.storage.local.remove([keyFor(url), `${PREFIX}${url}`]);
}

async function readEntries(): Promise<[string, SavedEntry][]> {
  const stored = await browser.storage.local.get(null);
  return Object.entries(stored)
    .filter(([key]) => isEntryKey(key))
    .map(([key, value]) => [key, value as SavedEntry] as [string, SavedEntry])
    .filter(([, entry]) => typeof entry?.url === 'string');
}

async function readAll(): Promise<SavedEntry[]> {
  return (await readEntries()).map(([, entry]) => entry);
}

/**
 * Re-keys entries saved before URLs were canonicalised. Once per profile, guarded
 * by a stored flag, so the usual cost is one single-key read.
 *
 * Bulk checks canonicalise as they read, so imports were always safe — but a
 * single lookup asks for one key, and `saved:…/post` does not find
 * `saved:…/post?utm_source=old`. Without this the popup calls a saved page unsaved
 * and auto-save pays to save it again, which is the bug canonical URLs were meant
 * to fix.
 *
 * Where one page exists under two keys — the same article shared through two
 * campaigns — the newer entry wins, because it points at the file most likely to
 * still be there.
 */
export async function canonicaliseSavedKeys(): Promise<number> {
  const stored = await browser.storage.local.get(CANONICAL_KEY);
  if (stored[CANONICAL_KEY]) return 0;

  const entries = await readEntries();
  const stale = entries.filter(([key, entry]) => key !== keyFor(entry.url));

  if (stale.length === 0) {
    await browser.storage.local.set({ [CANONICAL_KEY]: true });
    return 0;
  }

  const merged = new Map<string, SavedEntry>();
  for (const [, entry] of entries) {
    const key = keyFor(entry.url);
    const winner = merged.get(key);
    if (!winner || entry.savedAt > winner.savedAt) {
      merged.set(key, { ...entry, url: canonicalUrl(entry.url) });
    }
  }

  await browser.storage.local.remove(stale.map(([key]) => key));
  await browser.storage.local.set({
    ...Object.fromEntries(merged),
    [CANONICAL_KEY]: true,
  });
  return stale.length;
}

/**
 * Every saved URL, for bulk checks like the import planner.
 *
 * Canonicalised on the way out as well as in: entries written before URLs were
 * canonicalised still have their tracking parameters, and they should still count
 * as saved rather than being fetched again.
 */
export async function savedUrls(): Promise<Set<string>> {
  return new Set((await readAll()).map((entry) => canonicalUrl(entry.url)));
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
