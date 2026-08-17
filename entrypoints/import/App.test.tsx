/* @vitest-environment happy-dom */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportProgress } from '@/src/lib/messages';
import { DEFAULT_SETTINGS, setSettings, type Settings } from '@/src/lib/settings';
import { App } from './App';

let replies: Record<string, unknown>;
let sent: { type: string; options?: Record<string, unknown> }[];

function progress(patch: Partial<ImportProgress> = {}): ImportProgress {
  return {
    index: 0,
    total: 10,
    running: true,
    cancelled: false,
    saved: 0,
    skipped: 0,
    failures: [],
    failed: 0,
    consecutiveFailures: 0,
    options: {
      source: 'bookmarks',
      skipSaved: true,
      tagsFromFolders: true,
      tags: [],
      delayMs: 1500,
      summarize: false,
    },
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
  replies = {
    listFolders: [
      { id: 'toolbar', path: 'Toolbar', depth: 0, count: 12 },
      { id: 'reading', path: 'Toolbar/Reading', depth: 1, count: 4 },
    ],
    getImport: undefined,
    planImport: { count: 7, skipped: 3 },
    startImport: progress(),
    cancelImport: progress({ running: false, cancelled: true, index: 2, saved: 2 }),
    clearImport: true,
  };

  fakeBrowser.runtime.sendMessage = vi.fn(async (message: unknown) => {
    const request = message as { type: string };
    sent.push(request as never);
    return replies[request.type];
  }) as never;
  fakeBrowser.runtime.openOptionsPage = vi.fn().mockResolvedValue(undefined) as never;
  // The page tells the background which window it means; the background has none.
  fakeBrowser.tabs.getCurrent = vi.fn(async () => ({ id: 9, windowId: 77 })) as never;
});

async function open() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('planning a run', () => {
  it('says how many bookmarks it will save and how many it will skip', async () => {
    await configured();
    await open();

    await waitFor(() =>
      expect(
        screen.getByText('7 pages will be saved, 3 skipped as already saved.'),
      ).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Save 7 pages' })).toBeTruthy();
  });

  it('offers every bookmark folder with its count', async () => {
    await configured();
    await open();

    await waitFor(() => expect(screen.getByText(/Toolbar \(12\)/)).toBeTruthy());
    expect(screen.getByText(/Reading \(4\)/)).toBeTruthy();
  });

  it('re-counts when the selection changes', async () => {
    await configured();
    await open();
    await waitFor(() => expect(sent.some((m) => m.type === 'planImport')).toBe(true));

    replies.planImport = { count: 4, skipped: 0 };
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'reading' } });

    await waitFor(() => expect(screen.getByText('4 pages will be saved.')).toBeTruthy());
    expect(sent.filter((m) => m.type === 'planImport').at(-1)?.options).toMatchObject({
      folderId: 'reading',
    });
  });

  it('will not start without a complete configuration', async () => {
    await setSettings({ ...DEFAULT_SETTINGS, apiKey: '' });
    await open();

    await waitFor(() => expect(screen.getByText(/API key is missing/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /^Save \d/ })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('will not start when nothing matches', async () => {
    await configured();
    replies.planImport = { count: 0, skipped: 0 };
    await open();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save 0 pages' })).toHaveProperty(
        'disabled',
        true,
      ),
    );
  });

  it('passes the chosen options to the background', async () => {
    await configured();
    await open();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Save \d/ })).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText('Tags on every page saved'), {
      target: { value: 'archive, inbox' },
    });
    fireEvent.click(screen.getByLabelText('Turn folder names into tags'));
    fireEvent.change(screen.getByLabelText('Pause between pages'), {
      target: { value: '4000' },
    });
    fireEvent.change(screen.getByLabelText('Stop after (blank = no limit)'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Save \d/ }));

    await waitFor(() => expect(sent.some((m) => m.type === 'startImport')).toBe(true));
    expect(sent.find((m) => m.type === 'startImport')?.options).toMatchObject({
      tags: ['archive', 'inbox'],
      tagsFromFolders: false,
      delayMs: 4000,
      limit: 5,
    });
  });
});

