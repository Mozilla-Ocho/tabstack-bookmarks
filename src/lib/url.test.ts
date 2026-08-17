/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from 'vitest';
import { canonicalUrl, isTrackingParam } from './url';

describe('canonicalUrl', () => {
  it('strips the utm family and the question mark with it', () => {
    expect(
      canonicalUrl(
        'https://example.com/post?utm_source=newsletter&utm_medium=email&utm_campaign=spring',
      ),
    ).toBe('https://example.com/post');
  });

  it('strips ad-click identifiers', () => {
    for (const param of ['gclid', 'fbclid', 'msclkid', 'igshid', 'ttclid', 'twclid']) {
      expect(canonicalUrl(`https://example.com/a?${param}=xyz`)).toBe(
        'https://example.com/a',
      );
    }
  });

  it('strips newsletter and analytics parameters', () => {
    expect(
      canonicalUrl('https://example.com/a?mc_cid=1&mc_eid=2&_hsenc=3&mkt_tok=4'),
    ).toBe('https://example.com/a');
    expect(canonicalUrl('https://example.com/a?_ga=1.2.3&_gl=1*abc')).toBe(
      'https://example.com/a',
    );
  });

  /** The whole reason this exists. */
  it('makes the same page shared three ways one URL', () => {
    const canonical = 'https://example.com/blog/post';
    expect(canonicalUrl(`${canonical}?utm_source=twitter&utm_medium=social`)).toBe(
      canonical,
    );
    expect(canonicalUrl(`${canonical}?fbclid=IwAR0abc`)).toBe(canonical);
    expect(canonicalUrl(`${canonical}?mc_cid=9&utm_campaign=weekly`)).toBe(canonical);
  });

  it('keeps the parameters the page actually needs', () => {
    // Strip any of these and you fetch a different page, or none at all.
    const kept = [
      'https://example.com/watch?v=dQw4w9WgXcQ',
      'https://example.com/search?q=rust+ownership',
      'https://example.com/posts?page=3',
      'https://example.com/item?id=42',
      'https://example.com/doc?ref=sidebar',
      'https://open.spotify.com/track/abc?si=1a2b3c',
    ];
    for (const url of kept) expect(canonicalUrl(url)).toBe(url);
  });

  it('keeps the useful parameters while dropping the tracking ones beside them', () => {
    expect(
      canonicalUrl('https://example.com/watch?v=abc&utm_source=share&t=42&fbclid=xyz'),
    ).toBe('https://example.com/watch?v=abc&t=42');
  });

  it('leaves the fragment alone', () => {
    // A fragment can be the route in a single-page app, or the section someone
    // meant to point at.
    expect(canonicalUrl('https://example.com/guide?utm_source=x#installation')).toBe(
      'https://example.com/guide#installation',
    );
  });

  it('matches parameter names case-insensitively', () => {
    expect(canonicalUrl('https://example.com/a?UTM_Source=x&FBCLID=y')).toBe(
      'https://example.com/a',
    );
  });

  it('lowercases the host and drops a default port, as URLs are compared', () => {
    expect(canonicalUrl('https://Example.COM/a')).toBe('https://example.com/a');
    expect(canonicalUrl('https://example.com:443/a')).toBe('https://example.com/a');
    // A non-default port is part of the address.
    expect(canonicalUrl('http://example.com:8080/a')).toBe('http://example.com:8080/a');
  });

  it('does not touch the path, because /a and /a/ can differ', () => {
    expect(canonicalUrl('https://example.com/A/b/')).toBe('https://example.com/A/b/');
    expect(canonicalUrl('https://www.example.com/a')).toBe('https://www.example.com/a');
  });

  it('returns anything it cannot parse unchanged', () => {
    for (const raw of ['', 'not a url', 'about:debugging', 'file:///tmp/a.md']) {
      expect(canonicalUrl(raw)).toBe(raw);
    }
  });

  it('is stable: canonicalising twice changes nothing', () => {
    const once = canonicalUrl('https://example.com/a?utm_source=x&id=7');
    expect(canonicalUrl(once)).toBe(once);
  });
});

describe('isTrackingParam', () => {
  it.each(['utm_source', 'utm_id', 'UTM_CAMPAIGN', 'hsa_acc', 'pk_kwd', 'at_medium'])(
    'recognises %s by prefix',
    (name) => {
      expect(isTrackingParam(name)).toBe(true);
    },
  );

  it.each(['v', 'q', 'id', 'page', 'ref', 'si', 'source', 'lang', 't'])(
    'leaves %s alone',
    (name) => {
      expect(isTrackingParam(name)).toBe(false);
    },
  );
});
