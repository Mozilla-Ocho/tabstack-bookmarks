/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';
import { i18n } from '#i18n';
import type { BookmarkItem } from './bookmarks';
import { collectBookmarks } from './bookmarks';
import { isFatalStatus, isRetryableStatus } from './httpError';
import type { SaveRecord } from './messages';
import { runSave } from './save';
import { rememberSave } from './saveStore';
import { savedUrls } from './savedIndex';
import { canonicalUrl } from './url';

export interface ImportOptions {
  /** Restrict to one folder's subtree; empty means every bookmark. */
  folderId?: string;
  /** Skip URLs already saved by the extension. */
  skipSaved: boolean;
  /** Turn enclosing folder names into tags. */
  tagsFromFolders: boolean;
  /** Extra tags on every imported bookmark. */
  tags: string[];
  /** Pause between bookmarks, to stay well under the API rate limit. */
  delayMs: number;
  /** Also request an AI summary per bookmark (costs extra credits). */
  summarize: boolean;
  /** Stop after this many bookmarks. */
  limit?: number;
}

export interface ImportFailure {
  url: string;
  title: string;
  error: string;
}

export interface ImportJob {
  items: BookmarkItem[];
  /** Index of the next item to process. */
  index: number;
  total: number;
  running: boolean;
  cancelled: boolean;
  saved: number;
  skipped: number;
  /** The most recent failures, capped at `MAX_FAILURES`. See `failed`. */
  failures: ImportFailure[];
  /**
   * Every failure, including the ones trimmed out of `failures`. Optional
   * because jobs stored by earlier versions do not have it; fall back to
   * `failures.length`.
   */
  failed?: number;
  /**
   * Failures since the last success. Optional because jobs stored by earlier
   * versions do not have it; treat a missing value as 0.
   */
  consecutiveFailures?: number;
  options: ImportOptions;
  startedAt: number;
  updatedAt: number;
  /** Set when the whole run stopped early, e.g. out of credits. */
  abortReason?: string;
  finishedAt?: number;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  skipSaved: true,
  tagsFromFolders: true,
  tags: ['imported'],
  delayMs: 1_500,
  summarize: false,
};

const JOB_KEY = 'importJob';
const MAX_RETRIES = 3;
/**
 * Stop the run after this many failures in a row. The status checks below catch
 * the failures that announce themselves; this catches the rest — a destination
 * that has gone away, a config error that carries no status at all — before an
 * unattended run pays Tabstack to extract thousands of pages it cannot store.
 */
const MAX_CONSECUTIVE_FAILURES = 5;
/**
 * Failures kept in full. The job lives in one storage key that is rewritten and
 * broadcast after every item, so an unlucky 5,000-bookmark run must not grow an
 * unbounded list inside it. `failed` still counts them all.
 */
export const MAX_FAILURES = 100;

export async function getJob(): Promise<ImportJob | undefined> {
  const stored = await browser.storage.local.get(JOB_KEY);
  return stored[JOB_KEY] as ImportJob | undefined;
}

async function putJob(job: ImportJob): Promise<ImportJob> {
  const next = { ...job, updatedAt: Date.now() };
  await browser.storage.local.set({ [JOB_KEY]: next });
  return next;
}

export async function clearJob(): Promise<void> {
  await browser.storage.local.remove(JOB_KEY);
}

/** Counts what an import would do, without touching the API. */
export async function planImport(
  options: ImportOptions,
): Promise<{ items: BookmarkItem[]; skipped: number }> {
  let items = await collectBookmarks(options.folderId);
  let skipped = 0;

  if (options.skipSaved) {
    // The durable index, not the capped recent list: a 5,000 bookmark import
    // must not re-save everything but the last 30.
    const done = await savedUrls();
    const before = items.length;
    items = items.filter((item) => !done.has(canonicalUrl(item.url)));
    skipped = before - items.length;
  }

  if (options.limit && items.length > options.limit) {
    items = items.slice(0, options.limit);
  }

  return { items, skipped };
}

