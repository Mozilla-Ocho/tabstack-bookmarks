import type { BackendId, Settings } from '../settings';

export interface SavePayload {
  /** Path relative to the backend's configured folder, including filename. */
  path: string;
  /** Full markdown document, frontmatter included. */
  content: string;
  title: string;
  url: string;
  /** Replace an existing file at the same path instead of creating a sibling. */
  overwrite: boolean;
}

export interface SaveResult {
  /** Where it landed, for display: "owner/repo/bookmarks/foo.md". */
  location: string;
  /** Clickable URL, when the backend has one. */
  link?: string;
}

export interface StorageBackend {
  id: BackendId;
  /** Full name, used in the options page dropdown. */
  label: string;
  /** One word, used for the popup badge. */
  shortLabel: string;
  save(payload: SavePayload, settings: Settings): Promise<SaveResult>;
}

/** UTF-8 safe base64, usable from a service worker or event page. */
export function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
