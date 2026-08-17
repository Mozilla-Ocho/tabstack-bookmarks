# Contributing

Thanks for looking. This is a small extension with a deliberately small surface; the
fastest way to get a change merged is to keep it that way.

## Setup

```bash
pnpm install     # Node 22.12+, pnpm (version pinned in package.json)
pnpm dev:firefox # or pnpm dev for Chrome
```

`AGENTS.md` documents the architecture and the invariants that are easy to break —
please read it before changing anything in `src/lib/`. It is short.

User-visible text goes in `locales/en.yml`, never inline in a component. Run
`pnpm exec wxt prepare` after adding a key so the types know about it. Translations are
welcome as a `locales/<code>.yml` copy of that file.

## Before opening a pull request

```bash
pnpm compile        # types
pnpm lint           # eslint
pnpm format         # prettier --write
pnpm test:coverage  # vitest, with thresholds over src/lib
pnpm build:firefox && pnpm build
```

Found something exploitable rather than merely broken? Do not open a pull request — see
[SECURITY.md](SECURITY.md).

CI runs all of the above plus `web-ext lint`. If your change touches the manifest,
permissions, the UI, or anything a store reviewer would read, also update
`store/LISTING.md` and — if it changes what data moves — `PRIVACY.md`, in the same pull
request.

Unit tests do not catch CSS, manifest or permission problems. For anything visible, drive a
real browser:

```bash
node scripts/chrome-drive.mjs options.html --shot=/tmp/chrome.png
node scripts/firefox-drive.mjs options.html --shot=/tmp/firefox.png
```

## What is likely to be accepted

- A new storage destination. Implement `StorageBackend`; see the four touch points listed
  in the README. Bring tests for the 401, unreachable-host and duplicate-path cases, the
  way the existing backends have them.
- Bug fixes with a test that fails before the change.
- Accuracy fixes to the docs.

## What is likely to be declined

`AGENTS.md` has a "Deliberate omissions" section: telemetry of any kind, a hosted sync
service, and a generic webhook destination (which existed and was removed). If you want one
of those, open an issue first and make the case.

## Conventions

- Commit messages are prose that explains _why_, wrapped at ~80 columns. No trailers.
- Comments explain reasoning, not syntax.
- Files carry the MPL-2.0 header; `pnpm format` will not add it for you.
- Never commit a key or token. Test credentials belong in a throwaway browser profile.
