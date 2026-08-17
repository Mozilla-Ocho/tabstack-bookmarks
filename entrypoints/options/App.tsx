/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Fragment, useEffect, useRef, useState } from 'react';
import { browser } from '#imports';
import { i18n } from '#i18n';
import { backendLabel } from '@/src/ui/backendLabels';
import { rich, slots } from '@/src/ui/rich';
import { BACKEND_ORDER } from '@/src/lib/backends';
import { verifyGitHub } from '@/src/lib/backends/github';
import { verifyObsidian } from '@/src/lib/backends/obsidian';
import { parseTags, renderFilename } from '@/src/lib/markdown';
import type { SaveRecord } from '@/src/lib/messages';
import {
  hasHostPermissions,
  hasOrigin,
  requestHostPermissions,
} from '@/src/lib/permissions';
import { listRecords } from '@/src/lib/saveStore';
import { clearSaved, countSaved } from '@/src/lib/savedIndex';
import {
  backendOrigin,
  isGrantableOrigin,
  DEFAULT_SETTINGS,
  getSettings,
  setSettings,
  type Settings,
} from '@/src/lib/settings';
import {
  applySettingsFile,
  buildSettingsFile,
  parseSettingsFile,
  settingsFilename,
} from '@/src/lib/settingsFile';
import { canRebind, rebind, resetShortcut, savedShortcut } from '@/src/lib/shortcuts';
import { extractMarkdown } from '@/src/lib/tabstack';

type Note = { kind: 'ok' | 'err'; text: string } | null;

/** Filename template tokens, listed in the help text under the field. */
const TEMPLATE_TOKENS = [
  '{date}',
  '{yyyy}',
  '{mm}',
  '{dd}',
  '{slug}',
  '{title}',
  '{host}',
];

