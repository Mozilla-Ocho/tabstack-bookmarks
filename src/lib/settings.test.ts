/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backendOrigin,
  isGrantableOrigin,
  configErrors,
  DEFAULT_SETTINGS,
  getSettings,
  SCHEMA_VERSION,
  setSettings,
  type Settings,
} from './settings';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('getSettings', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('deep-merges nested backend config so new fields get defaults', async () => {
    await fakeBrowser.storage.local.set({
      settings: { apiKey: 'k', github: { owner: 'me' } },
    });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('k');
    expect(settings.github.owner).toBe('me');
    expect(settings.github.branch).toBe('main');
    expect(settings.obsidian.baseUrl).toBe(DEFAULT_SETTINGS.obsidian.baseUrl);
  });
});

describe('setSettings', () => {
  it('merges a patch over what is stored', async () => {
    await setSettings({ apiKey: 'one' });
    await setSettings({ backend: 'github' });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('one');
    expect(settings.backend).toBe('github');
  });
});

describe('configErrors', () => {
  it('reports a missing API key', () => {
    expect(configErrors(DEFAULT_SETTINGS)).toEqual(['Tabstack API key is missing.']);
  });

  it('reports missing GitHub fields', () => {
    const errors = configErrors({ ...DEFAULT_SETTINGS, apiKey: 'k', backend: 'github' });
    expect(errors).toHaveLength(3);
  });

  it('passes a fully configured Obsidian vault', () => {
    expect(
      configErrors({
        ...DEFAULT_SETTINGS,
        apiKey: 'k',
        backend: 'obsidian',
        obsidian: { ...DEFAULT_SETTINGS.obsidian, token: 'obs' },
      }),
    ).toEqual([]);
  });

  it('does not require destination fields for downloads', () => {
    expect(configErrors({ ...DEFAULT_SETTINGS, apiKey: 'k' })).toEqual([]);
  });
});

describe('backendOrigin', () => {
  it('is null for backends covered by the manifest', () => {
    expect(backendOrigin({ ...DEFAULT_SETTINGS, backend: 'github' })).toBeNull();
    expect(backendOrigin({ ...DEFAULT_SETTINGS, backend: 'download' })).toBeNull();
  });

  it('derives an origin pattern from user-supplied URLs', () => {
    expect(backendOrigin({ ...DEFAULT_SETTINGS, backend: 'obsidian' })).toBe(
      'http://127.0.0.1:27123/*',
    );
    expect(
      backendOrigin({
        ...DEFAULT_SETTINGS,
        backend: 'obsidian',
        obsidian: { ...DEFAULT_SETTINGS.obsidian, baseUrl: 'https://vault.lan:8443/api' },
      }),
    ).toBe('https://vault.lan:8443/*');
  });

  it('is null for an unparseable URL', () => {
    expect(
      backendOrigin({
        ...DEFAULT_SETTINGS,
        backend: 'obsidian',
        obsidian: { ...DEFAULT_SETTINGS.obsidian, baseUrl: 'nope' },
      }),
    ).toBeNull();
  });
});

describe('isGrantableOrigin', () => {
  it('accepts loopback hosts, since that is all the manifest offers', () => {
    expect(isGrantableOrigin('http://127.0.0.1:27123/*')).toBe(true);
    expect(isGrantableOrigin('http://localhost:27123/*')).toBe(true);
    expect(isGrantableOrigin('https://localhost/*')).toBe(true);
  });

  it('rejects hosts it could never obtain permission for', () => {
    expect(isGrantableOrigin('http://vault.lan:27123/*')).toBe(false);
    expect(isGrantableOrigin('https://example.com/*')).toBe(false);
    expect(isGrantableOrigin('nonsense')).toBe(false);
  });
});

