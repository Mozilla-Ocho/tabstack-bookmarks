/* @vitest-environment happy-dom */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveRecord } from '@/src/lib/messages';
import { forgetSaved, markSaved, searchSaved } from '@/src/lib/savedIndex';
import { DEFAULT_SETTINGS, setSettings, type Settings } from '@/src/lib/settings';
import { App } from './App';

let sent: { type: string; [key: string]: unknown }[];
/** Replies for `save`; searches run against the real index. */
let saveReply: unknown;

function saved(url: string, at: number, patch: Partial<SaveRecord> = {}): SaveRecord {
  return {
    url,
    title: 'A Page',
    status: 'done',
    tags: [],
    path: 'a.md',
    location: 'tabstack/a.md',
    backend: 'download',
    startedAt: at,
    updatedAt: at,
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
  saveReply = saved('https://ex.com/a', 2_000);

  // The page talks to the background; the background's search and delete are the
  // real thing, so these tests cover the round trip rather than a stub of it.
  fakeBrowser.runtime.sendMessage = vi.fn(async (message: unknown) => {
    const request = message as {
      type: string;
      query?: string;
      limit?: number;
      url?: string;
    };
    sent.push(request as never);
    switch (request.type) {
      case 'searchSaved':
        return searchSaved(request.query, request.limit);
      case 'clearState':
        await forgetSaved(request.url!);
        return true;
      case 'save':
        return saveReply;
      default:
        return undefined;
    }
  }) as never;
  fakeBrowser.runtime.openOptionsPage = vi.fn().mockResolvedValue(undefined) as never;
  fakeBrowser.tabs.create = vi.fn().mockResolvedValue({}) as never;
});

async function open() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

async function seed(count: number, titles?: string[]) {
  for (let i = 0; i < count; i++) {
    await markSaved(
      saved(`https://ex.com/${i}`, 1_000 + i, {
        title: titles?.[i] ?? `Page ${i}`,
        path: `${i}.md`,
        location: `tabstack/${i}.md`,
      }),
    );
  }
}

