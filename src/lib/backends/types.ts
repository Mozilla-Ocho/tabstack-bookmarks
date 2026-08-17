/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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
  /**
   * The browser's download id, for `downloads.show`. A downloaded file has no
   * URL to link to, so revealing it in the file manager is the only way to open
   * what was just saved.
   */
  downloadId?: number;
}

export interface StorageBackend {
  id: BackendId;
  save(payload: SavePayload, settings: Settings): Promise<SaveResult>;
}
// How a destination is *named* is display text, and lives in
// `src/ui/backendLabels.ts` with the rest of the strings.

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
