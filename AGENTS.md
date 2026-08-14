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

Popup, keyboard command, context menu and the import queue are four callers of that one
function. Add a fifth caller rather than a second pipeline.

## Commands

```bash
pnpm install          # runs `wxt prepare` via postinstall
pnpm compile          # tsc --noEmit
pnpm lint             # eslint; type-aware, so it needs TypeScript 6.x
pnpm format           # prettier --write .
pnpm test             # vitest run
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

**Dedupe reads `savedIndex`, never `listRecords()`.** `saveStore` is capped at 30 records
for the UI. Using it for "have I saved this?" was a real bug: a 1,000-bookmark import
remembered 30 URLs and re-saved (re-charged for) the rest. `src/lib/saveStore.test.ts`
guards this — if that test starts looking inconvenient, the change is wrong.

**Only `src/lib/tabstack.ts` talks to `api.tabstack.ai`,** and failures come back as
`TabstackError` carrying the HTTP status. `importQueue` branches on `errorStatus`: 429
means back off and retry, 401/402 means stop the entire run. Swallowing the status
silently turns "out of credits" into 500 failed items.

**A failed summary must never lose the markdown.** `/generate/json` runs in parallel with
extraction and its rejection is caught into `record.summaryError`; the save still
completes.

**Filename tokens cannot introduce path separators.** `renderFilename()` sanitises token
values while leaving template slashes as folders. A page titled `../../etc` must not
escape the destination folder.

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

## Settings

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

## Storage keys

| Key           | Contents                                          |
| ------------- | ------------------------------------------------- |
| `settings`    | The one settings object                           |
| `recentSaves` | Last 30 `SaveRecord`s, for the UI only            |
| `saved:<url>` | Durable index entry, one key per URL, O(1) writes |
| `importJob`   | The running/most recent import job                |

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
- APIs `fakeBrowser` does not implement (`bookmarks`) get `vi.spyOn(fakeBrowser.bookmarks, …)`.
- Cover the failure path, not just the happy one. Every backend has tests for 401, an
  unreachable host, and duplicate handling; keep that shape.

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
