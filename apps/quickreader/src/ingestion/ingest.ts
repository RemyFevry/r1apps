import type { BookRecord, Storage } from 'r1-kit'
import { extractEpub, NotEpubError } from './epub'

export const MAX_BYTES = 150 * 1024 * 1024

export type IngestErrorKind = 'bad-url' | 'network' | 'http' | 'too-large' | 'not-epub' | 'storage-full'

export class IngestError extends Error {
  constructor(
    public kind: IngestErrorKind,
    public status?: number,
  ) {
    super(kind)
  }
}

export function bookId(url: string): string {
  let h = 5381
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0
  return h.toString(36) + '-' + Date.now().toString(36)
}

export async function ingestBook(storage: Storage, url: string): Promise<BookRecord> {
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
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new IngestError('not-epub')

  let extracted
  try {
    extracted = await extractEpub(buf)
  } catch (e) {
    if (e instanceof NotEpubError) throw new IngestError('not-epub')
    throw e
  }

  const record: BookRecord = {
    id: bookId(u.href),
    title: extracted.title,
    author: extracted.author,
    chapters: extracted.chapters,
    wordCount: extracted.wordCount,
    addedAt: Date.now(),
    sourceUrl: u.href,
  }
  try {
    await storage.saveBook(record)
  } catch {
    throw new IngestError('storage-full')
  }
  return record
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
        return 'Book too large (150 MB max)'
      case 'not-epub':
        return 'Not a readable EPUB'
      case 'storage-full':
        return 'Storage full — delete a book from the library and try again'
    }
  }
  return 'Something went wrong'
}
