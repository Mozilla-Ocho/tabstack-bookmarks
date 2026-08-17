# Releasing

## Before every release

```bash
pnpm install
pnpm compile
pnpm test:coverage
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
  _Grant access_ in the options page and confirm the doorhanger. Automation cannot supply
  the gesture the prompt requires.
- **Obsidian certificate.** The plugin's HTTPS port is self-signed, so confirm whichever
  route the docs recommend still works: the plugin's HTTP port, or accepting the
  certificate once in a tab.

## Version bump

1. Set the new version in `package.json` (WXT reads it for the manifest).
2. Move `CHANGELOG.md`'s `[Unreleased]` entries under the new version with today's date.
3. Commit, then tag: `git tag -a v0.1.0 -m "v0.1.0"`.
4. `git push --follow-tags`.

Pushing the tag is the release. `.github/workflows/release.yml` then does all of this on a
clean checkout of the tagged commit:

- refuses the tag if it disagrees with `package.json`, or if `CHANGELOG.md` has no **dated**
  section for it — both before spending five minutes on a build;
- runs the whole gate again, because a tag can point at a commit CI never saw;
- builds both targets, runs `web-ext lint`, and produces the three zips;
- opens a **draft** GitHub release whose notes are that changelog section, with the zips
  attached.

Download those zips for the store uploads rather than whatever is in your `.output/` — they
are the ones built from the tagged commit, by something with no local state. The steps below
stay accurate if you would rather build by hand.

Still yours to do: read the draft, publish it, and upload to the two stores. Publishing is
deliberately not automated — see [Publishing](#publishing).

## Screenshots

Both stores take the four PNGs in `store/screenshots/`. The Chrome Web Store accepts
**1280×800 or 640×400 and nothing else**, so a retina capture has to be downscaled before
upload — a 2× screenshot of a 1280×800 window is a 2560×1600 file and gets rejected:

```bash
sips -z 800 1280 store/screenshots/*.png   # macOS; in place
```

## Publishing

The release is left as a draft on purpose. Nothing downstream can be taken back: a published
GitHub release notifies watchers, and a store submission enters a review queue that cannot be
cancelled halfway. Reading the notes once is cheap by comparison.

```bash
gh release edit "v0.3.0" --draft=false --latest
```

## Firefox (AMO)

```bash
pnpm zip:firefox
```

Produces two files in `.output/`:

- `tabstack-bookmarks-<version>-firefox.zip` — the package to upload
- `tabstack-bookmarks-<version>-sources.zip` — required, because the package is bundled

### Submitting from CI

`.github/workflows/publish-amo.yml`, run by hand from the Actions tab: pick the tag and the
channel. It checks out that tag, rebuilds, lints the package, and submits the build plus the
sources archive through AMO's API — so what Mozilla receives is demonstrably the tagged
source, built somewhere with no local state.

Two repository secrets, from <https://addons.mozilla.org/developers/addon/api/key/>:

| Secret           | What it is                               |
| ---------------- | ---------------------------------------- |
| `AMO_JWT_ISSUER` | The API key, of the form `user:12345:67` |
| `AMO_JWT_SECRET` | The API secret shown beside it, once     |

Put them on a repository **environment** called `amo`, not in plain repository secrets, and
add required reviewers to it. Then "who may ship to users" is a setting rather than "whoever
can push a workflow file", and the job pauses for approval before the credentials are readable.
The secret is shown once at creation; a lost one is regenerated, which invalidates the old.

The job submits and stops — `--approval-timeout 0`, because a listed version waits on human
review and a runner should not sit watching a queue for hours. Track it on the developer hub.

**The first listed submission is still a web form.** A new add-on needs listing metadata AMO
does not take from this API in a usable way — categories, the summary, the privacy policy URL.
Do that once at <https://addons.mozilla.org/developers/>, using the copy in
`store/LISTING.md`; every version after it can go through the workflow.

### Submitting by hand

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
