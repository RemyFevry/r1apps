// Testable units behind the bookshelf CLI (#11). The CLI keeps argument
// handling, git/gh orchestration, and output; these pure-ish units carry the
// decisions: staging (path rebasing derived from the app's build config), the
// shipped-version immutability guard, semver bump, and epub extraction through
// its normal interface (DOMParser injected, no globalThis mutation).

import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_BASE } from '../apps/quickreader/app.config'
import { extractEpub, type DomParserCtor, type ExtractedBook } from '../apps/quickreader/src/ingestion/epub'
import { extractEpubDocument, type ExtractedDocument } from '../packages/r1-kit/src/epub'

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

/** Per-app staging facts: every app on the shelf brings its own base/title/companion. */
export interface StageAppOpts {
  /** The app's vite base — the single source lives in its app.config.ts. */
  appBase: string
  /** The app's shelf base: the site-root path its shelf repo serves at. */
  shelfBase: string
  /** <title> of the app page; becomes "<title> shelf v<ver>" on the shelf. */
  appTitle: string
  /** The dist file that becomes the shelf's install.html (quickreader stages a dedicated companion). */
  companion: string
  /** Dist files the shelf doesn't want (quickreader drops its r1apps companion). */
  dropFiles: string[]
}

export const QUICKREADER_STAGE: StageAppOpts = {
  appBase: APP_BASE,
  shelfBase: SHELF_BASE,
  appTitle: 'QuickReader',
  companion: 'shelf-install.html',
  dropFiles: ['install.html'],
}

export function stageShelfSite(dist: string, site: string, ver: string, opts: StageAppOpts = QUICKREADER_STAGE): void {
  cpSync(dist + '/', site + '/', { recursive: true })
  for (const f of opts.dropFiles) rmSync(join(site, f))
  const appHtml = readFileSync(join(dist, 'index.html'), 'utf8')
  const shelfHtml = appHtml
    .replaceAll(opts.appBase, opts.shelfBase)
    .replace(`<title>${opts.appTitle}</title>`, `<title>${opts.appTitle} shelf v${ver}</title>`)
  writeFileSync(join(site, 'app.html'), shelfHtml)
  rmSync(join(site, 'index.html'))
  const companion = readFileSync(join(site, opts.companion), 'utf8').replaceAll(opts.appBase, opts.shelfBase)
  writeFileSync(join(site, 'install.html'), companion)
  rmSync(join(site, opts.companion))
}

export function extractEpubFile(file: string, DP: DomParserCtor): Promise<ExtractedBook> {
  const bytes = new Uint8Array(readFileSync(file))
  return extractEpub(bytes, DP)
}

/** steadyreader extracts through the r1-kit structured-document pipeline (ADR-0008). */
export function extractDocFile(file: string, DP: DomParserCtor): Promise<ExtractedDocument> {
  const bytes = new Uint8Array(readFileSync(file))
  return extractEpubDocument(bytes, DP)
}

/**
 * happy-dom's XML parser rejects single-quoted XML declarations (`<?xml
 * version='1.0'` — legal XML that browsers and the R1 webview accept). Real
 * EPUBs in the wild ship them, so the CLI normalizes the declaration to double
 * quotes before any xml parse. Browser code never needs this.
 */
export function lenientDomParser(win: { DOMParser: DomParserCtor }): DomParserCtor {
  const DP = win.DOMParser
  return class {
    parseFromString(xml: string, type: DOMParserSupportedType): Document {
      if (type === 'application/xml' || type === 'application/xhtml+xml') {
        xml = xml.replace(/^<\?xml\s+version='([^']*)'/, `<?xml version="$1"`)
      }
      return new DP().parseFromString(xml, type) as unknown as Document
    }
  } as unknown as DomParserCtor
}
