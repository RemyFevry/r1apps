import { describe, expect, it, vi } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { extractArticle, extractEpubDocument } from 'r1-kit'
import { ingestDocument, ingestErrorMessage, IngestError, type IngestedDoc } from '../src/ingestion/ingest'
import { MemoryDocStorage } from '../src/store'

vi.mock('r1-kit', async (orig) => {
  const real = await orig<typeof import('r1-kit')>()
  return { ...real }
})

const epubFixture = (() => {
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Zip Book</dc:title><dc:creator>Auth</dc:creator></metadata>
<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/></spine></package>`
  const ch = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Sentence one here. Sentence two follows.</p></body></html>`
  return zipSync({
    'META-INF/container.xml': strToU8(container),
    'content.opf': strToU8(opf),
    'c1.xhtml': strToU8(ch),
  })
})()

const articleHtml = `<!doctype html><html><head><title>Art</title></head><body><article>
<h2>Section</h2><p>Article body words. Enough of them to pass the minimum word count easily now.</p>
</article></body></html>`

function res(bytes: Uint8Array | string, type: string): Response {
  const body = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  return new Response(body.slice().buffer as ArrayBuffer, { headers: { 'content-type': type } })
}

async function run(fetchImpl: typeof fetch, url: string): Promise<IngestedDoc> {
  vi.stubGlobal('fetch', fetchImpl)
  const storage = new MemoryDocStorage()
  const doc = await ingestDocument(storage, url)
  const stored = await storage.loadDoc(doc.id)
  expect(stored).toEqual(doc)
  return doc
}

describe('ingestDocument', () => {
  it('ingests an EPUB by PK magic bytes into a structured document', async () => {
    const doc = await run(vi.fn(() => Promise.resolve(res(epubFixture, 'application/epub+zip'))), 'https://x.test/b.epub')
    expect(doc.kind).toBe('epub')
    expect(doc.title).toBe('Zip Book')
    expect(doc.chapters[0].paragraphs).toEqual(['Sentence one here. Sentence two follows.'])
  })

  it('ingests an HTML page as an article with headings as chapters', async () => {
    const doc = await run(vi.fn(() => Promise.resolve(res(articleHtml, 'text/html'))), 'https://x.test/a')
    expect(doc.kind).toBe('article')
    expect(doc.chapters.map((c) => c.title)).toEqual(['Section'])
    expect(doc.wordCount).toBeGreaterThan(10)
  })

  it('rejects non-document payloads', async () => {
    await expect(
      run(vi.fn(() => Promise.resolve(res('just plain text, nothing else', 'text/plain'))), 'https://x.test/t'),
    ).rejects.toMatchObject({ kind: 'not-readable' })
  })

  it('maps fetch failures to network errors with a CORS-aware message', async () => {
    await expect(run(vi.fn(() => Promise.reject(new Error('cors'))), 'https://x.test/a')).rejects.toMatchObject({
      kind: 'network',
    })
    expect(ingestErrorMessage(new IngestError('network'))).toContain('cross-origin')
  })

  it('maps http status and bad urls', async () => {
    await expect(
      run(vi.fn(() => Promise.resolve(new Response('no', { status: 404 }))), 'https://x.test/a'),
    ).rejects.toMatchObject({ kind: 'http', status: 404 })
    await expect(run(vi.fn(), 'not a url')).rejects.toMatchObject({ kind: 'bad-url' })
  })

  it('maps storage failures to storage-full', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(res(articleHtml, 'text/html'))))
    const boom = {
      saveDoc: () => Promise.reject(new Error('quota')),
    } as unknown as import('../src/store').DocStorage
    await expect(ingestDocument(boom, 'https://x.test/a')).rejects.toMatchObject({ kind: 'storage-full' })
  })
})

describe('extraction sanity through the real r1-kit pipeline', () => {
  it('article extraction is what ingestion stores', () => {
    const art = extractArticle(articleHtml)
    expect(art.title).toBe('Art')
    expect(art.chapters.length).toBe(1)
  })

  it('epub extraction is what ingestion stores', async () => {
    const book = await extractEpubDocument(epubFixture)
    expect(book.wordCount).toBe(6)
  })
})
