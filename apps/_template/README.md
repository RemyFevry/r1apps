# r1-app-template

Copy-to-start scaffold for a new R1 app. Everything R1-specific — the
compatibility gate, device-sim smoke, input events, storage, theme, install QR
page — is inherited automatically.

## Make a new app

1. `cp -R apps/_template apps/<name>` (do not keep the `_` prefix).
2. Rename in `apps/<name>/package.json` (`"name": "<name>"`).
3. Set the deployed base path in `apps/<name>/vite.config.ts`
   (`base: '/r1apps/<name>/'`).
4. `pnpm install` (workspace picks it up), `git add apps/<name>`, push a PR.

That's it. CI builds it, runs the R1 gate on it, and — once merged to `main` —
deploys it to `https://remyfevry.github.io/r1apps/<name>/` with its
`install.html` QR companion. See the [root README](../../README.md) for the
gate; [ADR-0013](../../docs/adr/0013-r1-compatibility-gate-ci.md) for why.

## What the template gives you

- `index.html` — the creation entry the R1 webview loads (240×282,
  `user-scalable=no` — enforced by the compat scan).
- `install.html` + `src/install.ts` — phone/computer QR page; scan with the R1
  camera to install. The QR URL carries `?v=<BUILD_ID>` for cache-busting.
- `src/main.ts` — boots into `#app`, wires R1 inputs via r1-kit's
  `attachInputs` (with desktop keyboard fallbacks for dev).
- Build target locked to the R1 webview floor (`R1_BUILD_TARGET` from
  [`r1.config.mjs`](../../r1.config.mjs)) — newer syntax fails the build.

## Versioning your app

- The R1 card title comes from `install.ts` (`title: '<Name> ${__APP_VERSION__}'`)
  — bump `version` in `apps/<name>/package.json` so devices can tell builds
  apart. On CI, `__BUILD_ID__` is the commit SHA.
- QuickReader additionally ships immutable `v/<semver>/` shelf builds — see
  [its README](../quickreader/README.md#version-scheme) if you want that
  pattern for your app.

## Commands (from repo root)

```sh
pnpm --filter <name> dev     # local dev server
pnpm verify                  # typecheck + test + build + R1 gate, exactly what CI runs
```
