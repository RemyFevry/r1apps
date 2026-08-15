import { unzip, type Chapter } from 'r1-kit'

export interface ExtractedBook {
  title: string
  author: string
  chapters: Chapter[]
  wordCount: number
}

export class NotEpubError extends Error {}

const WORD_RE = /["'(\[«]*[\p{L}\p{N}'’-]+[\])}"'’»…,;:!?.\-—–]*/gu
const BLOCK_SELECTOR = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,dd,td,pre'

export function wordsOf(text: string): string[] {
  return (text.replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').match(WORD_RE)) ?? []
}

export async function extractEpub(data: Uint8Array): Promise<ExtractedBook> {
  let files: Map<string, Uint8Array>
  try {
    files = await unzip(data)
  } catch (e) {
    throw new NotEpubError(e instanceof Error ? e.message : 'unreadable zip')
  }
  const dec = new TextDecoder('utf-8')
  const text = (name: string): string | null => {
    const f = files.get(name)
    return f ? dec.decode(f) : null
  }

  const containerRaw = text('META-INF/container.xml')
  if (!containerRaw) throw new NotEpubError('missing META-INF/container.xml')
  const container = parseXml(containerRaw)
  const rootfile = container.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  if (!rootfile) throw new NotEpubError('missing rootfile in container.xml')
  const opfDir = dirOf(rootfile)
  const opfRaw = text(rootfile)
  if (!opfRaw) throw new NotEpubError('missing package document ' + rootfile)
  const opf = parseXml(opfRaw)

  let title = ''
  let author = ''
  const metadata = opf.getElementsByTagName('metadata')[0]
  if (metadata) {
    for (const el of Array.from(metadata.getElementsByTagName('*'))) {
      const name = localNameOf(el)
      if (!title && name === 'title') title = (el.textContent ?? '').trim()
      else if (!author && name === 'creator') author = (el.textContent ?? '').trim()
    }
  }

  const items = new Map<string, { href: string; mediaType: string; properties: string }>()
  const manifest = opf.getElementsByTagName('manifest')[0]
  if (manifest) {
    for (const it of Array.from(manifest.getElementsByTagName('item'))) {
      const id = it.getAttribute('id') ?? ''
      const href = it.getAttribute('href') ?? ''
      items.set(id, {
        href: resolvePath(opfDir, stripFragment(href)),
        mediaType: it.getAttribute('media-type') ?? '',
        properties: it.getAttribute('properties') ?? '',
      })
    }
  }

  const spineEl = opf.getElementsByTagName('spine')[0]
  const hrefs: string[] = []
  if (spineEl) {
    for (const ir of Array.from(spineEl.getElementsByTagName('itemref'))) {
      if (ir.getAttribute('linear') === 'no') continue
      const it = items.get(ir.getAttribute('idref') ?? '')
      if (it && /xhtml|html/.test(it.mediaType)) hrefs.push(it.href)
    }
  }
  if (!hrefs.length) throw new NotEpubError('no spine documents')

  const titles = readTocTitles(text, items, spineEl)

  const chapters: Chapter[] = []
  for (const href of hrefs) {
    const raw = text(href)
    if (raw == null) continue
    const doc = parseChapterDoc(raw)
    const { words, paras } = extractWords(doc)
    if (!words.length) continue
    chapters.push({ title: titles.get(href) ?? `Chapter ${chapters.length + 1}`, words, paras })
  }
  if (!chapters.length) throw new NotEpubError('no readable text in spine documents')

  const wordCount = chapters.reduce((a, c) => a + c.words.length, 0)
  return { title: title || 'Untitled', author, chapters, wordCount }
}

function localNameOf(el: Element): string {
  const n = el.localName ?? el.nodeName
  const i = n.indexOf(':')
  return i < 0 ? n : n.slice(i + 1)
}

function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new NotEpubError('malformed xml')
  return doc
}

function parseChapterDoc(raw: string): Document {
  const doc = new DOMParser().parseFromString(raw, 'application/xhtml+xml')
  if (doc.getElementsByTagName('parsererror').length || !doc.getElementsByTagName('body').length) {
    return new DOMParser().parseFromString(raw, 'text/html')
  }
  return doc
}

function extractWords(doc: Document): { words: string[]; paras: number[] } {
  const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement
  const words: string[] = []
  const paras: number[] = []
  const all = Array.from(body.querySelectorAll(BLOCK_SELECTOR))
  const leafBlocks = all.filter((el) => !el.querySelector(BLOCK_SELECTOR))
  const blocks = leafBlocks.length ? leafBlocks : [body]
  for (const block of blocks) {
    const ws = wordsOf(block.textContent ?? '')
    if (!ws.length) continue
    paras.push(words.length)
    words.push(...ws)
  }
  return { words, paras }
}

function readTocTitles(
  text: (name: string) => string | null,
  items: Map<string, { href: string; mediaType: string; properties: string }>,
  spineEl: Element | undefined,
): Map<string, string> {
  const titles = new Map<string, string>()
  const put = (href: string, label: string) => {
    const t = label.replace(/\s+/g, ' ').trim()
    if (t && !titles.has(href)) titles.set(href, t)
  }
  const parser = new DOMParser()
  for (const it of items.values()) {
    if (!it.properties.split(/\s+/).includes('nav')) continue
    const raw = text(it.href)
    if (!raw) continue
    const doc = parser.parseFromString(raw, 'text/html')
    const base = dirOf(it.href)
    for (const a of Array.from(doc.getElementsByTagName('a'))) {
      const href = a.getAttribute('href')
      if (!href) continue
      put(resolvePath(base, stripFragment(href)), a.textContent ?? '')
    }
  }
  const tocId = spineEl?.getAttribute('toc')
  const ncx = tocId ? items.get(tocId) : undefined
  if (ncx) {
    const raw = text(ncx.href)
    if (raw) {
      const doc = parser.parseFromString(raw, 'application/xml')
      const base = dirOf(ncx.href)
      for (const np of Array.from(doc.getElementsByTagName('navPoint'))) {
        const content = np.getElementsByTagName('content')[0]
        const label = np.getElementsByTagName('text')[0]
        const src = content?.getAttribute('src')
        if (content && label && src) put(resolvePath(base, stripFragment(src)), label.textContent ?? '')
      }
    }
  }
  return titles
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

function stripFragment(href: string): string {
  const i = href.indexOf('#')
  return i < 0 ? href : href.slice(0, i)
}

function resolvePath(dir: string, href: string): string {
  if (/^[a-z]+:\/\//i.test(href) || href.startsWith('/')) return href
  const out: string[] = []
  for (const part of (dir + href).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return out.join('/')
}
