/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';
import { i18n } from '#i18n';

export type Effort = 'min' | 'standard' | 'max';
export type ContentScope = 'main' | 'full';
export type BackendId = 'github' | 'download' | 'obsidian';

export interface GitHubSettings {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  /** Folder inside the repo, e.g. "bookmarks". Empty = repo root. */
  folder: string;
}

export interface DownloadSettings {
  /** Subfolder of the browser download directory. Empty = download root. */
  folder: string;
}

export interface ObsidianSettings {
  /** Local REST API plugin base URL, e.g. http://127.0.0.1:27123. */
  baseUrl: string;
  /** The plugin's API key. */
  token: string;
  /** Folder inside the vault. Empty = vault root. */
  folder: string;
}

/**
 * Bumped only when stored settings need *reshaping* — a renamed or re-typed
 * field. Added fields need no bump, because getSettings() merges defaults.
 */
export const SCHEMA_VERSION = 1;

export interface Settings {
  /** Schema version of the stored object; see migrate(). */
  schemaVersion: number;
  apiKey: string;
  effort: Effort;
  contentScope: ContentScope;
  /** Bypass Tabstack's cache on every save. */
  nocache: boolean;
  /** Save as soon as the popup opens instead of waiting for a click. */
  autoSave: boolean;
  /** Tokens: {yyyy} {mm} {dd} {date} {slug} {title} {host} */
  filenameTemplate: string;
  /** Tags applied to every bookmark, on top of per-save tags. */
  defaultTags: string[];
  /** Also call /generate/json for a summary, key points and tag suggestions. */
  summarize: boolean;
  /** Add the tags the summary suggests to the bookmark's own tags. */
  useSuggestedTags: boolean;
  backend: BackendId;
  github: GitHubSettings;
  download: DownloadSettings;
  obsidian: ObsidianSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SCHEMA_VERSION,
  apiKey: '',
  effort: 'standard',
  contentScope: 'main',
  nocache: false,
  autoSave: true,
  filenameTemplate: '{date}-{slug}.md',
  defaultTags: [],
  summarize: false,
  useSuggestedTags: true,
  backend: 'download',
  github: { token: '', owner: '', repo: '', branch: 'main', folder: 'bookmarks' },
  download: { folder: 'tabstack' },
  obsidian: { baseUrl: 'http://127.0.0.1:27123', token: '', folder: 'Bookmarks' },
};

const KEY = 'settings';

/**
 * Reshapes an older stored object. Nothing to do yet — version 1 is the first
 * shape — but the seam exists so a future rename has an obvious home, instead of
 * being smuggled into getSettings() as an `if (raw.oldName)`.
 */
function migrate(raw: Partial<Settings>): Partial<Settings> {
  const from = raw.schemaVersion ?? SCHEMA_VERSION;
  if (from > SCHEMA_VERSION) {
    // A newer version of the extension wrote these. Merging defaults over
    // unknown fields is the safest thing available.
    return raw;
  }
  return raw;
}

/**
 * Everything except the three credentials, which stay on the device.
 *
 * `storage.sync` is readable by the browser's sync service and, on Chrome,
 * travels through the user's Google account. An API key and a GitHub token are
 * not ours to put there — see SECURITY.md. Preferences are: retyping a filename
 * template on every machine is the kind of friction people uninstall over.
 */
export interface SyncedSettings extends Omit<Settings, 'apiKey' | 'github' | 'obsidian'> {
  github: Omit<GitHubSettings, 'token'>;
  obsidian: Omit<ObsidianSettings, 'token'>;
}

function syncable(s: Settings): SyncedSettings {
  const { apiKey: _apiKey, github, obsidian, ...rest } = s;
  const { token: _githubToken, ...githubRest } = github;
  const { token: _obsidianToken, ...obsidianRest } = obsidian;
  return { ...rest, github: githubRest, obsidian: obsidianRest };
}

async function readArea(
  area: 'local' | 'sync',
  key: string,
): Promise<Record<string, unknown>> {
  try {
    return ((await browser.storage[area].get(key))[key] ?? {}) as Record<string, unknown>;
  } catch {
    // Firefox without a signed-in account, a disabled sync service, an
    // enterprise policy: none of that should stop the extension working.
    return {};
  }
}

/**
 * The one rule: preferences come from `sync` when it has them, credentials only
 * ever from `local`.
 *
 * Both areas are written together by `setSettings`, so they only differ when
 * *another* device changed something — which is exactly when the synced copy is
 * the newer one. A device that has never synced sees an empty `sync` and falls
 * back to everything it has locally.
 */
export async function getSettings(): Promise<Settings> {
  const [local, synced] = await Promise.all([
    readArea('local', KEY),
    readArea('sync', KEY),
  ]);

  const raw = migrate({ ...local, ...synced } as Partial<Settings>);
  const device = local as Partial<Settings>;

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    github: {
      ...DEFAULT_SETTINGS.github,
      ...(local.github as Partial<GitHubSettings> | undefined),
      ...(synced.github as Partial<GitHubSettings> | undefined),
      token: device.github?.token ?? '',
    },
    download: {
      ...DEFAULT_SETTINGS.download,
      ...(local.download as Partial<DownloadSettings> | undefined),
      ...(synced.download as Partial<DownloadSettings> | undefined),
    },
    obsidian: {
      ...DEFAULT_SETTINGS.obsidian,
      ...(local.obsidian as Partial<ObsidianSettings> | undefined),
      ...(synced.obsidian as Partial<ObsidianSettings> | undefined),
      token: device.obsidian?.token ?? '',
    },
    apiKey: device.apiKey ?? '',
    schemaVersion: SCHEMA_VERSION,
  };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };

  // Local gets everything, including the credentials: this device has to keep
  // working when sync is unavailable.
  await browser.storage.local.set({ [KEY]: next });
  try {
    await browser.storage.sync.set({ [KEY]: syncable(next) });
  } catch (error) {
    // Over quota, no account, sync disabled by policy. The settings are already
    // saved; syncing them is the part that failed.
    console.warn('[tabstack] settings did not sync:', error);
  }

  return next;
}

/** Missing config that would make a save fail. */
export function configErrors(s: Settings): string[] {
  const errors: string[] = [];
  if (!s.apiKey.trim()) errors.push(i18n.t('errors.config.apiKey'));
  if (s.backend === 'github') {
    if (!s.github.token.trim()) errors.push(i18n.t('errors.config.githubToken'));
    if (!s.github.owner.trim()) errors.push(i18n.t('errors.config.githubOwner'));
    if (!s.github.repo.trim()) errors.push(i18n.t('errors.config.githubRepo'));
  }
  if (s.backend === 'obsidian') {
    if (!s.obsidian.baseUrl.trim()) errors.push(i18n.t('errors.config.obsidianUrl'));
    if (!s.obsidian.token.trim()) errors.push(i18n.t('errors.config.obsidianToken'));
  }
  return errors;
}

/**
 * Origin pattern the active backend needs at runtime. GitHub and Tabstack are
 * in the manifest; user-supplied endpoints have to be requested on demand.
 */
/**
 * Whether an origin can actually be granted at runtime. The manifest's optional
 * host permissions are limited to loopback, so a vault on another machine needs
 * its pattern added to wxt.config.ts and a rebuild.
 */
export function isGrantableOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin.replace('/*', '/'));
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function backendOrigin(s: Settings): string | null {
  const raw = s.backend === 'obsidian' ? s.obsidian.baseUrl : null;
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}
