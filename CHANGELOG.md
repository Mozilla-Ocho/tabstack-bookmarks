# Changelog

All notable changes to this extension. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] — 2026-08-17

### Added

- An error boundary on every page, so a render error shows the message and a reload button
  instead of a blank window.
- `schemaVersion` on stored settings, with a `migrate()` seam for future reshaping.
- Prettier, ESLint (type-aware, plus react-hooks), `.editorconfig`, and both as CI gates.
- Dependabot, grouped weekly.
- MPL-2.0 headers on source files, `CONTRIBUTING.md`, issue templates, and a Chrome Web
  Store promo tile.
- `SECURITY.md`: how to report a vulnerability, what the extension stores, and the
  boundaries worth knowing about.
- A tagged release workflow that runs the full gate, builds both packages, checks the tag
  against `package.json`, and drafts the GitHub release with the zips attached.
- Coverage thresholds over `src/lib`, and tests for the parts that had none: the Tabstack
  client, the downloads backend, host permissions, `isErrorReply()` and backend lookup.
- `minimum_chrome_version` on the Chrome package, the counterpart to gecko's
  `strict_min_version`.

### Fixed

- A rejected background handler replied with `{ error }`, which the popup rendered as an
  empty status box; replies are now checked with `isErrorReply()` and the message shown.
- Removed dead pre-`try` assignments in the three API error mappers, and a synchronous
  `setState` inside an effect on the options page.
- Non-JSON error bodies from the Tabstack API were dropped: the fallback read the body a
  second time, after the failed JSON parse had already consumed it. A 502 said only
  "request failed (502)".
- An import gave up on an item the moment a request failed to reach the API at all. Network
  failures now carry status 0 and are retried with the same backoff as a 429, while a 422 —
  a page the API cannot fetch — no longer burns three extra retries on it.
- A destination that rejected every write only ever failed one item at a time, each after
  paying for a full extraction. GitHub and Obsidian failures now carry their HTTP status,
  401/402/404 stops the run, and five failures in a row stops it regardless of status.
- The Obsidian backend overwrote an existing note once 50 candidate filenames were taken;
  it now refuses, like the GitHub backend already did.
- A filename template of `../../{slug}` could write outside the destination folder. Token
  values were already sanitised; the template's own dot segments are now dropped too.
- Store screenshots were 2560×1600 retina captures, which the Chrome Web Store rejects;
  they are now the 1280×800 it accepts.
- Editing the options page and closing the tab threw the edits away without a word. There is
  now an "Unsaved changes" marker and a `beforeunload` guard while edits are pending.
- Failure lists in the import page were keyed by URL alone, which collides when the same
  page is bookmarked in two folders.
- Work the background does not await — eight promises, most of them a bare `void` — turned a
  storage failure into an unhandled rejection and a run that silently stopped. They log
  under `[tabstack]` now.
- `scripts/chrome-drive.mjs` died on cleanup with `ENOTEMPTY` when Chrome was still flushing
  its profile, losing the exit code the run had earned.

### Changed

- An import kept every failure in the job object, which is one storage key rewritten and
  broadcast per item. It keeps the last 100 and counts the rest in `failed`, and the page
  says when the list is truncated.

- Pruning the saved-URL index no longer scans all of `storage.local` on every single save —
  it sweeps once per 250 saves. A 5,000-bookmark import did 5,000 full-index scans.
- The one-time migration from the recent-saves list is recorded with a flag instead of
  inferred from an empty index, which had it scanning all of storage on every background
  wakeup, forever.
- `browser_specific_settings` is left out of the Chrome package rather than shipped as a key
  its validator does not recognise.
- CI uploads the Chrome package alongside the Firefox one, runs with a read-only token, and
  gates on coverage.
- TypeScript pinned to 6.x, because `typescript-eslint` does not support 7 yet.
- `web-ext` is a pinned devDependency instead of `pnpm dlx web-ext@latest` in CI.

## [0.1.0] — 2026-08-14

First release. Verified end to end against the live Tabstack API in Firefox 153 and
Chrome 151.

### Added

- Save the current tab as markdown via `POST /v1/extract/markdown`, with YAML frontmatter
  (title, URL, save date, page metadata, tags, note).
- Three destinations: local folder (browser downloads), GitHub repository (contents API),
  and an Obsidian vault (Local REST API plugin).
- Optional AI summaries via `POST /v1/generate/json` — summary, key points and suggested
  tags, run in parallel with extraction and never able to lose the page.
- Bulk import of existing browser bookmarks: folder picker with counts, folder names as
  tags, skip-already-saved, rate-limit backoff, cancel, and resume after the browser
  suspends the extension.
- Configurable filename templates (`{date}`, `{yyyy}`, `{mm}`, `{dd}`, `{slug}`,
  `{title}`, `{host}`), with slashes creating folders.
- Three ways to save: toolbar popup (with editable title, tags and note),
  <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, and page/link context menu items.
- Durable per-URL saved index, so imports skip what is already saved and a page saved
  long ago can be re-saved in place.
- Tabstack brand theming, light and dark, with the brand mark and fonts bundled.
