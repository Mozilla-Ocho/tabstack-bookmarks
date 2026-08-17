/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import type { BackendId } from '../settings';
import { BACKEND_ORDER, BACKENDS, getBackend } from './index';

describe('getBackend', () => {
  it.each(BACKEND_ORDER)('resolves %s to a backend whose id matches', (id) => {
    expect(getBackend(id).id).toBe(id);
  });

  it('lists every backend in the picker order', () => {
    // A destination added to BACKENDS but not to BACKEND_ORDER is a destination
    // the options page never offers.
    expect([...BACKEND_ORDER].sort()).toEqual(Object.keys(BACKENDS).sort());
  });

  it('names the offender when settings hold a backend that no longer exists', () => {
    // Reachable from stored settings written by a newer or older version.
    expect(() => getBackend('dropbox' as BackendId)).toThrow(
      /Unknown storage backend: dropbox/,
    );
  });

  it('keys every backend by its own id', () => {
    // Display names are not here: they are strings, so they live in the message
    // catalogue and are resolved by src/ui/backendLabels.ts.
    for (const [id, backend] of Object.entries(BACKENDS)) {
      expect(backend.id).toBe(id);
    }
  });
});
