import { idbSentenceCache, memorySentenceCache } from '../tts/eleven'
import type { ChapterStream, ChapterStreamSeam } from '../engine/readalong'
import { createChapterAudioSource, type ChapterAudioSource, type ChapterAudioDeps } from './source'
import { createChapterStream, type ChapterStreamDeps } from './stream'
import { HtmlChapterPlayer } from './player'

/**
 * The chapter-audio module's engine-facing seam (ADR-0014): per-book resolver
 * that turns the source's `{ audio, wordTimings }` entries into a live
 * `ChapterStream` player. `open` propagates source rejections (pre-gen exists
 * but cannot be obtained → the engine degrades with a notice) and resolves null
 * for no-pre-gen (→ ElevenLabs / silent ladder).
 */
export function createChapterStreamSeam(bookId: string, source: ChapterAudioSource, streamDeps: ChapterStreamDeps): ChapterStreamSeam {
  return {
    open(chapter: number): Promise<ChapterStream | null> {
      return source.fetchChapter(bookId, chapter).then((entry) => {
        if (!entry) return null
        const audio = new Blob([entry.audio], { type: entry.mime ?? 'audio/mpeg' })
        return createChapterStream(audio, entry.wordTimings, streamDeps)
      })
    },
    preload(chapter: number): void {
      source.preload(bookId, chapter)
    },
  }
}

/** Production source deps: real fetch, IndexedDB cache, resolved against the app's own location. */
export function defaultChapterAudioDeps(): ChapterAudioDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    cache: typeof indexedDB !== 'undefined' ? idbSentenceCache('steadyreader-audio', 100 * 1024 * 1024) : memorySentenceCache(),
    baseUrl: new URL('.', document.baseURI).href,
  }
}

export function defaultChapterStreamDeps(): ChapterStreamDeps {
  return {
    createPlayer: () => new HtmlChapterPlayer(),
    poll: (fn, ms) => {
      const h = setInterval(() => {
        if (!fn()) clearInterval(h)
      }, ms)
      return h
    },
    unpoll: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  }
}

export type { ChapterAudioDeps, ChapterAudioSource, ChapterAudio, ShelfAudioManifest } from './source'
export type { ChapterStreamDeps } from './stream'
export type { ChapterPlayer } from './player'
export { createChapterAudioSource } from './source'