describe('schema version', () => {
  it('stamps the current version on read and write', async () => {
    expect((await getSettings()).schemaVersion).toBe(SCHEMA_VERSION);
    await setSettings({ apiKey: 'k' });
    const stored = (await fakeBrowser.storage.local.get('settings')).settings as {
      schemaVersion: number;
    };
    expect(stored.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('upgrades a stored object that predates the field', async () => {
    await fakeBrowser.storage.local.set({ settings: { apiKey: 'old' } });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('old');
    expect(settings.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('keeps settings written by a newer version rather than discarding them', async () => {
    await fakeBrowser.storage.local.set({
      settings: { schemaVersion: 99, apiKey: 'from-the-future' },
    });
    const settings = await getSettings();
    expect(settings.apiKey).toBe('from-the-future');
    expect(settings.backend).toBe(DEFAULT_SETTINGS.backend);
  });
});

describe('syncing', () => {
  /** The whole point: preferences follow you, credentials do not. */
  it('keeps the three credentials out of the synced copy', async () => {
    await setSettings({
      apiKey: 'ts_secret',
      filenameTemplate: '{slug}.md',
      github: {
        token: 'gh_secret',
        owner: 'me',
        repo: 'notes',
        branch: 'main',
        folder: 'b',
      },
      obsidian: { token: 'obs_secret', baseUrl: 'http://127.0.0.1:27123', folder: 'B' },
    });

    const synced = (await fakeBrowser.storage.sync.get('settings')).settings as Record<
      string,
      Record<string, string>
    >;

    expect(JSON.stringify(synced)).not.toContain('secret');
    expect(synced.apiKey).toBeUndefined();
    expect(synced.github!.token).toBeUndefined();
    expect(synced.obsidian!.token).toBeUndefined();
    // The parts that are not secret still travel.
    expect(synced.filenameTemplate).toBe('{slug}.md');
    expect(synced.github!.owner).toBe('me');
    expect(synced.obsidian!.baseUrl).toBe('http://127.0.0.1:27123');
  });

  it('still writes everything locally, credentials included', async () => {
    await setSettings({
      apiKey: 'ts_secret',
      github: { ...DEFAULT_SETTINGS.github, token: 'gh' },
    });
    const local = (await fakeBrowser.storage.local.get('settings')).settings as Settings;
    expect(local.apiKey).toBe('ts_secret');
    expect(local.github.token).toBe('gh');
  });

  /** A second machine: preferences arrive, and it asks for its own key. */
  it('adopts synced preferences on a device with no local settings', async () => {
    await fakeBrowser.storage.sync.set({
      settings: {
        schemaVersion: SCHEMA_VERSION,
        filenameTemplate: '{yyyy}/{slug}.md',
        backend: 'github',
        github: { owner: 'me', repo: 'notes', branch: 'trunk', folder: 'pages' },
      },
    });

    const settings = await getSettings();
    expect(settings.filenameTemplate).toBe('{yyyy}/{slug}.md');
    expect(settings.github.owner).toBe('me');
    expect(settings.github.branch).toBe('trunk');
    // Nothing arrived that could stand in for a credential.
    expect(settings.apiKey).toBe('');
    expect(settings.github.token).toBe('');
    expect(configErrors(settings)).toContain('Tabstack API key is missing.');
  });

  it('prefers a synced preference over a stale local one', async () => {
    // Both areas are written together, so they differ only when another device
    // changed something — and then the synced copy is the newer one.
    await fakeBrowser.storage.local.set({
      settings: { apiKey: 'mine', filenameTemplate: 'old.md', defaultTags: ['old'] },
    });
    await fakeBrowser.storage.sync.set({
      settings: { filenameTemplate: 'new.md', defaultTags: ['new'] },
    });

    const settings = await getSettings();
    expect(settings.filenameTemplate).toBe('new.md');
    expect(settings.defaultTags).toEqual(['new']);
    // ...but the local credential is still the only one there is.
    expect(settings.apiKey).toBe('mine');
  });

  it('merges a synced group with the local one rather than replacing it', async () => {
    await fakeBrowser.storage.local.set({
      settings: {
        github: {
          token: 'gh_local',
          owner: 'old',
          repo: 'old',
          branch: 'main',
          folder: 'x',
        },
      },
    });
    await fakeBrowser.storage.sync.set({
      settings: { github: { owner: 'new', repo: 'notes' } },
    });

    const settings = await getSettings();
    expect(settings.github).toMatchObject({
      token: 'gh_local',
      owner: 'new',
      repo: 'notes',
      // Untouched by the sync payload, so the local value survives.
      folder: 'x',
    });
  });

  it('works when the sync area is unavailable', async () => {
    // Firefox without an account, sync disabled by policy, a quota rejection.
    const get = vi
      .spyOn(fakeBrowser.storage.sync, 'get')
      .mockRejectedValue(new Error('sync is disabled'));
    const set = vi
      .spyOn(fakeBrowser.storage.sync, 'set')
      .mockRejectedValue(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(setSettings({ apiKey: 'ts_key' })).resolves.toMatchObject({
      apiKey: 'ts_key',
    });
    expect((await getSettings()).apiKey).toBe('ts_key');
    expect(warn).toHaveBeenCalled();

    get.mockRestore();
    set.mockRestore();
    warn.mockRestore();
  });
});

describe('opting out of sync', () => {
  it('stops writing to sync, and clears what it left there', async () => {
    await setSettings({ filenameTemplate: 'shared.md' });
    expect((await fakeBrowser.storage.sync.get('settings')).settings).toBeDefined();

    await setSettings({ syncSettings: false });

    // Not a stale copy for the next machine to adopt.
    expect((await fakeBrowser.storage.sync.get('settings')).settings).toBeUndefined();
  });

  it('ignores a synced copy while opted out', async () => {
    await fakeBrowser.storage.sync.set({
      settings: { filenameTemplate: 'from-sync.md' },
    });
    await fakeBrowser.storage.local.set({
      settings: { syncSettings: false, filenameTemplate: 'mine.md' },
    });

    expect((await getSettings()).filenameTemplate).toBe('mine.md');
  });

  it('adopts the synced copy again when switched back on', async () => {
    await fakeBrowser.storage.sync.set({
      settings: { filenameTemplate: 'from-sync.md' },
    });
    await fakeBrowser.storage.local.set({
      settings: { syncSettings: true, filenameTemplate: 'mine.md' },
    });

    expect((await getSettings()).filenameTemplate).toBe('from-sync.md');
  });

  /** One machine bowing out must not decide for the others. */
  it('never syncs the switch itself', async () => {
    await setSettings({ syncSettings: true });
    const synced = (await fakeBrowser.storage.sync.get('settings')).settings as Record<
      string,
      unknown
    >;
    expect(synced.syncSettings).toBeUndefined();
  });

  it('syncs by default', async () => {
    expect((await getSettings()).syncSettings).toBe(true);
  });

  it('does not read sync at all while opted out', async () => {
    await fakeBrowser.storage.local.set({ settings: { syncSettings: false } });
    const get = vi.spyOn(fakeBrowser.storage.sync, 'get');

    await getSettings();

    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
  });
});
