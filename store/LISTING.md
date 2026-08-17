# Store listing copy and review answers

Everything a submission form asks for, kept here so both stores tell the same story.
Screenshots live in `store/screenshots/`.

## Identity

- **Name:** Tabstack Bookmarks
- **Category:** Productivity (AMO: Bookmarks / Tabs)
- **Homepage:** https://github.com/JustSteveKing/tabstack-bookmarks
- **Privacy policy:** link to `PRIVACY.md` in the repository (raw or Pages URL)
- **Support:** repository issues
- **License:** MPL-2.0

## Summary (≤132 characters, both stores)

> Bookmark pages as markdown. Tabstack extracts the page, your storage keeps it.

(78 characters — matches the manifest description.)

Both the name and this summary come from `extName` and `extDescription` in `locales/en.yml`,
which is where the manifest reads them from. Change them there, not in `wxt.config.ts`, and a
translated listing needs only a `locales/<code>.yml`.

## Short description (AMO summary, ~250 characters)

> A bookmark manager that keeps the page, not just the link. One click converts the tab to
> clean markdown and files it in your own storage — a local folder, a GitHub repo or an
> Obsidian vault. No account, no sync service.

## Full description

> **Bookmarks rot. This keeps the page.**
>
> Click the toolbar icon and Tabstack Bookmarks converts the current tab into clean
> markdown — title, article text, links, metadata — and writes it to storage you control.
> A year later, when the page is paywalled, rewritten or gone, you still have it.
>
> **Your files, your storage**
> • Local folder — plain .md files in your download directory
> • GitHub repository — committed through the GitHub API, versioned like anything else
> • Obsidian vault — written straight into your vault via the Local REST API plugin
>
> Every note gets YAML frontmatter (title, URL, save date, description, author, tags), so
> it drops straight into Obsidian, Logseq, a static site, or grep.
>
> **Optional AI summaries**
> Turn it on and each save also gets a short summary, the key points as a bullet list, and
> suggested topic tags. Off by default, because it costs an extra API call.
>
> **One page, one file**
> Tracking parameters are stripped before saving, so the same article from a newsletter, a
> tweet and an ad is saved once rather than three times.
>
> **Find them again**
> Search everything you have saved by title, URL or file path. Re-save a page that has
> changed, straight over the file you saved before.
>
> **Clear the decks**
> Twenty tabs open since Tuesday? Save the lot — this window or all of them — and close them
> knowing the pages are yours.
>
> **Bring your existing bookmarks**
> Import the bookmarks you already have, a folder at a time. Folder names become tags,
> pages you already saved are skipped, and the run continues in the background — close the
> tab and keep browsing.
>
> **Ways to save**
> • Toolbar button, with editable title, tags and a note
> • Alt+Shift+S for the active tab
> • Right-click a page or a link
>
> **What it does not do**
> No account. No sync service. No analytics, telemetry or tracking. No content scripts —
> it never touches the pages you visit. The markdown goes only where you told it to go.
>
> Requires a Tabstack API key (tabstack.ai) for the extraction API.

## Single purpose statement (Chrome Web Store)

> The extension saves the page in the current tab as a markdown file in a storage
> destination the user configures. Every feature — the toolbar popup, the keyboard
> shortcut, the context menu items and the bookmark import — is a way of performing that
> one action.

## Permission justifications (Chrome Web Store)

| Permission                                                | Justification                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                                 | Stores the user's settings, destination credentials, and the index of which URLs have already been saved.                    |
| `unlimitedStorage`                                        | The saved-URL index grows with the user's library; a large import would otherwise exhaust the 10 MB extension storage quota. |
| `activeTab`                                               | Reads the URL and title of the tab the user chose to save.                                                                   |
| `tabs`                                                    | Identifies the active tab when saving via the keyboard shortcut or context menu, where no popup is open to supply it.        |
| `downloads`                                               | Writes the markdown file when the user's chosen destination is a local folder.                                               |
| `bookmarks`                                               | Read-only listing of existing bookmarks for the optional bulk import feature. Bookmarks are never modified.                  |
| `contextMenus`                                            | Adds "Save page to Tabstack" and "Save link to Tabstack" right-click items.                                                  |
| `notifications`                                           | Reports completion or failure of a save, and the result of a background import.                                              |
| `alarms`                                                  | Resumes an in-progress bookmark import after the browser suspends the service worker.                                        |
| `host_permissions: https://api.tabstack.ai/*`             | The extraction API that converts a URL to markdown. This is the extension's core function.                                   |
| `host_permissions: https://api.github.com/*`              | Commits the markdown file when the user configures the GitHub destination. Unused otherwise.                                 |
| Optional `http(s)://localhost/*`, `http(s)://127.0.0.1/*` | Requested only if the user configures the Obsidian destination, which runs on their own machine.                             |
| Remote code                                               | None. No remote code is loaded or executed; all code ships in the package.                                                   |

## Data disclosures (Chrome Web Store "Privacy practices")

Declare **Website content** as collected, and nothing else:

- **Website content** — the URL of a page the user chooses to save is sent to
  `api.tabstack.ai`, which fetches and converts it. The resulting markdown is sent only to
  the destination the user configured.
- Not collected: personally identifiable information, health information, financial
  information, authentication information (the user's own API key is stored locally and
  transmitted only to the service it belongs to), personal communications, location, web
  history (the extension records only the pages the user explicitly saves), user activity,
  or any other category.
- Certifications: data is **not** sold to third parties, **not** used or transferred for
  purposes unrelated to the item's core functionality, and **not** used to determine
  creditworthiness or for lending.

## Data collection consent (AMO / Firefox 142+)

The manifest declares:

```json
"data_collection_permissions": { "required": ["websiteContent"] }
```

Reviewer note: the page URL is sent to `api.tabstack.ai` for conversion. There are no
content scripts; page contents are never read from the browser.

## Source code note for AMO reviewers

The uploaded package is built from source with WXT (Vite + Rollup), so a sources archive
accompanies the submission (`pnpm zip:firefox` produces both). To reproduce:

```
pnpm install
pnpm build:firefox   # → .output/firefox-mv3
```

Node 22.12+, pnpm (version pinned in `package.json`). No obfuscation, no minified vendor
blobs beyond standard bundler output of React and the extension's own source.

## Screenshots

| File                  | Shows                                                    |
| --------------------- | -------------------------------------------------------- |
| `01-options.png`      | Settings: API key, effort, summaries, destination        |
| `02-recent-saves.png` | Filename template, recent saves with real file paths     |
| `03-import.png`       | Bookmark import, mid-run                                 |
| `04-output.png`       | The markdown a save produces, frontmatter and key points |

Captured from a real Chrome running the production build, with real API responses — no
mockups. Regenerate them after UI changes rather than shipping stale images.

They must be **exactly 1280×800** (or 640×400) or the Chrome Web Store rejects them. A
retina capture of a 1280×800 window is a 2560×1600 file, so downscale before uploading:
`sips -z 800 1280 store/screenshots/*.png`.
