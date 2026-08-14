import { defineConfig } from 'wxt';

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: '.',
  modules: ['@wxt-dev/module-react'],
  // Firefox 128+ supports MV3; keeping one manifest version keeps the
  // `browser.action` / service-worker-vs-event-page differences to a minimum.
  manifestVersion: 3,
  manifest: {
    name: 'Tabstack Bookmarks',
    description:
      'Bookmark pages as markdown. Tabstack extracts the page, your storage keeps it.',
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
    // The Obsidian destination is user-supplied (host and port), so its origin
    // is requested from the options page once it is configured.
    optional_host_permissions: ['*://*/*'],
    commands: {
      'save-page': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: 'Save the current page to Tabstack',
      },
    },
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
    action: {
      default_title: 'Save to Tabstack',
    },
  },
});
