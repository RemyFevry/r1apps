import { describe, expect, test, vi } from 'vitest'
import { MemoryStorage } from 'r1-kit'
import { ingestBook, IngestError } from '../src/ingestion/ingest'
import { zipSync, strToU8 } from 'fflate'

function epubBytes(): Uint8Array {
  const container = `<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Tiny</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`
  const c1 = `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello speed reading world</p></body></html>`
  return zipSync({
    'META-INF/container.xml': strToU8(container),
    'content.opf': strToU8(opf),
    'c1.xhtml': strToU8(c1),
  })
}

function okFetch(bytes: Uint8Array, headers: Record<string, string> = {}) {
  return vi.fn(async () => new Response(bytes as BodyInit, { headers }))
}

describe('ingestBook', () => {
  test('fetches, extracts, stores and returns the record', async () => {
    const storage = new MemoryStorage()
    globalThis.fetch = okFetch(epubBytes(), { 'content-type': 'application/epub+zip' })
    const rec = await ingestBook(storage, 'https://example.com/tiny.epub')
    expect(rec.title).toBe('Tiny')
    expect(rec.wordCount).toBe(4)
    expect(await storage.loadBook(rec.id)).toEqual(rec)
    expect((await storage.listBooks()).map((m) => m.id)).toEqual([rec.id])
  })

  test('rejects non-http schemes', async () => {
    await expect(ingestBook(new MemoryStorage(), 'ftp://x/y.epub')).rejects.toMatchObject({ kind: 'bad-url' })
  })

  test('rejects unparseable urls', async () => {
    await expect(ingestBook(new MemoryStorage(), 'not a url')).rejects.toBeInstanceOf(IngestError)
  })

  test('rejects non-zip payloads', async () => {
    globalThis.fetch = okFetch(strToU8('<html>just a page</html>'), { 'content-type': 'text/html' })
    await expect(ingestBook(new MemoryStorage(), 'https://example.com/x')).rejects.toMatchObject({ kind: 'not-epub' })
  })

  test('surfaces http errors', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 }))
    await expect(ingestBook(new MemoryStorage(), 'https://example.com/gone.epub')).rejects.toMatchObject({ kind: 'http', status: 404 })
  })

  test('surfaces network failures', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('cors blocked')
    })
    await expect(ingestBook(new MemoryStorage(), 'https://example.com/x.epub')).rejects.toMatchObject({ kind: 'network' })
  })
})
