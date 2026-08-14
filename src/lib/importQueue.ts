import { browser } from '#imports';
import type { BookmarkItem } from './bookmarks';
import { collectBookmarks } from './bookmarks';
import type { SaveRecord } from './messages';
import { runSave } from './save';
import { rememberSave } from './saveStore';
import { savedUrls } from './savedIndex';

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
  failures: ImportFailure[];
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
    items = items.filter((item) => !done.has(item.url));
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

        if (record.status === 'done' || record.errorStatus !== 429) break;
        if (attempt === MAX_RETRIES) break;
        await sleep(backoffMs(attempt));
      }

      // Merge onto the stored job, not the snapshot from before the save.
      const latest = (await getJob()) ?? job;
      const ok = record?.status === 'done';
      job = await putJob({
        ...latest,
        index: latest.index + 1,
        saved: latest.saved + (ok ? 1 : 0),
        failures: ok
          ? latest.failures
          : [
              ...latest.failures,
              { url: item.url, title: item.title, error: record?.error ?? 'Unknown error' },
            ],
      });
      onProgress?.(job);

      // Out of credits or a bad key will fail every remaining item; stop now.
      if (record?.errorStatus === 402 || record?.errorStatus === 401) {
        job = await putJob({
          ...job,
          running: false,
          abortReason: record.error,
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
