/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { downloadBackend } from './download';
import type { SavePayload } from './types';

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  backend: 'download',
  download: { folder: 'tabstack' },
};

const payload: SavePayload = {
  path: '2026-08-14-a-page.md',
  content: '# doc',
  title: 'A Page',
  url: 'https://ex.com/a',
  overwrite: false,
};

/** Mirrors what the browser reports back as a download progresses. */
type Delta = {
  id: number;
  state?: { current?: string };
  error?: { current?: string };
};

/** fake-browser has no downloads.onChanged, so drive one by hand. */
let listeners: Array<(delta: Delta) => void> = [];

function emit(delta: Delta) {
  for (const listener of [...listeners]) listener(delta);
}

let download: ReturnType<typeof vi.fn>;
let search: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeBrowser.reset();
  vi.useFakeTimers();
  listeners = [];
  download = vi.fn().mockResolvedValue(7);
  search = vi.fn().mockResolvedValue([{ filename: '/home/me/Downloads/final.md' }]);
  vi.stubGlobal('URL', { ...URL, createObjectURL: undefined });
  fakeBrowser.downloads.download = download as never;
  fakeBrowser.downloads.search = search as never;
  // The event object itself is read-only; its methods are not.
  const onChanged = fakeBrowser.downloads.onChanged as unknown as {
    addListener: (fn: (delta: Delta) => void) => void;
    removeListener: (fn: (delta: Delta) => void) => void;
  };
  onChanged.addListener = (fn) => {
    listeners.push(fn);
  };
  onChanged.removeListener = (fn) => {
    listeners = listeners.filter((listener) => listener !== fn);
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Kicks off a save, then plays the download's state changes past it. */
async function save(deltas: Delta[], input = payload) {
  const pending = downloadBackend.save(input, settings);
  // Claim the rejection now: the failure cases reject while the timers below are
  // still running, before the caller gets a chance to assert on it.
  void pending.catch(() => {});
  await vi.advanceTimersByTimeAsync(0);
  for (const delta of deltas) emit(delta);
  await vi.runAllTimersAsync();
  return pending;
}

describe('downloadBackend.save', () => {
  it('files the note under the configured folder and reports the real filename', async () => {
    const result = await save([{ id: 7, state: { current: 'complete' } }]);

    expect(download.mock.calls[0][0]).toMatchObject({
      filename: 'tabstack/2026-08-14-a-page.md',
      conflictAction: 'uniquify',
      saveAs: false,
    });
    // The browser renames on collision, so the final name comes from the API,
    // not from what we asked for.
    expect(result.location).toBe('/home/me/Downloads/final.md');
  });

  it('overwrites instead of uniquifying when rewriting a previous save', async () => {
    await save([{ id: 7, state: { current: 'complete' } }], {
      ...payload,
      overwrite: true,
    });
    expect(download.mock.calls[0][0].conflictAction).toBe('overwrite');
  });

  it('falls back to a data URL when blob URLs are unavailable', async () => {
    // Chrome MV3 service workers have no URL.createObjectURL.
    await save([{ id: 7, state: { current: 'complete' } }]);
    expect(download.mock.calls[0][0].url).toMatch(
      /^data:text\/markdown;charset=utf-8;base64,/,
    );
  });

  it('surfaces a failed download instead of reporting success', async () => {
    const pending = save([{ id: 7, error: { current: 'FILE_NO_SPACE' } }]);
    await expect(pending).rejects.toThrow(/Download failed: FILE_NO_SPACE/);
  });

  it('ignores state changes belonging to other downloads', async () => {
    const result = await save([
      { id: 99, state: { current: 'complete' } },
      { id: 99, error: { current: 'FILE_FAILED' } },
      { id: 7, state: { current: 'complete' } },
    ]);
    expect(result.location).toBe('/home/me/Downloads/final.md');
  });

  it('settles on the requested name if the browser never reports back', async () => {
    // A download that stays in progress must not leave the save pending forever.
    const result = await save([]);
    expect(result.location).toBe('tabstack/2026-08-14-a-page.md');
    expect(search).not.toHaveBeenCalled();
  });

  it('settles on the requested name when the lookup fails', async () => {
    search.mockRejectedValue(new Error('erased'));
    const result = await save([{ id: 7, state: { current: 'complete' } }]);
    expect(result.location).toBe('tabstack/2026-08-14-a-page.md');
  });
});
