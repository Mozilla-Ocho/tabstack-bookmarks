/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser, defineBackground } from '#imports';
import { i18n } from '#i18n';
import { listBookmarkFolders } from '@/src/lib/bookmarks';
import {
  cancelImport,
  clearJob,
  getJob,
  planImport,
  processJob,
  startImport,
  type ImportJob,
} from '@/src/lib/importQueue';
import type {
  ImportProgress,
  Message,
  SaveRecord,
  SaveRequest,
} from '@/src/lib/messages';
import { isSaveableUrl, runSave } from '@/src/lib/save';
import {
  deleteRecord,
  getRecordOrIndexed,
  listRecords,
  putRecord,
  rememberSave,
} from '@/src/lib/saveStore';
import { migrateFromRecent, searchSaved } from '@/src/lib/savedIndex';

const MENU_PAGE = 'tabstack-save-page';
const MENU_LINK = 'tabstack-save-link';
const IMPORT_ALARM = 'tabstack-import-resume';

/**
 * Starts work nothing is waiting on, and turns a rejection into a log line.
 *
 * The background has no UI to fail into, and these paths can genuinely reject —
 * `storage.local` is finite, and an import writes to it once per bookmark. An
 * unhandled rejection here leaves a run that just stopped, with nothing said
 * anywhere; `[tabstack]` in the console is the difference between a bug report
 * that can be acted on and "the import froze".
 */
function detached(what: string, work: Promise<unknown> | undefined): void {
  void work?.catch((error: unknown) => {
    console.error(`[tabstack] ${what} failed:`, error);
  });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    detached('create menus', createMenus());
    // Nothing works without an API key, so a fresh install lands on the options
    // page rather than on a toolbar button that only errors.
    if (details.reason === 'install') {
      detached('open options', browser.runtime.openOptionsPage());
    }
  });
  // Event pages restart; menus are cheap to (re)create defensively.
  detached('create menus', createMenus());
  // Profiles that saved things before the durable index existed. Gated by a
  // stored flag, so this is one storage read per wakeup after the first.
  detached('migrate saved index', listRecords().then(migrateFromRecent));

  // Chrome's native onMessage ignores returned promises, so reply through
  // sendResponse and keep the channel open with `return true` instead.
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const pending = route(message as Message);
    if (!pending) return false;
    pending.then(sendResponse, (error: unknown) =>
      sendResponse({ error: error instanceof Error ? error.message : String(error) }),
    );
    return true;
  });

  // Alt+Shift+S saves the active tab without opening the popup.
  browser.commands?.onCommand.addListener((command) => {
    if (command !== 'save-page') return;
    detached(
      'save from keyboard command',
      browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!isSaveableUrl(tab?.url)) return;
        return handleSave({ type: 'save', url: tab!.url!, title: tab?.title ?? '' });
      }),
    );
  });

  // An import outlives the page that started it, and the event page can be
  // suspended mid-run, so a periodic alarm picks the queue back up.
  browser.alarms?.onAlarm.addListener((alarm) => {
    if (alarm.name === IMPORT_ALARM) detached('resume import', resumeImport());
  });
  browser.runtime.onStartup?.addListener(() => detached('resume import', resumeImport()));
  detached('resume import', resumeImport());

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const url = info.menuItemId === MENU_LINK ? info.linkUrl : (info.pageUrl ?? tab?.url);
    if (!isSaveableUrl(url)) return;
    // linkText is Firefox-only; fall back to the tab title elsewhere.
    const linkText = (info as { linkText?: string }).linkText;
    detached(
      'save from context menu',
      handleSave({
        type: 'save',
        url: url!,
        title: (info.menuItemId === MENU_LINK ? linkText : tab?.title) ?? '',
      }),
    );
  });
});

function route(message: Message): Promise<unknown> | null {
  switch (message?.type) {
    case 'save':
      return handleSave(message);
    case 'getState':
      return getRecordOrIndexed(message.url);
    case 'clearState':
      return deleteRecord(message.url).then(() => true);
    case 'listFolders':
      return listBookmarkFolders();
    case 'searchSaved':
      return searchSaved(message.query, message.limit);
    case 'planImport':
      return planImport(message.options).then(({ items, skipped }) => ({
        count: items.length,
        skipped,
      }));
    case 'startImport':
      return runImport(message.options);
    case 'cancelImport':
      return cancelImport().then((job) => job && progressOf(job));
    case 'getImport':
      return getJob().then((job) => (job ? progressOf(job) : undefined));
    case 'clearImport':
      return clearJob().then(() => true);
    default:
      return null;
  }
}

