/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { i18n } from '#i18n';
import { isErrorReply, type SaveRecord } from '@/src/lib/messages';
import type { SavedEntry, SearchResult } from '@/src/lib/savedIndex';
import { getSettings, type Settings } from '@/src/lib/settings';
import { backendShortLabel } from '@/src/ui/backendLabels';

/**
 * How many rows to render at once.
 *
 * The index can hold 50,000 entries. Searching all of them is one pass in the
 * background; painting all of them is thousands of DOM nodes nobody scrolls to.
 */
const PAGE = 50;

/** A link to the saved file, when the destination has one we can rebuild. */
function fileLink(entry: SavedEntry, settings: Settings): string | undefined {
  if (entry.backend === 'obsidian') {
    return `obsidian://open?file=${encodeURIComponent(entry.path)}`;
  }
  // GitHub's blob URL needs the repo it went to, which is only in the current
  // settings — so offer it only while those still point at the same place.
  if (entry.backend === 'github' && settings.backend === 'github') {
    const { owner, repo, branch } = settings.github;
    if (!owner || !repo) return undefined;
    return `https://github.com/${owner}/${repo}/blob/${branch}/${entry.path}`;
  }
  // Downloads land wherever the browser put them; there is no URL to offer.
  return undefined;
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  /**
   * One place loads the list: the query, the window size and this counter are its
   * only inputs, so re-saving or forgetting a row just bumps the counter rather
   * than each having its own copy of the fetch.
   *
   * It re-runs on every keystroke, undebounced — the search is a filter over data
   * the background already holds, so waiting would only add lag.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      const reply = await browser.runtime.sendMessage({
        type: 'searchSaved',
        query,
        limit,
      });
      if (!alive) return;
      if (isErrorReply(reply)) {
        setFailure(reply.error);
        return;
      }
      setResult(reply as SearchResult);
    })();
    return () => {
      alive = false;
    };
  }, [query, limit, reloads]);

  async function resave(entry: SavedEntry) {
    setBusy(entry.url);
    setNote(null);
    try {
      const reply = await browser.runtime.sendMessage({
        type: 'save',
        url: entry.url,
        title: entry.title ?? '',
        // In place, so a refreshed page replaces the file it came from rather
        // than leaving two copies to reconcile.
        overwritePath: entry.path,
      });
      if (isErrorReply(reply)) {
        setFailure(reply.error);
        return;
      }
      const record = reply as SaveRecord;
      if (record.status === 'error') {
        setFailure(record.error ?? i18n.t('errors.unknown'));
        return;
      }
      setNote(i18n.t('library.resaved', [record.title || entry.url]));
      setReloads((n) => n + 1);
    } finally {
      setBusy(null);
    }
  }

  async function forget(entry: SavedEntry) {
    if (!confirm(i18n.t('library.forgetConfirm', [entry.title || entry.url]))) return;
    const reply = await browser.runtime.sendMessage({
      type: 'clearState',
      url: entry.url,
    });
    if (isErrorReply(reply)) {
      setFailure(reply.error);
      return;
    }
    setReloads((n) => n + 1);
  }

  if (!settings || !result) {
    return <div className="options">{i18n.t('common.loading')}</div>;
  }

  const { entries, matched, total } = result;

  return (
    <div className="options">
      <header>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>{i18n.t('library.title')}</h1>
        </div>
        <p className="help">{i18n.t('library.help')}</p>
      </header>

      {failure && (
        <div className="status err" role="alert">
          {failure}
        </div>
      )}
      {note && (
        <div className="status ok" role="status">
          {note}
        </div>
      )}

      <section>
        <div className="field">
          <label htmlFor="q">{i18n.t('library.searchLabel')}</label>
          <input
            id="q"
            type="search"
            value={query}
            placeholder={i18n.t('library.searchPlaceholder')}
            onChange={(event) => {
              setQuery(event.target.value);
              // A new search starts from the top of the list, not from wherever
              // "show more" had got to.
              setLimit(PAGE);
            }}
          />
          <p className="help" role="status" aria-live="polite">
            {query.trim()
              ? i18n.t('library.matched', matched, [matched.toLocaleString()])
              : i18n.t('library.total', total, [total.toLocaleString()])}{' '}
            {entries.length < matched &&
              i18n.t('library.showing', [
                entries.length.toLocaleString(),
                matched.toLocaleString(),
              ])}
          </p>
        </div>

        {entries.length > 0 && (
          <ul className="recent saved">
            {entries.map((entry) => {
              const link = fileLink(entry, settings);
              return (
                <li key={entry.url}>
                  <div>
                    <strong>{entry.title || entry.url}</strong>
                    <div className="url">{entry.url}</div>
                    <div className="help">
                      {entry.location ?? entry.path}
                      {entry.backend && ` · ${backendShortLabel(entry.backend)}`}
                      {link && (
                        <>
                          {' · '}
                          <a href={link} target="_blank" rel="noreferrer">
                            {i18n.t('library.open')}
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                  <time className="help" dateTime={new Date(entry.savedAt).toISOString()}>
                    {new Date(entry.savedAt).toLocaleDateString()}
                  </time>
                  <div className="row-actions">
                    <button onClick={() => void resave(entry)} disabled={busy !== null}>
                      {busy === entry.url
                        ? i18n.t('library.resaving')
                        : i18n.t('library.resave')}
                    </button>
                    <button className="link" onClick={() => void forget(entry)}>
                      {i18n.t('library.forget')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {entries.length < matched && (
          <div className="actions">
            <button onClick={() => setLimit((current) => current + PAGE)}>
              {i18n.t('library.loadMore')}
            </button>
          </div>
        )}
      </section>

      <div className="actions">
        <button className="link" onClick={() => void browser.runtime.openOptionsPage()}>
          {i18n.t('common.options')}
        </button>
      </div>
    </div>
  );
}
