/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// WxtVitest wires up `#imports` and swaps in an in-memory fake browser.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    coverage: {
      // `pnpm test:coverage`. Only src/lib is measured: the entrypoints are React
      // and browser wiring that the driver scripts in scripts/ exercise instead,
      // and counting them would just move the number without testing anything.
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts'],
      reporter: ['text', 'html'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
