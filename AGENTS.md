# r1apps

Rabbit R1 apps monorepo — quickreader and friends. Public, deployed to GitHub Pages.

## R1 compatibility gate

Every push and PR passes `.github/workflows/ci.yml` before it can deploy. The R1
device profile lives in `r1.config.mjs` (Chrome 103 floor — Android 13-era
webview, 240×282, no touch). If a device report ever proves a higher floor, bump
`R1_CHROMIUM_MAJOR` there and nowhere else.

Run the whole gate locally (CI runs exactly this):

```
pnpm verify          # typecheck + test + build + r1:compat + r1:smoke
```

- `pnpm r1:compat` — post-build static scan of `apps/<name>/dist`: JS built-ins
  and CSS newer than the Chromium floor, viewport contract on creation entries
  (`index.html` must be `width=240, user-scalable=no`), no external resources,
  JS bundle budget.
- `pnpm r1:smoke` — Playwright Chromium at 240×282 with `creationStorage` /
  `closeWebView` mocked and post-Chrome-103 built-ins deleted (runtime floor
  shim), driving each app through R1 hardware events (`sideClick`,
  `scrollUp/Down`, `longPressStart/End`); fails on any console error or
  horizontal overflow. The denylist both layers share is `R1_JS_DENYLIST` in
  `r1.config.mjs`.

Vite build targets are locked to the same floor (`build.target` imports from
`r1.config.mjs`), so syntax the webview can't parse fails the build. New apps
copied from `apps/_template` inherit all of this. Full decision record:
docs/adr/0013-r1-compatibility-gate-ci.md.

## Shelf sync rule

Shelves always update when r1apps updates: after any change to an app with bundled
documents lands on main, run `pnpm bookshelf auto` from a checkout that holds the
bundled books (they're gitignored, so they live only on the dev machine). It bumps
the app version, merges to main, and syncs the shelf repos.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`RemyFevry/r1apps`); agent operations run as `remyf-agent`. See `docs/agents/issue-tracker.md`.
