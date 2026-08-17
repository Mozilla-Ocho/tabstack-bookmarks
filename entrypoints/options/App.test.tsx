/* @vitest-environment happy-dom */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rememberSave } from '@/src/lib/saveStore';
import { DEFAULT_SETTINGS, getSettings, setSettings } from '@/src/lib/settings';
import { App } from './App';

let fetchMock: ReturnType<typeof vi.fn>;
let granted: boolean;
let requested: string[][];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  granted = true;
  requested = [];

  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);

  fakeBrowser.permissions.contains = vi.fn(async () => granted) as never;
  fakeBrowser.permissions.request = vi.fn(async (perms: { origins?: string[] }) => {
    requested.push(perms.origins ?? []);
    granted = true;
    return true;
  }) as never;
  fakeBrowser.tabs.create = vi.fn().mockResolvedValue({}) as never;

  await setSettings(DEFAULT_SETTINGS);
});

afterEach(() => vi.unstubAllGlobals());

async function open() {
  render(<App />);
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('editing settings', () => {
  it('writes nothing until Save is pressed', async () => {
    await open();

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'ts_typed' } });
    expect((await getSettings()).apiKey).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(async () => expect((await getSettings()).apiKey).toBe('ts_typed'));
  });

  /**
   * Nothing is written as you type, so closing the tab loses the edits. The
   * marker is the only warning inside the page itself.
   */
  it('marks unsaved edits, and clears the mark once saved', async () => {
    await open();
    expect(screen.queryByText('Unsaved changes.')).toBeNull();

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'ts_typed' } });
    expect(screen.getByText('Unsaved changes.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
    expect(screen.queryByText('Unsaved changes.')).toBeNull();
  });

  it('keeps the API key when resetting the rest to defaults', async () => {
    await setSettings({
      ...DEFAULT_SETTINGS,
      apiKey: 'ts_key',
      filenameTemplate: 'x.md',
    });
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(async () => {
      const saved = await getSettings();
      expect(saved.apiKey).toBe('ts_key');
      expect(saved.filenameTemplate).toBe(DEFAULT_SETTINGS.filenameTemplate);
    });
  });

  it('previews what the filename template produces', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Filename template'), {
      target: { value: '{yyyy}/{slug}.md' },
    });
    await waitFor(() =>
      expect(screen.getByText(/\d{4}\/how-attention-works\.md/)).toBeTruthy(),
    );
  });

  it('shows the fields for the chosen destination only', async () => {
    await open();
    expect(screen.getByLabelText('Subfolder of your download directory')).toBeTruthy();
    expect(screen.queryByLabelText('GitHub token')).toBeNull();

    fireEvent.change(screen.getByLabelText('Store markdown in'), {
      target: { value: 'github' },
    });

    await waitFor(() => expect(screen.getByLabelText('GitHub token')).toBeTruthy());
    expect(screen.getByLabelText('Folder in repo')).toBeTruthy();
    expect(screen.queryByLabelText('Subfolder of your download directory')).toBeNull();
  });

  it('only offers the suggested-tags option when summaries are on', async () => {
    await open();
    expect(screen.queryByLabelText(/Add the suggested tags/)).toBeNull();

    fireEvent.click(screen.getByLabelText(/Generate an AI summary/));
    await waitFor(() =>
      expect(screen.getByLabelText(/Add the suggested tags/)).toBeTruthy(),
    );
  });
});

