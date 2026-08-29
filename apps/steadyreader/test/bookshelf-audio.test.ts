import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { DocChapter } from 'r1-kit'
import {
  QuotaError,
  chapterAudioKey,
  chapterText,
  chapterWords,
  generateBookAudio,
  mapTimings,
  type ChapterSynthInput,
  type SynthesisEngine,
  type WordTiming,
} from '../../../scripts/audio'

const dirs: string[] = []
function tmp(name: string): string {
  const d = mkdtempSync(join(tmpdir(), `sr-audio-${name}-`))
  dirs.push(d)
  return d
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const CH_A: DocChapter = { title: 'A', paragraphs: ['One two. Three.'] }
const CH_B: DocChapter = { title: 'B', paragraphs: ['Alpha beta gamma.'] }

const BOOKS = [
  { id: 'b1', chapters: [CH_A, CH_B] },
  { id: 'b2', chapters: [CH_A] },
]

/** Fake engine: emits one timing per word at 0.25s spacing, audio = the chapter index byte. */
function fakeEngine(calls: ChapterSynthInput[] = []): SynthesisEngine {
  return {
    async synthesize(input: ChapterSynthInput) {
      calls.push(input)
      const wordTimings: WordTiming[] = input.words.map((w, i) => ({
        text: w.text,
        start: i * 0.25,
        end: i * 0.25 + 0.2,
      }))
      return { audio: new Uint8Array([input.index]), mime: 'audio/mpeg', wordTimings }
    },
  }
}

describe('chapter audio keying (ADR-0014: hash of (book, chapter text))', () => {
  test('is deterministic and distinguishes book and text', () => {
    const t = chapterText(CH_A)
    expect(chapterAudioKey('b1', t)).toBe(chapterAudioKey('b1', t))
    expect(chapterAudioKey('b1', t)).not.toBe(chapterAudioKey('b2', t))
    expect(chapterAudioKey('b1', chapterText(CH_B))).not.toBe(chapterAudioKey('b1', t))
  })

  test('chapter words align with the reader tokenization (r1-kit)', () => {
    expect(chapterWords(CH_A).map((w) => w.text)).toEqual(['One', 'two.', 'Three.'])
  })
})

describe('mapTimings (token→word alignment by construction)', () => {
  const words = chapterWords(CH_A) // One / two. / Three.

  test('one token per word maps 1:1 onto the word list', () => {
    const tokens = [
      { text: 'One', start: 0, end: 0.3 },
      { text: 'two.', start: 0.35, end: 0.7 },
      { text: 'Three.', start: 0.75, end: 1.1 },
    ]
    const t = mapTimings(words, tokens)
    expect(t).toEqual([
      { text: 'One', start: 0, end: 0.3 },
      { text: 'two.', start: 0.35, end: 0.7 },
      { text: 'Three.', start: 0.75, end: 1.1 },
    ])
  })

  test('a merged engine token spans the words it covers', () => {
    const tokens = [
      { text: 'One two.', start: 0, end: 0.6 },
      { text: 'Three.', start: 0.65, end: 1.0 },
    ]
    const t = mapTimings(words, tokens)
    expect(t[0]).toMatchObject({ text: 'One', start: 0 })
    expect(t[0].end).toBeCloseTo(0.6, 10)
    expect(t[1]).toMatchObject({ text: 'two.', start: 0 })
    expect(t[2]).toMatchObject({ text: 'Three.', start: 0.65 })
  })

  test('a word the engine skipped is filled from its neighbors (no gaps, no crash)', () => {
    const tokens = [
      { text: 'One', start: 0, end: 0.3 },
      { text: 'Three.', start: 0.75, end: 1.1 },
    ]
    const t = mapTimings(words, tokens)
    expect(t).toHaveLength(3)
    expect(t[1]).toMatchObject({ text: 'two.', start: 0.3, end: 0.75 })
  })

  test('throws when the tokens do not match the fed text at all', () => {
    expect(() => mapTimings(words, [{ text: 'unrelated', start: 0, end: 1 }])).toThrow()
  })
})

describe('generateBookAudio (hash-incremental, quota skip, manifest + summary)', () => {
  test('a fresh run generates every chapter and writes manifest + meta', async () => {
    const calls: ChapterSynthInput[] = []
    const dir = tmp('fresh')
    const s = await generateBookAudio({ engine: fakeEngine(calls), engineName: 'kokoro', audioDir: dir, books: BOOKS })
    expect(s).toEqual({ books: 2, generated: 3, skipped: 0, quotaLimited: 0, failed: 0, quotaBooks: [] })
    expect(calls.map((c) => c.index)).toEqual([0, 1, 0])
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest.books.b1).toEqual([
      { audio: 'audio/b1/0.mp3', timings: 'audio/b1/0.json', mime: 'audio/mpeg' },
      { audio: 'audio/b1/1.mp3', timings: 'audio/b1/1.json', mime: 'audio/mpeg' },
    ])
    expect(existsSync(join(dir, 'b1', '0.mp3'))).toBe(true)
    expect(existsSync(join(dir, 'b1', '0.json'))).toBe(true)
    const sidecar = JSON.parse(readFileSync(join(dir, 'b1', '0.json'), 'utf8')) as WordTiming[]
    expect(sidecar.map((w) => w.text)).toEqual(['One', 'two.', 'Three.'])
  })

  test('a re-run with unchanged text touches nothing (engine not called)', async () => {
    const calls: ChapterSynthInput[] = []
    const dir = tmp('incr')
    await generateBookAudio({ engine: fakeEngine(calls), engineName: 'kokoro', audioDir: dir, books: BOOKS })
    const callsAfterFirst = calls.length
    const s = await generateBookAudio({ engine: fakeEngine(calls), engineName: 'kokoro', audioDir: dir, books: BOOKS })
    expect(s).toEqual({ books: 2, generated: 0, skipped: 3, quotaLimited: 0, failed: 0, quotaBooks: [] })
    expect(calls.length).toBe(callsAfterFirst)
  })

  test('a changed chapter text regenerates only that chapter', async () => {
    const calls: ChapterSynthInput[] = []
    const dir = tmp('delta')
    await generateBookAudio({ engine: fakeEngine(calls), engineName: 'kokoro', audioDir: dir, books: BOOKS })
    const edited = [{ id: 'b1', chapters: [CH_A, { ...CH_B, paragraphs: ['Alpha beta gamma delta.'] }] }]
    const s = await generateBookAudio({ engine: fakeEngine(calls), engineName: 'kokoro', audioDir: dir, books: edited })
    expect(s).toEqual({ books: 1, generated: 1, skipped: 1, quotaLimited: 0, failed: 0, quotaBooks: [] })
    expect(calls.at(-1)?.index).toBe(1) // only chapter 1 regenerated
  })

  test('quota exhaustion skips the rest of that book, continues the next, and records nulls', async () => {
    const dir = tmp('quota')
    const engine: SynthesisEngine = {
      async synthesize(input: ChapterSynthInput) {
        if (input.index === 1) throw new QuotaError('429 quota')
        return fakeEngine().synthesize(input)
      },
    }
    const s = await generateBookAudio({ engine, engineName: 'azure', audioDir: dir, books: BOOKS })
    expect(s.generated).toBe(2) // b1 ch0 + b2 ch0
    expect(s.quotaLimited).toBe(1) // b1 ch1 skipped
    expect(s.quotaBooks).toEqual(['b1'])
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest.books.b1[0]).not.toBeNull()
    expect(manifest.books.b1[1]).toBeNull()
    expect(manifest.books.b2[0]).not.toBeNull()
  })

  test('a failed chapter is recorded null and counted; others continue', async () => {
    const dir = tmp('fail')
    const engine: SynthesisEngine = {
      async synthesize(input: ChapterSynthInput) {
        if (input.index === 0) throw new Error('engine exploded')
        return fakeEngine().synthesize(input)
      },
    }
    const s = await generateBookAudio({ engine, engineName: 'kokoro', audioDir: dir, books: BOOKS })
    expect(s.failed).toBe(2) // b1 ch0 + b2 ch0
    expect(s.generated).toBe(1) // b1 ch1
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest.books.b1[0]).toBeNull()
    expect(manifest.books.b1[1]).not.toBeNull()
  })

  test('timing-count mismatch with the reader word list fails the chapter', async () => {
    const dir = tmp('mismatch')
    const engine: SynthesisEngine = {
      async synthesize(input: ChapterSynthInput) {
        return { audio: new Uint8Array([1]), mime: 'audio/mpeg', wordTimings: [{ text: 'only', start: 0, end: 1 }] }
      },
    }
    const s = await generateBookAudio({ engine, engineName: 'kokoro', audioDir: dir, books: BOOKS })
    expect(s.generated).toBe(0)
    expect(s.failed).toBe(3)
  })

  test('wav output names files .wav and records the mime in the manifest', async () => {
    const dir = tmp('wav')
    const engine: SynthesisEngine = {
      async synthesize(input: ChapterSynthInput) {
        const base = await fakeEngine().synthesize(input)
        return { ...base, mime: 'audio/wav' }
      },
    }
    await generateBookAudio({ engine, engineName: 'kokoro', audioDir: dir, books: BOOKS })
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest.books.b1[0].audio).toBe('audio/b1/0.wav')
    expect(manifest.books.b1[0].mime).toBe('audio/wav')
    expect(existsSync(join(dir, 'b1', '0.wav'))).toBe(true)
    expect(readdirSync(join(dir, 'b1')).sort()).toEqual(['0.json', '0.wav', '1.json', '1.wav'])
  })
})
