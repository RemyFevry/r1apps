import { extractArticle, extractEpubDocument, NotArticleError, NotEpubError, type DocChapter } from 'r1-kit'
import type { DocKind, DocRecord, DocStorage } from '../store'

export const MAX_BYTES = 150 * 1024 * 1024

export type IngestErrorKind = 'bad-url' | 'network' | 'http' | 'too-large' | 'not-readable' | 'storage-full'

export class IngestError extends Error {
  constructor(
    public kind: IngestErrorKind,
    public status?: number,
  ) {
    super(kind)
  }
}

export type IngestedDoc = DocRecord

export function docId(url: string): string {
  let h = 5381
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0
  return h.toString(36) + '-' + Date.now().toString(36)
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 1000).toLowerCase()
  return head.includes('<!doctype html') || head.includes('<html') || head.includes('<body') || head.includes('<head')
}

export async function ingestDocument(storage: DocStorage, url: string): Promise<IngestedDoc> {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    throw new IngestError('bad-url')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new IngestError('bad-url')

  let res: Response
  try {
    res = await fetch(u.href)
  } catch {
    throw new IngestError('network')
  }
  if (!res.ok) throw new IngestError('http', res.status)

  const len = Number(res.headers.get('content-length') ?? 0)
  if (len > MAX_BYTES) throw new IngestError('too-large')
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length > MAX_BYTES) throw new IngestError('too-large')

  let kind: DocKind
  let title: string
  let author: string
  let chapters: DocChapter[]
  let wordCount: number

  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) {
    kind = 'epub'
    try {
      const book = await extractEpubDocument(buf)
      title = book.title
      author = book.author
      chapters = book.chapters
      wordCount = book.wordCount
    } catch (e) {
      if (e instanceof NotEpubError) throw new IngestError('not-readable')
      throw e
    }
  } else {
    kind = 'article'
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
    if (!looksLikeHtml(text)) throw new IngestError('not-readable')
    try {
      const art = extractArticle(text, { fallbackTitle: hostTitle(u) })
      title = art.title
      author = art.author
      chapters = art.chapters
      wordCount = art.wordCount
    } catch (e) {
      if (e instanceof NotArticleError) throw new IngestError('not-readable')
      throw e
    }
  }

  const record: DocRecord = {
    id: docId(u.href),
    title,
    author,
    chapters,
    wordCount,
    addedAt: Date.now(),
    sourceUrl: u.href,
    kind,
  }
  try {
    await storage.saveDoc(record)
  } catch {
    throw new IngestError('storage-full')
  }
  return record
}

function hostTitle(u: URL): string {
  return u.hostname.replace(/^www\./, '')
}

export function ingestErrorMessage(e: unknown): string {
  if (e instanceof IngestError) {
    switch (e.kind) {
      case 'bad-url':
        return 'That does not look like a web address'
      case 'network':
        return 'Could not fetch — check the URL, or the host may block cross-origin requests'
      case 'http':
        return `Server returned an error${e.status ? ' (' + e.status + ')' : ''}`
      case 'too-large':
        return 'Document too large (150 MB max)'
      case 'not-readable':
        return 'Not a readable EPUB or article page'
      case 'storage-full':
        return 'Storage full — delete a document from the library and try again'
    }
  }
  return 'Something went wrong'
}
