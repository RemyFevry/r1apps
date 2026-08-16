import { describe, expect, it } from 'vitest'
import { buildChapterIndex, segmentSentences, sentenceAt, tokenizeWords, wordsOf } from '../src/document'

describe('buildChapterIndex', () => {
  const chapter = {
    title: 'Ch 1',
    paragraphs: ['One. Two!', 'Three? Four... five.'],
  }
  const ci = buildChapterIndex(chapter)

  it('segments per paragraph — a sentence never crosses a paragraph boundary', () => {
    expect(ci.sentences.map((s) => s.text)).toEqual(['One.', 'Two!', 'Three?', 'Four... five.'])
  })

  it('carries flat word offsets across paragraphs', () => {
    expect(ci.sentences.map((s) => s.wordOffset)).toEqual([0, 1, 2, 3])
    expect(ci.wordCount).toBe(5)
  })

  it('marks the last sentence of each paragraph with paraAfter', () => {
    expect(ci.sentences.map((s) => s.paraAfter)).toEqual([false, true, false, true])
  })

  it('gives each sentence word spans true to its text', () => {
    for (const s of ci.sentences) {
      expect(s.words.map((w) => w.text)).toEqual(wordsOf(s.text))
      for (const w of s.words) expect(s.text.slice(w.start, w.end)).toBe(w.text)
    }
  })

  it('maps a flat wordIndex to its sentence and word-in-sentence (ADR-0009)', () => {
    expect(sentenceAt(ci, 0)).toEqual({ sentence: 0, wordInSentence: 0 })
    expect(sentenceAt(ci, 1)).toEqual({ sentence: 1, wordInSentence: 0 })
    expect(sentenceAt(ci, 4)).toEqual({ sentence: 3, wordInSentence: 1 })
  })

  it('clamps out-of-range word indices', () => {
    expect(sentenceAt(ci, 99)).toEqual({ sentence: 3, wordInSentence: 1 })
    expect(sentenceAt(ci, -5)).toEqual({ sentence: 0, wordInSentence: 0 })
  })

  it('skips empty paragraphs', () => {
    const ci2 = buildChapterIndex({ title: '', paragraphs: ['', '  ', 'Hi.'] })
    expect(ci2.sentences.map((s) => s.text)).toEqual(['Hi.'])
  })
})


describe('tokenizeWords', () => {
  it('tokenizes with char offsets that rebuild the sentence', () => {
    const text = '“Hello, world!” she said.'
    const toks = tokenizeWords(text)
    expect(toks.map((t) => t.text)).toEqual(wordsOf(text))
    for (const t of toks) expect(text.slice(t.start, t.end)).toBe(t.text)
  })

  it('normalizes whitespace-only and zero-width characters away', () => {
    expect(wordsOf('a\u00AD\u200Bb   c')).toEqual(['ab', 'c'])
  })

  it('returns an empty array for blank text', () => {
    expect(tokenizeWords('  \n\t ')).toEqual([])
  })
})

describe('segmentSentences', () => {
  it('splits on sentence-ending punctuation, keeping the punctuation', () => {
    expect(segmentSentences('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?'])
  })

  it('keeps trailing quotes and brackets attached', () => {
    expect(segmentSentences('He said “stop.” Then left.')).toEqual(['He said “stop.”', 'Then left.'])
  })

  it('does not split after common abbreviations and initials', () => {
    expect(segmentSentences('Mrs. Watson met Dr. Smith at 8 a.m. today.')).toEqual([
      'Mrs. Watson met Dr. Smith at 8 a.m. today.',
    ])
    expect(segmentSentences('J. R. R. Tolkien wrote it.')).toEqual(['J. R. R. Tolkien wrote it.'])
  })

  it('splits after a sentence end followed by a lowercase start anyway (hard boundary)', () => {
    expect(segmentSentences('Wait, no. i changed my mind.')).toEqual(['Wait, no.', 'i changed my mind.'])
  })

  it('does not split decimals or numbered lists dots', () => {
    expect(segmentSentences('It cost 3.50 credits. Cheap!')).toEqual(['It cost 3.50 credits.', 'Cheap!'])
  })
})
