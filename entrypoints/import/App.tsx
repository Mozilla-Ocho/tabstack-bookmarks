/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useState } from 'react';
import { browser } from '#imports';
import type { BookmarkFolder } from '@/src/lib/bookmarks';
import { DEFAULT_IMPORT_OPTIONS, type ImportOptions } from '@/src/lib/importQueue';
import { parseTags } from '@/src/lib/markdown';
import { isErrorReply, type ImportProgress, type ImportUpdate } from '@/src/lib/messages';
import { configErrors, getSettings, type Settings } from '@/src/lib/settings';

const DELAYS = [
  { ms: 500, label: '0.5s — fastest, more likely to hit rate limits' },
  { ms: 1500, label: '1.5s — recommended' },
  { ms: 4000, label: '4s — gentle, good for very large imports' },
];

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [tagInput, setTagInput] = useState(DEFAULT_IMPORT_OPTIONS.tags.join(', '));
  const [plan, setPlan] = useState<{ count: number; skipped: number } | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

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
        options: { ...options, tags: parseTags(tagInput) },
      })
      .then((reply) => {
        if (!cancelled) setPlan(unwrap<{ count: number; skipped: number }>(reply));
      });
    return () => {
      cancelled = true;
    };
    // Re-planning on any option change is a local count plus one message, so
    // depending on the whole object is cheaper than keeping a subset in sync.
  }, [settings, options, tagInput]);

  if (!settings) return <div className="options">Loading…</div>;

  const problems = configErrors(settings);
  const running = Boolean(progress?.running);
  const done = progress && !progress.running && progress.total > 0;
  const percent = progress?.total
    ? Math.round((progress.index / progress.total) * 100)
    : 0;

  async function start() {
    setBusy(true);
    try {
      setProgress(
        unwrap<ImportProgress>(
          await browser.runtime.sendMessage({
            type: 'startImport',
            options: { ...options, tags: parseTags(tagInput) },
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
          <h1>Import existing bookmarks</h1>
        </div>
        <p className="help">
          Every selected bookmark goes through Tabstack and lands in your configured
          destination — one API call per bookmark, so this costs credits. The run keeps
          going in the background; you can close this tab.
        </p>
      </header>

      {failure && (
        <div className="status err" role="alert">
          The extension's background page reported: {failure}
        </div>
      )}

      {problems.length > 0 && (
        <div className="status err">
          {problems.join(' ')}{' '}
          <button className="link" onClick={() => void browser.runtime.openOptionsPage()}>
            Open options
          </button>
        </div>
      )}

      <section>
        <h2>What to import</h2>
        <div className="field">
          <label htmlFor="folder">Folder</label>
          <select
            id="folder"
            value={options.folderId ?? ''}
            disabled={running}
            onChange={(e) =>
              setOptions({ ...options, folderId: e.target.value || undefined })
            }
          >
            <option value="">All bookmarks</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {' '.repeat(folder.depth * 2)}
                {folder.path.split('/').at(-1)} ({folder.count})
              </option>
            ))}
          </select>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.skipSaved}
            disabled={running}
            onChange={(e) => setOptions({ ...options, skipSaved: e.target.checked })}
          />
          Skip bookmarks this extension already saved
        </label>

        <div className="field">
          <label htmlFor="limit">Stop after (blank = no limit)</label>
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
          <p className="help">
            Start with 5–10 to see what the output looks like before committing credits.
          </p>
        </div>

        {plan && (
          <p className="help">
            {plan.count} bookmark{plan.count === 1 ? '' : 's'} will be imported
            {plan.skipped > 0 && `, ${plan.skipped} skipped as already saved`}.
          </p>
        )}
      </section>

      <section>
        <h2>How to import</h2>
        <div className="field">
          <label htmlFor="tags">Tags on every imported bookmark</label>
          <input
            id="tags"
            value={tagInput}
            disabled={running}
            onChange={(e) => setTagInput(e.target.value)}
          />
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.tagsFromFolders}
            disabled={running}
            onChange={(e) =>
              setOptions({ ...options, tagsFromFolders: e.target.checked })
            }
          />
          Turn folder names into tags
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={options.summarize}
            disabled={running}
            onChange={(e) => setOptions({ ...options, summarize: e.target.checked })}
          />
          Also generate AI summaries (a second API call per bookmark)
        </label>

        <div className="field">
          <label htmlFor="delay">Pause between bookmarks</label>
          <select
            id="delay"
            value={options.delayMs}
            disabled={running}
            onChange={(e) => setOptions({ ...options, delayMs: Number(e.target.value) })}
          >
            {DELAYS.map((delay) => (
              <option key={delay.ms} value={delay.ms}>
                {delay.label}
              </option>
            ))}
          </select>
          <p className="help">
            Rate-limited bookmarks are retried with backoff. Running out of credits or a
            rejected key stops the whole run.
          </p>
        </div>
      </section>

      {progress && progress.total > 0 && (
        <section>
          <h2>{running ? 'Importing' : progress.cancelled ? 'Cancelled' : 'Finished'}</h2>
          <div
            className="bar"
            role="progressbar"
            aria-valuenow={progress.index}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label="Bookmarks processed"
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="counts" role="status" aria-live="polite">
            <span>
              <strong>
                {progress.index}/{progress.total}
              </strong>{' '}
              processed
            </span>
            <span>
              <strong>{progress.saved}</strong> saved
            </span>
            <span>
              <strong>{progress.failures.length}</strong> failed
            </span>
            {progress.skipped > 0 && (
              <span>
                <strong>{progress.skipped}</strong> skipped
              </span>
            )}
          </div>
          {running && progress.currentTitle && (
            <p className="help">Now saving: {progress.currentTitle}</p>
          )}
          {progress.abortReason && (
            <div className="status err">{progress.abortReason}</div>
          )}

          {progress.failures.length > 0 && (
            <ul className="failures">
              {progress.failures.map((failure) => (
                <li key={failure.url}>
                  <strong>{failure.title || failure.url}</strong>
                  <div className="url">{failure.url}</div>
                  <div className="help">{failure.error}</div>
                </li>
              ))}
            </ul>
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
            Cancel import
          </button>
        ) : (
          <button
            className="primary"
            onClick={() => void start()}
            disabled={busy || problems.length > 0 || !plan?.count}
          >
            {busy ? 'Starting…' : `Import ${plan?.count ?? 0} bookmarks`}
          </button>
        )}
        {done && (
          <button
            onClick={async () => {
              await browser.runtime.sendMessage({ type: 'clearImport' });
              setProgress(null);
            }}
          >
            Clear results
          </button>
        )}
        <button className="link" onClick={() => void browser.runtime.openOptionsPage()}>
          Options
        </button>
      </div>
    </div>
  );
}
