import { browser } from '#imports';

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


export interface Settings {
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

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  const raw = (stored[KEY] ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    github: { ...DEFAULT_SETTINGS.github, ...(raw.github ?? {}) },
    download: { ...DEFAULT_SETTINGS.download, ...(raw.download ?? {}) },
    obsidian: { ...DEFAULT_SETTINGS.obsidian, ...(raw.obsidian ?? {}) },
  };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

/** Missing config that would make a save fail. */
export function configErrors(s: Settings): string[] {
  const errors: string[] = [];
  if (!s.apiKey.trim()) errors.push('Tabstack API key is missing.');
  if (s.backend === 'github') {
    if (!s.github.token.trim()) errors.push('GitHub token is missing.');
    if (!s.github.owner.trim()) errors.push('GitHub owner is missing.');
    if (!s.github.repo.trim()) errors.push('GitHub repo is missing.');
  }
  if (s.backend === 'obsidian') {
    if (!s.obsidian.baseUrl.trim()) errors.push('Obsidian REST API URL is missing.');
    if (!s.obsidian.token.trim()) errors.push('Obsidian REST API key is missing.');
  }
  return errors;
}

/**
 * Origin pattern the active backend needs at runtime. GitHub and Tabstack are
 * in the manifest; user-supplied endpoints have to be requested on demand.
 */
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
