/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['.output', '.wxt', 'node_modules', 'store/screenshots'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Extension code passes browser objects around whose types the polyfill
      // models loosely; an explicit cast is clearer than a fabricated interface.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Node scripts, not extension code.
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: { 'no-undef': 'off' },
  },
);
