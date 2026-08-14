# Changelog

All notable changes to this extension. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
