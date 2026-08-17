/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { i18n } from '#i18n';
import type { BookmarkFolder } from '@/src/lib/bookmarks';
import {
  DEFAULT_IMPORT_OPTIONS,
  type ImportOptions,
  type ImportSource,
} from '@/src/lib/importQueue';
import { parseTags } from '@/src/lib/markdown';
import { isErrorReply, type ImportProgress, type ImportUpdate } from '@/src/lib/messages';
import { configErrors, getSettings, type Settings } from '@/src/lib/settings';

const DELAYS = [
  { ms: 500, key: 'import.delayFast' },
  { ms: 1500, key: 'import.delayNormal' },
  { ms: 4000, key: 'import.delaySlow' },
] as const;

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [tagInput, setTagInput] = useState(DEFAULT_IMPORT_OPTIONS.tags.join(', '));
  const [plan, setPlan] = useState<{ count: number; skipped: number } | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /**
   * Which window "tabs I have open" means. The background cannot work this out —
   * it has no window — so the page that asked has to say.
   */
  const [windowId, setWindowId] = useState<number | undefined>(undefined);

  /** Unwraps a background reply, keeping handler errors out of the UI state. */
  const unwrap = <T,>(reply: unknown): T | null => {
    if (isErrorReply(reply)) {
      setFailure(reply.error);
      return null;
    }
    return (reply ?? null) as T | null;
  };

  useEffect(() => {
    (async () => {
      const self = await browser.tabs.getCurrent();
      setWindowId(self?.windowId);
      const loaded = await getSettings();
      setSettings(loaded);
      setOptions((current) => ({ ...current, summarize: loaded.summarize }));
      setFolders(
        unwrap<BookmarkFolder[]>(
          await browser.runtime.sendMessage({ type: 'listFolders' }),
        ) ?? [],
      );
      setProgress(
        unwrap<ImportProgress>(await browser.runtime.sendMessage({ type: 'getImport' })),
      );
    })();
  }, []);

  // The queue lives in the background; follow it from here.
  useEffect(() => {
    const listener = (message: ImportUpdate) => {
      if (message?.type === 'importUpdate') setProgress(message.progress);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  // Re-count whenever the selection changes, so Start is never a surprise.
  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    void browser.runtime
      .sendMessage({
        type: 'planImport',
        options: { ...options, tags: parseTags(tagInput), windowId },
      })
      .then((reply) => {
        if (!cancelled) setPlan(unwrap<{ count: number; skipped: number }>(reply));
      });
    return () => {
      cancelled = true;
    };
    // Re-planning on any option change is a local count plus one message, so
    // depending on the whole object is cheaper than keeping a subset in sync.
  }, [settings, options, tagInput, windowId]);

  if (!settings) return <div className="options">{i18n.t('common.loading')}</div>;

  const problems = configErrors(settings);
  const running = Boolean(progress?.running);
  const done = progress && !progress.running && progress.total > 0;
  const percent = progress?.total
    ? Math.round((progress.index / progress.total) * 100)
    : 0;
  // The listed failures are capped; the count is not, so read it separately.
  const failed = progress?.failed ?? 0;
  const listed = progress?.failures.length ?? 0;

  async function start() {
    setBusy(true);
    try {
      setProgress(
        unwrap<ImportProgress>(
          await browser.runtime.sendMessage({
            type: 'startImport',
            options: { ...options, tags: parseTags(tagInput), windowId },
          }),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="options">
      <header>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>{i18n.t('import.title')}</h1>
        </div>
        <p className="help">{i18n.t('import.help')}</p>
      </header>

      {failure && (
        <div className="status err" role="alert">
          {i18n.t('import.backgroundError', [failure])}
        </div>
      )}

      {problems.length > 0 && (
        <div className="status err">
          {problems.join(' ')}{' '}
          <button className="link" onClick={() => void browser.runtime.openOptionsPage()}>
            {i18n.t('common.openOptions')}
          </button>
        </div>
      )}

      <section>
        <h2>{i18n.t('import.whatHeading')}</h2>
        <div className="field">
          <label htmlFor="source">{i18n.t('import.sourceLabel')}</label>
          <select
            id="source"
            value={options.source}
            disabled={running}
            onChange={(e) =>
              setOptions({ ...options, source: e.target.value as ImportSource })
            }
          >
            <option value="bookmarks">{i18n.t('import.sourceBookmarks')}</option>
            <option value="tabs">{i18n.t('import.sourceTabs')}</option>
          </select>
        </div>

        {options.source === 'tabs' && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={options.allWindows ?? false}
              disabled={running}
              onChange={(e) => setOptions({ ...options, allWindows: e.target.checked })}
            />
            {i18n.t('import.allWindows')}
          </label>
        )}

        {options.source === 'bookmarks' && (
          <div className="field">
            <label htmlFor="folder">{i18n.t('import.folderLabel')}</label>
            <select
              id="folder"
              value={options.folderId ?? ''}
              disabled={running}
              onChange={(e) =>
                setOptions({ ...options, folderId: e.target.value || undefined })
              }
            >
              <option value="">{i18n.t('import.allBookmarks')}</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {' '.repeat(folder.depth * 2)}
                  {i18n.t('import.folderOption', [
                    folder.path.split('/').at(-1) ?? '',
                    String(folder.count),
                  ])}
                </option>
              ))}
            </select>
          </div>
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.skipSaved}
            disabled={running}
            onChange={(e) => setOptions({ ...options, skipSaved: e.target.checked })}
          />
          {i18n.t('import.skipSaved')}
        </label>

        <div className="field">
          <label htmlFor="limit">{i18n.t('import.limitLabel')}</label>
          <input
            id="limit"
            type="number"
            min={1}
            value={options.limit ?? ''}
            disabled={running}
            onChange={(e) =>
              setOptions({
                ...options,
                limit: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
          <p className="help">{i18n.t('import.limitHelp')}</p>
        </div>

        {plan && (
          <p className="help">
            {i18n.t('import.planned', plan.count)}
            {plan.skipped > 0 && i18n.t('import.plannedSkipped', [String(plan.skipped)])}.
          </p>
        )}
      </section>

      <section>
        <h2>{i18n.t('import.howHeading')}</h2>
        <div className="field">
          <label htmlFor="tags">{i18n.t('import.tagsLabel')}</label>
          <input
            id="tags"
            value={tagInput}
            disabled={running}
            onChange={(e) => setTagInput(e.target.value)}
          />
        </div>

        {options.source === 'bookmarks' && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={options.tagsFromFolders}
              disabled={running}
              onChange={(e) =>
                setOptions({ ...options, tagsFromFolders: e.target.checked })
              }
            />
            {i18n.t('import.tagsFromFolders')}
          </label>
        )}

        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.summarize}
            disabled={running}
            onChange={(e) => setOptions({ ...options, summarize: e.target.checked })}
          />
          {i18n.t('import.summarize')}
        </label>

        <div className="field">
          <label htmlFor="delay">{i18n.t('import.delayLabel')}</label>
          <select
            id="delay"
            value={options.delayMs}
            disabled={running}
            onChange={(e) => setOptions({ ...options, delayMs: Number(e.target.value) })}
          >
            {DELAYS.map((delay) => (
              <option key={delay.ms} value={delay.ms}>
                {i18n.t(delay.key)}
              </option>
            ))}
          </select>
          <p className="help">{i18n.t('import.retryHelp')}</p>
        </div>
      </section>

      {progress && progress.total > 0 && (
        <section>
          <h2>
            {running
              ? i18n.t('import.running')
              : progress.cancelled
                ? i18n.t('import.cancelled')
                : i18n.t('import.finished')}
          </h2>
          <div
            className="bar"
            role="progressbar"
            aria-valuenow={progress.index}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label={i18n.t('import.progressLabel')}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="counts" role="status" aria-live="polite">
            <span>
              <strong>
                {progress.index}/{progress.total}
              </strong>{' '}
              {i18n.t('import.processed')}
            </span>
            <span>
              <strong>{progress.saved}</strong> {i18n.t('import.savedCount')}
            </span>
            <span>
              <strong>{failed}</strong> {i18n.t('import.failedCount')}
            </span>
            {progress.skipped > 0 && (
              <span>
                <strong>{progress.skipped}</strong> {i18n.t('import.skippedCount')}
              </span>
            )}
          </div>
          {running && progress.currentTitle && (
            <p className="help">{i18n.t('import.nowSaving', [progress.currentTitle])}</p>
          )}
          {progress.abortReason && (
            <div className="status err">{progress.abortReason}</div>
          )}

          {listed > 0 && (
            <>
              {failed > listed && (
                <p className="help">
                  {i18n.t('import.failuresTruncated', [String(listed), String(failed)])}
                </p>
              )}
              <ul className="failures">
                {progress.failures.map((item, i) => (
                  // The same URL can be bookmarked twice, so the URL alone is
                  // not a unique key.
                  <li key={`${item.url}-${i}`}>
                    <strong>{item.title || item.url}</strong>
                    <div className="url">{item.url}</div>
                    <div className="help">{item.error}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <div className="actions">
        {running ? (
          <button
            onClick={async () =>
              setProgress(
                unwrap<ImportProgress>(
                  await browser.runtime.sendMessage({ type: 'cancelImport' }),
                ),
              )
            }
          >
            {i18n.t('import.cancelButton')}
          </button>
        ) : (
          <button
            className="primary"
            onClick={() => void start()}
            disabled={busy || problems.length > 0 || !plan?.count}
          >
            {busy
              ? i18n.t('import.starting')
              : i18n.t('import.startButton', plan?.count ?? 0)}
          </button>
        )}
        {done && (
          <button
            onClick={async () => {
              await browser.runtime.sendMessage({ type: 'clearImport' });
              setProgress(null);
            }}
          >
            {i18n.t('import.clearResults')}
          </button>
        )}
        <button className="link" onClick={() => void browser.runtime.openOptionsPage()}>
          {i18n.t('common.options')}
        </button>
      </div>
    </div>
  );
}
