/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Prints one version's section of CHANGELOG.md, for a release's notes.
 *
 * The release workflow used a fixed string that told the reader to go and look at
 * the changelog themselves — and, worse, nothing checked that the changelog had
 * anything to say about the version being tagged. Running this before the build
 * makes an undocumented release fail in ten seconds rather than producing a
 * release nobody can read.
 *
 *   node scripts/changelog-section.mjs 0.3.0
 *   node scripts/changelog-section.mjs 0.3.0 --check   # exit status only
 */
import { readFileSync } from 'node:fs';

const [, , rawVersion, ...flags] = process.argv;
const version = (rawVersion ?? '').replace(/^v/, '');
const checkOnly = flags.includes('--check');

if (!version) {
  console.error('usage: node scripts/changelog-section.mjs <version> [--check]');
  process.exit(2);
}

const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

/**
 * Headings look like `## [0.3.0] — 2026-08-17`. The date is required: an entry
 * still sitting under `[Unreleased]`, or dated "TBD", means the changelog was not
 * finished, and that is exactly when a release should stop.
 */
const heading = new RegExp(
  `^## \\[${version.replace(/\./g, '\\.')}\\][^\\n]*?(\\d{4}-\\d{2}-\\d{2})\\s*$`,
  'm',
);

const start = changelog.match(heading);
if (!start) {
  console.error(
    `CHANGELOG.md has no dated section for ${version}.\n` +
      `Expected a heading like "## [${version}] — YYYY-MM-DD".`,
  );
  process.exit(1);
}

const from = start.index + start[0].length;
const rest = changelog.slice(from);
// Up to the next version heading, or the end of the file for the oldest entry.
const next = rest.search(/^## \[/m);
const body = (next === -1 ? rest : rest.slice(0, next)).trim();

if (!body) {
  console.error(`CHANGELOG.md has a heading for ${version} but nothing under it.`);
  process.exit(1);
}

if (!checkOnly) console.log(body);
