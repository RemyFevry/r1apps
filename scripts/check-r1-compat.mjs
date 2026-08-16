/**
 * Post-build R1 compatibility gate.
 *
 * Scans every built app (apps/<name>/dist) for things the R1's Android 13-era webview
 * (R1_CHROMIUM_MAJOR, see r1.config.mjs) cannot run:
 *
 *  1. JS built-ins newer than the target Chromium (esbuild transpiles *syntax*
 *     via build.target, but never polyfills *APIs* — those ship silently broken).
 *  2. CSS features newer than the target Chromium (vite does not gate CSS).
 *  3. HTML contract: viewport locked to width=240 + user-scalable=no, and zero
 *     external network resources (the R1 caches creations; CDN refs break offline).
 *  4. Bundle budget (weak CPU on device).
 *
 * Known gap: iterator helpers (.take()/.drop() on iterators) are method calls and
 * cannot be safely told apart from user methods in minified output, so they are
 * not grepped. The smoke suite deletes them (and every other denylist entry)
 * from the runtime before app code runs — see R1_JS_DENYLIST in r1.config.mjs.
 *
 * Run: node scripts/check-r1-compat.mjs   (after pnpm build; exits non-zero on any violation)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { R1_CHROMIUM_MAJOR, R1_JS_BUDGET_KB, R1_JS_DENYLIST } from '../r1.config.mjs'

const root = join(import.meta.dirname, '..')

// Scan half of the shared denylist (see r1.config.mjs); entries without a
// `scan` regex are runtime-only and enforced by the device-sim smoke instead.
const JS_SCANS = R1_JS_DENYLIST.flatMap((e) => (e.scan ? [{ label: e.label, minChrome: e.minChrome, re: new RegExp(e.scan.source, 'g') }] : []))

/** CSS features that postdate the R1 webview floor. [label, minChrome, regex] */
const CSS_DENYLIST = [
  [':has()', 105, /:has\s*\(/g],
  ['color-mix()', 111, /color-mix\s*\(/g],
  ['oklch()/oklab()/lch()/lab()', 111, /(?:oklch|oklab|lch|lab)\s*\(/gi],
  ['text-wrap', 114, /text-wrap\s*:/g],
  ['@scope', 118, /@scope\b/g],
  ['subgrid', 117, /\bsubgrid\b/g],
  [':user-valid/:user-invalid', 119, /:user-(?:in)?valid\b/g],
  ['selector & nesting', 112, /&/g],
  ['container queries', 105, /@container\b|container-type\s*:|container-name\s*:/g],
  ['field-sizing', 123, /field-sizing\s*:/g],
  [':nth-child(... of ...)', 111, /:nth-[a-z-]+\(\s*[^)]*\bof\b/g],
  ['round()/mod()', 125, /(?:^|[{;\s])(?:round|mod)\s*\(/g],
  ['prefers-reduced-transparency', 118, /prefers-reduced-transparency/g],
  ['external @import', 0, /@import\s+(?:url\()?\s*['"]?https?:\/\//g],
]

const violations = []
const report = (app, file, label, why, match) => {
  const line = match.index == null ? 1 : readFileSync(file, 'utf8').slice(0, match.index).split('\n').length
  const rel = relative(root, file)
  const snippet = match[0].length > 40 ? match[0].slice(0, 40) + '…' : match[0]
  violations.push(`${app}: ${rel}:${line}  ${label} (${why})  "${snippet}"`)
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

function checkApp(app, dist) {
  const files = [...walk(dist)]
  let jsBytes = 0

  for (const file of files) {
    const text = readFileSync(file, 'utf8')

    if (/\.(js|mjs)$/.test(file)) {
      jsBytes += statSync(file).size
      for (const { label, minChrome, re } of JS_SCANS) {
        for (const match of text.matchAll(re)) report(app, file, label, `needs Chrome ${minChrome}, R1 floor is ${R1_CHROMIUM_MAJOR}`, match)
      }
    }

    if (file.endsWith('.css')) {
      // Strip url(...) first: SVG data URIs legitimately contain `&` etc.
      const css = text.replace(/url\([^)]*\)/g, 'url()')
      for (const [label, minChrome, re] of CSS_DENYLIST) {
        for (const match of css.matchAll(re)) report(app, file, label, minChrome ? `needs Chrome ${minChrome}, R1 floor is ${R1_CHROMIUM_MAJOR}` : 'R1 apps must be self-contained', match)
      }
    }

    if (file.endsWith('.html')) {
      const viewport = text.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']*)["']/i)
      if (!viewport) {
        violations.push(`${app}: ${relative(root, file)}  missing viewport meta`)
      } else if (/index\.html$/.test(file)) {
        // index.html is the creation — it runs inside the R1 webview.
        if (!/width=240/.test(viewport[1])) violations.push(`${app}: ${relative(root, file)}  viewport width must be 240 (R1 screen), got "${viewport[1]}"`)
        if (!/user-scalable\s*=\s*no/.test(viewport[1])) violations.push(`${app}: ${relative(root, file)}  viewport must pin user-scalable=no (R1 has no touchscreen), got "${viewport[1]}"`)
      }
      for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']https?:\/\/[^"']+["']/gi)) {
        report(app, file, 'external resource', 'R1 apps must be self-contained (cached on device)', match)
      }
    }
  }

  const budgetBytes = R1_JS_BUDGET_KB * 1024
  if (jsBytes > budgetBytes) {
    violations.push(`${app}: JS budget exceeded — ${(jsBytes / 1024).toFixed(0)} KB > ${R1_JS_BUDGET_KB} KB (weak CPU on device; see r1.config.mjs)`)
  }
  return { files: files.length, jsBytes }
}

const apps = readdirSync(join(root, 'apps')).filter((name) => {
  try {
    return statSync(join(root, 'apps', name, 'dist')).isDirectory()
  } catch {
    return false
  }
})

if (!apps.length) {
  console.error('r1-compat: no apps/*/dist found — run `pnpm build` first')
  process.exit(1)
}

for (const app of apps) {
  const { files, jsBytes } = checkApp(app, join(root, 'apps', app, 'dist'))
  console.log(`r1-compat: ${app} — ${files} files, ${(jsBytes / 1024).toFixed(0)} KB JS — ${violations.length ? 'see violations' : 'clean'}`)
}

if (violations.length) {
  console.error(`\nr1-compat: ${violations.length} violation(s) against the R1 device profile (Chrome ${R1_CHROMIUM_MAJOR} floor):\n`)
  for (const v of violations) console.error(`  ✗ ${v}`)
  process.exit(1)
}
console.log(`\nr1-compat: all ${apps.length} app(s) compatible with the R1 device profile`)
