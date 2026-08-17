/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/*
 * Not in entrypoints/ with the file it tests: WXT reads every top-level file
 * there as an entrypoint, taking the name up to the first dot, so
 * `background.test.ts` registers a second `background` and the build fails with
 * "Multiple entrypoints with the same name". Page tests are fine where they are,
 * because a page entrypoint is its directory's index.html.
 */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveRecord } from '@/src/lib/messages';

vi.mock('@/src/lib/save', () => ({
  runSave: vi.fn(),
  isSaveableUrl: (url?: string) => /^https?:\/\//.test(url ?? ''),
}));
vi.mock('@/src/lib/bookmarks', () => ({
  listBookmarkFolders: vi.fn(async () => [
    { id: 'toolbar', path: 'Toolbar', depth: 0, count: 2 },
  ]),
  collectBookmarks: vi.fn(async () => [
    { id: '1', url: 'https://ex.com/a', title: 'A', folders: [] },
  ]),
}));

import background from '@/entrypoints/background';
import { runSave } from '@/src/lib/save';
import { listPending, queueRetry } from '@/src/lib/retryQueue';
import { getRecord } from '@/src/lib/saveStore';

const save = vi.mocked(runSave);

function done(patch: Partial<SaveRecord> = {}): SaveRecord {
  return {
    url: 'https://ex.com/a',
    title: 'A',
    status: 'done',
    tags: [],
    path: 'a.md',
    startedAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

/**
 * Sends a message the way a page does.
 *
 * `fakeBrowser.runtime.sendMessage` implements the contract the whole extension
 * depends on: it only waits for `sendResponse` if a listener returned `true`.
 * Chrome's `onMessage` ignores a returned promise, so a "simplification" of
 * `route()` into an async listener would leave every caller with `undefined` —
 * which is what these tests would show.
 */
function send<T = unknown>(message: unknown): Promise<T> {
  return fakeBrowser.runtime.sendMessage(message) as Promise<T>;
}

/**
 * A working event, for the APIs `fakeBrowser` does not implement. Returns the
 * listeners' own return values from `trigger`, like the real thing.
 */
function fakeEvent<Args extends unknown[]>() {
  const listeners: ((...args: Args) => unknown)[] = [];
  return {
    addListener: (fn: (...args: Args) => unknown) => void listeners.push(fn),
    removeListener: (fn: (...args: Args) => unknown) => {
      const at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    hasListener: (fn: (...args: Args) => unknown) => listeners.includes(fn),
    trigger: (...args: Args) => listeners.map((fn) => fn(...args)),
  };
}

/** A whole Alarm, which is what the listener's type asks for. */
function alarm(name: string) {
  return {
    name,
    scheduledTime: Date.now(),
    periodInMinutes: 1,
    persistAcrossSessions: false,
  };
}

let onCommand: ReturnType<typeof fakeEvent<[string]>>;
let onNotificationClicked: ReturnType<typeof fakeEvent<[string]>>;
let onMenuClicked: ReturnType<
  typeof fakeEvent<
    [Record<string, unknown>, { title?: string; url?: string } | undefined]
  >
>;

beforeEach(() => {
  fakeBrowser.reset();
  vi.clearAllMocks();
  save.mockImplementation(async (request, onUpdate) => {
    const record = done({ url: request.url, title: request.title });
    onUpdate(record);
    return record;
  });
  // Menus, commands and notifications are unimplemented in the fake.
  onCommand = fakeEvent<[string]>();
  onMenuClicked =
    fakeEvent<[Record<string, unknown>, { title?: string; url?: string } | undefined]>();
  fakeBrowser.commands = { onCommand } as never;
  fakeBrowser.contextMenus = {
    removeAll: vi.fn(async () => {}),
    create: vi.fn(),
    onClicked: onMenuClicked,
  } as never;
  onNotificationClicked = fakeEvent<[string]>();
  fakeBrowser.notifications.create = vi.fn(async () => 'id') as never;
  fakeBrowser.notifications.clear = vi.fn(async () => true) as never;
  (fakeBrowser.notifications as unknown as Record<string, unknown>).onClicked =
    onNotificationClicked;
  fakeBrowser.tabs.create = vi.fn(async () => ({})) as never;
  fakeBrowser.downloads = {
    show: vi.fn(async () => {}),
    showDefaultFolder: vi.fn(),
  } as never;
  fakeBrowser.action = {
    setBadgeText: vi.fn(async () => {}),
    setBadgeBackgroundColor: vi.fn(async () => {}),
  } as never;

  background.main();
});

describe('message routing', () => {
  it('answers a save with the finished record, and remembers it', async () => {
    const reply = await send<SaveRecord>({
      type: 'save',
      url: 'https://ex.com/a',
      title: 'A',
    });

    expect(reply).toMatchObject({ status: 'done', path: 'a.md' });
    // rememberSave, not just the in-flight progress write.
    expect(await getRecord('https://ex.com/a')).toMatchObject({ status: 'done' });
  });

  it('answers getState from the store', async () => {
    await send({ type: 'save', url: 'https://ex.com/a', title: 'A' });
    const reply = await send<SaveRecord>({
      type: 'getState',
      url: 'https://ex.com/a',
    });
    expect(reply).toMatchObject({ url: 'https://ex.com/a', status: 'done' });
  });

  it('answers getState with nothing for a page never saved', async () => {
    expect(await send({ type: 'getState', url: 'https://nope.com' })).toBeUndefined();
  });

  it('forgets a record on request', async () => {
    await send({ type: 'save', url: 'https://ex.com/a', title: 'A' });
    expect(await send({ type: 'clearState', url: 'https://ex.com/a' })).toBe(true);
    expect(await send({ type: 'getState', url: 'https://ex.com/a' })).toBeUndefined();
  });

  it('answers listFolders', async () => {
    expect(await send({ type: 'listFolders' })).toEqual([
      { id: 'toolbar', path: 'Toolbar', depth: 0, count: 2 },
    ]);
  });

  it('searches the saved index, reporting the counts behind the window', async () => {
    await send({ type: 'save', url: 'https://ex.com/a', title: 'A' });
    await send({ type: 'save', url: 'https://other.com/b', title: 'B' });

    const all = await send<{ entries: unknown[]; matched: number; total: number }>({
      type: 'searchSaved',
    });
    expect(all).toMatchObject({ matched: 2, total: 2 });

    const hits = await send<{ entries: { url: string }[]; matched: number }>({
      type: 'searchSaved',
      query: 'other.com',
    });
    expect(hits.entries.map((entry) => entry.url)).toEqual(['https://other.com/b']);
    expect(hits.matched).toBe(1);
  });

  it('answers planImport with counts, not the item list', async () => {
    const reply = await send<{ count: number; skipped: number }>({
      type: 'planImport',
      options: {
        skipSaved: false,
        tagsFromFolders: false,
        tags: [],
        delayMs: 0,
        summarize: false,
      },
    });
    expect(reply).toEqual({ count: 1, skipped: 0 });
    expect(reply).not.toHaveProperty('items');
  });

  /** The item list can be thousands of bookmarks; it must never be broadcast. */
  it('strips the item list from import progress', async () => {
    const reply = await send<Record<string, unknown>>({
      type: 'startImport',
      options: {
        skipSaved: false,
        tagsFromFolders: false,
        tags: [],
        delayMs: 0,
        summarize: false,
      },
    });
    expect(reply).toMatchObject({ total: 1 });
    expect(reply).not.toHaveProperty('items');
  });

  /**
   * The load-bearing half of the routing contract, asserted on the listener's own
   * return value: `true` for anything it will answer, `false` for anything else.
   */
  it('keeps the channel open only for messages it handles', async () => {
    const reply = (message: unknown) =>
      fakeBrowser.runtime.onMessage.trigger(message, { id: 'test' }, () => {});

    expect(await reply({ type: 'listFolders' })).toContain(true);
    expect(await reply({ type: 'nonsense' })).toEqual([false]);
    expect(await reply(undefined)).toEqual([false]);
  });

  /**
   * A rejected handler must answer `{ error }` rather than hanging, or the popup
   * waits on a reply that never comes.
   */
  it('turns a handler failure into an error reply', async () => {
    save.mockRejectedValueOnce(new Error('storage is full'));
    expect(await send({ type: 'save', url: 'https://ex.com/a', title: 'A' })).toEqual({
      error: 'storage is full',
    });
  });
});

describe('the other ways to save', () => {
  it('saves the active tab on the keyboard command', async () => {
    fakeBrowser.tabs.query = vi
      .fn()
      .mockResolvedValue([{ url: 'https://ex.com/a', title: 'A' }]) as never;

    onCommand.trigger('save-page');
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0]).toMatchObject({ url: 'https://ex.com/a' });
  });

  it('ignores the command on a page it cannot save', async () => {
    fakeBrowser.tabs.query = vi
      .fn()
      .mockResolvedValue([{ url: 'about:addons', title: 'Add-ons' }]) as never;

    onCommand.trigger('save-page');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(save).not.toHaveBeenCalled();
  });

  it('ignores commands it does not own', async () => {
    onCommand.trigger('some-other-command');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(save).not.toHaveBeenCalled();
  });
});

describe('the context menu', () => {
  it('saves the page it was opened on', async () => {
    onMenuClicked.trigger(
      { menuItemId: 'tabstack-save-page', pageUrl: 'https://ex.com/a' },
      { title: 'A', url: 'https://ex.com/a' },
    );

    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0]).toMatchObject({
      url: 'https://ex.com/a',
      title: 'A',
    });
  });

  it('saves a link, titled with the link text rather than the page', async () => {
    onMenuClicked.trigger(
      {
        menuItemId: 'tabstack-save-link',
        linkUrl: 'https://ex.com/linked',
        linkText: 'The linked thing',
        pageUrl: 'https://ex.com/a',
      },
      { title: 'A', url: 'https://ex.com/a' },
    );

    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![0]).toMatchObject({
      url: 'https://ex.com/linked',
      title: 'The linked thing',
    });
  });

  it('ignores a link it cannot save', async () => {
    onMenuClicked.trigger(
      { menuItemId: 'tabstack-save-link', linkUrl: 'mailto:me@example.com' },
      { title: 'A' },
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(save).not.toHaveBeenCalled();
  });
});

