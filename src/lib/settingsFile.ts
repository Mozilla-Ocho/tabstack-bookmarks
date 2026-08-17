/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { i18n } from '#i18n';
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  type BackendId,
  type ContentScope,
  type Effort,
  type Settings,
} from './settings';

/**
 * Settings as a file, for backup and for moving to a machine that does not sync.
 *
 * Credentials are left out. An export lands in the downloads folder, which is
 * synced to somebody's cloud drive more often than not, and a file full of API
 * tokens is not a backup — it is a leak with a filename. The import keeps
 * whatever credentials the device already has, so restoring is: import the file,
 * paste your key.
 */

export interface SettingsFile {
  /** Marks the file as ours before we trust a single field in it. */
  tabstackBookmarks: true;
  schemaVersion: number;
  exportedAt: string;
  settings: Partial<Settings>;
}

/** What a file may set. Anything else in it is ignored. */
export function exportable(settings: Settings): Partial<Settings> {
  const {
    apiKey: _apiKey,
    schemaVersion: _version,
    github,
    obsidian,
    ...rest
  } = settings;
  const { token: _githubToken, ...githubRest } = github;
  const { token: _obsidianToken, ...obsidianRest } = obsidian;
  return {
    ...rest,
    github: { ...githubRest, token: '' },
    obsidian: { ...obsidianRest, token: '' },
  };
}

export function buildSettingsFile(settings: Settings, now: Date): SettingsFile {
  return {
    tabstackBookmarks: true,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    settings: exportable(settings),
  };
}

/** `tabstack-settings-2026-08-17.json` */
export function settingsFilename(now: Date): string {
  return `tabstack-settings-${now.toISOString().slice(0, 10)}.json`;
}

const EFFORTS: Effort[] = ['min', 'standard', 'max'];
const SCOPES: ContentScope[] = ['main', 'full'];
const BACKENDS: BackendId[] = ['github', 'download', 'obsidian'];

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function tags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((tag): tag is string => typeof tag === 'string');
}

function oneOf<T extends string>(value: unknown, allowed: T[]): T | undefined {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Drops keys that are absent, so a patch never writes `undefined` over a default. */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export interface ImportResult {
  settings?: Partial<Settings>;
  error?: string;
}

/**
 * Reads a file back into a settings patch.
 *
 * Every field is checked by type and, where it is an enumeration, by value. A
 * hand-edited file with `effort: "turbo"` or `defaultTags: "reading"` must not be
 * able to put the extension into a state its own UI cannot represent — the point
 * of a schema is that the edges are where it is enforced.
 */
export function parseSettingsFile(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: i18n.t('errors.settingsFile.notJson') };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { error: i18n.t('errors.settingsFile.notJson') };
  }

  const file = raw as Partial<SettingsFile>;
  if (file.tabstackBookmarks !== true || typeof file.settings !== 'object') {
    return { error: i18n.t('errors.settingsFile.notOurs') };
  }

  if (typeof file.schemaVersion === 'number' && file.schemaVersion > SCHEMA_VERSION) {
    return { error: i18n.t('errors.settingsFile.newer') };
  }

  const from = file.settings as Record<string, unknown>;
  const group = (name: 'github' | 'download' | 'obsidian'): Record<string, unknown> =>
    typeof from[name] === 'object' && from[name] !== null
      ? (from[name] as Record<string, unknown>)
      : {};

  const settings = defined({
    effort: oneOf(from.effort, EFFORTS),
    contentScope: oneOf(from.contentScope, SCOPES),
    backend: oneOf(from.backend, BACKENDS),
    nocache: bool(from.nocache),
    autoSave: bool(from.autoSave),
    summarize: bool(from.summarize),
    useSuggestedTags: bool(from.useSuggestedTags),
    syncSettings: bool(from.syncSettings),
    filenameTemplate: str(from.filenameTemplate),
    defaultTags: tags(from.defaultTags),
    github: defined({
      owner: str(group('github').owner),
      repo: str(group('github').repo),
      branch: str(group('github').branch),
      folder: str(group('github').folder),
    }),
    download: defined({ folder: str(group('download').folder) }),
    obsidian: defined({
      baseUrl: str(group('obsidian').baseUrl),
      folder: str(group('obsidian').folder),
    }),
  }) as Partial<Settings>;

  return { settings };
}

/**
 * Merges a parsed file onto the settings this device already has, keeping its
 * credentials. Groups merge field by field, so a file that omits `github.branch`
 * leaves the branch alone rather than blanking it.
 */
export function applySettingsFile(
  current: Settings,
  patch: Partial<Settings>,
): Partial<Settings> {
  return {
    ...patch,
    github: { ...current.github, ...patch.github, token: current.github.token },
    download: { ...current.download, ...patch.download },
    obsidian: { ...current.obsidian, ...patch.obsidian, token: current.obsidian.token },
    // Never from a file, whatever it claims.
    apiKey: current.apiKey,
    schemaVersion: DEFAULT_SETTINGS.schemaVersion,
  };
}
