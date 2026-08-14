/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { browser } from '#imports';

/**
 * Firefox MV3 hands out host permissions only after the user opts in, so the
 * options page has to check and request them before the first save.
 */
export const REQUIRED_ORIGINS = ['https://api.tabstack.ai/*', 'https://api.github.com/*'];

export async function hasHostPermissions(origins = REQUIRED_ORIGINS): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins });
  } catch {
    return true;
  }
}

/** Must be called from a user gesture (a click handler). */
export async function requestHostPermissions(
  origins = REQUIRED_ORIGINS,
): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}

/**
 * Localhost is exempt from Firefox's opt-in host permissions in some builds,
 * so treat a failed check as "needs granting" rather than assuming either way.
 */
export async function hasOrigin(origin: string): Promise<boolean> {
  return hasHostPermissions([origin]);
}
