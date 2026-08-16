import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, test } from 'vitest'
import { APP_BASE } from '../app.config'
import { extractDocFile, shippedVersion, stageShelfSite } from '../../../scripts/shelf'
import type { DomParserCtor } from '../../../packages/r1-kit/src/epub'

const dirs: string[] = []
function tmp(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `sr-shelf-${name}-`))
  dirs.push(d)
  return d
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const STAGE = {
  appBase: APP_BASE,
  appTitle: 'SteadyReader',
  companion: 'shelf-install.html',
  dropFiles: ['install.html'],
}

function fixtureDist(): string {
  const dist = tmp('dist')
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(
    join(dist, 'index.html'),
    `<!doctype html><html><head><title>SteadyReader</title>` +
      `<script src="${APP_BASE}assets/main-AbC123.js"></script>` +
      `<link rel="stylesheet" href="${APP_BASE}assets/style-XyZ9.css"></head>` +
      `<body><div id="app"></div></body></html>`,
  )
  writeFileSync(join(dist, 'install.html'), `<html><body>r1apps companion ${APP_BASE}</body></html>`)
  writeFileSync(
    join(dist, 'shelf-install.html'),
    `<html><body>shelf companion <script src="${APP_BASE}assets/shelf-install-Qq0.js"></script></body></html>`,
  )
  writeFileSync(join(dist, 'assets', 'main-AbC123.js'), 'console.log("app")')
  writeFileSync(join(dist, 'assets', 'style-XyZ9.css'), 'body{margin:0}')
  writeFileSync(join(dist, 'assets', 'shelf-install-Qq0.js'), 'console.log("shelf")')
  return dist
}

describe('stageShelfSite (steadyreader)', () => {
  test('app page becomes rebased app.html with the shelf title; companions swap', () => {
    const dist = fixtureDist()
    const site = tmp('site')
    stageShelfSite(dist, site, '0.1.0', STAGE)
    const html = readFileSync(join(site, 'app.html'), 'utf8')
    expect(html).toContain('<title>SteadyReader shelf v0.1.0</title>')
    expect(html).not.toContain(APP_BASE)
    const install = readFileSync(join(site, 'install.html'), 'utf8')
    expect(install).toContain('shelf companion')
    expect(install).not.toContain(APP_BASE)
    for (const gone of ['index.html', 'shelf-install.html']) {
      expect(existsSync(join(site, gone))).toBe(false)
    }
    // hashed assets carried over
    expect(existsSync(join(site, 'assets', 'main-AbC123.js'))).toBe(true)
  })

  test('shippedVersion guard works on a staged tree', () => {
    const stage = tmp('stage')
    mkdirSync(join(stage, 'v', '0.1.0'), { recursive: true })
    expect(shippedVersion(stage, '0.1.0')).toBe(true)
    expect(shippedVersion(stage, '0.2.0')).toBe(false)
  })
})

describe('extractDocFile (r1-kit structured pipeline)', () => {
  test('extracts paragraphs, not word streams', async () => {
    const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Shelf Book</dc:title><dc:creator>Auth</dc:creator></metadata>
<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/></spine></package>`
    const ch = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Sentence one here. Sentence two follows.</p></body></html>`
    const epub = zipSync({
      'META-INF/container.xml': strToU8(container),
      'content.opf': strToU8(opf),
      'c1.xhtml': strToU8(ch),
    })
    const file = join(tmp('epub'), 'shelf-book.epub')
    writeFileSync(file, epub)
    // happy-dom's Document lives in its own type universe; runtime is what's under test here.
    const DP = new Window().DOMParser as unknown as DomParserCtor
    const doc = await extractDocFile(file, DP)
    expect(doc.title).toBe('Shelf Book')
    expect(doc.chapters[0].paragraphs).toEqual(['Sentence one here. Sentence two follows.'])
    expect(readdirSync(join(file, '..')).length).toBe(1)
  })
})
