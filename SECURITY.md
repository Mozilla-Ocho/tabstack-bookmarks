# Security policy

## Reporting a vulnerability

Report privately through GitHub's
[private vulnerability reporting](https://github.com/JustSteveKing/tabstack-bookmarks/security/advisories/new)
on this repository. Please do not open a public issue for anything exploitable.

Include the extension version (from `about:addons` or `chrome://extensions`), the browser
and version, and the smallest set of steps that shows the problem. Expect an
acknowledgement within a week. If a fix ships, the advisory and the changelog entry will
credit you unless you would rather they did not.

## Supported versions

The published version is the supported version. Fixes go out as a new release to both
stores rather than as patches to older ones.

## What the extension holds

Three credentials, all supplied by the user and all stored in `browser.storage.local`:

- the Tabstack API key,
- a GitHub personal access token, when the GitHub destination is in use,
- the Obsidian Local REST API key, when the Obsidian destination is in use.

`storage.local` is unencrypted, per-profile, and readable by anyone who can read the
browser profile directory or run code in the extension's own context. Browsers give
extensions nothing better, so treat these tokens as you would a config file on disk:

- Scope the GitHub token to a single repository with **Contents: read and write**, nothing
  else. A classic `repo` token grants far more than this extension needs.
- Revoke tokens when you uninstall. Uninstalling clears the profile's copy, but it does not
  revoke anything at the other end.

## Where data goes

Page URLs and page content go to `api.tabstack.ai` for extraction, and the resulting
markdown goes to the destination the user configured — nowhere else. There are no content
scripts, no analytics, and no telemetry. `PRIVACY.md` has the details.

## Boundaries worth knowing about

- **No remote code.** Everything shipped is in the package; nothing is fetched and
  evaluated at runtime.
- **Filename templates cannot escape their folder.** `renderFilename()` strips path
  separators from token values and drops `.` and `..` segments from the template, so
  neither a page titled `../../etc/passwd` nor a template of `../../{slug}` writes outside
  the destination folder. `src/lib/markdown.test.ts` covers both.
- **Host permissions are narrow.** `api.tabstack.ai` and `api.github.com` are requested;
  the optional set is loopback only. The extension cannot reach arbitrary sites, and it
  never reads the pages you visit — extraction happens server-side, from the URL.
- **Markdown is written, never executed.** Extracted content is stored as a file. If you
  render it later, that is your renderer's business; treat saved pages as untrusted input
  the same way you would any downloaded file.
