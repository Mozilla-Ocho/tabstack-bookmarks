/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import {
  applySettingsFile,
  buildSettingsFile,
  parseSettingsFile,
  settingsFilename,
} from './settingsFile';
import { DEFAULT_SETTINGS, SCHEMA_VERSION, type Settings } from './settings';

const NOW = new Date('2026-08-17T09:30:00Z');

function configured(patch: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    apiKey: 'ts_secret',
    filenameTemplate: '{yyyy}/{slug}.md',
    defaultTags: ['inbox'],
    backend: 'github',
    github: {
      token: 'gh_secret',
      owner: 'me',
      repo: 'notes',
      branch: 'trunk',
      folder: 'p',
    },
    obsidian: { token: 'obs_secret', baseUrl: 'http://127.0.0.1:27123', folder: 'B' },
    ...patch,
  };
}

/** An export is what someone keeps in a folder that is probably synced. */
describe('exporting', () => {
  it('leaves every credential out', () => {
    const file = buildSettingsFile(configured(), NOW);
    const json = JSON.stringify(file);

    expect(json).not.toContain('secret');
    expect(file.settings.apiKey).toBeUndefined();
    expect(file.settings.github!.token).toBe('');
    expect(file.settings.obsidian!.token).toBe('');
  });

  it('keeps the preferences worth restoring', () => {
    const file = buildSettingsFile(configured(), NOW);
    expect(file.settings).toMatchObject({
      filenameTemplate: '{yyyy}/{slug}.md',
      defaultTags: ['inbox'],
      backend: 'github',
      github: { owner: 'me', repo: 'notes', branch: 'trunk', folder: 'p' },
      obsidian: { baseUrl: 'http://127.0.0.1:27123', folder: 'B' },
    });
  });

  it('marks the file as ours, and stamps it', () => {
    const file = buildSettingsFile(configured(), NOW);
    expect(file.tabstackBookmarks).toBe(true);
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.exportedAt).toBe('2026-08-17T09:30:00.000Z');
  });

  it('names the file by the day it was written', () => {
    expect(settingsFilename(NOW)).toBe('tabstack-settings-2026-08-17.json');
  });
});

describe('reading a file back', () => {
  const round = (settings: Settings) =>
    parseSettingsFile(JSON.stringify(buildSettingsFile(settings, NOW)));

  it('round-trips its own export', () => {
    const { settings, error } = round(configured());
    expect(error).toBeUndefined();
    expect(settings).toMatchObject({
      filenameTemplate: '{yyyy}/{slug}.md',
      backend: 'github',
      github: { owner: 'me', repo: 'notes', branch: 'trunk' },
    });
  });

  it('refuses a file that is not JSON', () => {
    expect(parseSettingsFile('not json at all').error).toMatch(/not JSON/);
    expect(parseSettingsFile('[1,2,3]').error).toMatch(/not exported by this extension/);
    expect(parseSettingsFile('"a string"').error).toMatch(/not JSON/);
  });

  it('refuses somebody else’s JSON', () => {
    expect(parseSettingsFile('{"settings":{"backend":"github"}}').error).toMatch(
      /not exported by this extension/,
    );
  });

  it('refuses a file from a newer version rather than guessing', () => {
    const file = { ...buildSettingsFile(configured(), NOW), schemaVersion: 99 };
    expect(parseSettingsFile(JSON.stringify(file)).error).toMatch(/newer version/);
  });

  /**
   * The file is hand-editable, so it is an input like any other. A bad value must
   * be dropped rather than putting the extension in a state its own UI cannot show.
   */
  it('drops fields with the wrong type or an unknown value', () => {
    const { settings, error } = parseSettingsFile(
      JSON.stringify({
        tabstackBookmarks: true,
        settings: {
          effort: 'turbo',
          contentScope: 42,
          backend: 'dropbox',
          autoSave: 'yes',
          filenameTemplate: { not: 'a string' },
          defaultTags: 'reading',
          github: 'not an object',
        },
      }),
    );

    expect(error).toBeUndefined();
    expect(settings).toEqual({ github: {}, download: {}, obsidian: {} });
  });

  it('keeps the good fields alongside the bad ones', () => {
    const { settings } = parseSettingsFile(
      JSON.stringify({
        tabstackBookmarks: true,
        settings: { effort: 'max', backend: 'nonsense', nocache: true },
      }),
    );
    expect(settings).toMatchObject({ effort: 'max', nocache: true });
    expect(settings!.backend).toBeUndefined();
  });

  it('keeps only the strings out of a tag list', () => {
    const { settings } = parseSettingsFile(
      JSON.stringify({
        tabstackBookmarks: true,
        settings: { defaultTags: ['keep', 7, null, 'this'] },
      }),
    );
    expect(settings!.defaultTags).toEqual(['keep', 'this']);
  });

  it('ignores a credential a file tries to set', () => {
    const { settings } = parseSettingsFile(
      JSON.stringify({
        tabstackBookmarks: true,
        settings: {
          apiKey: 'ts_from_file',
          github: { token: 'gh_from_file', owner: 'me' },
        },
      }),
    );
    expect(settings!.apiKey).toBeUndefined();
    expect(settings!.github).toEqual({ owner: 'me' });
  });
});

describe('applying a file', () => {
  it('keeps the credentials this device already has', () => {
    const current = configured();
    const { settings } = parseSettingsFile(
      JSON.stringify(
        buildSettingsFile(
          configured({ github: { ...current.github, owner: 'them' } }),
          NOW,
        ),
      ),
    );

    const merged = applySettingsFile(current, settings!);

    expect(merged.apiKey).toBe('ts_secret');
    expect(merged.github!.token).toBe('gh_secret');
    expect(merged.obsidian!.token).toBe('obs_secret');
    expect(merged.github!.owner).toBe('them');
  });

  /** A file that omits a field should leave it alone, not blank it. */
  it('merges a group field by field', () => {
    const current = configured();
    const merged = applySettingsFile(current, { github: { repo: 'other' } as never });

    expect(merged.github).toMatchObject({
      repo: 'other',
      owner: 'me',
      branch: 'trunk',
      folder: 'p',
      token: 'gh_secret',
    });
  });

  it('stamps the current schema version', () => {
    const merged = applySettingsFile(configured(), { schemaVersion: 99 } as never);
    expect(merged.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
