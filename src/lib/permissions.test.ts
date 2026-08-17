/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fakeBrowser } from 'wxt/testing/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasHostPermissions,
  hasOrigin,
  REQUIRED_ORIGINS,
  requestHostPermissions,
} from './permissions';

/** fake-browser leaves permissions unimplemented, so stand both calls in. */
let contains: ReturnType<typeof vi.fn>;
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fakeBrowser.reset();
  contains = vi.fn().mockResolvedValue(true);
  request = vi.fn().mockResolvedValue(true);
  fakeBrowser.permissions.contains = contains as never;
  fakeBrowser.permissions.request = request as never;
});

describe('hasHostPermissions', () => {
  it('asks about the manifest origins by default', async () => {
    expect(await hasHostPermissions()).toBe(true);
    expect(contains).toHaveBeenCalledWith({ origins: REQUIRED_ORIGINS });
    expect(REQUIRED_ORIGINS).toEqual([
      'https://api.tabstack.ai/*',
      'https://api.github.com/*',
    ]);
  });

  it('passes an explicit origin through', async () => {
    contains.mockResolvedValue(false);
    expect(await hasOrigin('http://127.0.0.1:27123/*')).toBe(false);
    expect(contains).toHaveBeenCalledWith({ origins: ['http://127.0.0.1:27123/*'] });
  });

  /**
   * Chrome grants manifest host permissions outright, and some builds have no
   * working `contains`. Reporting "missing" there would block saves that would
   * have worked, so the check fails open.
   */
  it('assumes granted when the API throws', async () => {
    contains.mockRejectedValue(new Error('not implemented'));
    expect(await hasHostPermissions()).toBe(true);
  });
});

describe('requestHostPermissions', () => {
  it('returns what the browser decided', async () => {
    request.mockResolvedValue(false);
    expect(await requestHostPermissions(['https://api.github.com/*'])).toBe(false);
    expect(request).toHaveBeenCalledWith({ origins: ['https://api.github.com/*'] });
  });

  /**
   * Fails closed, unlike the check above: a request rejects when it was not made
   * from a user gesture, and claiming success would send the user on to a save
   * that dies on CORS instead of back to the button.
   */
  it('reports failure when the request throws', async () => {
    request.mockRejectedValue(new Error('may only be called from a user gesture'));
    expect(await requestHostPermissions()).toBe(false);
  });
});
