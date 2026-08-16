# QuickReader

RSVP speed reader for EPUB ebooks on the [Rabbit R1](https://www.rabbit.tech/) —
words flash one at a time from the pre-extracted word stream; the scroll wheel
paces, the side button navigates, push-to-talk holds.

## Install on an R1

Open an install page below **on any phone/computer**, then open the R1 camera
and scan the QR. Nothing is downloaded to the scanning device.

### Latest public build (no books bundled)

**https://remyfevry.github.io/r1apps/quickreader/install.html**

Every push to `main` of [RemyFevry/r1apps](https://github.com/RemyFevry/r1apps)
redeploys this after the CI compatibility gate passes. It is always the newest
build — older main builds are not kept here.

### A specific version (shelf builds, books bundled)

Shelf builds are personal builds with your books inside the app. **Every synced
version lives forever at its own URL** — old QR links keep serving the exact
build they were minted for:

```
https://remyfevry.github.io/r1-shelf/v/<version>/install.html
```

e.g. `…/r1-shelf/v/0.6.6/install.html`. Scan that page's QR and the R1 creation
card is named **QuickReader `<version>`**, so the card itself shows what it's
running. The unversioned root (`https://remyfevry.github.io/r1-shelf/`)
always serves the latest sync.

**Every version is also a GitHub artifact**: each sync publishes a Release on
[RemyFevry/r1-shelf](https://github.com/RemyFevry/r1-shelf/releases) tagged
`v<version>` with the exact site zip attached (backfilled through v0.5.0) —
the downloadable, immutable artifact record behind the serving URL.

## Version scheme

| Channel | Version | Where it comes from | Old versions kept? |
| --- | --- | --- | --- |
| Main site (`r1apps`) | app semver + `?v=<commit SHA>` | CI stamps the commit SHA into `BUILD_ID` | no — always latest `main` |
| Shelf (`r1-shelf`) | semver, e.g. `0.6.6` | `apps/quickreader/package.json` via `pnpm bookshelf bump` | **yes** — immutable `v/<ver>/` per sync |

A shipped shelf version never changes: `sync` refuses to overwrite an existing
`v/<ver>/`, so bump before every sync.

## Managing the shelf

See the [root README](../../README.md#managing-your-shelf-bundled-books) —
`pnpm bookshelf add | list | remove | bump | sync`.

## Develop

From the repo root:

```sh
pnpm install
pnpm --filter quickreader dev   # desktop keyboard fallbacks for R1 inputs
pnpm --filter quickreader test
pnpm verify                     # full R1 gate: typecheck + test + build + compat + smoke
```

Everything (R1 input events, storage seam, QR generation, theme) comes from
[`r1-kit`](../../packages/r1-kit/README.md); the device profile and build floor
live in [`r1.config.mjs`](../../r1.config.mjs).
