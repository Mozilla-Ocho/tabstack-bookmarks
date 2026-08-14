import { useEffect, useRef, useState } from 'react';
import { browser } from '#imports';
import { BACKENDS } from '@/src/lib/backends';
import { parseTags, renderFilename } from '@/src/lib/markdown';
import type { SaveRecord, SaveRequest, SaveUpdate } from '@/src/lib/messages';
import { isSaveableUrl } from '@/src/lib/save';
import { configErrors, getSettings, type Settings } from '@/src/lib/settings';

interface TabInfo {
  url: string;
  title: string;
}

export function App() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [record, setRecord] = useState<SaveRecord | null>(null);
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [note, setNote] = useState('');
  const [updateInPlace, setUpdateInPlace] = useState(true);
  const [summarize, setSummarize] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const autoSaved = useRef(false);

  // Boot: current tab + settings + any previous save for this URL.
  useEffect(() => {
    (async () => {
      const [active] = await browser.tabs.query({ active: true, currentWindow: true });
      const info = { url: active?.url ?? '', title: active?.title ?? '' };
      const loaded = await getSettings();
      const previous = (await browser.runtime.sendMessage({
        type: 'getState',
        url: info.url,
      })) as SaveRecord | undefined;

      setTab(info);
      setSettings(loaded);
      setSummarize(loaded.summarize);
      setTitle(previous?.title || info.title);
      setTags((previous?.tags ?? []).join(', '));
      setNote(previous?.note ?? '');
      if (previous) setRecord(previous);

      const busy = previous?.status === 'extracting' || previous?.status === 'storing';
      const shouldAutoSave =
        loaded.autoSave &&
        !previous &&
        !busy &&
        isSaveableUrl(info.url) &&
        configErrors(loaded).length === 0;

      if (shouldAutoSave && !autoSaved.current) {
        autoSaved.current = true;
        void send({
          type: 'save',
          url: info.url,
          title: info.title,
          summarize: loaded.summarize,
        });
      }
    })();
  }, []);

  // Progress arrives from the background, which keeps working if we close.
  useEffect(() => {
    const listener = (message: SaveUpdate) => {
      if (message?.type === 'saveUpdate' && message.record.url === tab?.url) {
        setRecord(message.record);
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, [tab?.url]);

  async function send(request: SaveRequest) {
    setRecord({
      url: request.url,
      title: request.title,
      status: 'extracting',
      tags: request.tags ?? [],
      note: request.note,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const result = (await browser.runtime.sendMessage(request)) as SaveRecord | undefined;
    if (result) setRecord(result);
  }

  function onSave() {
    if (!tab) return;
    void send({
      type: 'save',
      url: tab.url,
      title: title.trim(),
      tags: parseTags(tags),
      note: note.trim() || undefined,
      overwritePath: updateInPlace ? record?.path : undefined,
      summarize,
    });
  }

  if (!tab || !settings) {
    return (
      <div className="popup">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  const problems = configErrors(settings);
  const busy = record?.status === 'extracting' || record?.status === 'storing';
  const saved = record?.status === 'done';
  const previewPath =
    record?.path ??
    renderFilename(settings.filenameTemplate, {
      title: title || tab.title,
      url: tab.url,
      date: new Date(),
    });

  return (
    <div className="popup">
      <header>
        <h1>Save to Tabstack</h1>
        <span className="badge">{BACKENDS[settings.backend].shortLabel}</span>
      </header>

      {problems.length > 0 && (
        <div className="status err">
          {problems.join(' ')}{' '}
          <button className="link" onClick={() => void browser.runtime.openOptionsPage()}>
            Open options
          </button>
        </div>
      )}

      {!isSaveableUrl(tab.url) && (
        <div className="status err">This page is not an http(s) URL, so it cannot be saved.</div>
      )}

      {record && (
        <div className={`status ${saved ? 'ok' : record.status === 'error' ? 'err' : 'busy'}`}>
          {record.status === 'extracting' && 'Extracting markdown via Tabstack…'}
          {record.status === 'storing' && 'Storing markdown…'}
          {saved && (
            <>
              {record.indexed ? 'Saved earlier to ' : 'Saved to '}
              <code>{record.location ?? record.path}</code>
              {record.indexed && ` on ${new Date(record.updatedAt).toLocaleDateString()}`}
              {record.bytes ? ` · ${Math.max(1, Math.round(record.bytes / 1024))} KB` : ''}
              {record.link && (
                <>
                  {' · '}
                  <a href={record.link} target="_blank" rel="noreferrer">
                    view
                  </a>
                </>
              )}
            </>
          )}
          {record.status === 'error' && record.error}
          {record.summaryError && (
            <div className="muted">Summary skipped: {record.summaryError}</div>
          )}
        </div>
      )}

      {record?.summary && <p className="summary">{record.summary}</p>}

      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="tags">Tags (comma separated)</label>
        <input
          id="tags"
          value={tags}
          placeholder="reading, research"
          onChange={(e) => setTags(e.target.value)}
        />
      </div>

      {showDetails && (
        <div className="field">
          <label htmlFor="note">Note</label>
          <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      )}

      <p className="muted">
        {previewPath}
        <br />
        {tab.url}
      </p>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={summarize}
          onChange={(e) => setSummarize(e.target.checked)}
        />
        Summarize with AI
      </label>

      {saved && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={updateInPlace}
            onChange={(e) => setUpdateInPlace(e.target.checked)}
          />
          Overwrite the same file when re-saving
        </label>
      )}

      <footer>
        <button
          className="primary"
          onClick={onSave}
          disabled={busy || !isSaveableUrl(tab.url) || problems.length > 0}
        >
          {busy ? 'Saving…' : saved ? 'Re-save' : 'Save'}
        </button>
        <button onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? 'Less' : 'Note'}
        </button>
        <span className="grow" />
        <button className="link" onClick={() => void browser.runtime.openOptionsPage()}>
          Options
        </button>
      </footer>
    </div>
  );
}
