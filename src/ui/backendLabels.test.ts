/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { BACKEND_ORDER } from '../lib/backends';
import { backendLabel, backendShortLabel } from './backendLabels';

describe('destination names', () => {
  it.each(BACKEND_ORDER)('names %s in both lengths', (id) => {
    // Empty means the message is missing from the catalogue: browser.i18n
    // answers an unknown key with '' rather than throwing.
    expect(backendLabel(id)).not.toBe('');
    expect(backendShortLabel(id)).not.toBe('');
  });

  it('gives the dropdown the longer form and the badge the shorter one', () => {
    expect(backendLabel('download')).toBe('Local folder (browser downloads)');
    expect(backendShortLabel('download')).toBe('Downloads');
    expect(backendShortLabel('download').length).toBeLessThan(
      backendLabel('download').length,
    );
  });

  it('gives every destination a distinct name', () => {
    const labels = BACKEND_ORDER.map(backendLabel);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
