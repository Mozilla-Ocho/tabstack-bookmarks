# Releasing

## Before every release

```bash
pnpm install
pnpm compile
pnpm test
pnpm build:firefox && pnpm build
pnpm dlx web-ext lint -s .output/firefox-mv3   # 0 errors; 2 React warnings are expected
```

Then exercise the real thing, because unit tests do not catch manifest, CSS or permission
problems:

```bash
node scripts/chrome-drive.mjs options.html --shot=/tmp/chrome.png   # throwaway profile
node scripts/firefox-drive.mjs options.html --shot=/tmp/firefox.png # needs web-ext, see header
```

At minimum, walk one save per destination you claim to support, and one import.

Two paths only a human can check, both on a **fresh profile**:

- **Host permission grant.** Firefox asks for `api.tabstack.ai` access on first use; click
  *Grant access* in the options page and confirm the doorhanger. Automation cannot supply
  the gesture the prompt requires.
- **Obsidian certificate.** The plugin's HTTPS port is self-signed, so confirm whichever
  route the docs recommend still works: the plugin's HTTP port, or accepting the
  certificate once in a tab.

## Version bump

1. Set the new version in `package.json` (WXT reads it for the manifest).
2. Move `CHANGELOG.md`'s `[Unreleased]` entries under the new version with today's date.
3. Commit, then tag: `git tag -a v0.1.0 -m "v0.1.0"`.

## Firefox (AMO)

```bash
pnpm zip:firefox
```

Produces two files in `.output/`:

- `tabstack-bookmarks-<version>-firefox.zip` — the package to upload
- `tabstack-bookmarks-<version>-sources.zip` — required, because the package is bundled

Upload at <https://addons.mozilla.org/developers/>. Listing copy, permission
justifications and reviewer notes are in `store/LISTING.md`; the privacy policy URL is
`PRIVACY.md` in this repository.

Note: `strict_min_version` is `142.0` because `data_collection_permissions` requires it.

## Chrome Web Store

```bash
pnpm zip
```

Upload `.output/tabstack-bookmarks-<version>-chrome.zip` at
<https://chrome.google.com/webstore/devconsole>. The console asks for a single-purpose
statement, a justification per permission, and the data-usage disclosures — all written out
in `store/LISTING.md`. Keep the answers identical between releases unless the permissions
actually changed.

## After publishing

- Push the tag: `git push --tags`.
- Note the store review outcome in the changelog entry if anything had to change.
