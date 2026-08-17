/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';
import { i18n } from '#i18n';
import { joinPath } from '../markdown';
import type { Settings } from '../settings';
import {
  toBase64,
  type SavePayload,
  type SaveResult,
  type StorageBackend,
} from './types';

/**
 * Blob URLs are unavailable inside a Chrome MV3 service worker but fine in a
 * Firefox event page, so prefer them and fall back to a data URL.
 */
function contentUrl(markdown: string): { url: string; revoke: () => void } {
  if (typeof URL.createObjectURL === 'function' && typeof Blob === 'function') {
    try {
      const url = URL.createObjectURL(
        new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      );
      return { url, revoke: () => URL.revokeObjectURL(url) };
    } catch {
      // fall through
    }
  }
  return {
    url: `data:text/markdown;charset=utf-8;base64,${toBase64(markdown)}`,
    revoke: () => {},
  };
}

export const downloadBackend: StorageBackend = {
  id: 'download',

  async save(payload: SavePayload, settings: Settings): Promise<SaveResult> {
    const filename = joinPath(settings.download.folder, payload.path);
    const { url, revoke } = contentUrl(payload.content);

    try {
      const id = await browser.downloads.download({
        url,
        filename,
        conflictAction: payload.overwrite ? 'overwrite' : 'uniquify',
        saveAs: false,
      });

      const finalName = await waitForFilename(id, filename);
      return { location: finalName, downloadId: id };
    } finally {
      // Give the download a tick to read the blob before dropping it.
      setTimeout(revoke, 60_000);
    }
  },
};

/** Resolves once the download leaves the in-progress state. */
function waitForFilename(id: number, fallback: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const done = (name: string) => {
      browser.downloads.onChanged.removeListener(onChanged);
      clearTimeout(timer);
      resolve(name);
    };

    const onChanged = (delta: {
      id: number;
      state?: { current?: string };
      error?: { current?: string };
    }) => {
      if (delta.id !== id) return;
      if (delta.error?.current) {
        browser.downloads.onChanged.removeListener(onChanged);
        clearTimeout(timer);
        reject(new Error(i18n.t('errors.downloadFailed', [delta.error.current])));
        return;
      }
      if (delta.state?.current === 'complete') {
        void browser.downloads
          .search({ id })
          .then((items) => done(items[0]?.filename ?? fallback))
          .catch(() => done(fallback));
      }
    };

    const timer = setTimeout(() => done(fallback), 15_000);
    browser.downloads.onChanged.addListener(onChanged);
  });
}
