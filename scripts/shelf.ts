// Testable units behind the bookshelf CLI (#11). The CLI keeps argument
// handling, git/gh orchestration, and output; these pure-ish units carry the
// decisions: staging (path rebasing derived from the app's build config), the
// shipped-version immutability guard, semver bump, and epub extraction through
// its normal interface (DOMParser injected, no globalThis mutation).

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_BASE } from '../apps/quickreader/app.config'
import { extractEpub, type DomParserCtor, type ExtractedBook } from '../apps/quickreader/src/ingestion/epub'

export const SHELF_BASE = '/r1-shelf/'

export function slugify(name: string): string {
  return name
    .replace(/\.epub$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function smallHash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

export function parseSemver(v: unknown): { major: number; minor: number; patch: number } {
  const m = /^\d+\.\d+\.\d+$/.exec(typeof v === 'string' ? v : '')
  if (!m) throw new Error(`version is not semver: ${v}`)
  const [major, minor, patch] = (m[0] as string).split('.').map(Number)
  return { major, minor, patch }
}

/** Increment and persist the app version; returns both ends for the CLI's message. */
export function bumpVersion(pkgPath: string, part: 'major' | 'minor' | 'patch'): { from: string; to: string } {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const from = parseSemver(pkg.version)
  const to =
    part === 'major'
      ? `${from.major + 1}.0.0`
      : part === 'minor'
        ? `${from.major}.${from.minor + 1}.0`
        : `${from.major}.${from.minor}.${from.patch + 1}`
  pkg.version = to
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  return { from: `${from.major}.${from.minor}.${from.patch}`, to }
}

/** A v/<ver>/ that already shipped is immutable — refuse to restage it. */
export function shippedVersion(stage: string, ver: string): boolean {
  return existsSync(join(stage, 'v', ver))
}

/**
 * Copy a built dist onto the shelf site: the app page becomes app.html and the
 * companion page becomes install.html, both rebased from the app's build base
 * (APP_BASE — the single source, imported from the app config) onto SHELF_BASE.
 * Every rebased reference — including hashed asset URLs — must resolve inside
 * the staged tree; that invariant is what the companion-page 404 regression
 * broke when the base string was hand-copied here.
 */
export function stageShelfSite(dist: string, site: string, ver: string): void {
  cpSync(dist + '/', site + '/', { recursive: true })
  rmSync(join(site, 'install.html'))
  rmSync(join(site, 'index.html'))
  const appHtml = readFileSync(join(dist, 'index.html'), 'utf8')
  const shelfHtml = appHtml
    .replaceAll(APP_BASE, SHELF_BASE)
    .replace('<title>QuickReader</title>', `<title>QuickReader shelf v${ver}</title>`)
  writeFileSync(join(site, 'app.html'), shelfHtml)
  const companion = readFileSync(join(site, 'shelf-install.html'), 'utf8').replaceAll(APP_BASE, SHELF_BASE)
  writeFileSync(join(site, 'install.html'), companion)
  rmSync(join(site, 'shelf-install.html'))
}

export function extractEpubFile(file: string, DP: DomParserCtor): Promise<ExtractedBook> {
  const bytes = new Uint8Array(readFileSync(file))
  return extractEpub(bytes, DP)
}
