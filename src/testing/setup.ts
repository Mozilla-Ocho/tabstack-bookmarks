/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { generateChromeMessages, parseMessagesFile } from '@wxt-dev/i18n/build';
import { fakeBrowser } from 'wxt/testing/fake-browser';

/**
 * Gives tests the real message catalogue.
 *
 * `fakeBrowser` does not implement `i18n`, and the alternative — stubbing `t()`
 * to echo its key — would make every assertion on a user-visible string
 * meaningless. This compiles `locales/en.yml` the same way the build does and
 * answers from it, so a test that expects "out of credits (402)" is checking the
 * string a user actually reads, and a missing or misnamed key fails the test.
 *
 * Only `getMessage` is stubbed. Plural selection and key flattening stay with
 * `@wxt-dev/i18n`'s own runtime, so the tests exercise that too.
 */
const messages = generateChromeMessages(await parseMessagesFile('locales/en.yml'));

function getMessage(key: string, subs?: string | string[]): string {
  const entry = messages[key];
  // What the browser does with an unknown key, rather than throwing.
  if (!entry) return '';

  const list = subs === undefined ? [] : Array.isArray(subs) ? subs : [subs];
  return entry.message.replace(/\$(\$|[1-9])/g, (_, token: string) =>
    token === '$' ? '$' : (list[Number(token) - 1] ?? ''),
  );
}

// `fakeBrowser.reset()` only resets APIs that implement `resetState`, so this
// survives the `beforeEach` in every test file.
fakeBrowser.i18n.getMessage = getMessage as typeof fakeBrowser.i18n.getMessage;
