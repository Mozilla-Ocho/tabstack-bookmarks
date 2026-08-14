# Privacy Policy — Tabstack Bookmarks

_Last updated: 14 August 2026_

Tabstack Bookmarks is a browser extension that converts a web page into markdown and
writes it to a destination you choose. This policy describes every piece of data the
extension handles.

There is no account, no server operated by this extension, and no analytics.

## What is sent off your device, and where

**To the Tabstack API (`api.tabstack.ai`)** — when you save a page, the extension sends
that page's URL and your API key. Tabstack fetches the URL and returns markdown. If you
enable AI summaries, the same URL is sent a second time to Tabstack's
`/generate/json` endpoint, which returns a summary, key points and suggested tags.

The extension does not read or transmit the contents of your open tabs. Tabstack fetches
the page itself, from its own infrastructure, using only the URL. Pages behind a login are
therefore fetched as an anonymous visitor, and your cookies are never sent anywhere.

Tabstack's own handling of these requests is covered by the Tabstack privacy policy at
<https://tabstack.ai>.

**To the destination you configure** — the resulting markdown is written to exactly one of:

- **Local folder** — written to your browser's download directory. Nothing leaves the
  machine.
- **GitHub repository** — the markdown, filename and commit message are sent to
  `api.github.com` using the token you supplied, and committed to the repository you
  named.
- **Obsidian vault** — the markdown is sent to the Obsidian Local REST API plugin on your
  own machine (`localhost`).

Nothing else is transmitted anywhere. There is no third-party analytics, telemetry, crash
reporting, advertising, tracking, or remote font/CDN request of any kind.

## What is stored on your device

All of the following lives in the browser's extension storage
(`browser.storage.local`), on your device only. None of it is synced to any account.

| Data                                                | Purpose                                                           |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| Tabstack API key                                    | Authenticating extraction requests                                |
| GitHub token / Obsidian API key (if configured)     | Authenticating writes to your destination                         |
| Settings                                            | Destination, filename template, tags, effort, toggles             |
| Last 30 save records                                | The "Recent saves" list, and re-saving a page in place            |
| Saved-URL index (URL, path, destination, timestamp) | Knowing which pages you already saved, so an import can skip them |
| Import job state (while an import runs)             | Resuming after the browser suspends the extension                 |

Credentials are stored as entered so they can be used for their destination. They are
never sent anywhere except to the service they belong to.

## Your control over it

- **Options → Forget saved history** deletes the saved-URL index. Your markdown files are
  not touched.
- Clearing the API key or destination credentials removes them from storage immediately.
- **Uninstalling the extension deletes all of the above.** Files already written to your
  download folder, repository or vault are yours and stay where they are.

## Browser permissions, and why each exists

| Permission                         | Why                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `storage`, `unlimitedStorage`      | Keep settings and the saved-URL index; the index grows with your library, and Chrome otherwise caps extension storage at 10 MB |
| `activeTab`, `tabs`                | Read the URL and title of the tab you are saving                                                                               |
| `downloads`                        | Write the markdown file when the destination is a local folder                                                                 |
| `bookmarks`                        | List your existing bookmarks for the optional bulk import                                                                      |
| `contextMenus`                     | The "Save page/link to Tabstack" right-click items                                                                             |
| `notifications`                    | Tell you when a save or an import finished or failed                                                                           |
| `alarms`                           | Resume a long import after the browser suspends the extension                                                                  |
| `https://api.tabstack.ai/*`        | The extraction API                                                                                                             |
| `https://api.github.com/*`         | Only used when the GitHub destination is configured                                                                            |
| Optional `localhost` / `127.0.0.1` | Only requested if you configure the Obsidian destination                                                                       |

The extension has no content scripts and does not inject anything into web pages.

## Children

The extension is not directed at children and collects no personal information about
anyone.

## Changes

Material changes to this policy will appear in this file and in the extension's release
notes; the date above will be updated.

## Contact

Issues and questions: <https://github.com/JustSteveKing/tabstack-bookmarks/issues>
