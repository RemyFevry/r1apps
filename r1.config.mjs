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

/**
 * JS built-ins that postdate the R1 webview floor. One list, two consumers:
 *
 * - `scan` (RegExp): the static scan (scripts/check-r1-compat.mjs) greps dist
 *   bundles for call sites — catches usage before the app even boots.
 * - `path` (dotted property path): the device-sim smoke deletes the property
 *   before app code runs, so runtime usage (invisible to grep) throws and
 *   fails the smoke test.
 *
 * Entries may omit `scan` when the pattern cannot be grepped safely — e.g.
 * iterator helpers (`.take(`) collide with same-named user methods — and omit
 * `path` when there is nothing to delete (e.g. the `"scrollend"` event name).
 */
export const R1_JS_DENYLIST = [
  { label: 'Promise.withResolvers', minChrome: 119, path: 'Promise.withResolvers', scan: /Promise\s*\.\s*withResolvers\b/ },
  { label: 'Promise.try', minChrome: 128, path: 'Promise.try', scan: /Promise\s*\.\s*try\s*\(/ },
  { label: 'Array.fromAsync', minChrome: 121, path: 'Array.fromAsync', scan: /Array\s*\.\s*fromAsync\s*\(/ },
  { label: 'Object.groupBy', minChrome: 117, path: 'Object.groupBy', scan: /Object\s*\.\s*groupBy\s*\(/ },
  { label: 'Map.groupBy', minChrome: 117, path: 'Map.groupBy', scan: /Map\s*\.\s*groupBy\s*\(/ },
  { label: 'RegExp.escape', minChrome: 136, path: 'RegExp.escape', scan: /RegExp\s*\.\s*escape\s*\(/ },
  { label: 'URL.canParse', minChrome: 132, path: 'URL.canParse', scan: /URL\s*\.\s*canParse\s*\(/ },
  { label: 'AbortSignal.any', minChrome: 116, path: 'AbortSignal.any', scan: /AbortSignal\s*\.\s*any\s*\(/ },
  { label: 'Array.prototype.toSorted', minChrome: 110, path: 'Array.prototype.toSorted', scan: /\.\s*toSorted\s*\(/ },
  { label: 'Array.prototype.toSpliced', minChrome: 110, path: 'Array.prototype.toSpliced', scan: /\.\s*toSpliced\s*\(/ },
  { label: 'Array.prototype.toReversed', minChrome: 110, path: 'Array.prototype.toReversed', scan: /\.\s*toReversed\s*\(/ },
  { label: 'Array.prototype.with', minChrome: 110, path: 'Array.prototype.with', scan: /\.\s*with\s*\(/ },
  { label: 'String.prototype.toWellFormed', minChrome: 121, path: 'String.prototype.toWellFormed', scan: /\.\s*toWellFormed\s*\(/ },
  { label: 'String.prototype.isWellFormed', minChrome: 121, path: 'String.prototype.isWellFormed', scan: /\.\s*isWellFormed\s*\(/ },
  { label: 'HTMLElement.showPopover', minChrome: 114, path: 'HTMLElement.prototype.showPopover', scan: /\.\s*showPopover\s*\(/ },
  { label: 'HTMLElement.hidePopover', minChrome: 114, path: 'HTMLElement.prototype.hidePopover', scan: /\.\s*hidePopover\s*\(/ },
  { label: 'document.startViewTransition', minChrome: 111, path: 'Document.prototype.startViewTransition', scan: /\.\s*startViewTransition\s*\(/ },
  { label: '"scrollend" event', minChrome: 114, path: null, scan: /['"]scrollend['"]/ },
  // Iterator helpers: runtime-only (method names collide with user code in grep).
  { label: 'Iterator.prototype.take', minChrome: 122, path: 'Iterator.prototype.take', scan: null },
  { label: 'Iterator.prototype.drop', minChrome: 122, path: 'Iterator.prototype.drop', scan: null },
  { label: 'Iterator.prototype.flatMap', minChrome: 122, path: 'Iterator.prototype.flatMap', scan: null },
  { label: 'Iterator.prototype.map', minChrome: 122, path: 'Iterator.prototype.map', scan: null },
  { label: 'Iterator.prototype.filter', minChrome: 122, path: 'Iterator.prototype.filter', scan: null },
  { label: 'Iterator.prototype.toArray', minChrome: 122, path: 'Iterator.prototype.toArray', scan: null },
  { label: 'Iterator.prototype.forEach', minChrome: 122, path: 'Iterator.prototype.forEach', scan: null },
  { label: 'Iterator.prototype.reduce', minChrome: 122, path: 'Iterator.prototype.reduce', scan: null },
]
