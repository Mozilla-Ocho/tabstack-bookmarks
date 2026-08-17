# AGENTS.md

Working notes for agents (and humans) changing this repo. The [README](README.md) explains
what the extension does and how to use it; this file is about not breaking it.

## Shape of the thing

A WXT + React browser extension. One source tree, two shipped targets: `firefox-mv3` and
`chrome-mv3`. TypeScript throughout, pnpm, Node 22.12+.

The whole product is one pipeline — `runSave()` in `src/lib/save.ts`:

```
tab URL → Tabstack /extract/markdown (+ optional /generate/json)
        → compose frontmatter + body
        → StorageBackend.save()
        → rememberSave()
```

Popup, keyboard command, context menu, the import queue and the library's re-save are five
callers of that one function. Add a sixth caller rather than a second pipeline.

## Commands

```bash
pnpm install          # runs `wxt prepare` via postinstall
pnpm compile          # tsc --noEmit
pnpm lint             # eslint; type-aware, so it needs TypeScript 6.x
pnpm format           # prettier --write .
pnpm test             # vitest run
pnpm test:coverage    # same, with thresholds over src/ and entrypoints/ (CI runs this)
pnpm build:firefox    # .output/firefox-mv3
pnpm build            # .output/chrome-mv3
pnpm dev:firefox      # HMR (see the caveat below)
```

Before claiming a change works:
`pnpm compile && pnpm lint && pnpm format:check && pnpm test && pnpm build:firefox`. If you
touched `wxt.config.ts`, permissions or anything manifest-shaped, also run
`pnpm dlx web-ext lint -s .output/firefox-mv3` — 0 errors, and only the two React
`UNSAFE_VAR_ASSIGNMENT` warnings are expected.

## Invariants

Break these and things fail in ways unit tests may not catch.

**The background is an event page on Firefox.** It gets unloaded between saves. No state
in module scope, ever — persist to `browser.storage.local` and re-read it. The one
exception is the `processing` re-entry guard in `importQueue.ts`, which is deliberately
allowed to reset on restart.

**Message routing replies through `sendResponse` and returns `true`.** Chrome's native
`onMessage` ignores returned promises. Do not "simplify" `route()` in
`entrypoints/background.ts` into a promise-returning listener.

**There is exactly one final-write path: `rememberSave()`.** It writes both the 30-record
UI history and the durable index. Progress updates use `putRecord()`. If you add a new
save caller, call `rememberSave()` when it finishes.

**`savedIndex` is the library, not just a dedupe set.** `searchSaved()` backs the library
page, so an entry is something a user can see, re-save and delete — `forgetSaved()` is a
user-visible action now, not only internal bookkeeping.

**Dedupe reads `savedIndex`, never `listRecords()`.** `saveStore` is capped at 30 records
for the UI. Using it for "have I saved this?" was a real bug: a 1,000-bookmark import
remembered 30 URLs and re-saved (re-charged for) the rest. `src/lib/saveStore.test.ts`
guards this — if that test starts looking inconvenient, the change is wrong.

**Only `src/lib/tabstack.ts` talks to `api.tabstack.ai`,** and failures come back as
`TabstackError` carrying the HTTP status. Swallowing the status silently turns "out of
credits" into 500 failed items.

**Every HTTP failure carries a status, whoever it came from.** `HttpError` in
`src/lib/httpError.ts` is the base; `TabstackError` extends it, and the GitHub and Obsidian
backends throw it too. A failure with no response at all gets `NETWORK_STATUS` (0), not
`undefined`. `runSave()` copies the status onto `record.errorStatus`, and `importQueue`
decides from it via `isRetryableStatus()` (0/403/429/5xx) and `isFatalStatus()`
(401/402/404). Throwing a bare `Error` from a backend drops it back into "retry nothing,
stop for nothing" — which is how a wrong GitHub token used to pay for thousands of
extractions before failing to store every one of them. On top of the statuses,
`MAX_CONSECUTIVE_FAILURES` stops a run after five failures in a row, which is what catches
the failures no status describes.

**A failed summary must never lose the markdown.** `/generate/json` runs in parallel with
extraction and its rejection is caught into `record.summaryError`; the save still
completes.

**Filename tokens cannot introduce path separators.** `renderFilename()` sanitises token
values while leaving template slashes as folders, and drops `.` and `..` segments from the
template itself. Neither a page titled `../../etc` nor a template of `../../{slug}` may
escape the destination folder.

