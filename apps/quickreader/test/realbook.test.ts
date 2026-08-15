import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { extractEpub } from '../src/ingestion/epub'
import { delayFor } from '../src/engine/rsvp'

const PATH = join(import.meta.dirname, 'ethical-slut.epub')

const haveBook = existsSync(PATH)

describe.skipIf(!haveBook)('ethical-slut.epub (real book, 30 MB OCR EPUB)', () => {
  test('extracts the full book quickly with lazy zip reads', async () => {
    const data = new Uint8Array(readFileSync(PATH))
    const t0 = performance.now()
    const book = await extractEpub(data)
    const ms = performance.now() - t0
    expect(book.chapters).toHaveLength(305)
    expect(book.wordCount).toBeGreaterThan(100000)
    expect(book.wordCount).toBeLessThan(120000)
    expect(ms).toBeLessThan(5000)
  })

  test('falls back to Untitled/Chapter N — this EPUB carries no dc:title, dc:creator, or TOC labels', async () => {
    const book = await extractEpub(new Uint8Array(readFileSync(PATH)))
    expect(book.title).toBe('Untitled')
    expect(book.author).toBe('')
    expect(book.chapters[0].title).toBe('Chapter 1')
    expect(book.chapters[304].title).toBe('Chapter 305')
  })

  test('every chapter has words, sorted paragraph indices, and clean text', async () => {
    const book = await extractEpub(new Uint8Array(readFileSync(PATH)))
    for (const c of book.chapters) {
      expect(c.words.length).toBeGreaterThan(0)
      expect(c.paras.length).toBeGreaterThan(0)
      expect([...c.paras].sort((a, b) => a - b)).toEqual(c.paras)
      expect(c.paras[0]).toBe(0)
      expect(Math.max(...c.paras)).toBeLessThan(c.words.length)
      for (const w of c.words) expect(w).not.toMatch(/[\u00AD\u200B-\u200D\uFEFF]/)
    }
  })

  test('real words produce sane RSVP delays', async () => {
    const book = await extractEpub(new Uint8Array(readFileSync(PATH)))
    for (const c of book.chapters.slice(0, 50)) {
      for (let i = 0; i < c.words.length; i++) {
        const ms = delayFor(c.words[i], { wpm: 300, pacing: 'standard', nextIsPara: c.paras.includes(i + 1) })
        expect(ms).toBeGreaterThan(0)
        expect(Number.isFinite(ms)).toBe(true)
      }
    }
  })
})