/** Creates a job. Call `processJob` to actually run it. */
export async function startImport(options: ImportOptions): Promise<ImportJob> {
  const existing = await getJob();
  if (existing?.running) return existing;

  const { items, skipped } = await planImport(options);
  return putJob({
    items,
    index: 0,
    total: items.length,
    running: items.length > 0,
    cancelled: false,
    saved: 0,
    skipped,
    failures: [],
    failed: 0,
    consecutiveFailures: 0,
    options,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: items.length ? undefined : Date.now(),
  });
}

export async function cancelImport(): Promise<ImportJob | undefined> {
  const job = await getJob();
  if (!job) return undefined;
  return putJob({ ...job, cancelled: true, running: false, finishedAt: Date.now() });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry-After style backoff for 429s: 5s, 15s, 45s. */
function backoffMs(attempt: number): number {
  return 5_000 * 3 ** attempt;
}

/** Why the whole run should stop, or undefined to carry on with the next item. */
function abortReasonFor(
  record: SaveRecord | undefined,
  consecutiveFailures: number,
): string | undefined {
  // A rejected key, an empty account or a missing repo fails every remaining
  // item too, and each attempt is charged for before storage is even tried.
  if (isFatalStatus(record?.errorStatus)) {
    return record?.error ?? i18n.t('errors.import.unrecoverable');
  }
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return i18n.t('errors.import.stoppedAfter', [
      String(consecutiveFailures),
      record?.error ?? i18n.t('errors.unknown'),
    ]);
  }
  return undefined;
}

let processing = false;

/**
 * Drains the queue one bookmark at a time, persisting progress after each so
 * an event-page restart can resume where it left off.
 */
export async function processJob(
  onProgress?: (job: ImportJob) => void,
): Promise<ImportJob | undefined> {
  if (processing) return getJob();
  processing = true;

  try {
    let job = await getJob();
    if (!job || !job.running) return job;

    for (;;) {
      // Always re-read: cancelImport may have flipped the flags while the
      // previous item was in flight, and that must not be overwritten.
      job = (await getJob())!;
      if (!job || job.cancelled || !job.running) return job;
      if (job.index >= job.items.length) break;

      const item = job.items[job.index]!;
      const tags = [
        ...job.options.tags,
        ...(job.options.tagsFromFolders ? item.folders : []),
      ];

      let record: SaveRecord | undefined;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        record = await runSave(
          {
            type: 'save',
            url: item.url,
            title: item.title,
            tags,
            summarize: job.options.summarize,
          },
          () => {},
        );
        await rememberSave(record);

        if (record.status === 'done') break;
        // Rate limits, server faults and dropped connections are worth another
        // go; a rejected token or an unfetchable page is not. Before this, a
        // single network blip mid-run turned an item into a permanent failure.
        if (!isRetryableStatus(record.errorStatus)) break;
        if (attempt === MAX_RETRIES) break;
        await sleep(backoffMs(attempt));
      }

      // Merge onto the stored job, not the snapshot from before the save.
      const latest = (await getJob()) ?? job;
      const ok = record?.status === 'done';
      const consecutiveFailures = ok ? 0 : (latest.consecutiveFailures ?? 0) + 1;
      job = await putJob({
        ...latest,
        index: latest.index + 1,
        saved: latest.saved + (ok ? 1 : 0),
        consecutiveFailures,
        failed: (latest.failed ?? latest.failures.length) + (ok ? 0 : 1),
        failures: ok
          ? latest.failures
          : // Newest last, oldest dropped: the tail is what a user reads to work
            // out what went wrong, and the count lives in `failed` regardless.
            [
              ...latest.failures,
              {
                url: item.url,
                title: item.title,
                error: record?.error ?? i18n.t('errors.unknown'),
              },
            ].slice(-MAX_FAILURES),
      });
      onProgress?.(job);

      const abortReason = abortReasonFor(record, consecutiveFailures);
      if (abortReason) {
        job = await putJob({
          ...job,
          running: false,
          abortReason,
          finishedAt: Date.now(),
        });
        onProgress?.(job);
        return job;
      }

      if (job.index < job.items.length && job.options.delayMs > 0) {
        await sleep(job.options.delayMs);
      }
    }

    job = await putJob({ ...job, running: false, finishedAt: Date.now() });
    onProgress?.(job);
    return job;
  } finally {
    processing = false;
  }
}
