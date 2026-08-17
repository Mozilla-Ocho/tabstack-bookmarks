/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { useEffect, useRef, useState } from 'react';
import { browser } from '#imports';
import { i18n } from '#i18n';
import { parseTags, renderFilename } from '@/src/lib/markdown';
import {
  isErrorReply,
  type SaveRecord,
  type SaveRequest,
  type SaveUpdate,
} from '@/src/lib/messages';
import { isSaveableUrl } from '@/src/lib/save';
import { backendShortLabel } from '@/src/ui/backendLabels';
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
      const stateReply = await browser.runtime.sendMessage({
        type: 'getState',
        url: info.url,
      });
      const previous = isErrorReply(stateReply)
        ? undefined
        : (stateReply as SaveRecord | undefined);

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
    const reply = await browser.runtime.sendMessage(request);
    if (isErrorReply(reply)) {
      setRecord(
        (current) =>
          ({
            ...(current ?? {
              url: request.url,
              title: request.title,
              tags: [],
              startedAt: Date.now(),
            }),
            status: 'error',
            error: reply.error,
            updatedAt: Date.now(),
          }) as SaveRecord,
      );
      return;
    }
    if (reply) setRecord(reply as SaveRecord);
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
        <p className="muted">{i18n.t('common.loading')}</p>
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
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>{i18n.t('popup.title')}</h1>
        </div>
        <span className="badge">{backendShortLabel(settings.backend)}</span>
      </header>

      {problems.length > 0 && (
        <div className="status err">
          {problems.join(' ')}{' '}
          <button className="link" onClick={() => void browser.runtime.openOptionsPage()}>
            {i18n.t('common.openOptions')}
          </button>
        </div>
      )}

      {!isSaveableUrl(tab.url) && (
        <div className="status err">{i18n.t('popup.notHttp')}</div>
      )}

      {record && (
        <div
          className={`status ${saved ? 'ok' : record.status === 'error' ? 'err' : 'busy'}`}
          role="status"
          aria-live="polite"
        >
          {record.status === 'extracting' && i18n.t('popup.extracting')}
          {record.status === 'storing' && i18n.t('popup.storing')}
          {saved && (
            <>
              {record.indexed ? i18n.t('popup.savedEarlierTo') : i18n.t('popup.savedTo')}
              <code>{record.location ?? record.path}</code>
              {record.indexed &&
                ` ${i18n.t('popup.savedOn', [
                  new Date(record.updatedAt).toLocaleDateString(),
                ])}`}
              {record.bytes
                ? ` · ${Math.max(1, Math.round(record.bytes / 1024))} KB`
                : ''}
              {record.link && (
                <>
                  {' · '}
                  <a href={record.link} target="_blank" rel="noreferrer">
                    {i18n.t('popup.view')}
                  </a>
                </>
              )}
            </>
          )}
          {record.status === 'error' && record.error}
          {record.summaryError && (
            <div className="muted">
              {i18n.t('popup.summarySkipped', [record.summaryError])}
            </div>
          )}
        </div>
      )}

      {record?.summary && <p className="summary">{record.summary}</p>}

      <div className="field">
        <label htmlFor="title">{i18n.t('popup.titleLabel')}</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="field">
        <label htmlFor="tags">{i18n.t('popup.tagsLabel')}</label>
        <input
          id="tags"
          value={tags}
          placeholder={i18n.t('popup.tagsPlaceholder')}
          onChange={(e) => setTags(e.target.value)}
        />
      </div>

      {showDetails && (
        <div className="field">
          <label htmlFor="note">{i18n.t('popup.noteLabel')}</label>
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
        {i18n.t('popup.summarize')}
      </label>

      {saved && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={updateInPlace}
            onChange={(e) => setUpdateInPlace(e.target.checked)}
          />
          {i18n.t('popup.overwrite')}
        </label>
      )}

      <footer>
        <button
          className="primary"
          onClick={onSave}
          disabled={busy || !isSaveableUrl(tab.url) || problems.length > 0}
        >
          {busy
            ? i18n.t('popup.saving')
            : saved
              ? i18n.t('popup.resave')
              : i18n.t('popup.save')}
        </button>
        <button onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? i18n.t('popup.lessButton') : i18n.t('popup.noteButton')}
        </button>
        <span className="grow" />
        <button className="link" onClick={() => void browser.runtime.openOptionsPage()}>
          {i18n.t('common.options')}
        </button>
      </footer>
    </div>
  );
}