export function App() {
  const [settings, setLocal] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [granted, setGranted] = useState(true);
  const [originGranted, setOriginGranted] = useState(true);
  const [keyNote, setKeyNote] = useState<Note>(null);
  const [destNote, setDestNote] = useState<Note>(null);
  const [recent, setRecent] = useState<SaveRecord[]>([]);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<'key' | 'dest' | null>(null);
  const [dirty, setDirty] = useState(false);
  const [shortcut, setShortcut] = useState('');
  const [shortcutInput, setShortcutInput] = useState('');
  const [shortcutNote, setShortcutNote] = useState<Note>(null);
  const [backupNote, setBackupNote] = useState<Note>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSettings().then(setLocal);
    void hasHostPermissions().then(setGranted);
    void listRecords().then(setRecent);
    void countSaved().then(setSavedCount);
    void savedShortcut().then((current) => {
      setShortcut(current);
      setShortcutInput(current);
    });
  }, []);

  // User-supplied destinations need their own origin permission.
  const origin = settings ? backendOrigin(settings) : null;
  useEffect(() => {
    let alive = true;
    void (async () => {
      const granted = origin ? await hasOrigin(origin) : true;
      if (alive) setOriginGranted(granted);
    })();
    return () => {
      alive = false;
    };
  }, [origin]);

  /**
   * Nothing here writes as you type — a half-typed API key or repo name would
   * make every save fail — so leaving with edits pending loses them. Warn first.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!settings) return <div className="options">{i18n.t('common.loading')}</div>;

  const patch = (next: Partial<Settings>) => {
    setLocal({ ...settings, ...next });
    setSaved(false);
    setDirty(true);
  };

  async function persist() {
    await setSettings(settings!);
    setSaved(true);
    setDirty(false);
  }

  async function testKey() {
    setBusy('key');
    setKeyNote(null);
    try {
      // Testing the key stores it, so the result describes what is saved rather
      // than what is only typed in.
      await setSettings(settings!);
      setSaved(true);
      setDirty(false);
      const res = await extractMarkdown({
        apiKey: settings!.apiKey,
        url: 'https://example.com',
        effort: 'min',
      });
      setKeyNote({
        kind: 'ok',
        text: i18n.t('options.keyWorks', [String(res.content.length)]),
      });
    } catch (error) {
      setKeyNote({ kind: 'err', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  /** Runs the active backend's own connection check. */
  async function testDestination() {
    setBusy('dest');
    setDestNote(null);
    try {
      const s = settings!;
      if (origin && !isGrantableOrigin(origin)) {
        throw new Error(i18n.t('options.originNotGrantable', [origin]));
      }
      if (
        origin &&
        !(await hasOrigin(origin)) &&
        !(await requestHostPermissions([origin]))
      ) {
        throw new Error(i18n.t('options.originRefused', [origin]));
      }
      setOriginGranted(true);

      const text =
        s.backend === 'github'
          ? await verifyGitHub(s.github)
          : s.backend === 'obsidian'
            ? await verifyObsidian(s.obsidian)
            : i18n.t('options.downloadsNoCheck');
      setDestNote({ kind: 'ok', text });
    } catch (error) {
      setDestNote({ kind: 'err', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function changeShortcut() {
    setShortcutNote(null);
    // The browser is the authority on what a valid shortcut is; report its
    // complaint rather than second-guessing it.
    const error = await rebind(shortcutInput.trim());
    if (error) {
      setShortcutNote({ kind: 'err', text: error });
      return;
    }
    setShortcut(await savedShortcut());
    setShortcutNote({ kind: 'ok', text: i18n.t('options.shortcutChanged') });
  }

  async function restoreShortcut() {
    setShortcutNote(null);
    const error = await resetShortcut();
    if (error) {
      setShortcutNote({ kind: 'err', text: error });
      return;
    }
    const current = await savedShortcut();
    setShortcut(current);
    setShortcutInput(current);
    setShortcutNote({ kind: 'ok', text: i18n.t('options.shortcutChanged') });
  }

  async function exportToFile() {
    setBackupNote(null);
    const now = new Date();
    const file = buildSettingsFile(await getSettings(), now);
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
      // saveAs, because this is a file someone chose to keep.
      await browser.downloads.download({
        url,
        filename: settingsFilename(now),
        saveAs: true,
      });
    } catch (error) {
      setBackupNote({ kind: 'err', text: (error as Error).message });
    } finally {
      // Long enough for the download to have read it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }

  async function importFromFile(file: File | undefined) {
    setBackupNote(null);
    if (!file) return;

    const { settings: patched, error } = parseSettingsFile(await file.text());
    if (error || !patched) {
      setBackupNote({ kind: 'err', text: error ?? i18n.t('errors.unknown') });
      return;
    }

    // Into the form, not into storage: an import is a proposal, and the page
    // already knows how to show unsaved changes.
    setLocal({ ...settings!, ...applySettingsFile(settings!, patched) });
    setSaved(false);
    setDirty(true);
    setBackupNote({ kind: 'ok', text: i18n.t('options.imported', [file.name]) });
    if (fileInput.current) fileInput.current.value = '';
  }

  const preview = renderFilename(settings.filenameTemplate, {
    title: 'How Attention Works',
    url: 'https://example.com/blog/how-attention-works',
    date: new Date(),
  });

  return (
    <div className="options">
      <header>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>{i18n.t('extName')}</h1>
        </div>
        <p className="help">{i18n.t('options.help')}</p>
      </header>

      {!granted && (
        <div className="status err">
          {i18n.t('options.grantHosts')}{' '}
          <button
            className="link"
            onClick={async () => setGranted(await requestHostPermissions())}
          >
            {i18n.t('options.grantAccess')}
          </button>
        </div>
      )}

      <section>
        <h2>{i18n.t('options.tabstackHeading')}</h2>
        <div className="field">
          <label htmlFor="apiKey">{i18n.t('options.apiKeyLabel')}</label>
          <input
            id="apiKey"
            type="password"
            autoComplete="off"
            value={settings.apiKey}
            placeholder="ts_…"
            onChange={(e) => patch({ apiKey: e.target.value })}
          />
          <p className="help">{i18n.t('options.apiKeyHelp')}</p>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="effort">{i18n.t('options.effortLabel')}</label>
            <select
              id="effort"
              value={settings.effort}
              onChange={(e) => patch({ effort: e.target.value as Settings['effort'] })}
            >
              <option value="min">{i18n.t('options.effortMin')}</option>
              <option value="standard">{i18n.t('options.effortStandard')}</option>
              <option value="max">{i18n.t('options.effortMax')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="scope">{i18n.t('options.scopeLabel')}</label>
            <select
              id="scope"
              value={settings.contentScope}
              onChange={(e) =>
                patch({ contentScope: e.target.value as Settings['contentScope'] })
              }
            >
              <option value="main">{i18n.t('options.scopeMain')}</option>
              <option value="full">{i18n.t('options.scopeFull')}</option>
            </select>
          </div>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.nocache}
            onChange={(e) => patch({ nocache: e.target.checked })}
          />
          {i18n.t('options.nocache')}
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.summarize}
            onChange={(e) => patch({ summarize: e.target.checked })}
          />
          {i18n.t('options.summarize')}
        </label>
        <p className="help">
          {rich(i18n.t('options.summarizeHelp', slots(2)), [
            <code key="call">/generate/json</code>,
            <code key="heading">## Key points</code>,
          ])}
        </p>

        {settings.summarize && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.useSuggestedTags}
              onChange={(e) => patch({ useSuggestedTags: e.target.checked })}
            />
            {i18n.t('options.useSuggestedTags')}
          </label>
        )}

        <div className="actions">
          <button
            onClick={() => void testKey()}
            disabled={busy !== null || !settings.apiKey}
          >
            {busy === 'key' ? i18n.t('options.testingKey') : i18n.t('options.testKey')}
          </button>
          {keyNote && (
            <span
              className={`status ${keyNote.kind === 'ok' ? 'ok' : 'err'}`}
              role="status"
              aria-live="polite"
            >
              {keyNote.text}
            </span>
          )}
        </div>
      </section>

      <section>
        <h2>{i18n.t('options.destinationHeading')}</h2>
        <div className="field">
          <label htmlFor="backend">{i18n.t('options.backendLabel')}</label>
          <select
            id="backend"
            value={settings.backend}
            onChange={(e) => {
              patch({ backend: e.target.value as Settings['backend'] });
              setDestNote(null);
            }}
          >
            {BACKEND_ORDER.map((id) => (
              <option key={id} value={id}>
                {backendLabel(id)}
              </option>
            ))}
          </select>
        </div>

        {!originGranted && origin && isGrantableOrigin(origin) && (
          <div className="status err" role="status">
            {rich(i18n.t('options.grantOrigin', slots(1)), [
              <code key="origin">{origin}</code>,
            ])}{' '}
            <button
              className="link"
              onClick={async () =>
                setOriginGranted(await requestHostPermissions([origin]))
              }
            >
              {i18n.t('options.grantAccess')}
            </button>
          </div>
        )}

        {origin && !isGrantableOrigin(origin) && (
          <div className="status err" role="status">
            {rich(i18n.t('options.originNotLoopback', slots(4)), [
              <code key="origin">{origin}</code>,
              <code key="localhost">localhost</code>,
              <code key="loopback">127.0.0.1</code>,
              <code key="key">optional_host_permissions</code>,
            ])}
          </div>
        )}

        {settings.backend === 'github' && (
          <>
            <div className="field">
              <label htmlFor="token">{i18n.t('options.githubTokenLabel')}</label>
              <input
                id="token"
                type="password"
                autoComplete="off"
                value={settings.github.token}
                placeholder="github_pat_…"
                onChange={(e) =>
                  patch({ github: { ...settings.github, token: e.target.value } })
                }
              />
              <p className="help">
                {rich(i18n.t('options.githubTokenHelp', slots(1)), [
                  <code key="perm">Contents: read and write</code>,
                ])}
              </p>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="owner">{i18n.t('options.ownerLabel')}</label>
                <input
                  id="owner"
                  value={settings.github.owner}
                  onChange={(e) =>
                    patch({
                      github: { ...settings.github, owner: e.target.value.trim() },
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="repo">{i18n.t('options.repoLabel')}</label>
                <input
                  id="repo"
                  value={settings.github.repo}
                  onChange={(e) =>
                    patch({ github: { ...settings.github, repo: e.target.value.trim() } })
                  }
                />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="branch">{i18n.t('options.branchLabel')}</label>
                <input
                  id="branch"
                  value={settings.github.branch}
                  onChange={(e) =>
                    patch({
                      github: { ...settings.github, branch: e.target.value.trim() },
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="ghFolder">{i18n.t('options.githubFolderLabel')}</label>
                <input
                  id="ghFolder"
                  value={settings.github.folder}
                  placeholder="bookmarks"
                  onChange={(e) =>
                    patch({ github: { ...settings.github, folder: e.target.value } })
                  }
                />
              </div>
            </div>
          </>
        )}

        {settings.backend === 'download' && (
          <div className="field">
            <label htmlFor="dlFolder">{i18n.t('options.downloadFolderLabel')}</label>
            <input
              id="dlFolder"
              value={settings.download.folder}
              placeholder="tabstack"
              onChange={(e) => patch({ download: { folder: e.target.value } })}
            />
            <p className="help">{i18n.t('options.downloadFolderHelp')}</p>
          </div>
        )}

        {settings.backend === 'obsidian' && (
          <>
            <div className="row">
              <div className="field">
                <label htmlFor="obsUrl">{i18n.t('options.obsidianUrlLabel')}</label>
                <input
                  id="obsUrl"
                  value={settings.obsidian.baseUrl}
                  placeholder="http://127.0.0.1:27123"
                  onChange={(e) =>
                    patch({
                      obsidian: { ...settings.obsidian, baseUrl: e.target.value.trim() },
                    })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="obsFolder">{i18n.t('options.obsidianFolderLabel')}</label>
                <input
                  id="obsFolder"
                  value={settings.obsidian.folder}
                  placeholder="Bookmarks"
                  onChange={(e) =>
                    patch({ obsidian: { ...settings.obsidian, folder: e.target.value } })
                  }
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="obsToken">{i18n.t('options.obsidianTokenLabel')}</label>
              <input
                id="obsToken"
                type="password"
                autoComplete="off"
                value={settings.obsidian.token}
                onChange={(e) =>
                  patch({ obsidian: { ...settings.obsidian, token: e.target.value } })
                }
              />
              <p className="help">
                {rich(i18n.t('options.obsidianTokenHelp', slots(1)), [
                  <em key="option">Non-encrypted (HTTP) Server</em>,
                ])}
              </p>
            </div>
          </>
        )}

        {settings.backend !== 'download' && (
          <div className="actions">
            <button onClick={() => void testDestination()} disabled={busy !== null}>
              {busy === 'dest'
                ? i18n.t('options.testingDestination')
                : i18n.t('options.testDestination')}
            </button>
            {destNote && (
              <span
                className={`status ${destNote.kind === 'ok' ? 'ok' : 'err'}`}
                role="status"
                aria-live="polite"
              >
                {destNote.text}
              </span>
            )}
          </div>
        )}
      </section>

      <section>
        <h2>{i18n.t('options.filesHeading')}</h2>
        <div className="field">
          <label htmlFor="template">{i18n.t('options.templateLabel')}</label>
          <input
            id="template"
            value={settings.filenameTemplate}
            onChange={(e) => patch({ filenameTemplate: e.target.value })}
          />
          <p className="help">
            {rich(i18n.t('options.templateHelp', slots(2)), [
              <span key="tokens">
                {TEMPLATE_TOKENS.map((token, i) => (
                  <Fragment key={token}>
                    {i > 0 && ' '}
                    <code>{token}</code>
                  </Fragment>
                ))}
              </span>,
              <code key="preview">{preview}</code>,
            ])}
          </p>
        </div>

        <div className="field">
          <label htmlFor="defaultTags">{i18n.t('options.defaultTagsLabel')}</label>
          <input
            id="defaultTags"
            value={settings.defaultTags.join(', ')}
            placeholder={i18n.t('options.defaultTagsPlaceholder')}
            onChange={(e) => patch({ defaultTags: parseTags(e.target.value) })}
          />
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.autoSave}
            onChange={(e) => patch({ autoSave: e.target.checked })}
          />
          {i18n.t('options.autoSave')}
        </label>
        <p className="help">
          {rich(i18n.t('options.shortcutHelp', slots(1)), [
            <span key="keys">
              <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>
            </span>,
          ])}
        </p>
      </section>

      <section>
        <h2>{i18n.t('options.existingHeading')}</h2>
        <p className="help">{i18n.t('options.existingHelp')}</p>
        <div className="actions">
          <button
            onClick={() =>
              void browser.tabs.create({ url: browser.runtime.getURL('/import.html') })
            }
          >
            {i18n.t('options.openImport')}
          </button>
        </div>
      </section>

      <section>
        <h2>{i18n.t('options.shortcutHeading')}</h2>
        <p className="help">
          {shortcut
            ? i18n.t('options.shortcutCurrent', [shortcut])
            : i18n.t('options.shortcutUnbound')}
        </p>

        {canRebind() ? (
          <>
            <div className="field">
              <label htmlFor="shortcut">{i18n.t('options.shortcutLabel')}</label>
              <input
                id="shortcut"
                value={shortcutInput}
                placeholder={i18n.t('options.shortcutPlaceholder')}
                onChange={(e) => setShortcutInput(e.target.value)}
              />
            </div>
            <div className="actions">
              <button
                onClick={() => void changeShortcut()}
                disabled={!shortcutInput.trim()}
              >
                {i18n.t('options.shortcutSave')}
              </button>
              <button onClick={() => void restoreShortcut()}>
                {i18n.t('options.shortcutReset')}
              </button>
              {shortcutNote && (
                <span
                  className={`status ${shortcutNote.kind === 'ok' ? 'ok' : 'err'}`}
                  role="status"
                  aria-live="polite"
                >
                  {shortcutNote.text}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Chrome will not let an extension rebind its own shortcut. */}
            <p className="help">{i18n.t('options.shortcutBrowserHelp')}</p>
            <div className="actions">
              <button
                onClick={() =>
                  void browser.tabs.create({ url: 'chrome://extensions/shortcuts' })
                }
              >
                {i18n.t('options.shortcutOpenBrowser')}
              </button>
            </div>
          </>
        )}
      </section>

      <section>
        <h2>{i18n.t('options.syncHeading')}</h2>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.syncSettings}
            onChange={(e) => patch({ syncSettings: e.target.checked })}
          />
          {i18n.t('options.syncSettings')}
        </label>
        <p className="help">{i18n.t('options.syncHelp')}</p>
      </section>

      <section>
        <h2>{i18n.t('options.backupHeading')}</h2>
        <p className="help">{i18n.t('options.backupHelp')}</p>
        <div className="actions">
          <button onClick={() => void exportToFile()}>{i18n.t('options.export')}</button>
          <button onClick={() => fileInput.current?.click()}>
            {i18n.t('options.import')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => void importFromFile(e.target.files?.[0])}
          />
          {backupNote && (
            <span
              className={`status ${backupNote.kind === 'ok' ? 'ok' : 'err'}`}
              role="status"
              aria-live="polite"
            >
              {backupNote.text}
            </span>
          )}
        </div>
      </section>

      <section>
        <h2>{i18n.t('options.recentHeading')}</h2>
        {recent.length === 0 ? (
          <p className="help">{i18n.t('options.nothingSaved')}</p>
        ) : (
          <ul className="recent">
            {recent.map((item) => (
              <li key={item.url}>
                <span className={`dot ${item.status}`} aria-hidden="true" />
                <div>
                  <strong>{item.title || item.url}</strong>
                  <div className="help">
                    {item.status === 'done'
                      ? item.location
                      : item.status === 'error'
                        ? item.error
                        : i18n.t('options.inProgress')}
                    {item.link && (
                      <>
                        {' · '}
                        <a href={item.link} target="_blank" rel="noreferrer">
                          {i18n.t('options.open')}
                        </a>
                      </>
                    )}
                  </div>
                </div>
                <time className="help" dateTime={new Date(item.updatedAt).toISOString()}>
                  {new Date(item.updatedAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
        <p className="help">
          {savedCount === null
            ? i18n.t('options.counting')
            : i18n.t('options.savedTotal', savedCount, [savedCount.toLocaleString()])}
        </p>
        <div className="actions">
          <button
            onClick={() => {
              void listRecords().then(setRecent);
              void countSaved().then(setSavedCount);
            }}
          >
            {i18n.t('common.refresh')}
          </button>
          <button
            className="primary"
            onClick={() =>
              void browser.tabs.create({ url: browser.runtime.getURL('/library.html') })
            }
          >
            {i18n.t('options.openLibrary')}
          </button>
          <button
            onClick={async () => {
              if (!confirm(i18n.t('options.forgetSavedConfirm'))) return;
              await clearSaved();
              setSavedCount(0);
            }}
          >
            {i18n.t('options.forgetSaved')}
          </button>
        </div>
      </section>

      <div className="actions">
        <button className="primary" onClick={() => void persist()}>
          {i18n.t('options.saveSettings')}
        </button>
        <button
          onClick={() => {
            setLocal({ ...DEFAULT_SETTINGS, apiKey: settings.apiKey });
            setSaved(false);
            setDirty(true);
          }}
        >
          {i18n.t('options.resetDefaults')}
        </button>
        {saved && <span className="status ok">{i18n.t('common.saved')}</span>}
        {dirty && (
          <span className="status err" role="status">
            {i18n.t('common.unsavedChanges')}
          </span>
        )}
      </div>
    </div>
  );
}
