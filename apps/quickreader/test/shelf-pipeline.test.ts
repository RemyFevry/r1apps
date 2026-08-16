import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, test } from 'vitest'
import { APP_BASE } from '../app.config'
import type { DomParserCtor } from '../src/ingestion/epub'
import { bumpVersion, extractEpubFile, shippedVersion, stageShelfSite, SHELF_BASE } from '../../../scripts/shelf'

const dirs: string[] = []
function tmp(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `r1-shelf-${name}-`))
  dirs.push(d)
  return d
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function fixtureDist(): string {
  const dist = tmp('dist')
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(
    join(dist, 'index.html'),
    `<!doctype html><html><head><title>QuickReader</title>` +
      `<script src="${APP_BASE}assets/main-AbC123.js"></script>` +
      `<link rel="stylesheet" href="${APP_BASE}assets/style-XyZ9.css"></head>` +
      `<body><div id="app"></div></body></html>`,
  )
  writeFileSync(join(dist, 'install.html'), `<html><body>app install page ${APP_BASE}</body></html>`)
  writeFileSync(
    join(dist, 'shelf-install.html'),
    `<html><body>shelf companion <script src="${APP_BASE}assets/shelf-install-Qq0.js"></script></body></html>`,
  )
  writeFileSync(join(dist, 'assets', 'main-AbC123.js'), 'console.log("app")')
  writeFileSync(join(dist, 'assets', 'style-XyZ9.css'), 'body{margin:0}')
  writeFileSync(join(dist, 'assets', 'shelf-install-Qq0.js'), 'console.log("shelf")')
  return dist
}

describe('stageShelfSite', () => {
  test('app page becomes rebased app.html with the shelf title', () => {
    const dist = fixtureDist()
    const site = tmp('site')
    stageShelfSite(dist, site, '1.2.3')
    const html = readFileSync(join(site, 'app.html'), 'utf8')
    expect(html).toContain('<title>QuickReader shelf v1.2.3</title>')
    expect(html).toContain(`src="${SHELF_BASE}assets/main-AbC123.js"`)
    expect(html).toContain(`href="${SHELF_BASE}assets/style-XyZ9.css"`)
    expect(html).not.toContain(APP_BASE)
  })

  test('companion page becomes install.html; originals are gone', () => {
    const dist = fixtureDist()
    const site = tmp('site')
    stageShelfSite(dist, site, '1.2.3')
    const html = readFileSync(join(site, 'install.html'), 'utf8')
    expect(html).toContain(`src="${SHELF_BASE}assets/shelf-install-Qq0.js"`)
    expect(html).not.toContain(APP_BASE)
    const entries = readdirSync(site).sort()
    expect(entries).toEqual(['app.html', 'assets', 'install.html'])
  })

  test('every rebased reference resolves inside the staged tree (the 404 regression)', () => {
    const dist = fixtureDist()
    const site = tmp('site')
    stageShelfSite(dist, site, '1.2.3')
    for (const page of ['app.html', 'install.html']) {
      const html = readFileSync(join(site, page), 'utf8')
      const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => r.startsWith(SHELF_BASE))
      expect(refs.length).toBeGreaterThan(0)
      for (const ref of refs) {
        const rel = ref.slice(SHELF_BASE.length)
        expect(existsSync(join(site, rel)), `${page} → ${ref}`).toBe(true)
      }
    }
  })
})

describe('shippedVersion — immutability guard', () => {
  test('a shipped v/<ver>/ is refused; the next semver is not', () => {
    const stage = tmp('stage')
    expect(shippedVersion(stage, '0.6.4')).toBe(false)
    mkdirSync(join(stage, 'v', '0.6.4'), { recursive: true })
    expect(shippedVersion(stage, '0.6.4')).toBe(true)
    expect(shippedVersion(stage, '0.6.5')).toBe(false)
  })
})

describe('bumpVersion', () => {
  test('patch / minor / major round-trip with package.json formatting', () => {
    const pkgPath = join(tmp('pkg'), 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ name: 'quickreader', version: '1.2.3' }, null, 2) + '\n')
    expect(bumpVersion(pkgPath, 'patch')).toEqual({ from: '1.2.3', to: '1.2.4' })
    expect(bumpVersion(pkgPath, 'minor')).toEqual({ from: '1.2.4', to: '1.3.0' })
    expect(bumpVersion(pkgPath, 'major')).toEqual({ from: '1.3.0', to: '2.0.0' })
    const raw = readFileSync(pkgPath, 'utf8')
    expect(raw.endsWith('\n')).toBe(true)
    expect(JSON.parse(raw)).toEqual({ name: 'quickreader', version: '2.0.0' })
  })

  test('non-semver version throws', () => {
    const pkgPath = join(tmp('pkg'), 'package.json')
    writeFileSync(pkgPath, JSON.stringify({ version: 'dev' }))
    expect(() => bumpVersion(pkgPath, 'patch')).toThrow(/not semver/)
  })
})

describe('extractEpubFile', () => {
  test('parses through the injected DOMParser — no globalThis mutation', async () => {
    const files: Record<string, string> = {
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Pipeline Book</dc:title></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
      'OEBPS/ch1.xhtml': `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello shelf world.</p></body></html>`,
    }
    const epubPath = join(tmp('epub'), 'book.epub')
    writeFileSync(epubPath, zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))))
    const g = globalThis as { DOMParser?: unknown }
    const saved = g.DOMParser
    delete g.DOMParser
    try {
      // happy-dom's Document lives in its own type universe; runtime is what's under test here.
      const DP = new Window().DOMParser as unknown as DomParserCtor
      const book = await extractEpubFile(epubPath, DP)
      expect(book.title).toBe('Pipeline Book')
      expect(book.chapters[0].words).toEqual(['Hello', 'shelf', 'world.'])
    } finally {
      if (saved !== undefined) g.DOMParser = saved
    }
  })
})
