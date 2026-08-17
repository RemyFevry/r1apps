# r1-kit

Shared platform kit for the R1 apps in this monorepo — the R1-facing machinery
so app code stays screens and logic. Consumed as a workspace dependency
(`"r1-kit": "workspace:*"`); entry point is `src/index.ts` (plain TS, no build
step).

## Modules

| Module | What it gives an app |
| --- | --- |
| `inputs.ts` | `attachInputs(handlers)` — R1 hardware events (`sideClick`, `scrollUp/Down`, `longPressStart/End`) with desktop keyboard fallbacks (Escape/Arrows/Space) |
| `storage.ts` | The storage seam (ADR-0003): `saveBook`/`loadBook`/`listBooks`/`deleteBook`/`savePosition`/`loadPosition`/`saveSettings`/`loadSettings`/`health` — on-device adapter (`creationStorage.plain` + `localStorage`, base64) and in-memory adapter for tests/desktop; `probeDeviceStorage` write→read-back probe |
| `constants.ts` | Screen geometry (240×282), theme (`#0e0e10`/`#FE5000`), font stack and scale |
| `rows.ts` | `createRowList` — item list controller: navigation, windowing, DOM sync |
| `qr.ts` | Install-QR payload (`installPayload`) and SVG renderer (`renderQr`) for `install.html` pages |
| `zip.ts` | Zip (EPUB) reader used by ingestion |
| `close.ts` | `closeApp()` — closes the creation via `closeWebView.postMessage` |

## The R1 compatibility gate

The kit itself is subject to the gate like everything else: post-Chrome-103
built-ins fail CI. The device profile (`R1_CHROMIUM_MAJOR`, viewport, JS
budget, `R1_JS_DENYLIST`) lives in [`r1.config.mjs`](../../r1.config.mjs) at
the repo root — not here — because vite configs, the static scan, and the
device-sim smoke all import it. Decision record:
[ADR-0013](../../docs/adr/0013-r1-compatibility-gate-ci.md).

## Develop

```sh
pnpm --filter r1-kit test        # vitest, happy-dom
pnpm --filter r1-kit typecheck
```
