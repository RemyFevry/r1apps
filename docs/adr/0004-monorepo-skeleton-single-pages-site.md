# ADR-0004: Monorepo skeleton — single Pages site, path-based apps, full r1-kit from day one

Date: 2026-08-15
Status: accepted
Map ticket: Monorepo skeleton and deploy pipeline (#7)

## Context

Tooling posture settled at charting: pnpm workspaces + TypeScript + Vite, one shared
package, static output the R1 installs via QR. The R1 caches creations by URL;
`?v=N` busts the cache. GitHub Pages serves the repo at `remyfevry.github.io/r1apps/`.

## Decision

### Layout

```
apps/<name>/          Vite TS site — index.html + install.html (QR companion) as two entries
apps/_template/       copy-to-start scaffold for new apps
packages/r1-kit/      shared TS library
docs/adr/, docs/glossary.md
.github/workflows/deploy.yml
pnpm-workspace.yaml
```

### r1-kit scope (day one)

- **inputs**: R1 window events (`sideClick`, `longPress*`, `scrollUp/Down`) with the
  desktop keyboard-fallback shim (Escape/Arrows/Space) from the platform guide.
- **storage**: the ADR-0003 seam interface + on-device adapter (creationStorage.plain +
  localStorage, base64 handling) + in-memory adapter for tests/desktop.
- **constants**: screen geometry (240×282), theme (`#0e0e10` bg, `#FE5000` accent),
  font stack and size scale.
- **list**: item-based list controller (translateY scroll, select-then-open,
  longPress-to-delete patterns).
- **qr**: install.html generator — renders the install QR (JSON payload:
  title/url/description/iconUrl/themeColor) and, for QuickReader, book deep-link QRs.
- **closeWebView** helper.

### Deploy

- One workflow, push → `main`: `pnpm install`, build every `apps/*`, publish a single
  Pages artifact preserving `/<app>/` paths → each app at
  `remyfevry.github.io/r1apps/<app>/`.
- Each app sets Vite `base: '/r1apps/<app>/'`.
- Cache-busting: builds inject a build id as `?v=<build id>` into the app URL
  used by install.html QRs — rescan the QR to pick up a new version. (2026-08-16:
  the constant was renamed `__COMMIT_SHA__` → `__BUILD_ID__` once it stopped
  holding a SHA — shelf builds stamp the semver via bookshelf, CI stamps the
  commit SHA.)

### New apps

Copy `apps/_template/`, rename, add to the workspace; the workflow builds it
automatically. QR companion and inputs/storage/theme come free from r1-kit.

## Consequences

- One repo, one workflow, one Pages site; adding apps is a folder copy.
- QuickReader's app code stays thin: screens + RSVP engine + EPUB ingestion; the
  platform-facing machinery lives in r1-kit.
- Books are never hosted here (ADR-0001) — the Pages site serves apps only.