describe('an empty library', () => {
  it('says so rather than showing an empty list', async () => {
    await configured();
    await open();
    expect(screen.getByText(/Nothing saved yet/)).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('listing', () => {
  it('shows what has been saved, newest first', async () => {
    await configured();
    await seed(3, ['Oldest', 'Middle', 'Newest']);
    await open();

    const titles = screen
      .getAllByRole('listitem')
      .map((li) => li.querySelector('strong')?.textContent);
    expect(titles).toEqual(['Newest', 'Middle', 'Oldest']);
    expect(screen.getByText('3 pages saved.')).toBeTruthy();
  });

  it('shows where each page went, and which destination', async () => {
    await configured();
    await seed(1, ['Only one']);
    await open();

    expect(screen.getByText(/tabstack\/0\.md/)).toBeTruthy();
    expect(screen.getByText(/Downloads/)).toBeTruthy();
  });

  /**
   * The index can hold 50,000 entries; painting them all is thousands of nodes
   * nobody scrolls to.
   */
  it('renders a window of a long library, and says so', async () => {
    await configured();
    await seed(60);
    await open();

    expect(screen.getAllByRole('listitem')).toHaveLength(50);
    // The count and the window share one paragraph, so read the whole line.
    expect(screen.getByRole('status').textContent).toContain('Showing 50 of 60.');

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(60));
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });
});

describe('searching', () => {
  it('filters as you type, and counts the matches', async () => {
    await configured();
    await seed(3, ['Rust ownership', 'CSS grid', 'Rust async']);
    await open();

    fireEvent.change(screen.getByLabelText('Search saved pages'), {
      target: { value: 'rust' },
    });

    await waitFor(() => expect(screen.getByText('2 pages match.')).toBeTruthy());
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('says when nothing matches', async () => {
    await configured();
    await seed(2);
    await open();

    fireEvent.change(screen.getByLabelText('Search saved pages'), {
      target: { value: 'nothing like this' },
    });

    await waitFor(() =>
      expect(screen.getByText('Nothing matches that search.')).toBeTruthy(),
    );
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  /** Otherwise a search after "show more" starts halfway down its own results. */
  it('starts a new search from the top of the list', async () => {
    await configured();
    await seed(60);
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(60));

    fireEvent.change(screen.getByLabelText('Search saved pages'), {
      target: { value: 'Page' },
    });

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(50));
  });
});

describe('re-saving from the library', () => {
  it('overwrites the file it wrote before', async () => {
    await configured();
    await seed(1, ['A Page']);
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Re-save' }));

    await waitFor(() => expect(sent.some((m) => m.type === 'save')).toBe(true));
    expect(sent.find((m) => m.type === 'save')).toMatchObject({
      url: 'https://ex.com/0',
      // In place: a refreshed page replaces its own file.
      overwritePath: '0.md',
    });
    await waitFor(() => expect(screen.getByText(/Re-saved/)).toBeTruthy());
  });

  it('reports a failed re-save without dropping the row', async () => {
    await configured();
    await seed(1);
    await open();

    saveReply = saved('https://ex.com/0', 3_000, {
      status: 'error',
      error: 'Tabstack organization is out of credits (402).',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Re-save' }));

    await waitFor(() =>
      expect(
        screen.getByText('Tabstack organization is out of credits (402).'),
      ).toBeTruthy(),
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('surfaces an error reply from the background', async () => {
    await configured();
    await seed(1);
    await open();

    saveReply = { error: 'Extension context invalidated.' };
    fireEvent.click(screen.getByRole('button', { name: 'Re-save' }));

    await waitFor(() =>
      expect(screen.getByText('Extension context invalidated.')).toBeTruthy(),
    );
  });
});

describe('forgetting an entry', () => {
  it('asks first, and leaves the row alone if refused', async () => {
    await configured();
    await seed(2);
    await open();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Forget' })[0]!);

    await waitFor(() => expect(sent.some((m) => m.type === 'clearState')).toBe(false));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it('drops the entry from the index once confirmed', async () => {
    await configured();
    await seed(2, ['Keep me', 'Forget me']);
    await open();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    // Newest first, so "Forget me" is the first row.
    fireEvent.click(screen.getAllByRole('button', { name: 'Forget' })[0]!);

    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(screen.getByText('Keep me')).toBeTruthy();
    expect((await searchSaved()).total).toBe(1);
    vi.unstubAllGlobals();
  });
});

describe('links to the saved file', () => {
  it('deep-links into an Obsidian vault', async () => {
    await configured({ backend: 'obsidian' });
    await markSaved(
      saved('https://ex.com/a', 1, {
        backend: 'obsidian',
        path: 'Bookmarks/a page.md',
      }),
    );
    await open();

    expect(screen.getByRole('link', { name: 'open' }).getAttribute('href')).toBe(
      'obsidian://open?file=Bookmarks%2Fa%20page.md',
    );
  });

  it('links to the file on GitHub while the settings still point there', async () => {
    await configured({
      backend: 'github',
      github: { token: 't', owner: 'me', repo: 'notes', branch: 'main', folder: '' },
    });
    await markSaved(saved('https://ex.com/a', 1, { backend: 'github', path: 'a.md' }));
    await open();

    expect(screen.getByRole('link', { name: 'open' }).getAttribute('href')).toBe(
      'https://github.com/me/notes/blob/main/a.md',
    );
  });

  /** The repo it went to is not recorded, so a link would be a guess. */
  it('offers no GitHub link once the destination has changed', async () => {
    await configured({ backend: 'download' });
    await markSaved(saved('https://ex.com/a', 1, { backend: 'github', path: 'a.md' }));
    await open();

    expect(screen.queryByRole('link', { name: 'open' })).toBeNull();
  });

  it('offers no link for a downloaded file', async () => {
    await configured();
    await seed(1);
    await open();
    expect(screen.queryByRole('link', { name: 'open' })).toBeNull();
  });
});

describe('getting elsewhere', () => {
  it('opens the options page', async () => {
    await configured();
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(fakeBrowser.runtime.openOptionsPage).toHaveBeenCalled();
  });
});