describe('choosing what to save', () => {
  it('asks the background for tabs once tabs are chosen', async () => {
    await configured();
    await open();
    await waitFor(() => expect(sent.some((m) => m.type === 'planImport')).toBe(true));

    replies.planImport = { count: 12, skipped: 0 };
    fireEvent.change(screen.getByLabelText('Pages to save'), {
      target: { value: 'tabs' },
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save 12 pages' })).toBeTruthy(),
    );
    expect(sent.filter((m) => m.type === 'planImport').at(-1)?.options).toMatchObject({
      source: 'tabs',
    });
  });

  /** A tab has no folder, and every window is a question only tabs raise. */
  it('swaps the folder controls for the window scope', async () => {
    await configured();
    await open();
    expect(screen.getByLabelText('Folder')).toBeTruthy();
    expect(screen.getByLabelText('Turn folder names into tags')).toBeTruthy();
    expect(screen.queryByLabelText(/Every window/)).toBeNull();

    fireEvent.change(screen.getByLabelText('Pages to save'), {
      target: { value: 'tabs' },
    });

    await waitFor(() => expect(screen.getByLabelText(/Every window/)).toBeTruthy());
    expect(screen.queryByLabelText('Folder')).toBeNull();
    expect(screen.queryByLabelText('Turn folder names into tags')).toBeNull();
  });

  it('sends the window scope with the run', async () => {
    await configured();
    await open();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Save \d/ })).toBeTruthy(),
    );

    fireEvent.change(screen.getByLabelText('Pages to save'), {
      target: { value: 'tabs' },
    });
    fireEvent.click(await screen.findByLabelText(/Every window/));
    fireEvent.click(screen.getByRole('button', { name: /^Save \d/ }));

    await waitFor(() => expect(sent.some((m) => m.type === 'startImport')).toBe(true));
    expect(sent.find((m) => m.type === 'startImport')?.options).toMatchObject({
      source: 'tabs',
      allWindows: true,
      // Its own window, so "this window" means something in the background.
      windowId: 77,
    });
  });
});

describe('following a run', () => {
  it('picks up a run already in progress', async () => {
    await configured();
    replies.getImport = progress({ index: 3, saved: 3, currentTitle: 'Third page' });
    await open();

    await waitFor(() => expect(screen.getByText('Importing')).toBeTruthy());
    expect(screen.getByText(/Now saving: Third page/)).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('3');
  });

  it('updates as the background broadcasts', async () => {
    await configured();
    replies.getImport = progress({ index: 1, saved: 1 });
    await open();
    await waitFor(() => expect(screen.getByText('Importing')).toBeTruthy());

    fakeBrowser.runtime.onMessage.trigger(
      { type: 'importUpdate', progress: progress({ index: 9, saved: 8, skipped: 2 }) },
      {},
      () => {},
    );

    await waitFor(() => expect(screen.getByText('9/10')).toBeTruthy());
    const counts = screen.getByRole('status').textContent;
    expect(counts).toContain('8 saved');
    expect(counts).toContain('2 skipped');
  });

  it('lists what failed, and says when the list is truncated', async () => {
    await configured();
    replies.getImport = progress({
      running: false,
      index: 10,
      saved: 7,
      failed: 120,
      failures: [
        {
          url: 'https://ex.com/x',
          title: 'X',
          error: 'Tabstack could not fetch this URL (422).',
        },
      ],
    });
    await open();

    await waitFor(() => expect(screen.getByText('Finished')).toBeTruthy());
    expect(screen.getByText('Showing the last 1 of 120 failures.')).toBeTruthy();
    expect(screen.getByText(/could not fetch this URL/)).toBeTruthy();
  });

  it('shows why a run stopped early', async () => {
    await configured();
    replies.getImport = progress({
      running: false,
      index: 4,
      abortReason: 'Tabstack organization is out of credits (402).',
    });
    await open();

    // The exact message, not /out of credits/: the help text under the delay
    // picker explains that running out of credits stops a run, and would match.
    await waitFor(() =>
      expect(
        screen.getByText('Tabstack organization is out of credits (402).'),
      ).toBeTruthy(),
    );
  });

  it('cancels on request', async () => {
    await configured();
    replies.getImport = progress({ index: 2, saved: 2 });
    await open();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel import' }));

    await waitFor(() => expect(sent.some((m) => m.type === 'cancelImport')).toBe(true));
    await waitFor(() => expect(screen.getByText('Cancelled')).toBeTruthy());
  });

  it('clears the results of a finished run', async () => {
    await configured();
    replies.getImport = progress({ running: false, index: 10, saved: 10 });
    await open();

    fireEvent.click(await screen.findByRole('button', { name: 'Clear results' }));

    await waitFor(() => expect(sent.some((m) => m.type === 'clearImport')).toBe(true));
    await waitFor(() => expect(screen.queryByText('Finished')).toBeNull());
  });

  /** A handler that rejects answers `{ error }`; it must not render as a job. */
  it('surfaces an error reply from the background', async () => {
    await configured();
    replies.getImport = { error: 'Bookmarks permission was revoked.' };
    await open();

    await waitFor(() =>
      expect(screen.getByText(/Bookmarks permission was revoked/)).toBeTruthy(),
    );
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
