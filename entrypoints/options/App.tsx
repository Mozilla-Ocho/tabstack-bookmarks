import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { BACKENDS, BACKEND_ORDER } from '@/src/lib/backends';
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
import { extractMarkdown } from '@/src/lib/tabstack';

type Note = { kind: 'ok' | 'err'; text: string } | null;

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

  useEffect(() => {
    void getSettings().then(setLocal);
    void hasHostPermissions().then(setGranted);
    void listRecords().then(setRecent);
    void countSaved().then(setSavedCount);
  }, []);

  // User-supplied destinations need their own origin permission.
  const origin = settings ? backendOrigin(settings) : null;
  useEffect(() => {
    if (!origin) {
      setOriginGranted(true);
      return;
    }
    void hasOrigin(origin).then(setOriginGranted);
  }, [origin]);

  if (!settings) return <div className="options">Loading…</div>;

  const patch = (next: Partial<Settings>) => {
    setLocal({ ...settings, ...next });
    setSaved(false);
  };

  async function persist() {
    await setSettings(settings!);
    setSaved(true);
  }

  async function testKey() {
    setBusy('key');
    setKeyNote(null);
    try {
      await setSettings(settings!);
      const res = await extractMarkdown({
        apiKey: settings!.apiKey,
        url: 'https://example.com',
        effort: 'min',
      });
      setKeyNote({
        kind: 'ok',
        text: `Key works — ${res.content.length} characters returned for example.com.`,
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
        throw new Error(
          `${origin} is not a loopback address, so this build cannot request access to it.`,
        );
      }
      if (origin && !(await hasOrigin(origin)) && !(await requestHostPermissions([origin]))) {
        throw new Error(`Access to ${origin} was not granted.`);
      }
      setOriginGranted(true);

      const text =
        s.backend === 'github'
          ? await verifyGitHub(s.github)
          : s.backend === 'obsidian'
            ? await verifyObsidian(s.obsidian)
            : 'Downloads need no connection check.';
      setDestNote({ kind: 'ok', text });
    } catch (error) {
      setDestNote({ kind: 'err', text: (error as Error).message });
    } finally {
      setBusy(null);
    }
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
          <h1>Tabstack Bookmarks</h1>
        </div>
        <p className="help">
          Tabstack turns the page into markdown. The markdown is written only to the
          destination you configure here.
        </p>
      </header>

      {!granted && (
        <div className="status err">
          Firefox needs your permission to reach api.tabstack.ai and api.github.com.{' '}
          <button
            className="link"
            onClick={async () => setGranted(await requestHostPermissions())}
          >
            Grant access
          </button>
        </div>
      )}

      <section>
        <h2>Tabstack</h2>
        <div className="field">
          <label htmlFor="apiKey">API key</label>
          <input
            id="apiKey"
            type="password"
            autoComplete="off"
            value={settings.apiKey}
            placeholder="ts_…"
            onChange={(e) => patch({ apiKey: e.target.value })}
          />
          <p className="help">
            Stored in extension local storage on this device only. Create one at
            tabstack.ai.
          </p>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="effort">Fetch effort</label>
            <select
              id="effort"
              value={settings.effort}
              onChange={(e) => patch({ effort: e.target.value as Settings['effort'] })}
            >
              <option value="min">min — fastest (1-5s)</option>
              <option value="standard">standard — balanced (3-15s)</option>
              <option value="max">max — full browser render (15-60s)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="scope">Content scope</label>
            <select
              id="scope"
              value={settings.contentScope}
              onChange={(e) =>
                patch({ contentScope: e.target.value as Settings['contentScope'] })
              }
            >
              <option value="main">main — article only</option>
              <option value="full">full — whole page</option>
            </select>
          </div>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.nocache}
            onChange={(e) => patch({ nocache: e.target.checked })}
          />
          Bypass Tabstack cache on every save
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.summarize}
            onChange={(e) => patch({ summarize: e.target.checked })}
          />
          Generate an AI summary, key points and tag suggestions
        </label>
        <p className="help">
          Adds a <code>/generate/json</code> call per save — a second API call, so double
          the credits. The summary lands in the frontmatter and the key points become a{' '}
          <code>## Key points</code> section.
        </p>

        {settings.summarize && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.useSuggestedTags}
              onChange={(e) => patch({ useSuggestedTags: e.target.checked })}
            />
            Add the suggested tags to each bookmark
          </label>
        )}

        <div className="actions">
          <button onClick={() => void testKey()} disabled={busy !== null || !settings.apiKey}>
            {busy === 'key' ? 'Testing…' : 'Test key'}
          </button>
          {keyNote && (
            <span className={`status ${keyNote.kind === 'ok' ? 'ok' : 'err'}`} role="status" aria-live="polite">
              {keyNote.text}
            </span>
          )}
        </div>
      </section>

      <section>
        <h2>Destination</h2>
        <div className="field">
          <label htmlFor="backend">Store markdown in</label>
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
                {BACKENDS[id].label}
              </option>
            ))}
          </select>
        </div>

        {!originGranted && origin && isGrantableOrigin(origin) && (
          <div className="status err" role="status">
            The extension needs permission to reach <code>{origin}</code>.{' '}
            <button
              className="link"
              onClick={async () => setOriginGranted(await requestHostPermissions([origin]))}
            >
              Grant access
            </button>
          </div>
        )}

        {origin && !isGrantableOrigin(origin) && (
          <div className="status err" role="status">
            <code>{origin}</code> is not a loopback address. This build can only be
            granted access to <code>localhost</code> and <code>127.0.0.1</code>; a vault on
            another machine needs its pattern added to{' '}
            <code>optional_host_permissions</code> and a rebuild.
          </div>
        )}

        {settings.backend === 'github' && (
          <>
            <div className="field">
              <label htmlFor="token">GitHub token</label>
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
                Fine-grained token with <code>Contents: read and write</code> on the
                target repo.
              </p>
            </div>
            <div className="row">
              <div className="field">
                <label htmlFor="owner">Owner</label>
                <input
                  id="owner"
                  value={settings.github.owner}
                  onChange={(e) =>
                    patch({ github: { ...settings.github, owner: e.target.value.trim() } })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="repo">Repo</label>
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
                <label htmlFor="branch">Branch</label>
                <input
                  id="branch"
                  value={settings.github.branch}
                  onChange={(e) =>
                    patch({ github: { ...settings.github, branch: e.target.value.trim() } })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="ghFolder">Folder in repo</label>
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
            <label htmlFor="dlFolder">Subfolder of your download directory</label>
            <input
              id="dlFolder"
              value={settings.download.folder}
              placeholder="tabstack"
              onChange={(e) => patch({ download: { folder: e.target.value } })}
            />
            <p className="help">
              Browsers can only write inside the download directory. Point the browser's
              download folder at your vault (or symlink it) to land files in Obsidian.
            </p>
          </div>
        )}

        {settings.backend === 'obsidian' && (
          <>
            <div className="row">
              <div className="field">
                <label htmlFor="obsUrl">Local REST API URL</label>
                <input
                  id="obsUrl"
                  value={settings.obsidian.baseUrl}
                  placeholder="http://127.0.0.1:27123"
                  onChange={(e) =>
                    patch({ obsidian: { ...settings.obsidian, baseUrl: e.target.value.trim() } })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor="obsFolder">Folder in vault</label>
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
              <label htmlFor="obsToken">Local REST API key</label>
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
                Needs the Local REST API community plugin, with Obsidian running. Use its
                HTTP port (default 27123) — the HTTPS port uses a self-signed certificate
                that extensions refuse.
              </p>
            </div>
          </>
        )}


        {settings.backend !== 'download' && (
          <div className="actions">
            <button onClick={() => void testDestination()} disabled={busy !== null}>
              {busy === 'dest' ? 'Checking…' : 'Test destination'}
            </button>
            {destNote && (
              <span className={`status ${destNote.kind === 'ok' ? 'ok' : 'err'}`} role="status" aria-live="polite">
                {destNote.text}
              </span>
            )}
          </div>
        )}
      </section>

      <section>
        <h2>Files</h2>
        <div className="field">
          <label htmlFor="template">Filename template</label>
          <input
            id="template"
            value={settings.filenameTemplate}
            onChange={(e) => patch({ filenameTemplate: e.target.value })}
          />
          <p className="help">
            Tokens: <code>{'{date}'}</code> <code>{'{yyyy}'}</code> <code>{'{mm}'}</code>{' '}
            <code>{'{dd}'}</code> <code>{'{slug}'}</code> <code>{'{title}'}</code>{' '}
            <code>{'{host}'}</code>. Slashes create folders. Example: <code>{preview}</code>
          </p>
        </div>

        <div className="field">
          <label htmlFor="defaultTags">Tags added to every bookmark</label>
          <input
            id="defaultTags"
            value={settings.defaultTags.join(', ')}
            placeholder="bookmark, inbox"
            onChange={(e) => patch({ defaultTags: parseTags(e.target.value) })}
          />
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.autoSave}
            onChange={(e) => patch({ autoSave: e.target.checked })}
          />
          Start saving as soon as the popup opens
        </label>
        <p className="help">
          <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> saves the active tab without opening
          the popup.
        </p>
      </section>

      <section>
        <h2>Existing bookmarks</h2>
        <p className="help">
          Convert bookmarks you already have into markdown, folder by folder. Runs in the
          background, one bookmark at a time.
        </p>
        <div className="actions">
          <button
            onClick={() =>
              void browser.tabs.create({ url: browser.runtime.getURL('/import.html') })
            }
          >
            Open bookmark import
          </button>
        </div>
      </section>

      <section>
        <h2>Recent saves</h2>
        {recent.length === 0 ? (
          <p className="help">Nothing saved yet.</p>
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
                        : 'in progress…'}
                    {item.link && (
                      <>
                        {' · '}
                        <a href={item.link} target="_blank" rel="noreferrer">
                          open
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
            ? 'Counting…'
            : `${savedCount.toLocaleString()} page${savedCount === 1 ? '' : 's'} saved in total. ` +
              'This list shows the 30 most recent; the full set is remembered so imports can skip what is already saved.'}
        </p>
        <div className="actions">
          <button
            onClick={() => {
              void listRecords().then(setRecent);
              void countSaved().then(setSavedCount);
            }}
          >
            Refresh
          </button>
          <button
            onClick={async () => {
              if (
                !confirm(
                  'Forget which pages have been saved? Your markdown files are untouched, but the next import will re-save everything.',
                )
              ) {
                return;
              }
              await clearSaved();
              setSavedCount(0);
            }}
          >
            Forget saved history
          </button>
        </div>
      </section>

      <div className="actions">
        <button className="primary" onClick={() => void persist()}>
          Save settings
        </button>
        <button
          onClick={() => {
            setLocal({ ...DEFAULT_SETTINGS, apiKey: settings.apiKey });
            setSaved(false);
          }}
        >
          Reset to defaults
        </button>
        {saved && <span className="status ok">Saved.</span>}
      </div>
    </div>
  );
}
