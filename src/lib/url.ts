/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Tracking parameters, stripped before a URL is saved or looked up.
 *
 * The point is dedupe. The same article shared through a newsletter, a tweet and
 * a Google result is three URLs that differ only in who gets the credit, and the
 * saved index keys on the URL — so without this, "have I saved this?" answers no
 * three times, an import re-saves (and re-charges for) all three, and the library
 * shows one page three times.
 *
 * The list is deliberately conservative. Anything not known to be tracking is
 * left alone, because a stripped parameter can change which page you get: `?id=`,
 * `?page=`, `?v=` and `?q=` are load-bearing, and so is `?si=` on a Spotify or
 * YouTube share link even though it identifies the sharer. Guessing wrong saves
 * the wrong page, which is worse than saving a page twice.
 */

/** Whole families, matched by prefix. */
const TRACKING_PREFIXES = [
  'utm_', // the universal ones, plus utm_id, utm_reader, utm_swu, …
  'hsa_', // HubSpot ads
  'pk_', // Piwik
  'piwik_',
  'matomo_',
  'at_', // BBC and others: at_medium, at_campaign
];

/** Individually named parameters. */
const TRACKING_PARAMS = new Set([
  // Ad-click identifiers. Every one of these is a click, not a page.
  'gclid',
  'gclsrc',
  'gbraid',
  'wbraid',
  'dclid',
  'fbclid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'igshid',
  'igsh',
  'li_fat_id',
  'rdt_cid',
  'epik',
  'sccid',
  'sc_cid',
  'wickedid',
  // Email and marketing platforms.
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  '_hsenc',
  '_hsmi',
  '__hsfp',
  '__hssc',
  '__hstc',
  'hsctatracking',
  'vero_id',
  'vero_conv',
  'oly_anon_id',
  'oly_enc_id',
  'ml_subscriber',
  'ml_subscriber_hash',
  's_cid',
  // Analytics session and linker parameters.
  '_ga',
  '_gl',
  'ref_src', // Twitter's share wrapper
  'spm', // Alibaba
  'scm',
]);

export function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return TRACKING_PARAMS.has(key) || TRACKING_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * The URL to save, dedupe and display: the same page without the parameters that
 * only say where the link came from.
 *
 * Order is preserved and nothing else is normalised — no trailing-slash rule, no
 * `www.` stripping, no case folding of the path — because `/a` and `/a/` really
 * can be different pages and this runs on URLs that must still resolve. Anything
 * unparseable comes back untouched; validation is `isSaveableUrl`'s job.
 */
export function canonicalUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw;

  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) url.searchParams.delete(name);
  }

  // `new URL()` already lowercases the host and drops :80 / :443, and omits the
  // `?` once the last parameter is gone.
  return url.toString();
}
