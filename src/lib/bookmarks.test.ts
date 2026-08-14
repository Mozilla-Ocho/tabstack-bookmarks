/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectBookmarks, dedupeByUrl, listBookmarkFolders } from './bookmarks';

/** Shape of a Firefox tree: unnamed root, named roots, nested folders. */
const TREE = [
  {
    id: 'root________',
    title: '',
    children: [
      {
        id: 'toolbar_____',
        title: 'Bookmarks Toolbar',
        children: [
          { id: 'b1', title: 'Post One', url: 'https://ex.com/one', dateAdded: 1 },
          { id: 'b2', title: '', url: 'https://ex.com/two' },
          { id: 'js', title: 'Bookmarklet', url: 'javascript:void(0)' },
          {
            id: 'reading',
            title: 'Reading',
            children: [
              { id: 'b3', title: 'Deep', url: 'https://ex.com/three' },
              { id: 'b4', title: 'Dupe', url: 'https://ex.com/one' },
            ],
          },
        ],
      },
      {
        id: 'menu________',
        title: 'Bookmarks Menu',
        children: [{ id: 'sep', type: 'separator' }],
      },
    ],
  },
];

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.bookmarks, 'getTree').mockResolvedValue(TREE as never);
  vi.spyOn(fakeBrowser.bookmarks, 'getSubTree').mockImplementation((async (
    id: string,
  ) => {
    const find = (nodes: typeof TREE): unknown =>
      nodes.reduce<unknown>((found, node) => {
        if (found) return found;
        if (node.id === id) return node;
        return node.children ? find(node.children as typeof TREE) : undefined;
      }, undefined);
    return [find(TREE)];
  }) as never);
});

describe('collectBookmarks', () => {
  it('returns saveable bookmarks with their folder path', async () => {
    const items = await collectBookmarks();
    expect(items.map((i) => i.url)).toEqual([
      'https://ex.com/one',
      'https://ex.com/two',
      'https://ex.com/three',
    ]);
    // The unnamed root contributes no folder name.
    expect(items[0]!.folders).toEqual(['Bookmarks Toolbar']);
    expect(items[2]!.folders).toEqual(['Bookmarks Toolbar', 'Reading']);
  });

  it('skips non-http entries and separators', async () => {
    const items = await collectBookmarks();
    expect(items.some((i) => i.url.startsWith('javascript:'))).toBe(false);
    expect(items).toHaveLength(3);
  });

  it('drops duplicate URLs, keeping the first', async () => {
    const items = await collectBookmarks();
    expect(items.filter((i) => i.url === 'https://ex.com/one')).toHaveLength(1);
    expect(items.find((i) => i.url === 'https://ex.com/one')!.title).toBe('Post One');
  });

  it('can be scoped to one folder subtree', async () => {
    const items = await collectBookmarks('reading');
    expect(items.map((i) => i.url)).toEqual([
      'https://ex.com/three',
      'https://ex.com/one',
    ]);
    expect(items[0]!.folders).toEqual(['Reading']);
  });
});

describe('dedupeByUrl', () => {
  it('is order preserving', () => {
    const items = [
      { id: '1', url: 'a', title: 'first', folders: [] },
      { id: '2', url: 'b', title: 'b', folders: [] },
      { id: '3', url: 'a', title: 'second', folders: [] },
    ];
    expect(dedupeByUrl(items).map((i) => i.title)).toEqual(['first', 'b']);
  });
});

describe('listBookmarkFolders', () => {
  it('counts a folder plus everything under it', async () => {
    const folders = await listBookmarkFolders();
    const toolbar = folders.find((f) => f.path === 'Bookmarks Toolbar')!;
    expect(toolbar.count).toBe(4); // 2 direct + 2 in Reading, before dedupe
    expect(folders.find((f) => f.path === 'Bookmarks Toolbar/Reading')!.count).toBe(2);
  });

  it('hides empty folders and reports nesting depth', async () => {
    const folders = await listBookmarkFolders();
    expect(folders.some((f) => f.path === 'Bookmarks Menu')).toBe(false);
    expect(folders.find((f) => f.path === 'Bookmarks Toolbar')!.depth).toBe(0);
    expect(folders.find((f) => f.path === 'Bookmarks Toolbar/Reading')!.depth).toBe(1);
  });
});
