/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { i18n } from '#i18n';
import type { BackendId } from '../lib/settings';

/**
 * How each destination is named in the UI.
 *
 * These sit here rather than on the `StorageBackend` objects in `src/lib`: they
 * are display text, and a backend that has to reach for the message catalogue to
 * describe itself is a backend whose tests need a browser i18n implementation.
 *
 * The switches are exhaustive, so a new destination fails to compile here until
 * it has been named.
 */
export function backendLabel(id: BackendId): string {
  switch (id) {
    case 'download':
      return i18n.t('backend.downloadLabel');
    case 'github':
      return i18n.t('backend.githubLabel');
    case 'obsidian':
      return i18n.t('backend.obsidianLabel');
  }
}

/** One word, for the popup badge. */
export function backendShortLabel(id: BackendId): string {
  switch (id) {
    case 'download':
      return i18n.t('backend.downloadShort');
    case 'github':
      return i18n.t('backend.githubShort');
    case 'obsidian':
      return i18n.t('backend.obsidianShort');
  }
}
