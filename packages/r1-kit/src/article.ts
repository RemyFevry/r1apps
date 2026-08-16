import { normalizeText, wordsOf, type DocChapter } from './document'

export interface ExtractedArticle {
  title: string
  author: string
  chapters: DocChapter[]
  wordCount: number
}

export class NotArticleError extends Error {}

const STRIP = 'script,style,nav,aside,header,footer,form,noscript,iframe,svg,button,figure'
const BLOCKS = 'p,h2,h3,li,blockquote,dd,td,pre'
const MIN_WORDS = 10

export function extractArticle(html: string, opts?: { fallbackTitle?: string }): ExtractedArticle {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const title =
    metaContent(doc, 'meta[property="og:title"]') ||
    metaContent(doc, 'meta[name="twitter:title"]') ||
    normalizeText(doc.querySelector('title')?.textContent ?? '') ||
    normalizeText(doc.querySelector('h1')?.textContent ?? '') ||
    opts?.fallbackTitle ||
    'Untitled article'
  const author = metaContent(doc, 'meta[name="author"]') || ''

  const root =
    doc.querySelector('article') ??
    doc.querySelector('[role="main"]') ??
    doc.querySelector('main') ??
    doc.querySelector('#content') ??
    doc.body

  for (const el of Array.from(root.querySelectorAll(STRIP))) el.remove()

  const chapters: DocChapter[] = [{ title: 'Intro', paragraphs: [] }]
  const blocks = Array.from(root.querySelectorAll(BLOCKS)).filter((el) => !el.querySelector(BLOCKS))
  for (const block of blocks) {
    const tag = elTag(block)
    const text = normalizeText(block.textContent ?? '')
    if (!text) continue
    if (tag === 'h2' || tag === 'h3') {
      chapters.push({ title: text, paragraphs: [] })
      continue
    }
    chapters[chapters.length - 1].paragraphs.push(text)
  }

  const kept = chapters.filter((c) => c.paragraphs.length > 0)
  if (!kept.length) throw new NotArticleError('no readable text in page')
  if (kept.length === 1 && kept[0].title === 'Intro') kept[0].title = title

  const wordCount = kept.reduce(
    (a, c) => a + c.paragraphs.reduce((b, p) => b + wordsOf(p).length, 0),
    0,
  )
  if (wordCount < MIN_WORDS) throw new NotArticleError('too little readable text in page')

  return { title, author, chapters: kept, wordCount }
}

function elTag(el: Element): string {
  return (el.localName ?? el.nodeName).toLowerCase()
}

function metaContent(doc: Document, selector: string): string {
  return normalizeText(doc.querySelector(selector)?.getAttribute('content') ?? '')
}
