/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// WxtVitest wires up `#imports` and swaps in an in-memory fake browser.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    // Answers browser.i18n from locales/en.yml, so assertions on user-visible
    // strings stay meaningful. See the file for why.
    setupFiles: ['./src/testing/setup.ts'],
    coverage: {
      // `pnpm test:coverage`. The pages are in here now that they have tests of
      // their own; `main.tsx` and the CSS-only files are mounting boilerplate the
      // driver scripts in scripts/ cover better than a unit test would.
      include: ['src/lib/**/*.ts', 'src/ui/**/*.ts?(x)', 'entrypoints/**/*.ts?(x)'],
      exclude: ['**/*.test.ts?(x)', 'entrypoints/**/main.tsx'],
      reporter: ['text', 'html'],
      thresholds: { statements: 85, branches: 85, functions: 90, lines: 85 },
    },
  },
});
