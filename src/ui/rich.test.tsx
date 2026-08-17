/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Fragment, isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { rich, slots } from './rich';

/** What `browser.i18n` does with a message and its substitutions. */
function substitute(message: string, subs: string[]): string {
  return message.replace(/\$(\d)/g, (_, n: string) => subs[Number(n) - 1] ?? '');
}

/** The text a caller would see, with element children standing in as text. */
function flatten(nodes: ReactNode): string {
  const parts = Array.isArray(nodes) ? nodes : [nodes];
  return parts
    .map((node) => {
      if (typeof node === 'string') return node;
      if (isValidElement<{ children?: ReactNode }>(node)) {
        const inner = flatten(node.props.children);
        // The wrapper Fragment rich() adds is plumbing, not markup.
        return node.type === Fragment ? inner : `[${inner}]`;
      }
      return '';
    })
    .join('');
}

describe('rich', () => {
  it('puts each node where its placeholder was', () => {
    const message = substitute('Adds a $1 call, and a $2 section.', slots(2));
    const out = rich(message, [
      <code key="a">/generate/json</code>,
      <em key="b">Key</em>,
    ]);
    expect(flatten(out)).toBe('Adds a [/generate/json] call, and a [Key] section.');
  });

  it('keeps a sentence intact when it has no placeholders', () => {
    expect(flatten(rich('Nothing to fill in.', []))).toBe('Nothing to fill in.');
  });

  it('handles a placeholder at either end', () => {
    const message = substitute('$1 saves the tab. $2', slots(2));
    const out = rich(message, [<kbd key="k">Alt</kbd>, <b key="b">Done</b>]);
    expect(flatten(out)).toBe('[Alt] saves the tab. [Done]');
  });

  it('lets a translation reorder the placeholders', () => {
    // The point of the whole exercise: German puts the verb last, Japanese puts
    // the object first. A fragment-per-key catalogue cannot express that.
    const message = substitute('Second $2, first $1.', slots(2));
    const out = rich(message, [<code key="a">one</code>, <code key="b">two</code>]);
    expect(flatten(out)).toBe('Second [two], first [one].');
  });

  it('ignores a slot with no matching node', () => {
    const message = substitute('Only $1 and $2.', slots(2));
    expect(flatten(rich(message, [<code key="a">one</code>]))).toBe('Only [one] and .');
  });

  it('does not treat a literal dollar-digit in the text as a slot', () => {
    // `$$1` is how the messages file escapes a dollar sign, so prices survive.
    expect(flatten(rich('Costs $1.00 today.', []))).toBe('Costs $1.00 today.');
  });
});
