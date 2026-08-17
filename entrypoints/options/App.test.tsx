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
  fakeBrowser.downloads = { download: vi.fn(async () => 1) } as never;
  // Chrome shape by default: getAll only, no update. Firefox adds the rest.
  fakeBrowser.commands = {
    getAll: vi.fn(async () => [{ name: 'save-page', shortcut: 'Alt+Shift+S' }]),
  } as never;

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
    fireEvent.click(screen.getByRole('button', { name: 'Save pages in bulk' }));
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

describe('the keyboard shortcut', () => {
  it('shows what is bound', async () => {
    await open();
    await waitFor(() => expect(screen.getByText(/bound to Alt\+Shift\+S/)).toBeTruthy());
  });

  it('says when nothing is bound', async () => {
    fakeBrowser.commands = {
      getAll: vi.fn(async () => [{ name: 'save-page', shortcut: '' }]),
    } as never;
    await open();
    await waitFor(() => expect(screen.getByText(/has no shortcut/)).toBeTruthy());
  });

  /** Chrome will not let an extension rebind its own shortcut. */
  it('sends you to the browser’s own page where rebinding is not allowed', async () => {
    await open();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Open browser shortcut settings' }),
      ).toBeTruthy(),
    );
    expect(screen.queryByLabelText('New shortcut')).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: 'Open browser shortcut settings' }),
    );
    expect(fakeBrowser.tabs.create).toHaveBeenCalledWith({
      url: 'chrome://extensions/shortcuts',
    });
  });

  it('rebinds in place where the browser allows it', async () => {
    const update = vi.fn(async () => {});
    let shortcut = 'Alt+Shift+S';
    fakeBrowser.commands = {
      getAll: vi.fn(async () => [{ name: 'save-page', shortcut }]),
      update: vi.fn(async (details: { shortcut: string }) => {
        shortcut = details.shortcut;
        await update();
      }),
    } as never;
    await open();

    const input = await screen.findByLabelText('New shortcut');
    fireEvent.change(input, { target: { value: 'Ctrl+Shift+Y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    await waitFor(() => expect(screen.getByText('Shortcut changed.')).toBeTruthy());
    expect(screen.getByText(/bound to Ctrl\+Shift\+Y/)).toBeTruthy();
  });

  it('shows the browser’s complaint about an invalid shortcut', async () => {
    fakeBrowser.commands = {
      getAll: vi.fn(async () => [{ name: 'save-page', shortcut: 'Alt+Shift+S' }]),
      update: vi.fn(async () => {
        throw new Error('Value Ctrl+Q is an invalid shortcut.');
      }),
    } as never;
    await open();

    fireEvent.change(await screen.findByLabelText('New shortcut'), {
      target: { value: 'Ctrl+Q' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));

    await waitFor(() =>
      expect(screen.getByText('Value Ctrl+Q is an invalid shortcut.')).toBeTruthy(),
    );
  });
});

describe('sharing preferences between browsers', () => {
  it('is on by default and can be turned off', async () => {
    await open();
    const toggle = screen.getByLabelText(/Share preferences/);
    expect(toggle).toHaveProperty('checked', true);

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(async () => expect((await getSettings()).syncSettings).toBe(false));
  });
});

describe('backing settings up', () => {
  it('downloads a file named for today, and asks where to put it', async () => {
    await setSettings({ ...DEFAULT_SETTINGS, apiKey: 'ts_secret' });
    await open();

    fireEvent.click(screen.getByRole('button', { name: 'Export settings' }));

    await waitFor(() => expect(fakeBrowser.downloads.download).toHaveBeenCalled());
    expect(fakeBrowser.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: expect.stringMatching(/^tabstack-settings-\d{4}-\d{2}-\d{2}\.json$/),
        saveAs: true,
      }),
    );
  });

  it('loads a file into the form as unsaved changes, not into storage', async () => {
    await open();

    const file = new File(
      [
        JSON.stringify({
          tabstackBookmarks: true,
          settings: { filenameTemplate: 'from-file.md', backend: 'github' },
        }),
      ],
      'backup.json',
      { type: 'application/json' },
    );
    const input = document.querySelector('input[type=file]')!;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(
        screen.getByText('Imported backup.json. Check it over, then save.'),
      ).toBeTruthy(),
    );
    // Proposed, not applied: the page already knows how to show pending edits.
    expect(screen.getByText('Unsaved changes.')).toBeTruthy();
    expect((await getSettings()).filenameTemplate).toBe(
      DEFAULT_SETTINGS.filenameTemplate,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(async () =>
      expect((await getSettings()).filenameTemplate).toBe('from-file.md'),
    );
  });

  it('keeps the API key when a file is imported', async () => {
    await setSettings({ ...DEFAULT_SETTINGS, apiKey: 'ts_secret' });
    await open();

    const file = new File(
      [JSON.stringify({ tabstackBookmarks: true, settings: { apiKey: 'ts_from_file' } })],
      'backup.json',
    );
    fireEvent.change(document.querySelector('input[type=file]')!, {
      target: { files: [file] },
    });

    await waitFor(() => expect(screen.getByText(/Imported backup.json/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(async () => expect((await getSettings()).apiKey).toBe('ts_secret'));
  });

  it('explains a file it cannot read', async () => {
    await open();

    const file = new File(['not json'], 'junk.json');
    fireEvent.change(document.querySelector('input[type=file]')!, {
      target: { files: [file] },
    });

    await waitFor(() => expect(screen.getByText(/not JSON/)).toBeTruthy());
    expect(screen.queryByText('Unsaved changes.')).toBeNull();
  });
});