**Never overwrite a file the user did not ask you to overwrite.** Both the GitHub and
Obsidian backends look for a free `-1`, `-2`, … name and throw once they run out, rather
than falling through to a write. Obsidian's save is a `PUT`, which replaces a note outright,
so "give up after 50" has to mean give up.

**Nothing that scans all of storage may run per save.** `storage.local.get(null)` costs the
whole index — 50,000 entries at the cap. `rememberSave()` calls `maybePruneSaved()`, which
sweeps once per `PRUNE_INTERVAL` saves off a single-key counter, and `migrateFromRecent()`
is gated by a stored flag rather than by "is the index empty?" — the background wakes for
every save, so an empty-index check pays for a one-time migration forever.

**Documents carry exactly one frontmatter block.** `composeDocument()` strips whatever the
extraction produced before prepending ours; the horizontal-rule case is tested.

**User-supplied hosts need a runtime origin grant.** Manifest `host_permissions` are
opt-in on Firefox, and the Obsidian base URL is not known at build time. `backendOrigin()`
derives the pattern, the options page requests it, and `runSave()` refuses to start
without it — failing early with a sentence beats failing mid-flight with a CORS error.

**Background replies can be errors.** `route()` answers a rejected handler with
`{ error }`. Every caller must pass replies through `isErrorReply()` before treating them
as their expected shape — a `SaveRecord` with no `status` renders as an empty box, which is
worse than an error message.

**Render errors must not blank a page.** Extension pages get no browser error UI, so each
entrypoint is wrapped in `ErrorBoundary`. Keep new entrypoints wrapped.

**A failed save is retried, an unsaveable one is not.** `retryQueue.ts` holds the original
`SaveRequest` — the edited title, the tags, the note — and the background re-runs it on a
one-minute alarm at 1, 5 then 15 minutes. Only `isRetryableStatus()` failures are queued, so
nobody pays for three more attempts at a rejected key or an unfetchable page, and the alarm
only runs while something is waiting. A success calls `dropPending()`; forget that and a saved
page gets saved again.

**Work the background does not await goes through `detached()`.** A bare `void promise()`
turns a storage failure into an unhandled rejection and a run that silently stopped. Use
`void` only for helpers that already swallow their own errors (`broadcast`, `paintBadge`).

## Settings

**Preferences sync; credentials never do.** `setSettings()` writes the whole object to
`storage.local` and everything _except_ the three tokens to `storage.sync`. `getSettings()`
prefers `sync` for preferences — both areas are written together, so they differ only when
another device changed something — and takes `apiKey`, `github.token` and `obsidian.token`
from `local` alone. `storage.sync` travels through the user's browser account; an API key is
not ours to put there. A sync area that is missing, disabled or over quota must never stop a
save: both reads and the write are wrapped, and local already has everything.

`Settings` in `src/lib/settings.ts` is the single schema. Adding a field means: the type,
`DEFAULT_SETTINGS`, and — for a nested group — the deep merge in `getSettings()`. Miss the
merge and existing users get `undefined` where they expect defaults, which is how you ship
a crash to people who installed last week.

Validation belongs in `configErrors()`, which gates the UI and `runSave()` alike.

`SCHEMA_VERSION` exists for _reshaping_ — a renamed or re-typed field — not for additions,
which the merge already handles. Bump it and put the transformation in `migrate()`; settings
written by a newer version are passed through rather than discarded.

TypeScript is pinned to 6.x on purpose: `typescript-eslint` refuses to run against TS 7, and
type-aware linting is worth more than being on the native compiler. Revisit when upstream
supports it.

## Strings

Every string a user reads lives in `locales/en.yml`, and `@wxt-dev/i18n` compiles it to
`_locales/<lang>/messages.json` at build time. A translation is one more file next to it —
`locales/de.yml` — and no code change.

```ts
i18n.t('popup.title'); // plain
i18n.t('popup.savedOn', [date]); // $1 substitution
i18n.t('import.planned', count); // plural: the `1:`/`n:` forms
```

Adding a key means running `pnpm exec wxt prepare` (or any `pnpm dev`/`build`) to regenerate
the types — `i18n.t` only accepts keys it knows, and it knows how many substitutions each
one takes, so a typo or a missing argument is a compile error rather than a `??key??` in the
UI. Two rules keep that useful:

