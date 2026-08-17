/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';
import type { BookmarkItem } from './bookmarks';
import { isSaveableUrl } from './save';
import { canonicalUrl } from './url';

export interface TabScope {
  /** Every window, rather than one. */
  allWindows?: boolean;
  /**
   * Which window "this window" means. The page has to say: this runs in the
   * background, which has no window of its own, so `currentWindow` there resolves
   * to the focused window — and matches nothing at all when the browser is not
   * focused. Driving a real Chrome found exactly that: zero tabs collected while
   * the page could see four.
   */
  windowId?: number;
}

/**
 * The open tabs, as items the import queue can already run.
 *
 * Twenty tabs left open for a week is the same problem a bookmark folder is, and
 * the queue that drains a folder — persisted progress, backoff, cancel, resume
 * after the browser suspends the extension — is exactly what draining a window
 * needs. So this returns the shape it already accepts rather than growing a second
 * queue beside it.
 *
 * `folders` is always empty: a tab has no folder, and "turn folder names into
 * tags" has nothing to say about one.
 */
export async function collectTabs(scope: TabScope = {}): Promise<BookmarkItem[]> {
  const tabs = await browser.tabs.query(
    scope.allWindows
      ? {}
      : scope.windowId !== undefined
        ? { windowId: scope.windowId }
        : // Nobody said which window; the focused one is the best guess left.
          { currentWindow: true },
  );

  const items: BookmarkItem[] = [];
  const seen = new Set<string>();

  for (const tab of tabs) {
    if (!isSaveableUrl(tab.url)) continue;

    // Two tabs on the same page is normal — a duplicate, or the same article
    // opened from two places. Save it once.
    const url = canonicalUrl(tab.url!);
    if (seen.has(url)) continue;
    seen.add(url);

    items.push({
      id: String(tab.id ?? url),
      url,
      title: tab.title ?? '',
      folders: [],
    });
  }

  return items;
}
