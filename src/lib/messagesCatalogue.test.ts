/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMessagesFile } from '@wxt-dev/i18n/build';
import { describe, expect, it } from 'vitest';

/**
 * Keeps `locales/en.yml` and the code that reads it honest in both directions.
 *
 * A missing key does not throw at runtime — `browser.i18n` returns an empty
 * string — so a typo ships as a blank label rather than a crash. And a key left
 * behind after its UI is deleted is work handed to every future translator for
 * nothing.
 */

const ROOTS = ['src', 'entrypoints'];
const CODE = /\.tsx?$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    // Test files reference keys too, but as fixtures, not as UI.
    return CODE.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
  });
}

/** Every `i18n.t('some.key')` in the source, with the file that used it. */
function usedKeys(): Map<string, string[]> {
  const used = new Map<string, string[]>();
  for (const file of ROOTS.flatMap(sourceFiles)) {
    const source = readFileSync(file, 'utf8');
    for (const [, key] of source.matchAll(/i18n\.t\(\s*'([^']+)'/g)) {
      used.set(key!, [...(used.get(key!) ?? []), file]);
    }
    // The import page keeps its delay labels in a table of key strings.
    for (const [, key] of source.matchAll(/key: '((?:import|options)\.[^']+)'/g)) {
      used.set(key!, [...(used.get(key!) ?? []), file]);
    }
  }
  return used;
}

const defined = new Set(
  (await parseMessagesFile('locales/en.yml')).map((message) => message.key.join('.')),
);
const used = usedKeys();

describe('locales/en.yml', () => {
  it('defines every key the code asks for', () => {
    const missing = [...used.keys()].filter((key) => !defined.has(key));
    expect(missing).toEqual([]);
  });

  it('has no key nothing uses', () => {
    // Manifest references (__MSG_extName__ and friends) are not i18n.t calls,
    // and `@@`-prefixed messages come from the browser, not from this file.
    const manifest = ['extName', 'extDescription', 'actionTitle', 'commandSavePage'];
    const orphans = [...defined].filter(
      (key) => !used.has(key) && !manifest.includes(key) && !key.startsWith('@@'),
    );
    expect(orphans).toEqual([]);
  });

  it('found the keys at all, so a broken regex cannot make this pass', () => {
    expect(used.size).toBeGreaterThan(100);
    expect(used.has('popup.title')).toBe(true);
  });
});
