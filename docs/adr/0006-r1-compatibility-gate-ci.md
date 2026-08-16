# ADR-0006: R1 compatibility gate — chrome103 floor, static scan, device-sim smoke, CI-gated deploy

Date: 2026-08-16
Status: accepted

## Context

The old `deploy.yml` shipped whatever compiled: green unit tests say nothing about
the R1's webview. The device runs an Android 13-era Chromium whose exact build is
not independently verifiable (docs/research/epub-parsing-approach.md pins the safe
floor at Chrome 103), at 240×282, no touch, weak CPU, caching creations by URL.
Three failure classes were ungated:

1. **Syntax** newer than the webview — Vite's default target transpiles for
   modern browsers, not for Chrome 103.
2. **APIs** newer than the webview — esbuild never polyfills built-ins, so
   `.toSorted()` or `Promise.withResolvers` ship silently broken.
3. **Runtime/layout breakage** — console errors, horizontal overflow at 240px,
   missing device bridge handling; invisible to unit tests and to `vite build`.

"Always 100% compatible with the R1" therefore needs a gate that runs on every
push and PR, not a deploy workflow that runs after the fact on main.

## Decision

### One source of truth for the device profile

`r1.config.mjs` at the repo root: `R1_CHROMIUM_MAJOR = 103`, viewport
(240×282), JS budget. Vite `build.target`, the static scan, and the smoke suite
all import from it. If a device report ever proves a higher floor, one constant
bumps and every layer follows.

### Build target locked

Every app's `vite.config.ts` sets `build.target = R1_BUILD_TARGET` (`chrome103`),
including `apps/_template` — new apps inherit the lock by folder copy. Syntax
newer than the floor either transpiles down or fails the build.

### `pnpm r1:compat` — post-build static scan (`scripts/check-r1-compat.mjs`)

For each `apps/<name>/dist`:

- **JS built-in denylist** — one shared list (`R1_JS_DENYLIST` in r1.config.mjs),
  two consumers: the static scan greps call sites (`scan` regex, reports
  file:line), and the device-sim deletes the properties before app code runs
  (`path`), so runtime usage the grep cannot see throws and fails smoke. Entries
  may be runtime-only (iterator helpers — `.take(` collides with user methods in
  minified output) or scan-only (the `"scrollend"` event name — nothing to
  delete).
- **CSS denylist** (`:has()` 105, container queries 105, nesting 112,
  `color-mix()` 111, oklch/oklab 111, `@scope` 118, external `@import` — never).
  `url(...)` is stripped first: SVG data URIs legitimately contain `&`.
- **Viewport contract on creation entries only**: `index.html` must be
  `width=240, user-scalable=no`. `install.html` is a phone/browser QR companion
  — `width=device-width` is correct there. (The first scan run caught exactly
  this false positive, and the rule was narrowed.)
- **No external resources**: the R1 caches creations; CDN references break
  offline.
- **JS budget** (1.5 MB total): weak CPU on device; catches step changes like a
  new dependency, not book-content noise.

Known gap closed: iterator helpers (`.take()`/`.drop()` on iterators) are
method calls indistinguishable from user methods in minified output — the grep
cannot flag them — but the device-sim deletes them from `Iterator.prototype`
(and every other denylist entry) before app code runs, so runtime usage throws
and fails the suite.

### `pnpm r1:smoke` — device-sim (`smoke/r1-smoke.spec.ts` + `playwright.config.ts`)

Playwright Chromium at exactly 240×282, `hasTouch: false`, with the device's JS
bridge mocked via `addInitScript` before app code runs — `creationStorage.plain`
(async getItem/setItem/removeItem, matching r1-kit's `CreationStorageArea`) and
`closeWebView.postMessage` — plus a **runtime floor shim**: every built-in in
`R1_JS_DENYLIST` is deleted, so Chromium behaves like the R1 floor for exactly
the APIs the gate cares about. Each app must: mount something in `#app`/body,
show zero console/page errors, and have no horizontal overflow. Then it is
driven through the R1 hardware events exactly as r1-kit receives them
(`sideClick`, `scrollUp/Down`, `longPressStart/End` on `window`) plus the
desktop keyboard fallbacks. `scripts/serve-r1-dist.mjs` serves every dist at
its deployed `/r1apps/<app>/` base so smoke loads the bytes Pages will serve.

### CI gates deploy (`.github/workflows/ci.yml`, replaces deploy.yml)

- `verify` job on every push (all branches) and PR: typecheck → test → build →
  `r1:compat` → `r1:smoke`. Playwright Chromium is cached.
- `deploy` job runs only for main pushes, `needs: verify`, and deploys **the
  artifact built by verify** — there is no second build, so the bytes deployed
  are the bytes the gate verified.
- Branch protection on `main`: `verify` required, `enforce_admins`, branch
  up-to-date, no force pushes or deletions, conversation resolution required —
  set 2026-08-16 by the owner (RemyFevry); every change to main, the owner's
  included, now merges only after the gate passes.

## Consequences

- Nothing reaches Pages without passing the gate, including the owner's own
  pushes once protection is on (direct version-bump pushes become short PRs).
- The denylists are allow-by-default maintenance tax: when a too-new API slips
  into general use, someone hits it on the device first and adds the entry.
  Device reports of a higher webview floor bump one constant and relax every
  layer at once.
- CI stays fast: one build per push, deploy job is artifact-publish only,
  Playwright's browser download cached on lockfile hash.
- `pnpm verify` runs the identical sequence locally — an R1 regression fails
  before the commit, not after the push.
