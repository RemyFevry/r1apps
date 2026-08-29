// Testable units behind `pnpm bookshelf audio` (#54 / ADR-0014). The CLI keeps
// argument handling + git/gh orchestration; these units carry the decisions:
// chapter text/word extraction (aligned to the reader's tokenization), the
// content-addressed incremental key, token→word timing alignment, and the
// generation loop (hash-skip, quota skip, manifest + meta + summary). Real
// synthesis lives behind the injected SynthesisEngine — never invoked by CI.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildChapterIndex, type DocChapter, type WordToken } from '../packages/r1-kit/src/document'
import { smallHash } from './shelf'

export interface WordTiming {
  text: string
  start: number
  end: number
}

export interface ChapterSynthInput {
  index: number
  /** The exact text handed to the engine (words joined by single spaces). */
  text: string
  /** The reader's chapter word list (r1-kit tokenization) the sidecar must align to. */
  words: WordToken[]
}

export interface SynthResult {
  audio: Uint8Array
  /** Blob type of the audio bytes ('audio/mpeg' | 'audio/wav'). */
  mime: string
  /** One timing per input word, in order. */
  wordTimings: WordTiming[]
}

export interface SynthesisEngine {
  synthesize(input: ChapterSynthInput): Promise<SynthResult>
}

/** Azure 429/403 — the CLI skips the rest of the book gracefully. */
export class QuotaError extends Error {}

export interface AudioBook {
  id: string
  chapters: DocChapter[]
}

export interface ShelfAudioManifest {
  books: Record<string, Array<{ audio: string; timings: string; mime?: string } | null>>
}

export interface AudioBookMeta {
  chapters: Array<{ hash: string; engine: string; at: number; mime: string } | null>
}

export interface AudioRunSummary {
  books: number
  generated: number
  skipped: number
  quotaLimited: number
  failed: number
  quotaBooks: string[]
}

/** The synthesis text: r1-kit paragraphs joined — the exact string the engine reads. */
export function chapterText(chapter: DocChapter): string {
  return chapter.paragraphs.join(' ')
}

/** The reader's chapter word list — the sidecar must align to it 1:1. */
export function chapterWords(chapter: DocChapter): WordToken[] {
  return buildChapterIndex(chapter).sentences.flatMap((s) => s.words)
}

/** Incremental key: (book, chapter text). Same text → same key → skip. */
export function chapterAudioKey(bookId: string, text: string): string {
  return smallHash(`${bookId}|${text}`)
}

/**
 * Map engine word tokens onto the reader's word list by cumulative character
 * spans over the fed text. The engine's segmentation may merge or split words
 * ("don't" as one token, contractions, OOD splits) — the r1-kit word inherits
 * the audio window of every token overlapping its span; words the engine
 * skipped are filled from the nearest neighbors. One timing per reader word,
 * by construction aligned to the audio that was just synthesized.
 */
export function mapTimings(words: WordToken[], tokens: Array<{ text: string; start: number; end: number }>): WordTiming[] {
  if (!words.length) return []
  const fed = words.map((w) => w.text).join(' ')
  const spans: Array<{ start: number; end: number; t: { text: string; start: number; end: number } }> = []
  let searchFrom = 0
  for (const t of tokens) {
    const idx = fed.indexOf(t.text, searchFrom)
    if (idx < 0) continue
    spans.push({ start: idx, end: idx + t.text.length, t })
    searchFrom = idx + t.text.length
  }
  if (!spans.length) throw new Error('engine tokens do not match the chapter text')
  const out: WordTiming[] = []
  let wordStart = 0
  for (const w of words) {
    const ws = wordStart
    const we = ws + w.text.length
    let start: number | undefined
    let end: number | undefined
    for (const s of spans) {
      if (s.start >= we || s.end <= ws) continue
      if (start === undefined || s.t.start < start) start = s.t.start
      if (end === undefined || s.t.end > end) end = s.t.end
    }
    if (start === undefined) {
      const prev = spans.filter((s) => s.end <= ws).at(-1)
      const next = spans.find((s) => s.start >= we)
      if (prev && next) {
        start = prev.t.end
        end = next.t.start
      } else if (prev) {
        start = prev.t.end
        end = prev.t.end + 0.05
      } else if (next) {
        start = next.t.start
        end = next.t.end
      } else {
        start = 0
        end = 0
      }
    }
    out.push({ text: w.text, start, end: end ?? start })
    wordStart = we + 1
  }
  return out
}

