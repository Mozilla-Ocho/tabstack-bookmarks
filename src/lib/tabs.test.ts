/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectTabs } from './tabs';

let query: ReturnType<typeof vi.fn>;

function tab(id: number, url: string, title = `Tab ${id}`) {
  return { id, url, title };
}

beforeEach(() => {
  fakeBrowser.reset();
  query = vi.fn().mockResolvedValue([]);
  fakeBrowser.tabs.query = query as never;
});

describe('collectTabs', () => {
  /**
   * The window has to be named. This runs in the background, which has no window
   * of its own: `currentWindow` there resolves to the focused window, and matches
   * nothing when the browser is not focused. A real Chrome collected zero tabs
   * that way while the page could see four.
   */
  it('queries the window it was given', async () => {
    await collectTabs({ windowId: 42 });
    expect(query).toHaveBeenCalledWith({ windowId: 42 });
  });

  it('queries every window when asked, whatever the window id says', async () => {
    await collectTabs({ allWindows: true, windowId: 42 });
    expect(query).toHaveBeenCalledWith({});
  });

  it('falls back to the focused window when nobody said which', async () => {
    await collectTabs();
    expect(query).toHaveBeenCalledWith({ currentWindow: true });
  });

  it('shapes tabs the way the import queue already takes them', async () => {
    query.mockResolvedValue([tab(7, 'https://ex.com/a', 'A Page')]);

    expect(await collectTabs()).toEqual([
      { id: '7', url: 'https://ex.com/a', title: 'A Page', folders: [] },
    ]);
  });

  /** A tab has no folder, so "folder names as tags" has nothing to say. */
  it('gives every tab an empty folder list', async () => {
    query.mockResolvedValue([tab(1, 'https://ex.com/a'), tab(2, 'https://ex.com/b')]);
    for (const item of await collectTabs()) expect(item.folders).toEqual([]);
  });

  it('leaves out the tabs that cannot be saved', async () => {
    query.mockResolvedValue([
      tab(1, 'https://ex.com/a'),
      tab(2, 'about:debugging'),
      tab(3, 'chrome://extensions'),
      tab(4, 'file:///tmp/notes.md'),
      { id: 5, title: 'No URL at all' },
      tab(6, 'http://ex.com/b'),
    ]);

    expect((await collectTabs()).map((item) => item.url)).toEqual([
      'https://ex.com/a',
      'http://ex.com/b',
    ]);
  });

  /**
   * Two tabs on the same page is normal — a duplicate, or the same article opened
   * from two places. Saving it twice would cost twice.
   */
  it('saves a page once however many tabs are open on it', async () => {
    query.mockResolvedValue([
      tab(1, 'https://ex.com/post', 'The Post'),
      tab(2, 'https://ex.com/post', 'The Post again'),
      tab(3, 'https://ex.com/post?utm_source=newsletter', 'From the newsletter'),
    ]);

    const items = await collectTabs();
    expect(items).toHaveLength(1);
    // The first tab wins, and its URL is already canonical.
    expect(items[0]).toMatchObject({ url: 'https://ex.com/post', title: 'The Post' });
  });

  it('strips tracking parameters, like every other way in', async () => {
    query.mockResolvedValue([tab(1, 'https://ex.com/a?fbclid=xyz&id=7')]);
    expect((await collectTabs())[0]!.url).toBe('https://ex.com/a?id=7');
  });

  it('tolerates a tab with no title', async () => {
    query.mockResolvedValue([{ id: 9, url: 'https://ex.com/a' }]);
    expect((await collectTabs())[0]).toMatchObject({ title: '' });
  });

  it('falls back to the URL when a tab has no id', async () => {
    query.mockResolvedValue([{ url: 'https://ex.com/a', title: 'A' }]);
    // The id only has to be unique for React keys and progress.
    expect((await collectTabs())[0]!.id).toBe('https://ex.com/a');
  });

  it('returns nothing when no tab can be saved', async () => {
    query.mockResolvedValue([tab(1, 'about:blank')]);
    expect(await collectTabs()).toEqual([]);
  });
});
