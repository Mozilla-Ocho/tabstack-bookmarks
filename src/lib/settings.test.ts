import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  backendOrigin,
  isGrantableOrigin,
  configErrors,
  DEFAULT_SETTINGS,
  getSettings,
  setSettings,
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
