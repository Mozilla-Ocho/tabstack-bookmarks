/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { HttpError, isFatalStatus, isRetryableStatus, NETWORK_STATUS } from './httpError';

describe('isRetryableStatus', () => {
  it.each([NETWORK_STATUS, 403, 429, 500, 502, 503])('retries %i', (status) => {
    expect(isRetryableStatus(status)).toBe(true);
  });

  it.each([400, 401, 402, 404, 422])('does not retry %i', (status) => {
    expect(isRetryableStatus(status)).toBe(false);
  });

  it('does not retry a failure with no status at all', () => {
    // Missing config, an unsaveable URL, a bug: attempts cost credits and
    // cannot succeed. The consecutive-failure breaker stops the run instead.
    expect(isRetryableStatus(undefined)).toBe(false);
  });
});

describe('isFatalStatus', () => {
  it.each([401, 402, 404])('stops the run on %i', (status) => {
    expect(isFatalStatus(status)).toBe(true);
  });

  it.each([undefined, NETWORK_STATUS, 403, 422, 429, 500])(
    'keeps going on %s',
    (status) => {
      expect(isFatalStatus(status)).toBe(false);
    },
  );
});

describe('HttpError', () => {
  it('is an Error carrying the status', () => {
    const error = new HttpError('nope', 418);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(418);
    expect(error.message).toBe('nope');
  });
});