**No user-visible literal in an entrypoint.** If it renders, it comes from `i18n.t`.

**A sentence is one key.** For inline markup, use `rich()` with `slots()` from
`src/ui/rich.tsx` rather than splitting the sentence into a key per fragment — a translator
needs to read and reorder the whole thing:

```tsx
// summarizeHelp: Adds a $1 call per save. Key points become a $2 section.
rich(i18n.t('options.summarizeHelp', slots(2)), [
  <code key="call">/generate/json</code>,
  <code key="heading">## Key points</code>,
]);
```

The manifest's `name`, `description`, action title and command description are
`__MSG_key__` references the browser substitutes, which is why `default_locale` must stay
set.

Error messages are in there too, under `errors.*` — the HTTP status stays in the text, since
that is the part a user quotes in a bug report. `src/lib/messagesCatalogue.test.ts` fails on
a key the code asks for and the file does not define, and on a key nothing uses: a missing
message is an empty string at runtime, not a crash, so nothing else would notice.

Two traps in the messages file itself:

- **Quote any value containing `: `.** Unquoted, YAML reads it as a nested key and the
  message vanishes into a key named after its own text.
- **Regenerate after editing** — `pnpm exec wxt prepare`. Stale types reject a key that
  exists, which reads like a broken build.

Tests get the real catalogue: `src/testing/setup.ts` compiles `locales/en.yml` the same way
the build does and answers `browser.i18n.getMessage` from it. So an assertion on "out of
credits (402)" is checking the string a user reads, and plural selection is exercised rather
than stubbed. Do not replace that with a `t()` that echoes its key — it would make every
message assertion in the suite meaningless.

## Storage keys

| Key                  | Contents                                          |
| -------------------- | ------------------------------------------------- |
| `settings`           | The one settings object                           |
| `recentSaves`        | Last 30 `SaveRecord`s, for the UI only            |
| `saved:<url>`        | Durable index entry, one key per URL, O(1) writes |
| `savedIndexWrites`   | Saves since the last prune sweep                  |
| `savedIndexMigrated` | Set once the pre-index migration has run          |
| `importJob`          | The running/most recent import job                |
| `retrySaves`         | Saves waiting for another attempt                 |

The library page reads the index through the `searchSaved` message rather than touching
storage directly: only the background should be scanning 50,000 keys, and only once per
query.

The `saved:` prefix is sharded on purpose: a single map would be rewritten on every save.
Anything iterating all keys must filter by prefix and ignore the rest.

## Tests

Vitest with the `WxtVitest` plugin, which provides `#imports` and `fakeBrowser`.

- Stub `fetch`. Do not stub storage — exercise the real code against `fakeBrowser`.
- `fakeBrowser.reset()` in `beforeEach`.
- Pin the clock (`vi.useFakeTimers`, `vi.setSystemTime`) when filenames or `saved_at` are
  asserted.
- The import queue sleeps between items: drive it with the `drain()` pattern in
  `importQueue.test.ts` (`const p = processJob(); await vi.runAllTimersAsync(); await p`).
- APIs `fakeBrowser` does not implement (`bookmarks`, `commands`, `contextMenus`,
  `downloads`, `i18n`, `permissions`) have to be supplied. For a method,
  `fakeBrowser.x.y = vi.fn()`; for an _event_, use the `fakeEvent()` helper in
  `background.test.ts`, which returns the listeners' own return values from `trigger` the
  way the real API does.
- Cover the failure path, not just the happy one. Every backend has tests for 401, an
  unreachable host, and duplicate handling; keep that shape.
- Give each mocked `fetch` its own `Response`. A body can only be read once, so a shared one
  fails the second read with a `TypeError` that looks like a network error.

The pages have tests too, in `entrypoints/*/App.test.tsx`. They need a DOM, which is a
per-file docblock rather than a config-wide default:

```tsx
/* @vitest-environment happy-dom */
```

They drive the real component against `fakeBrowser`, with the background's replies stubbed
through `runtime.sendMessage` — so they cover what a user does (auto-save, re-save in place,
cancel an import) rather than how it is rendered. `src/testing/setup.ts` unmounts between
tests; without that, a second `render()` leaves the first one in the document and every
`getByRole` reports "found multiple elements".

Two things to know when asserting on text:

