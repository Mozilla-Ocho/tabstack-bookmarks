/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { isErrorReply, type SaveRecord } from './messages';

const record: SaveRecord = {
  url: 'https://ex.com/a',
  title: 'A',
  status: 'error',
  tags: [],
  error: 'Tabstack rate limit hit (429).',
  errorStatus: 429,
  startedAt: 0,
  updatedAt: 0,
};

describe('isErrorReply', () => {
  it('spots a rejected background handler', () => {
    expect(isErrorReply({ error: 'boom' })).toBe(true);
  });

  /**
   * A failed *save* is a SaveRecord with an `error` string on it, not an error
   * reply. Treating it as one would drop the record the popup renders, so the
   * `status` field is what tells them apart.
   */
  it('does not mistake a failed save record for one', () => {
    expect(isErrorReply(record)).toBe(false);
  });

  it.each([undefined, null, 'boom', 42, {}, { error: 500 }, []])(
    'rejects %s',
    (value) => {
      expect(isErrorReply(value)).toBe(false);
    },
  );
});
