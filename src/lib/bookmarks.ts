/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';
import { isSaveableUrl } from './save';

export interface BookmarkItem {
  id: string;
  url: string;
  title: string;
  /** Enclosing folder names, outermost first. */
  folders: string[];
  dateAdded?: number;
}

export interface BookmarkFolder {
  id: string;
  /** Folder names joined with "/", e.g. "Bookmarks Toolbar/Reading". */
  path: string;
  /** Saveable bookmarks in this folder and everything under it. */
  count: number;
  depth: number;
}

type Node = {
  id: string;
  title?: string;
  url?: string;
  children?: Node[];
};

/** Depth-first walk yielding every saveable bookmark with its folder path. */
function walk(nodes: Node[], folders: string[], out: BookmarkItem[]): void {
  for (const node of nodes) {
    if (node.children) {
      // The unnamed roots ("", "root________") should not become tags.
      const name = node.title?.trim();
      walk(node.children, name ? [...folders, name] : folders, out);
      continue;
    }
    if (!isSaveableUrl(node.url)) continue;
    out.push({
      id: node.id,
      url: node.url!,
      title: node.title?.trim() ?? '',
      folders,
      dateAdded: (node as { dateAdded?: number }).dateAdded,
    });
  }
}

/** Every saveable bookmark in the tree, or in one folder's subtree. */
export async function collectBookmarks(folderId?: string): Promise<BookmarkItem[]> {
  const out: BookmarkItem[] = [];
  if (folderId) {
    const [node] = (await browser.bookmarks.getSubTree(folderId)) as unknown as Node[];
    if (node) walk([node], [], out);
  } else {
    walk((await browser.bookmarks.getTree()) as unknown as Node[], [], out);
  }
  return dedupeByUrl(out);
}

/** Bookmarks pointing at the same URL only need saving once. */
export function dedupeByUrl(items: BookmarkItem[]): BookmarkItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

/** Folder list for the import picker, each with a subtree count. */
export async function listBookmarkFolders(): Promise<BookmarkFolder[]> {
  const roots = (await browser.bookmarks.getTree()) as unknown as Node[];
  const folders: BookmarkFolder[] = [];

  const visit = (node: Node, names: string[]): number => {
    let count = 0;
    for (const child of node.children ?? []) {
      if (child.children) {
        const name = child.title?.trim();
        count += visit(child, name ? [...names, name] : names);
      } else if (isSaveableUrl(child.url)) {
        count += 1;
      }
    }
    if (names.length) {
      folders.push({
        id: node.id,
        path: names.join('/'),
        count,
        depth: names.length - 1,
      });
    }
    return count;
  };

  for (const root of roots) visit(root, root.title?.trim() ? [root.title.trim()] : []);
  return folders
    .filter((folder) => folder.count > 0)
    .sort((a, b) => a.path.localeCompare(b.path));
}
