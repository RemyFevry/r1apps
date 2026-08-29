import type { SentenceCache, WordTiming } from '../tts/eleven'

/**
 * Chapter-audio source (ADR-0014): resolves a chapter to its pre-generated
 * audio + word-timing sidecar, or null when the shelf has no pre-gen for it.
 *
 * The per-shelf manifest is fetched relative to the app's own location
 * (`audio/manifest.json` under the immutable v/<ver>/ root), so the app and its
 * audio always resolve from the same versioned path. Resolved manifests are
 * cached; a manifest that could not be fetched is NOT cached, so the next
 * chapter boundary (engine re-open) retries and audio auto-restores. Asset
 * bytes are cached on-device keyed by asset URL (re-reads are instant;
 * offline-after-first-read). The `ShelfAudioManifest` shape mirrors what
 * `pnpm bookshelf audio` emits.
 */

export interface ChapterAudio {
  audio: ArrayBuffer
  wordTimings: WordTiming[]
  /** Blob type of the audio bytes ('audio/mpeg' | 'audio/wav'); defaults to mpeg. */
  mime?: string
}

export interface ShelfAudioManifest {
  /** bookId → per-chapter pre-gen asset paths (relative to the version root), null = no pre-gen. */
  books: Record<string, Array<{ audio: string; timings: string; mime?: string } | null>>
}

export interface ChapterAudioDeps {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  /** On-device cache keyed by asset URL (the eleven SentenceCache shape is reused as-is). */
  cache: SentenceCache
  /** Base URL the manifest and its relative asset paths resolve against (must end in '/'). */
  baseUrl: string
}

export interface ChapterAudioSource {
  /** Resolve the chapter's pre-gen audio + timings, or null when none exists. Rejects when pre-gen exists but cannot be obtained (fetch/parse failure). */
  fetchChapter(bookId: string, chapter: number): Promise<ChapterAudio | null>
  /** Warm the on-device cache for a chapter (fire-and-forget; failures are swallowed). */
  preload(bookId: string, chapter: number): void
}

function parseTimings(raw: unknown): WordTiming[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('sidecar: not a non-empty array')
  for (const t of raw) {
    if (typeof t !== 'object' || t === null) throw new Error('sidecar: bad entry')
    const { text, start, end } = t as Record<string, unknown>
    if (typeof text !== 'string' || typeof start !== 'number' || typeof end !== 'number') {
      throw new Error('sidecar: entry missing text/start/end')
    }
  }
  return raw as WordTiming[]
}

export function createChapterAudioSource(deps: ChapterAudioDeps): ChapterAudioSource {
  let manifest: ShelfAudioManifest | null | undefined
  let manifestFetching: Promise<ShelfAudioManifest | null> | null = null
  const inflight = new Map<string, Promise<ChapterAudio | null>>()

  function getManifest(): Promise<ShelfAudioManifest | null> {
    if (manifest !== undefined) return Promise.resolve(manifest)
    if (manifestFetching) return manifestFetching
    const p = (async () => {
      try {
        const res = await deps.fetch(new URL('audio/manifest.json', deps.baseUrl))
        if (res.status === 404) return (manifest = { books: {} }) // shelf has no audio at all
        if (!res.ok) return null // unknown → treat as no pre-gen; retried next call
        manifest = JSON.parse(await res.text()) as ShelfAudioManifest
        return manifest
      } catch {
        return null
      } finally {
        manifestFetching = null
      }
    })()
    manifestFetching = p
    return p
  }

  function fetchChapter(bookId: string, chapter: number): Promise<ChapterAudio | null> {
    return getManifest().then((m) => {
      if (!m) return null
      const entry = m.books?.[bookId]?.[chapter]
      if (!entry) return null
      const audioUrl = new URL(entry.audio, deps.baseUrl).href
      return deps.cache.get(audioUrl).catch(() => null).then((cached) => {
        if (cached) return { audio: cached.audio, wordTimings: cached.timings, mime: entry.mime }
        const existing = inflight.get(audioUrl)
        if (existing) return existing
        const p = (async () => {
          try {
            const [audioRes, timingsRes] = await Promise.all([
              deps.fetch(new URL(entry.audio, deps.baseUrl)),
              deps.fetch(new URL(entry.timings, deps.baseUrl)),
            ])
            if (!audioRes.ok || !timingsRes.ok) throw new Error(`audio fetch failed: ${audioRes.status}/${timingsRes.status}`)
            const audio = await audioRes.arrayBuffer()
            if (!audio.byteLength) throw new Error('empty audio')
            const wordTimings = parseTimings(JSON.parse(await timingsRes.text()))
            const chapterAudio: ChapterAudio = { audio, wordTimings, mime: entry.mime }
            await deps.cache.put(audioUrl, { audio, timings: wordTimings }).catch(() => {})
            return chapterAudio
          } finally {
            inflight.delete(audioUrl)
          }
        })()
        inflight.set(audioUrl, p)
        return p
      })
    })
  }

  return {
    fetchChapter,
    preload(bookId: string, chapter: number): void {
      void fetchChapter(bookId, chapter).catch(() => {})
    },
  }
}
