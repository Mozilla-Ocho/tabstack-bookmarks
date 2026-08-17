/* @vitest-environment happy-dom */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveRecord } from '@/src/lib/messages';
import { DEFAULT_SETTINGS, setSettings, type Settings } from '@/src/lib/settings';
import { App } from './App';

/** Replies the background would send, keyed by message type. */
let replies: Record<string, unknown>;
let sent: { type: string; [key: string]: unknown }[];

function done(patch: Partial<SaveRecord> = {}): SaveRecord {
  return {
    url: 'https://ex.com/a',
    title: 'A Page',
    status: 'done',
    tags: [],
    path: '2026-08-17-a-page.md',
    location: 'tabstack/2026-08-17-a-page.md',
    backend: 'download',
    startedAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

async function configured(patch: Partial<Settings> = {}) {
  await setSettings({ ...DEFAULT_SETTINGS, apiKey: 'ts_key', ...patch });
}

beforeEach(async () => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  sent = [];
  replies = { getState: undefined, save: done() };

  fakeBrowser.tabs.query = vi
    .fn()
    .mockResolvedValue([{ url: 'https://ex.com/a', title: 'A Page' }]) as never;
  fakeBrowser.runtime.sendMessage = vi.fn(async (message: unknown) => {
    const request = message as { type: string };
    sent.push(request as never);
    return replies[request.type];
  }) as never;
  fakeBrowser.runtime.openOptionsPage = vi.fn().mockResolvedValue(undefined) as never;
});

/** The popup loads settings and tab info before it renders anything else. */
async function open() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('auto-save', () => {
  it('saves the tab as soon as the popup opens', async () => {
    await configured({ autoSave: true });
    await open();

    await waitFor(() => expect(sent.some((m) => m.type === 'save')).toBe(true));
    expect(sent.find((m) => m.type === 'save')).toMatchObject({
      url: 'https://ex.com/a',
      title: 'A Page',
    });
  });

  it('waits for a click when auto-save is off', async () => {
    await configured({ autoSave: false });
    await open();

    expect(sent.some((m) => m.type === 'save')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent.some((m) => m.type === 'save')).toBe(true));
  });

  /** Otherwise opening the popup on a saved page silently pays to save it again. */
  it('does not re-save a page that is already saved', async () => {
    await configured({ autoSave: true });
    replies.getState = done({ indexed: true });
    await open();

    await waitFor(() => expect(screen.getByText(/Saved earlier to/)).toBeTruthy());
    expect(sent.some((m) => m.type === 'save')).toBe(false);
  });

  it('does not save when the configuration is incomplete', async () => {
    await setSettings({ ...DEFAULT_SETTINGS, apiKey: '', autoSave: true });
    await open();

    expect(sent.some((m) => m.type === 'save')).toBe(false);
    expect(screen.getByText(/Tabstack API key is missing/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  });

  it('does not save a page that is not http(s)', async () => {
    await configured({ autoSave: true });
    fakeBrowser.tabs.query = vi
      .fn()
      .mockResolvedValue([{ url: 'about:debugging', title: 'Debug' }]) as never;
    await open();

    expect(sent.some((m) => m.type === 'save')).toBe(false);
    expect(screen.getByText(/not an http\(s\) URL/)).toBeTruthy();
  });
});

describe('saving', () => {
  it('sends the edited title, tags and note', async () => {
    await configured({ autoSave: false });
    await open();

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Better' } });
    fireEvent.change(screen.getByLabelText('Tags (comma separated)'), {
      target: { value: 'reading, rust' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    fireEvent.change(screen.getByLabelText('Note'), {
      target: { value: 'why I kept it' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(sent.some((m) => m.type === 'save')).toBe(true));
    expect(sent.find((m) => m.type === 'save')).toMatchObject({
      title: 'Better',
      tags: ['reading', 'rust'],
      note: 'why I kept it',
    });
  });

  /**
   * Re-saving should overwrite the file it wrote before, not pile up
   * my-post-1.md, my-post-2.md. That only works if the previous path is sent.
   */
  it('overwrites the previous file when re-saving in place', async () => {
    await configured({ autoSave: false });
    replies.getState = done();
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Re-save' }));
    await waitFor(() => expect(sent.some((m) => m.type === 'save')).toBe(true));
    expect(sent.find((m) => m.type === 'save')).toMatchObject({
      overwritePath: '2026-08-17-a-page.md',
    });
  });

  it('writes a sibling file when overwriting is turned off', async () => {
    await configured({ autoSave: false });
    replies.getState = done();
    await open();

    fireEvent.click(
      screen.getByLabelText('Overwrite the same file when re-saving', { exact: false }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Re-save' }));

    await waitFor(() => expect(sent.some((m) => m.type === 'save')).toBe(true));
    expect(sent.find((m) => m.type === 'save')?.overwritePath).toBeUndefined();
  });

  it('shows where the page landed', async () => {
    await configured({ autoSave: true });
    await open();
    await waitFor(() =>
      expect(screen.getByText('tabstack/2026-08-17-a-page.md')).toBeTruthy(),
    );
  });

  it('reports a failed save', async () => {
    await configured({ autoSave: true });
    replies.save = done({
      status: 'error',
      error: 'Tabstack organization is out of credits (402).',
      errorStatus: 402,
    });
    await open();

    await waitFor(() => expect(screen.getByText(/out of credits/)).toBeTruthy());
  });

  /**
   * A rejected background handler answers `{ error }`, which has no `status`.
   * Rendering it as a record leaves an empty status box.
   */
  it('reports an error reply from the background', async () => {
    await configured({ autoSave: true });
    replies.save = { error: 'Extension context invalidated.' };
    await open();

    await waitFor(() =>
      expect(screen.getByText('Extension context invalidated.')).toBeTruthy(),
    );
  });

  it('says the summary was skipped without hiding the save', async () => {
    await configured({ autoSave: true });
    replies.save = done({ summaryError: 'Tabstack rate limit hit (429).' });
    await open();

    await waitFor(() => expect(screen.getByText(/Summary skipped/)).toBeTruthy());
    expect(screen.getByText('tabstack/2026-08-17-a-page.md')).toBeTruthy();
  });
});

describe('the rest of the panel', () => {
  it('names the destination it will write to', async () => {
    await configured({ autoSave: false, backend: 'github' });
    await open();
    expect(screen.getByText('GitHub')).toBeTruthy();
  });

  it('previews the filename before saving', async () => {
    await configured({ autoSave: false, filenameTemplate: '{slug}.md' });
    await open();
    // The preview shares its paragraph with the tab's URL.
    expect(screen.getByText(/^a-page\.md/)).toBeTruthy();
  });

  it('follows progress broadcast from the background', async () => {
    await configured({ autoSave: false });
    await open();

    fakeBrowser.runtime.onMessage.trigger(
      { type: 'saveUpdate', record: done({ status: 'storing' }) },
      {},
      () => {},
    );

    await waitFor(() => expect(screen.getByText('Storing markdown…')).toBeTruthy());
  });

  it('ignores progress for a different tab', async () => {
    await configured({ autoSave: false });
    await open();

    fakeBrowser.runtime.onMessage.trigger(
      {
        type: 'saveUpdate',
        record: done({ url: 'https://other.com/x', status: 'storing' }),
      },
      {},
      () => {},
    );

    await waitFor(() => expect(screen.queryByText('Storing markdown…')).toBeNull());
  });
});
