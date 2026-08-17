/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Fragment, type ReactNode } from 'react';

/**
 * Private-use code point. It cannot occur in real message text, so splitting on
 * it can never cut a sentence in the wrong place.
 */
const SLOT = '\uE000';

/**
 * Substitution values that mark where React nodes belong. `browser.i18n` only
 * substitutes strings, so the message is rendered with these markers and then
 * split back apart.
 */
// Overloaded to return a fixed-length tuple: `i18n.t` types its substitutions
// per message, so a plain `string[]` matches none of its overloads.
export function slots(count: 1): [string];
export function slots(count: 2): [string, string];
export function slots(count: 3): [string, string, string];
export function slots(count: 4): [string, string, string, string];
export function slots(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${SLOT}${i}${SLOT}`);
}

/**
 * Renders a translated sentence that contains inline markup — a `<code>` path, a
 * `<kbd>` shortcut — without breaking it into fragments.
 *
 * The alternative is a key per fragment ("Adds a", "call per save — a second…"),
 * which a translator cannot reorder and cannot read for meaning. Whole sentence
 * in the catalogue, markup supplied here:
 *
 * ```tsx
 * // summarizeHelp: Adds a $1 call per save. Key points become a $2 section.
 * rich(i18n.t('options.summarizeHelp', slots(2)), [
 *   <code key="call">/generate/json</code>,
 *   <code key="heading">## Key points</code>,
 * ])
 * ```
 */
export function rich(message: string, nodes: ReactNode[]): ReactNode {
  return message.split(new RegExp(`${SLOT}(\\d+)${SLOT}`)).map((part, i) =>
    // Odd positions are the captured slot indexes.
    i % 2 === 0 ? part : <Fragment key={i}>{nodes[Number(part)]}</Fragment>,
  );
}
