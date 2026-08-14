# Tabstack Bookmarks

A bookmark manager that saves *content*, not just URLs. Click the toolbar icon and the
page goes to the [Tabstack](https://tabstack.ai) API, comes back as clean markdown, and
is written to a destination **you** configure. The extension is only a pipe — nothing is
stored on Tabstack's side beyond the extraction request, and no third-party sync service
is involved.

Built with [WXT](https://wxt.dev), so the same source builds for Firefox, Chrome, Edge
and Safari.

## How it works

1. `POST https://api.tabstack.ai/v1/extract/markdown` with the tab URL (Bearer API key).
2. Optionally `POST /v1/generate/json` in parallel for a summary, key points and tag
   suggestions (see *Summaries* below).
3. Compose a document: YAML frontmatter (title, url, saved_at, description, author,
   publisher, site_name, image, tags, note, summary) + a `## Key points` section +
   the extracted markdown body.
4. Hand the document to the configured storage backend.

## Storage backends

| Backend | What it does | Setup |
| --- | --- | --- |
| **Local folder** | Writes `<download dir>/<folder>/<file>.md` via the downloads API | Set a subfolder. Browsers can only write inside the download directory — point the browser download folder at an Obsidian vault (or symlink it) to land notes there. |
| **GitHub repo** | Commits the file via the GitHub contents API | Fine-grained PAT with `Contents: read and write`, plus owner/repo/branch/folder. |
| **Obsidian vault** | `PUT /vault/<path>` on the Local REST API plugin | Plugin installed and Obsidian running. Use its **HTTP** port (default 27123) — the HTTPS port's self-signed cert is rejected by extensions. |

Duplicate handling: GitHub and Obsidian probe for an existing file and append `-1`,
`-2`, … unless you tick *overwrite the same file*; downloads use the browser's
`uniquify`.

Adding another backend is one file: implement `StorageBackend` in
`src/lib/backends/`, register it in `src/lib/backends/index.ts`, add its id to
`BackendId` in `src/lib/settings.ts`, and add its fields to the options page.

## Summaries

Turn on *Generate an AI summary* in the options (off by default — it is a second API call
per save, so it doubles credit use). Each save then also calls `/generate/json` with a
fixed schema asking for `summary`, `key_points` and `tags`. The summary goes into the
frontmatter, the key points become a `## Key points` section above the article, and the
suggested tags are merged into the bookmark's tags unless you turn that off.

The summary call runs **alongside** the markdown extraction, not after it, and a failed
summary never loses the markdown — the save completes and the record carries a
`summaryError`. The popup has a per-save *Summarize with AI* checkbox that overrides the
setting for one save.

## Importing existing bookmarks

Options → *Open bookmark import*, or `import.html` directly. Pick a folder (with live
counts), then:

- **Skip already saved** — leaves out URLs the extension has saved successfully before.
- **Stop after N** — try 5–10 first to see the output before spending credits on a
  thousand bookmarks.
- **Folder names as tags** — `Toolbar/Reading` becomes tags `Toolbar`, `Reading`.
- **Pause between bookmarks** — 0.5s / 1.5s / 4s.

"Already saved" is answered from a durable per-URL index (`savedIndex.ts`), not the
30-record UI history — otherwise a 1,000 bookmark import would forget all but the last 30
and re-save them (and re-spend credits) on the next run. It also means a page saved months
ago still shows as saved in the popup, with *Re-save* updating the same file. Options →
*Forget saved history* clears the index without touching your files.

The queue lives in the background, one bookmark at a time, and survives closing the tab
or the event page being suspended (progress is persisted after every item and a 1-minute
alarm resumes it). Rate-limited items retry with 5s/15s/45s backoff; a 401 or 402 stops
the whole run and says why. Duplicate URLs across folders are saved once.

## Develop

```bash
pnpm install
pnpm dev:firefox     # launches Firefox with the extension loaded, HMR on
pnpm dev             # same for Chrome
pnpm test            # vitest (103 tests: markdown, settings, backends, save flow, bookmarks, import queue, saved index)
pnpm compile         # tsc --noEmit
pnpm build:firefox   # .output/firefox-mv3
pnpm zip:firefox     # distributable zip (+ sources zip for AMO)
```

Tests run through `WxtVitest`, which provides `#imports` and an in-memory
`fakeBrowser`, so storage and settings are exercised for real and only `fetch` is
stubbed.

Manual load in Firefox: `about:debugging#/runtime/this-firefox` → *Load Temporary
Add-on* → pick `.output/firefox-mv3/manifest.json`.

### Driving a real Firefox

`scripts/firefox-drive.mjs` opens the extension's own pages in a running Firefox and
runs code inside them, which is how the options page, the save pipeline and the import
queue were verified against the live API. WebDriver BiDi refuses to navigate to
`moz-extension://` URLs, so the script uses Marionette's chrome context. Its header has
the exact `web-ext run` invocation; then:

```bash
node scripts/firefox-drive.mjs options.html --shot=/tmp/options.png
node scripts/firefox-drive.mjs import.html --eval="return document.title"
```

`--eval` runs in the extension page, so `browser.*` is available and the body can await.

First run: open the options page, paste the Tabstack API key, pick a destination, hit
**Test key** / **Test repo access**.

## Firefox notes

- MV3 on Firefox uses an **event page**, not a service worker — the background script can
  be unloaded between saves, so all state lives in `browser.storage.local`
  (`src/lib/saveStore.ts`), never in module scope.
- Firefox treats `host_permissions` as **opt-in**. The options page detects this and shows
  a *Grant access* button (must be a user gesture) before the first save can reach
  `api.tabstack.ai`.
- The Obsidian destination is user-supplied (host and port), so its origin is requested
  on demand out of `optional_host_permissions: ["*://*/*"]`. `runSave` refuses to start
  when that origin is not granted, instead of failing mid-flight with a CORS error.
- `data_collection_permissions: ["websiteContent"]` is declared in the manifest, which AMO
  requires for new extensions. That key only exists in Firefox 142+, so
  `strict_min_version` is `142.0`; lower it (and drop the key) if you need older Firefox.
- `pnpm dlx web-ext lint -s .output/firefox-mv3` is clean apart from two
  `UNSAFE_VAR_ASSIGNMENT` notices inside React's own bundle.

## Icons

`scripts/make-icons.mjs` draws the Tabstack mark (four offset bars on a 2×4 grid) from
the wordmark's rect geometry, on integer pixel boundaries per size rather than
downscaling one large PNG, so the bars stay crisp at 16px. Ink `#101018` on white,
mark at 70% of the tile — matching the official `icon-512x512.png`. It also emits
`public/icon/mark.svg`.

## Layout

```
entrypoints/
  background.ts        message router, keyboard command, context menus, badge, notifications
  popup/               one-click save + editable title/tags/note
  options/             API key, destination config, filename template, recent saves
  import/              bulk import of existing browser bookmarks
src/lib/
  tabstack.ts          /extract/markdown + /generate/json clients, error mapping
  save.ts              extract → compose → store orchestration
  markdown.ts          slugs, filename templates, frontmatter
  settings.ts          settings schema, defaults, validation, backend origins
  saveStore.ts         30-record UI history + final-write helper
  savedIndex.ts        durable url → {path, backend, savedAt} index, one key per URL
  bookmarks.ts         bookmark tree → flat saveable items, folder counts
  importQueue.ts       persisted import job: retry, backoff, cancel, resume
  permissions.ts       runtime host-permission checks
  backends/            download.ts, github.ts, obsidian.ts, types.ts
```

## Shortcuts

- Toolbar click → popup (auto-saves on open unless turned off).
- <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> → save the active tab, no popup.
- Right-click a page or a link → *Save … to Tabstack*.

## Roadmap

- Search across saved items; re-extract stale bookmarks.
- Two-way sync: notice when a saved page changed and offer to refresh it.
- Per-folder destination rules (e.g. work bookmarks to one repo, personal to the vault).