/** Strips the item list, which is far too big to send on every tick. */
function progressOf(job: ImportJob, currentTitle?: string): ImportProgress {
  const { items, ...rest } = job;
  return { ...rest, currentTitle: currentTitle ?? items[job.index]?.title };
}

async function runImport(options: Parameters<typeof startImport>[0]) {
  const job = await startImport(options);
  await browser.alarms?.create(IMPORT_ALARM, { periodInMinutes: 1 });
  // Deliberately not awaited: the page that asked wants the first progress
  // snapshot now, and the alarm above picks the run back up if this dies.
  detached('drain import', drainImport());
  return progressOf(job);
}

/** Runs the queue to completion, broadcasting progress as it goes. */
async function drainImport(): Promise<void> {
  const job = await processJob((progress) => {
    void broadcastImport(progressOf(progress));
  });
  if (!job?.running) {
    await browser.alarms?.clear(IMPORT_ALARM);
    if (job) await notifyImport(job);
  }
}

async function resumeImport(): Promise<void> {
  const job = await getJob();
  if (job?.running && !job.cancelled) await drainImport();
}

async function broadcastImport(progress: ImportProgress): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'importUpdate', progress });
  } catch {
    // no listener
  }
}

async function notifyImport(job: ImportJob): Promise<void> {
  if (job.cancelled && job.saved === 0) return;
  // The stored list is capped; the count is not.
  const failed = job.failed ?? job.failures.length;
  try {
    await browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/96.png'),
      title: job.cancelled
        ? i18n.t('notify.importCancelled')
        : i18n.t('notify.importFinished'),
      message:
        i18n.t('notify.importCounts', job.saved) +
        (failed ? i18n.t('notify.importFailedSuffix', [String(failed)]) : '') +
        (job.abortReason ? `\n${job.abortReason}` : ''),
    });
  } catch {
    // notifications blocked
  }
}

async function createMenus(): Promise<void> {
  try {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: MENU_PAGE,
      title: i18n.t('menu.savePage'),
      contexts: ['page'],
    });
    browser.contextMenus.create({
      id: MENU_LINK,
      title: i18n.t('menu.saveLink'),
      contexts: ['link'],
    });
  } catch {
    // Menus already exist, or the API is unavailable on this platform.
  }
}

async function handleSave(request: SaveRequest): Promise<SaveRecord> {
  const record = await runSave(request, (partial) => {
    detached('store progress', putRecord(partial));
    void broadcast(partial);
    void paintBadge(partial);
  });

  await rememberSave(record);
  await notify(record);
  return record;
}

/** The popup may be closed; a dropped message is expected, not an error. */
async function broadcast(record: SaveRecord): Promise<void> {
  try {
    await browser.runtime.sendMessage({ type: 'saveUpdate', record });
  } catch {
    // no listener
  }
}

async function paintBadge(record: SaveRecord): Promise<void> {
  const text = record.status === 'done' ? '✓' : record.status === 'error' ? '!' : '…';
  const color =
    record.status === 'done'
      ? '#16a34a'
      : record.status === 'error'
        ? '#dc2626'
        : '#6b7280';
  try {
    await browser.action.setBadgeText({ text });
    await browser.action.setBadgeBackgroundColor({ color });
    if (record.status === 'done' || record.status === 'error') {
      setTimeout(
        () => detached('clear badge', browser.action.setBadgeText({ text: '' })),
        5_000,
      );
    }
  } catch {
    // action API missing (e.g. during tests)
  }
}

async function notify(record: SaveRecord): Promise<void> {
  if (record.status !== 'done' && record.status !== 'error') return;
  try {
    await browser.notifications.create({
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/96.png'),
      title:
        record.status === 'done' ? i18n.t('notify.saved') : i18n.t('notify.saveFailed'),
      message:
        record.status === 'done'
          ? `${record.title}\n${record.location ?? ''}`.trim()
          : (record.error ?? i18n.t('notify.unknownError')),
    });
  } catch {
    // notifications blocked
  }
}