- **A regex matches loosely.** `/out of credits/` also matches the help paragraph that
  explains running out of credits stops a run. Assert the exact string when a substring
  could appear twice.
- **`getByText` only sees an element's own text nodes**, so a value split by `<br />` or
  wrapped in `<code>` needs a regex or a parent lookup.

`src/tests/background.test.ts` covers routing through `fakeBrowser.runtime.sendMessage`,
which implements the real `sendResponse`-plus-`return true` contract: rewrite `route()` as an
async listener and those tests go `undefined`.

It lives outside `entrypoints/` on purpose. WXT reads every top-level file there as an
entrypoint and takes the name up to the first dot, so `entrypoints/background.test.ts` is a
second `background` and the build dies with "Multiple entrypoints with the same name" — while
the tests still pass, so only a build catches it. Page tests are fine beside their pages,
because a page entrypoint is its directory's `index.html`.

`pnpm test:coverage` gates `src/` and `entrypoints/` at 85% statements and branches. The
text report hides files at 100%, so a file missing from the table is covered, not skipped.

## Verifying in a real browser

Unit tests do not catch CSS, manifest or permission problems — the sticky-bar overlap and
the unified-extensions placement both needed a real window. Use
`scripts/firefox-drive.mjs` (its header has the `web-ext run` command line, including the
`-remote-allow-system-access` flag Firefox 142+ requires) and `scripts/chrome-drive.mjs`,
which handles its own browser and profile.

Test credentials belong in a throwaway profile, never a committed file: both scripts use
temporary profiles, and `JustSteveKing/tabstack-bookmarks-test` is a private repo kept for
exercising the GitHub destination.

Notes from doing this the hard way:

- `pnpm dev:firefox` prints "load manually" on this machine and serves pages from the HMR
  server, which muddies what you are verifying. For anything visual, test the production
  build via `web-ext run`.
- Chrome gets `scripts/chrome-drive.mjs`, which launches a throwaway profile and installs
  the build over CDP `Extensions.loadUnpacked` — current Chrome (151 here) silently ignores
  `--load-extension`. That path verified Chrome's save, `data:`-URL download fallback,
  summaries and import queue.
- Extension pages are privileged: BiDi refuses to navigate to them, and only the parent
  process can open one in a tab.
- Size the window _after_ attaching to the tab, or screenshots come out 300px wide.
- Full-page screenshots render `position: sticky` elements at the viewport edge, so an
  apparent overlap in a screenshot may not be a real one. Check computed styles too.

## Style

- Match the surrounding code: named exports, `async`/`await`, no default exports outside
  entrypoints, comments that explain _why_ rather than restating the line.
- Brand tokens only, from `src/ui/style.css`. Do not introduce a second palette or a
  remote font/CDN asset. Both schemes come from `light-dark()`; no duplicated dark block.
- Icons and the store promo tile are generated — edit `scripts/make-icons.mjs` and rerun
  it, never hand-edit the PNGs.
- Every source file carries the MPL-2.0 header. Prettier will not add it; copy it from a
  neighbouring file.
- Never log or print a secret. When debugging keys, log the length. `TABSTACK_API_KEY`
  from the environment is fine for local API probes; it must not reach a committed file,
  a test fixture, or a commit message.
- Commit messages: prose that explains why, wrapped at ~80 columns. No
  `Co-Authored-By` trailers, no emoji, no "generated with" footers.

## Shipping

`RELEASING.md` has the release steps; `store/LISTING.md` holds the listing copy,
permission justifications and store answers, and must be updated in the same change as
any permission edit. `PRIVACY.md` is the published policy — if a change alters what
leaves the machine or what is stored, that file changes too, and so does the
`data_collection_permissions` declaration. Screenshots in `store/screenshots/` are
generated from a real browser; regenerate rather than retouch.

## Deliberate omissions

Do not re-add these without asking:

- **A webhook destination.** It existed and was removed as not the point of the product.
- **Telemetry, analytics or error reporting.** The privacy claim in the README is load
  bearing.
- **A hosted sync service.** The extension is a pipe; data goes where the user says.

## Related repos

Siblings of this directory, useful but not to be edited from here:

- `tabstack-api-docs` — the API surface (`stainless/openapi.yaml`, generated upstream in
  `tabs-api`, so never hand-edited) and the UI theme this extension mirrors.
- `tabstack.ai` — brand: the official icon, palette and fonts.
