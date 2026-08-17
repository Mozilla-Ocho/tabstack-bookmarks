/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A failure from something we talked to over HTTP — the Tabstack API, GitHub, or
 * the Obsidian plugin.
 *
 * The status is what makes an unattended import survivable: `importQueue` has to
 * tell "retry in a moment" (429, 5xx, offline) from "every remaining item will
 * fail too" (401, 402, 404). Before this existed only Tabstack failures carried a
 * status, so a bad GitHub token meant thousands of items each paying for a full
 * extraction before failing to store.
 */
export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * Status for "there was no response at all" — offline, DNS, TLS, or a blocked
 * origin. Transport failures are worth retrying; a 4xx generally is not.
 */
export const NETWORK_STATUS = 0;

/** True when another attempt could plausibly succeed. */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  // 403 is in here because GitHub answers secondary rate limits with it, not
  // only permission problems. A genuine permission problem still stops the run,
  // via the consecutive-failure breaker rather than by status.
  return status === NETWORK_STATUS || status === 429 || status === 403 || status >= 500;
}

/**
 * True when the failure is settled config: the credentials, the account or the
 * destination itself. Retrying or continuing only burns API credits.
 */
export function isFatalStatus(status: number | undefined): boolean {
  return status === 401 || status === 402 || status === 404;
}
