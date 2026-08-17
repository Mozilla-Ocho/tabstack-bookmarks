# Tabstack Bookmarks

A bookmark manager that keeps the page, not just the link.

Click the toolbar icon and the current tab goes to the [Tabstack](https://tabstack.ai)
API, comes back as clean markdown, and is written to a destination **you** choose — a
local folder, a GitHub repo, or an Obsidian vault. A year later, when the page is behind
a paywall, rewritten, or gone, you still have it.

Built with [WXT](https://wxt.dev), so one source tree builds for Firefox and Chrome
(Edge and Safari targets are available but untested).

> Status: verified end to end against the live API in Firefox 153 and Chrome 151 —
> saving, both browsers' download paths, AI summaries and bookmark import. Not yet
> submitted to AMO or the Chrome Web Store; load it unpacked for now.

## Contents

- [How it works](#how-it-works) · [Install](#install) · [First run](#first-run)
- [Saving a page](#saving-a-page) · [What gets written](#what-gets-written)
- [Destinations](#destinations) · [Summaries](#summaries) · [Import](#importing-bookmarks-you-already-have)
- [Browsing what you saved](#browsing-what-you-saved)
- [Settings](#settings) · [Privacy](#privacy) · [Development](#development)

## How it works

1. `POST https://api.tabstack.ai/v1/extract/markdown` with the tab's URL and your API key.
2. Optionally, in parallel, `POST /v1/generate/json` for a summary, key points and
   suggested tags.
3. Compose a document: YAML frontmatter, an optional `## Key points` section, then the
   extracted markdown.
4. Hand it to the configured storage backend.

Nothing is stored by the extension beyond your settings and a local index of which URLs
you have saved. There is no account, no sync service, and no server of ours in the middle.

## Install

```bash
pnpm install
pnpm build:firefox     # → .output/firefox-mv3
pnpm build             # → .output/chrome-mv3
```

**Firefox** — `about:debugging#/runtime/this-firefox` → _Load Temporary Add-on_ → pick
`.output/firefox-mv3/manifest.json`. Temporary add-ons are removed when Firefox restarts;
`pnpm zip:firefox` produces the AMO upload (plus a sources zip) when you want a signed
install.

**Chrome** — `chrome://extensions` → _Developer mode_ → _Load unpacked_ →
`.output/chrome-mv3`.

Requires Node 22.12+ and pnpm. Firefox 142+ (see [Browser notes](#browser-notes)).

## First run

Open the extension's options page:

1. Paste your Tabstack API key, then click **Test key** — it does one cheap real request
   so you find out now rather than mid-save.
2. On Firefox you may see a banner asking to grant access to `api.tabstack.ai`. Click
   **Grant access**; Firefox requires a click for this and cannot be pre-approved.
3. Pick a destination and click **Test destination**.
4. **Save settings**.

## Saving a page

- **Toolbar icon** → the popup opens and starts saving immediately (turn that off if you
  prefer to review first). Edit title, tags or a note, then **Re-save** to update the
  same file.
- <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> → save the active tab with no popup.
- **Right-click** a page or a link → _Save … to Tabstack_. Saving a link never opens it.

A page you saved months ago still shows as saved when you reopen the popup, and
**Re-save** overwrites that same file instead of making a second copy.

Only `http` and `https` pages can be saved — the API has to be able to fetch the URL, so
local files and `about:` pages are rejected up front rather than failing later.

## What gets written

```markdown
---
title: 'Example Domain'
url: 'https://example.com/'
saved_at: '2026-08-14T20:28:03.254Z'
tags:
  - 'imported'
  - 'Reading'
source: tabstack
---

This domain is for use in documentation examples without needing permission…
```

Frontmatter carries whatever the page actually provided — `description`, `author`,
`publisher`, `site_name`, `image`, `type` are included when present and omitted when not,
so you never get empty keys. Your `note` and the AI `summary` join them when set. Any
frontmatter the extraction itself produced is stripped, so the document has exactly one
block.

Filenames come from a template. Tokens: `{date}` `{yyyy}` `{mm}` `{dd}` `{slug}`
`{title}` `{host}`. Slashes create folders, so `{yyyy}/{mm}/{slug}.md` gives you a dated
tree. Token values are sanitised — a page titled `a/b:c` cannot escape into another
directory.

## Destinations

| Destination        | How it writes                                             | What you need                                                                                                                                                                                                                                                                                          |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Local folder**   | Browser downloads API, into `<download dir>/<subfolder>/` | Nothing. Browsers can only write inside the download directory, so point Firefox's download folder at your vault (or symlink it) if you want notes to land in Obsidian.                                                                                                                                |
| **GitHub repo**    | Commit via the contents API                               | A fine-grained token with `Contents: read and write`, plus owner, repo, branch and folder.                                                                                                                                                                                                             |
| **Obsidian vault** | `PUT /vault/<path>` on the Local REST API plugin          | The plugin enabled with Obsidian running. It serves HTTPS on 27124 with a **self-signed certificate**, which browsers reject — so either enable the plugin's _Non-encrypted (HTTP) Server_ option and point at port 27123, or open `https://127.0.0.1:27124` in a tab once and accept the certificate. |

Duplicates: GitHub and Obsidian check whether the path is taken and append `-1`, `-2`, …
unless you asked to overwrite; downloads use the browser's own uniquify.

## Summaries

Off by default, because it is a second API call per save and therefore doubles credit use.
When on, each save also asks `/generate/json` for a `summary`, three-to-five
`key_points`, and topic `tags`. The summary goes in the frontmatter, the key points become
a `## Key points` section above the article, and suggested tags are merged into the
bookmark's tags (that part is separately switchable).

The summary runs _alongside_ extraction rather than after it, and it can never cost you
the page: if the summary call fails, the save still completes and the record notes why.
The popup has a per-save **Summarize with AI** checkbox that overrides the setting once.

## Importing bookmarks you already have

Options → **Open bookmark import**. Pick a folder (each shows how many saveable bookmarks
it holds), then:

- **Skip already saved** — leaves out URLs saved before.
- **Stop after N** — try 5–10 first and look at the output before spending credits on a
  thousand pages.
- **Folder names as tags** — `Toolbar/Reading` becomes tags `Toolbar` and `Reading`.
- **Pause between bookmarks** — 0.5s / 1.5s / 4s.

The run lives in the background: close the tab, keep browsing, it carries on one bookmark
at a time. Progress is written after every item and a one-minute alarm resumes the queue
if the browser suspended the extension, so a long import survives interruption.
Rate-limited pages retry with 5s/15s/45s backoff; running out of credits or a rejected key
stops the whole run and tells you which. Duplicate URLs across folders are saved once,
and non-web bookmarks (`javascript:`, `place:`) are skipped.

"Already saved" is answered from a durable per-URL index, not the 30-entry list the UI
shows. That distinction matters: with only the visible history, a 1,000-bookmark import
would remember the last 30 and re-save — and re-charge for — everything else next time.
Options → **Forget saved history** clears the index; your files are untouched.

## Browsing what you saved

Options → **Browse saved pages**, or **Saved** in the popup. Every page the extension has
ever saved, newest first — not the last thirty. Type to filter on title, URL or the path the
file landed at, so "which of these went into `archive/`?" is one search.

Each row offers:

- **Re-save** — fetches the page again and overwrites the same file, for something that has
  been updated since. It costs an API call, like any save.
- **Forget** — drops the entry from the index so a future import will save the page again.
  The file itself is untouched.
- **open** — for an Obsidian vault (`obsidian://`) or a GitHub repo. Downloaded files have no
  URL to link to, and GitHub links are offered only while the settings still point at the
  repo the file went to.

Long libraries render fifty rows at a time with a **Show more** button; the counts above the
list always describe the whole set, not the window.

## Settings

| Setting                 | Default            | Notes                                                                              |
| ----------------------- | ------------------ | ---------------------------------------------------------------------------------- |
| API key                 | —                  | Stored in extension local storage on this device. Never synced.                    |
| Fetch effort            | `standard`         | `min` 1–5s, `standard` 3–15s, `max` full browser render 15–60s for JS-heavy pages. |
| Content scope           | `main`             | `main` is the article; `full` includes nav, footer and links.                      |
| Bypass cache            | off                | Forces Tabstack to refetch instead of serving a cached extraction.                 |
| AI summary              | off                | Second API call per save.                                                          |
| Use suggested tags      | on                 | Only applies when summaries are on.                                                |
| Filename template       | `{date}-{slug}.md` | Slashes create folders.                                                            |
| Tags on every bookmark  | —                  | Merged ahead of per-save tags.                                                     |
| Auto-save on popup open | on                 | Turn off to review before spending a call.                                         |
| Destination             | Local folder       | Plus that destination's own fields.                                                |

## Privacy

- The page URL goes to `api.tabstack.ai`, which fetches and converts it. That is the one
  outbound call the extension makes on your behalf; the manifest declares it to Firefox as
  `data_collection_permissions: ["websiteContent"]`.
- The markdown goes only to the destination you configured — your download folder, your
  repo, your vault. Credentials for those live in extension local storage and are sent
  only to that destination.
- No analytics, no telemetry, no error reporting, no remote fonts or CDN assets. The two
  brand fonts are bundled in the package.
- Local state: settings, the last 30 save records (for the UI), the durable saved-URL
  index, and an import job while one is running. All in `browser.storage.local`, all
  removable — uninstalling takes it with you.

## Development

```bash
pnpm install
pnpm dev:firefox     # Firefox with HMR
pnpm dev             # Chrome with HMR
pnpm lint            # eslint (type-aware, plus react-hooks)
pnpm format          # prettier --write .
pnpm test            # vitest — 274 tests, pages included
pnpm test:coverage   # thresholds over src/ and entrypoints/
pnpm compile         # tsc --noEmit
pnpm build:firefox   # production build
pnpm zip:firefox     # AMO package + sources zip
```

Tests run through `WxtVitest`, which supplies `#imports` and an in-memory `fakeBrowser`.
Storage, settings and the import queue are exercised for real; only `fetch` is stubbed. The
three pages are tested with Testing Library against the same fake browser, so the popup's
auto-save, an import's progress and the options page's connection checks are covered as
behaviour rather than as markup.

### Layout

```
entrypoints/
  background.ts     message router, keyboard command, context menus, badge, notifications
  popup/            one-click save, editable title/tags/note
  options/          API key, destination, filename template, recent saves
  import/           bulk import of existing bookmarks
  library/          search, re-save and forget what has been saved
locales/
  en.yml            every string a user reads; a translation is one more file
src/ui/
  style.css         brand tokens, shared component styles
  ErrorBoundary.tsx keeps a render error from blanking a page
  rich.tsx          puts inline markup into a translated sentence
src/lib/
  tabstack.ts       /extract/markdown + /generate/json clients, error mapping
  httpError.ts      the status every HTTP failure carries, and what to do about it
  save.ts           extract → compose → store orchestration
  markdown.ts       slugs, filename templates, frontmatter
  settings.ts       schema, defaults, validation, backend origins
  saveStore.ts      30-record UI history + the single final-write path
  savedIndex.ts     durable url → {path, backend, savedAt} index, one key per URL
  bookmarks.ts      bookmark tree → flat saveable items, folder counts
  importQueue.ts    persisted import job: retry, backoff, cancel, resume
  permissions.ts    runtime host-permission checks
  backends/         download.ts, github.ts, obsidian.ts, types.ts
scripts/
  make-icons.mjs    generates icons from the brand mark's geometry
  firefox-drive.mjs drives a real Firefox over Marionette
```

### Driving a real browser

`scripts/firefox-drive.mjs` opens the extension's own pages in a running Firefox and runs
code inside them — how the options page, the save pipeline and the import queue were
verified against the live API. WebDriver BiDi refuses to navigate to `moz-extension://`
URLs, so it uses Marionette's chrome context instead. The script header has the exact
`web-ext run` invocation; then:

```bash
node scripts/firefox-drive.mjs options.html --shot=/tmp/options.png
node scripts/firefox-drive.mjs import.html --eval="return document.title"
```

`--eval` runs inside the extension page, so `browser.*` is available and the body may
await.

For Chrome, `scripts/chrome-drive.mjs` does the whole job itself — it launches a throwaway
profile, installs the build over CDP (current Chrome ignores `--load-extension`), runs your
code and tidies up:

```bash
node scripts/chrome-drive.mjs options.html --shot=/tmp/chrome.png
```

### Adding a destination

Four touch points: implement `StorageBackend` in `src/lib/backends/`, register it in
`src/lib/backends/index.ts`, add its id to `BackendId` and its fields to `Settings` in
`src/lib/settings.ts` (defaults _and_ the deep merge in `getSettings`), then add its
fieldset to the options page. If it talks to a user-supplied host, extend
`backendOrigin()` so its origin gets requested at runtime.

### Adding a language

Every string the UI shows lives in `locales/en.yml`, compiled by `@wxt-dev/i18n` into the
`_locales` directory the browsers expect. To add a language, copy that file to
`locales/<code>.yml`, translate the values, and rebuild — no code changes, and any key you
leave out falls back to English.

The extension name and description are in there too, so a translated store listing needs
nothing but the file. Error messages are included — the HTTP status stays in the text, since
that is the part worth quoting in a bug report. The language follows the browser's own
setting; extensions cannot offer their own language picker.

A test fails if the code asks for a key the file does not define, or if the file defines one
nothing uses, so a translation never starts from a stale list.

### Theming

Brand tokens live in `src/ui/style.css`, mirroring `tabstack-api-docs/theme.css` rather
than inventing a second palette:

- Accent `#ff97ea`. Accent _fills_ keep the raw pink with near-black text, matching the
  marketing CTAs; accent _text_ and focus rings use the darkened
  `oklch(from … calc(l * 0.7) calc(c * 1.2) h)` variant in light mode, where raw pink on
  white fails contrast.
- A neutral hue-0 grey ramp on `#fff` / `#0a0a0a` — no blue-tinted greys.
- Mozilla Headline for headings, Mozilla Text for UI text, bundled as variable woff2
  (~87 KB). The site pairs Headline with Geist, which is not vendored anywhere locally.
- One token set for both schemes via CSS `light-dark()` plus `color-scheme`.
- The mark in each header is `icon/mark.svg` as a CSS `mask` over `currentColor`, so it
  inverts with the theme rather than needing two assets.

Icons are generated, not hand-drawn: `node scripts/make-icons.mjs` draws the mark (four
offset bars on a 2×4 grid) from the wordmark's rect geometry, snapped to integer pixels at
each size so the bars stay crisp at 16px.

## Browser notes

**Firefox**

- MV3 uses an **event page**, not a service worker: the background can be unloaded between
  saves, so no state lives in module scope — it is all in `browser.storage.local`.
- `host_permissions` are opt-in. The options page detects and requests them; a click is
  required and cannot be skipped.
- The Obsidian host and port are user-supplied, so that origin is requested on demand from
  `optional_host_permissions`. A save refuses to start when it has not been granted,
  instead of failing halfway with an opaque network error.
- `data_collection_permissions` requires Firefox 142+, hence `strict_min_version: 142.0`.
  Drop the key to support older releases.
- `pnpm dlx web-ext lint -s .output/firefox-mv3` is clean apart from two
  `UNSAFE_VAR_ASSIGNMENT` notices from React's own bundle.

**Chrome**

- Background is a service worker, where `URL.createObjectURL` does not exist; the download
  backend detects that and falls back to a data URL.
- `onMessage` ignores returned promises, so the router replies through `sendResponse`.
- `unlimitedStorage` is declared because the saved-URL index would otherwise share a 10 MB
  quota with everything else.

## Releasing

`RELEASING.md` covers the checks, version bump and both store submissions.
`store/LISTING.md` holds the listing copy, permission justifications and the answers each
store's review form asks for, and `store/screenshots/` the 1280×800 captures (generated
from a real browser, not mocked up). CI runs typecheck, lint, formatting, tests with
coverage thresholds, both builds and `web-ext lint` on every push, and uploads both store
packages as artifacts. Pushing a `v*` tag builds the release packages and drafts the GitHub
release. Dependabot groups weekly dependency updates.

## Privacy, security and licence

[PRIVACY.md](PRIVACY.md) documents every byte that leaves your machine and everything
stored on it. [SECURITY.md](SECURITY.md) covers how to report a vulnerability, how the
tokens you paste are stored, and the boundaries the code keeps. The extension is
[MPL-2.0](LICENSE) licensed.

## Roadmap

- Notice when a saved page has changed, instead of leaving you to re-save on a hunch.
- Per-folder destination rules — work bookmarks to a repo, personal to the vault.
- S3/R2 and WebDAV destinations.
