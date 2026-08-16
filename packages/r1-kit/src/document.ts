const ZERO_WIDTH = /[\u00AD\u200B-\u200D\uFEFF]/g
const WORD_RE = /["'(\[«“‘]*[\p{L}\p{N}'’-]+(?:\.[\p{L}\p{N}'’-]+)*[\])}"'’»…,;:!?.\-—–”]*/gu

const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'fig',
  'approx', 'dept', 'univ', 'inc', 'ltd', 'co', 'a.m', 'p.m', 'u.s', 'u.k',
])

export interface WordToken {
  text: string
  start: number
  end: number
}

export function normalizeText(text: string): string {
  return text.replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim()
}

export function wordsOf(text: string): string[] {
  return tokenizeWords(normalizeText(text)).map((t) => t.text)
}

export function tokenizeWords(text: string): WordToken[] {
  const out: WordToken[] = []
  for (const m of text.matchAll(WORD_RE)) {
    if (m[0]) out.push({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length })
  }
  return out
}

function endsSentenceToken(tok: string): boolean {
  if (/\.\.["')\]»”’]*$/.test(tok)) return false
  return /[.!?…]["')\]»”’]*$/.test(tok)
}

function isAbbreviation(tok: string): boolean {
  const stem = tok.replace(/[.!?…"'()\[\]«»“”’]+$/, '').toLowerCase()
  if (!stem) return false
  return ABBREV.has(stem) || (stem.length === 1 && /\p{L}/u.test(stem))
}

export function segmentSentences(paragraph: string): string[] {
  const text = normalizeText(paragraph)
  const toks = tokenizeWords(text)
  if (!toks.length) return []
  const sentences: string[] = []
  let first = 0
  for (let i = 0; i < toks.length; i++) {
    const last = i === toks.length - 1
    if (last || (endsSentenceToken(toks[i].text) && !isAbbreviation(toks[i].text))) {
      sentences.push(text.slice(toks[first].start, toks[i].end).trim())
      first = i + 1
    }
  }
  return sentences.filter((s) => s.length > 0)
}

export interface DocChapter {
  title: string
  paragraphs: string[]
}

export interface SentenceSpan {
  text: string
  words: WordToken[]
  wordOffset: number
  paraAfter: boolean
}

export interface ChapterIndex {
  sentences: SentenceSpan[]
  wordCount: number
}

export function buildChapterIndex(chapter: DocChapter): ChapterIndex {
  const sentences: SentenceSpan[] = []
  for (const para of chapter.paragraphs) {
    const parts = segmentSentences(para)
    if (!parts.length) continue
    for (let i = 0; i < parts.length; i++) {
      sentences.push({
        text: parts[i],
        words: tokenizeWords(parts[i]),
        wordOffset: 0,
        paraAfter: i === parts.length - 1,
      })
    }
  }
  let offset = 0
  for (const s of sentences) {
    s.wordOffset = offset
    offset += s.words.length
  }
  return { sentences, wordCount: offset }
}

export function sentenceAt(ci: ChapterIndex, wordIndex: number): { sentence: number; wordInSentence: number } {
  const clamped = Math.min(Math.max(wordIndex, 0), Math.max(ci.wordCount - 1, 0))
  let lo = 0
  let hi = ci.sentences.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ci.sentences[mid].wordOffset <= clamped) lo = mid
    else hi = mid - 1
  }
  return { sentence: lo, wordInSentence: clamped - ci.sentences[lo].wordOffset }
}
