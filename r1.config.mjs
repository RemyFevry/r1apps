/**
 * Single source of truth for Rabbit R1 device compatibility.
 *
 * Everything that gates a build against the device reads these constants:
 * vite build targets, the post-build static scan (scripts/check-r1-compat.mjs),
 * and the device-sim smoke suite (playwright.config.ts).
 *
 * The R1 webview is Android 13-era Chromium. docs/research/epub-parsing-approach.md
 * pins the safe floor at Chrome 103 (Dec 2022) because the exact webview build
 * on the device is not independently verifiable. If a device report ever proves
 * a higher floor, bump R1_CHROMIUM_MAJOR here — and only here.
 */
export const R1_CHROMIUM_MAJOR = 103

/** esbuild/vite build target. Syntax newer than this either transpiles down or fails the build. */
export const R1_BUILD_TARGET = `chrome${R1_CHROMIUM_MAJOR}`

/** Physical webview size, in CSS pixels. */
export const R1_VIEWPORT = { width: 240, height: 282 }

/** Total JS budget per app (KB, uncompressed). Weak CPU on device; books inlined vary, so this catches step changes. */
export const R1_JS_BUDGET_KB = 1500
