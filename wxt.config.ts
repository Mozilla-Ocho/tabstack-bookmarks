/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: '.',
  modules: ['@wxt-dev/module-react', '@wxt-dev/i18n/module'],
  // Firefox 128+ supports MV3; keeping one manifest version keeps the
  // `browser.action` / service-worker-vs-event-page differences to a minimum.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    // Both come from locales/en.yml, so a translated listing needs one more file
    // rather than a code change. The browser does the substitution, which is why
    // default_locale has to be set for it to work at all.
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // MV3's `author` is { email } — left out rather than publishing a personal
    // address; the store listings carry developer identity anyway.
    homepage_url: 'https://github.com/Mozilla-Ocho/tabstack-bookmarks',
    permissions: [
      'storage',
      'activeTab',
      'tabs',
      'downloads',
      'contextMenus',
      'notifications',
      'bookmarks',
      'alarms',
      // The saved-URL index grows with the library; Chrome caps storage.local
      // at 10MB without this.
      'unlimitedStorage',
    ],
    // Firefox MV3 treats these as opt-in: the options page asks for them at runtime.
    host_permissions: ['https://api.tabstack.ai/*', 'https://api.github.com/*'],
    // The Chrome counterpart to gecko's strict_min_version, and only meaningful
    // there. 116 is the first release with `browser.action` promises and MV3
    // service workers stable enough for this; with no floor, older Chrome
    // installs the extension and breaks.
    ...(browser === 'firefox' ? {} : { minimum_chrome_version: '116' }),
    // The Obsidian destination is user-supplied, but in practice the plugin runs
    // on this machine. Keeping the optional set to loopback rather than "*://*/*"
    // means store reviewers (and users) are not asked to trust an all-sites
    // extension for a localhost feature. A vault behind a different host needs
    // the pattern added here.
    optional_host_permissions: [
      'http://127.0.0.1/*',
      'http://localhost/*',
      'https://127.0.0.1/*',
      'https://localhost/*',
    ],
    commands: {
      'save-page': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '__MSG_commandSavePage__',
      },
    },
    // Firefox-only, and left out of the Chrome package rather than shipped as a
    // key the Web Store's validator does not recognise.
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'bookmarks@tabstack.ai',
              // 142 is the first release that understands data_collection_permissions.
              strict_min_version: '142.0',
              // AMO requires a data-consent declaration: page URLs and page content
              // go to the Tabstack API, and the markdown goes to the user's store.
              data_collection_permissions: {
                required: ['websiteContent'],
              },
            },
          },
        }
      : {}),
    action: {
      default_title: '__MSG_actionTitle__',
      // Pinned explicitly so the toolbar uses the pixel-snapped small sizes
      // rather than downscaling the 128px icon.
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
      },
    },
  }),
});
