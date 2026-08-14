import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// WxtVitest wires up `#imports` and swaps in an in-memory fake browser.
export default defineConfig({
  plugins: [WxtVitest()],
});