export interface GenerateAudioOptions {
  engine: SynthesisEngine
  engineName: string
  /** Where assets + manifest.json + meta.json land (gitignored, staged into the shelf site at sync). */
  audioDir: string
  books: AudioBook[]
  /** Inject a clock for deterministic meta timestamps. */
  now?: () => number
}

function extFor(mime: string): string {
  return mime === 'audio/wav' ? 'wav' : 'mp3'
}

/**
 * Generate every bundled book's chapter audio: hash-incremental per
 * (book, chapter text), quota-exhausted chapters skipped to the runtime
 * ladder, per-book failures counted and continued. Writes the app-facing
 * manifest (relative paths + mime) and the incremental meta.
 */
export async function generateBookAudio(opts: GenerateAudioOptions): Promise<AudioRunSummary> {
  const now = opts.now ?? (() => Date.now())
  const metaPath = join(opts.audioDir, 'meta.json')
  let meta: Record<string, AudioBookMeta> = {}
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, AudioBookMeta>
    } catch {
      meta = {}
    }
  }
  const updated: Record<string, AudioBookMeta> = { ...meta }
  const manifest: ShelfAudioManifest = { books: {} }
  const summary: AudioRunSummary = { books: opts.books.length, generated: 0, skipped: 0, quotaLimited: 0, failed: 0, quotaBooks: [] }
  const quotaSeen = new Set<string>()

  for (const book of opts.books) {
    const bookMeta: AudioBookMeta = updated[book.id] ?? { chapters: [] }
    const entries: ShelfAudioManifest['books'][string] = []
    let quotaHit = false
    for (let i = 0; i < book.chapters.length; i++) {
      const chapter = book.chapters[i]!
      const text = chapterText(chapter)
      const words = chapterWords(chapter)
      const key = chapterAudioKey(book.id, text)
      const existing = bookMeta.chapters[i]
      const mime = existing?.mime ?? 'audio/mpeg'
      const ext = extFor(mime)
      const audioPath = join(opts.audioDir, book.id, `${i}.${ext}`)
      const timingsPath = join(opts.audioDir, book.id, `${i}.json`)
      if (!quotaHit && existing && existing.hash === key && existsSync(audioPath) && existsSync(timingsPath)) {
        entries.push({ audio: `audio/${book.id}/${i}.${ext}`, timings: `audio/${book.id}/${i}.json`, mime: existing.mime })
        summary.skipped++
        continue
      }
      if (quotaHit) {
        entries.push(null)
        summary.quotaLimited++
        continue
      }
      try {
        const result = await opts.engine.synthesize({ index: i, text, words })
        if (result.wordTimings.length !== words.length) {
          throw new Error(`engine returned ${result.wordTimings.length} timings for ${words.length} words`)
        }
        mkdirSync(join(opts.audioDir, book.id), { recursive: true })
        const ext = extFor(result.mime)
        writeFileSync(join(opts.audioDir, book.id, `${i}.${ext}`), result.audio)
        writeFileSync(join(opts.audioDir, book.id, `${i}.json`), JSON.stringify(result.wordTimings))
        const entry = { hash: key, engine: opts.engineName, at: now(), mime: result.mime }
        bookMeta.chapters[i] = entry
        entries.push({ audio: `audio/${book.id}/${i}.${ext}`, timings: `audio/${book.id}/${i}.json`, mime: result.mime })
        summary.generated++
      } catch (e) {
        if (e instanceof QuotaError) {
          quotaHit = true
          bookMeta.chapters[i] = null
          entries.push(null)
          summary.quotaLimited++
          if (!quotaSeen.has(book.id)) {
            quotaSeen.add(book.id)
            summary.quotaBooks.push(book.id)
          }
        } else {
          bookMeta.chapters[i] = null
          entries.push(null)
          summary.failed++
        }
      }
    }
    updated[book.id] = bookMeta
    manifest.books[book.id] = entries
  }

  mkdirSync(opts.audioDir, { recursive: true })
  writeFileSync(metaPath, JSON.stringify(updated, null, 2))
  writeFileSync(join(opts.audioDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return summary
}
