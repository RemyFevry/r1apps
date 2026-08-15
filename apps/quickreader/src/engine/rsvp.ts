import type { Pacing } from 'r1-kit'

const PACE_SCALE: Record<Pacing, number> = { relaxed: 1.4, standard: 1, snappy: 0.75 }
const SENTENCE = 2.2
const CLAUSE = 1.5
const PARAGRAPH = 3.5
const LONG_THRESHOLD = 8
const LONG_MS_PER_CHAR = 0.06
const MAX_LONG_FACTOR = 2

export function baseDelay(wpm: number): number {
  return 60000 / wpm
}

export function endsSentence(w: string): boolean {
  return /[.!?…]["')\]»]*$/.test(w)
}

export function endsClause(w: string): boolean {
  return /[,;:—–]["')\]»]*$/.test(w)
}

function scaled(ms: number, mult: number, paceScale: number): number {
  return ms * (1 + (mult - 1) * paceScale)
}

export function delayFor(word: string, opts: { wpm: number; pacing: Pacing; nextIsPara: boolean }): number {
  const base = baseDelay(opts.wpm)
  const s = PACE_SCALE[opts.pacing]
  let ms = base
  if (endsSentence(word)) ms = scaled(ms, SENTENCE, s)
  else if (endsClause(word)) ms = scaled(ms, CLAUSE, s)
  if (word.length > LONG_THRESHOLD) {
    const extra = base * (word.length - LONG_THRESHOLD) * LONG_MS_PER_CHAR
    ms = Math.min(ms + extra, base * MAX_LONG_FACTOR)
  }
  if (opts.nextIsPara) ms = Math.max(ms, scaled(base, PARAGRAPH, s))
  return ms
}

export function orpIndex(word: string): number {
  const len = Array.from(word).length
  if (len <= 1) return 0
  if (len <= 5) return 1
  if (len <= 9) return 2
  if (len <= 13) return 3
  return 4
}

export function sentenceStart(words: string[], from: number): number {
  let i = Math.min(Math.max(from, 0), words.length - 1)
  while (i > 0 && !endsSentence(words[i - 1])) i--
  return i
}

export function previousSentenceStart(words: string[], i: number): number {
  const cur = sentenceStart(words, i)
  if (i > cur) return cur
  if (cur === 0) return 0
  return sentenceStart(words, cur - 1)
}

/** Word index of a chapter start, clamped. */
export function chapterStart(chapter: { words: string[] }, wordIndex: number): number {
  return Math.min(Math.max(wordIndex, 0), chapter.words.length - 1)
}

/** Jump chapters with position carry: same relative fraction, or ends. */
export function jumpChapter(
  chapters: { words: string[] }[],
  from: { chapter: number; wordIndex: number },
  delta: number,
): { chapter: number; wordIndex: number } {
  const target = Math.min(Math.max(from.chapter + delta, 0), chapters.length - 1)
  if (target === from.chapter) {
    return { chapter: from.chapter, wordIndex: chapterStart(chapters[from.chapter], from.wordIndex) }
  }
  const frac = chapters[from.chapter].words.length > 1 ? from.wordIndex / (chapters[from.chapter].words.length - 1) : 0
  const targetWords = chapters[target].words.length
  const wordIndex = delta > 0 ? Math.round(frac * (targetWords - 1)) : delta < 0 ? Math.round(frac * (targetWords - 1)) : 0
  return { chapter: target, wordIndex: Math.max(0, Math.min(wordIndex, targetWords - 1)) }
}