describe('notifications', () => {
  it('says where a saved page landed', async () => {
    save.mockImplementation(async (request, onUpdate) => {
      const record = done({ url: request.url, location: 'tabstack/a.md' });
      onUpdate(record);
      return record;
    });

    await send({ type: 'save', url: 'https://ex.com/a', title: 'A' });

    // The id carries the URL, because a click hands back nothing else.
    expect(fakeBrowser.notifications.create).toHaveBeenCalledWith(
      'tabstack-saved:https://ex.com/a',
      expect.objectContaining({
        title: 'Saved to Tabstack',
        message: expect.stringContaining('tabstack/a.md'),
      }),
    );
  });

  it('reports a failure with its message', async () => {
    save.mockImplementation(async (request, onUpdate) => {
      const record = done({ url: request.url, status: 'error', error: 'boom' });
      onUpdate(record);
      return record;
    });

    await send({ type: 'save', url: 'https://ex.com/a', title: 'A' });

    expect(fakeBrowser.notifications.create).toHaveBeenCalledWith(
      'tabstack-saved:https://ex.com/a',
      expect.objectContaining({ title: 'Save failed', message: 'boom' }),
    );
  });
});

describe('retrying a failed save', () => {
  /** An import has always retried; a single save used to get one chance. */
  it('queues another attempt for a failure that could succeed', async () => {
    save.mockImplementation(async (request, onUpdate) => {
      const record = done({
        url: request.url,
        status: 'error',
        error: 'Could not reach api.tabstack.ai.',
        errorStatus: 0,
      });
      onUpdate(record);
      return record;
    });

    const reply = await send<SaveRecord>({
      type: 'save',
      url: 'https://ex.com/a',
      title: 'A',
    });

    // The popup can say so instead of showing a dead end.
    expect(reply.retryAt).toBeGreaterThan(Date.now());
    expect(await listPending()).toHaveLength(1);
    expect(await fakeBrowser.alarms.get('tabstack-retry-saves')).toBeDefined();
  });

  it('does not queue a failure that will always fail', async () => {
    save.mockImplementation(async (request, onUpdate) => {
      const record = done({
        url: request.url,
        status: 'error',
        error: 'Tabstack rejected the API key (401).',
        errorStatus: 401,
      });
      onUpdate(record);
      return record;
    });

    const reply = await send<SaveRecord>({
      type: 'save',
      url: 'https://ex.com/a',
      title: 'A',
    });

    expect(reply.retryAt).toBeUndefined();
    expect(await listPending()).toEqual([]);
  });

  it('runs a due retry with the request that was originally asked for', async () => {
    await queueRetry(
      done({
        status: 'error',
        error: 'Could not reach api.tabstack.ai.',
        errorStatus: 0,
      }),
      { type: 'save', url: 'https://ex.com/a', title: 'Edited', tags: ['keep'] },
      Date.now() - 120_000,
    );

    await fakeBrowser.alarms.onAlarm.trigger(alarm('tabstack-retry-saves'));
    await vi.waitFor(() => expect(save).toHaveBeenCalled());

    expect(save.mock.calls[0]![0]).toMatchObject({
      url: 'https://ex.com/a',
      title: 'Edited',
      tags: ['keep'],
    });
  });

  it('stops retrying, and stops the alarm, once one succeeds', async () => {
    await queueRetry(
      done({ status: 'error', error: 'offline', errorStatus: 0 }),
      { type: 'save', url: 'https://ex.com/a', title: 'A' },
      Date.now() - 120_000,
    );

    await fakeBrowser.alarms.onAlarm.trigger(alarm('tabstack-retry-saves'));
    await vi.waitFor(async () => expect(await listPending()).toEqual([]));
    expect(await fakeBrowser.alarms.get('tabstack-retry-saves')).toBeUndefined();
  });

  it('leaves a retry alone until it is due', async () => {
    await queueRetry(
      done({ status: 'error', error: 'offline', errorStatus: 0 }),
      { type: 'save', url: 'https://ex.com/a', title: 'A' },
      Date.now(),
    );

    await fakeBrowser.alarms.onAlarm.trigger(alarm('tabstack-retry-saves'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(save).not.toHaveBeenCalled();
    expect(await listPending()).toHaveLength(1);
  });
});

describe('clicking a notification', () => {
  it('opens the file in the repo it was committed to', async () => {
    save.mockImplementation(async (request, onUpdate) => {
      const record = done({
        url: request.url,
        link: 'https://github.com/me/notes/blob/main/a.md',
      });
      onUpdate(record);
      return record;
    });
    await send({ type: 'save', url: 'https://ex.com/a', title: 'A' });

    onNotificationClicked.trigger('tabstack-saved:https://ex.com/a');

    await vi.waitFor(() =>
      expect(fakeBrowser.tabs.create).toHaveBeenCalledWith({
        url: 'https://github.com/me/notes/blob/main/a.md',
      }),
    );
    expect(fakeBrowser.notifications.clear).toHaveBeenCalled();
  });

  /** A downloaded file has no URL, so the only way in is the file manager. */
  it('reveals a downloaded file', async () => {
    save.mockImplementation(async (request, onUpdate) => {
      const record = done({ url: request.url, downloadId: 42 });
      onUpdate(record);
      return record;
    });
    await send({ type: 'save', url: 'https://ex.com/a', title: 'A' });

    onNotificationClicked.trigger('tabstack-saved:https://ex.com/a');

    await vi.waitFor(() => expect(fakeBrowser.downloads.show).toHaveBeenCalledWith(42));
  });

  it('falls back to the download folder when the file has gone', async () => {
    save.mockImplementation(async (request, onUpdate) => {
      const record = done({ url: request.url, downloadId: 42 });
      onUpdate(record);
      return record;
    });
    await send({ type: 'save', url: 'https://ex.com/a', title: 'A' });
    fakeBrowser.downloads.show = vi.fn(async () => {
      throw new Error('no such download');
    }) as never;

    onNotificationClicked.trigger('tabstack-saved:https://ex.com/a');

    await vi.waitFor(() =>
      expect(fakeBrowser.downloads.showDefaultFolder).toHaveBeenCalled(),
    );
  });

  it('opens the library for a save with nothing to point at', async () => {
    save.mockImplementation(async (request, onUpdate) => {
      const record = done({ url: request.url, status: 'error', error: 'boom' });
      onUpdate(record);
      return record;
    });
    await send({ type: 'save', url: 'https://ex.com/a', title: 'A' });

    onNotificationClicked.trigger('tabstack-saved:https://ex.com/a');

    await vi.waitFor(() =>
      expect(fakeBrowser.tabs.create).toHaveBeenCalledWith({
        url: expect.stringContaining('library.html'),
      }),
    );
  });

  it('opens the library from the import notification', async () => {
    onNotificationClicked.trigger('tabstack-import');

    await vi.waitFor(() =>
      expect(fakeBrowser.tabs.create).toHaveBeenCalledWith({
        url: expect.stringContaining('library.html'),
      }),
    );
  });
});