describe('testing the API key', () => {
  it('reports success, and stores the key it tested', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ content: 'x'.repeat(42), url: 'https://example.com' }),
    );
    await open();

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'ts_key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test key' }));

    await waitFor(() =>
      expect(screen.getByText(/Key works — 42 characters/)).toBeTruthy(),
    );
    expect((await getSettings()).apiKey).toBe('ts_key');
  });

  it('reports what the API said when the key is rejected', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'invalid key' }, 401));
    await open();

    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'ts_bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test key' }));

    await waitFor(() =>
      expect(screen.getByText(/Tabstack rejected the API key \(401\)/)).toBeTruthy(),
    );
  });

  it('cannot be pressed without a key to test', async () => {
    await open();
    expect(screen.getByRole('button', { name: 'Test key' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});

describe('testing a destination', () => {
  it('checks a GitHub repo and reports its default branch', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        full_name: 'me/notes',
        default_branch: 'main',
        permissions: { push: true },
      }),
    );
    await setSettings({
      ...DEFAULT_SETTINGS,
      backend: 'github',
      github: { token: 't', owner: 'me', repo: 'notes', branch: 'main', folder: '' },
    });
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Test destination' }));

    await waitFor(() =>
      expect(
        screen.getByText('Connected to me/notes (default branch: main).'),
      ).toBeTruthy(),
    );
  });

  it('says so when the token cannot write', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        full_name: 'me/notes',
        default_branch: 'main',
        permissions: { push: false },
      }),
    );
    await setSettings({
      ...DEFAULT_SETTINGS,
      backend: 'github',
      github: { token: 't', owner: 'me', repo: 'notes', branch: 'main', folder: '' },
    });
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Test destination' }));
    await waitFor(() =>
      expect(screen.getByText('Token cannot write to me/notes.')).toBeTruthy(),
    );
  });

  it('has nothing to check for downloads', async () => {
    await open();
    expect(screen.queryByRole('button', { name: 'Test destination' })).toBeNull();
  });

  /** Firefox will not let the extension reach a vault it has no grant for. */
  it('asks for the vault origin before checking it', async () => {
    granted = false;
    fetchMock.mockResolvedValueOnce(json({ authenticated: true, service: 'Obsidian' }));
    await setSettings({
      ...DEFAULT_SETTINGS,
      backend: 'obsidian',
      obsidian: { baseUrl: 'http://127.0.0.1:27123', token: 'k', folder: 'Bookmarks' },
    });
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Test destination' }));

    await waitFor(() => expect(screen.getByText('Connected to Obsidian.')).toBeTruthy());
    expect(requested).toContainEqual(['http://127.0.0.1:27123/*']);
  });

  it('refuses a vault that is not on this machine, without asking', async () => {
    await setSettings({
      ...DEFAULT_SETTINGS,
      backend: 'obsidian',
      obsidian: { baseUrl: 'http://vault.lan:27123', token: 'k', folder: '' },
    });
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Test destination' }));

    await waitFor(() =>
      expect(screen.getByText(/is not a loopback address, so this build/)).toBeTruthy(),
    );
    expect(requested).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('host permissions', () => {
  it('offers to request the manifest origins when they are missing', async () => {
    granted = false;
    await open();

    await waitFor(() => expect(screen.getByText(/needs your permission/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Grant access' }));

    await waitFor(() => expect(screen.queryByText(/needs your permission/)).toBeNull());
    expect(requested[0]).toEqual([
      'https://api.tabstack.ai/*',
      'https://api.github.com/*',
    ]);
  });
});

describe('recent saves', () => {
  it('lists what has been saved, with a total', async () => {
    await rememberSave({
      url: 'https://ex.com/a',
      title: 'A Page',
      status: 'done',
      tags: [],
      path: 'a.md',
      location: 'tabstack/a.md',
      startedAt: 1,
      updatedAt: 1,
    });
    await open();

    await waitFor(() => expect(screen.getByText('A Page')).toBeTruthy());
    expect(screen.getByText('tabstack/a.md')).toBeTruthy();
    expect(screen.getByText(/1 page saved in total/)).toBeTruthy();
  });

  it('says when nothing has been saved yet', async () => {
    await open();
    await waitFor(() => expect(screen.getByText('Nothing saved yet.')).toBeTruthy());
  });

  it('forgets the index only after the warning is accepted', async () => {
    await rememberSave({
      url: 'https://ex.com/a',
      title: 'A Page',
      status: 'done',
      tags: [],
      path: 'a.md',
      startedAt: 1,
      updatedAt: 1,
    });
    await open();
    await waitFor(() => expect(screen.getByText(/1 page saved in total/)).toBeTruthy());

    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forget saved history' }));
    await waitFor(() => expect(screen.getByText(/1 page saved in total/)).toBeTruthy());

    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forget saved history' }));
    await waitFor(() => expect(screen.getByText(/0 pages saved in total/)).toBeTruthy());
  });

  it('opens the import page in a tab', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Open bookmark import' }));
    expect(fakeBrowser.tabs.create).toHaveBeenCalled();
  });

  it('opens the library in a tab', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Browse saved pages' }));
    expect(fakeBrowser.tabs.create).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining('library.html') }),
    );
  });
});
