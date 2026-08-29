import { describe, expect, test } from 'vitest'
import { createChapterAudioSource, type ChapterAudioDeps } from '../src/audio/source'
import { createChapterStream } from '../src/audio/stream'
import { createChapterStreamSeam } from '../src/audio'
import type { ChapterStreamDeps } from '../src/audio/stream'
import type { ChapterPlayer } from '../src/audio/player'
import type { SentenceCache, WordTiming } from '../src/tts/eleven'

// --- fakes (pattern: eleven.test.ts — injected fetch/cache/player) ---

class MemoryCache implements SentenceCache {
  map = new Map<string, { audio: ArrayBuffer; timings: WordTiming[] }>()
  async get(key: string) {
    return this.map.get(key) ?? null
  }
  async put(key: string, entry: { audio: ArrayBuffer; timings: WordTiming[] }) {
    this.map.set(key, entry)
  }
}

const AUDIO_BYTES = new Uint8Array([1, 2, 3, 4]).buffer

function makeFetch(manifest: unknown, audioOk = true, timingsOk = true) {
  const calls: Array<{ url: string }> = []
  const impl = async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push({ url })
    if (url.endsWith('audio/manifest.json')) {
      if (manifest instanceof Error) throw manifest
      return new Response(JSON.stringify(manifest), { status: manifest === '__404__' ? 404 : 200 })
    }
    if (url.endsWith('.mp3')) {
      return audioOk ? new Response(AUDIO_BYTES, { status: 200 }) : new Response('nope', { status: 404 })
    }
    if (url.endsWith('.json')) {
      if (!timingsOk) return new Response('not json', { status: 200 })
      return new Response(JSON.stringify([{ text: 'One', start: 0, end: 0.5 }, { text: 'two.', start: 0.6, end: 1.0 }]), { status: 200 })
    }
    return new Response('not found', { status: 404 })
  }
  return { calls, impl: impl as unknown as typeof fetch }
}

const MANIFEST = {
  books: {
    'book-1': [
      { audio: 'audio/book-1/0.mp3', timings: 'audio/book-1/0.json' },
      null, // chapter 1: quota-limited / skipped
    ],
  },
} as const

const BASE = 'https://shelf.example/steady-shelf/v/0.2.2/'

function sourceDeps(overrides: Partial<ChapterAudioDeps> = {}): { deps: ChapterAudioDeps; cache: MemoryCache } {
  const cache = new MemoryCache()
  return {
    cache,
    deps: { fetch: fetchImpl(), cache, baseUrl: BASE, ...overrides } as ChapterAudioDeps,
  }
}

function fetchImpl() {
  return makeFetch(MANIFEST).impl
}

// --- driver fakes ---

class FakePlayer implements ChapterPlayer {
  loaded: Blob | null = null
  plays = 0
  pauses = 0
  seeks: number[] = []
  rates: number[] = []
  t = 0
  endedFlag = false
  onError: (() => void) | null = null

  load(audio: Blob): void {
    this.loaded = audio
  }
  play(): void {
    this.plays++
  }
  pause(): void {
    this.pauses++
  }
  seek(t: number): void {
    this.seeks.push(t)
    this.t = t
  }
  setPlaybackRate(r: number): void {
    this.rates.push(r)
  }
  get currentTime(): number {
    return this.t
  }
  get ended(): boolean {
    return this.endedFlag
  }
  destroy(): void {
    this.loaded = null
  }
}

function streamDeps(): { deps: ChapterStreamDeps; players: FakePlayer[]; pump(): void } {
  const players: FakePlayer[] = []
  let polls: Array<() => boolean> = []
  return {
    deps: {
      createPlayer: () => {
        const p = new FakePlayer()
        players.push(p)
        return p
      },
      poll: (fn) => {
        polls.push(fn)
        return polls.length - 1
      },
      unpoll: () => {},
    },
    players,
    pump: () => {
      const cur = polls
      polls = []
      for (const f of cur) {
        if (f()) polls.push(f)
      }
    },
  }
}

const TIMINGS: WordTiming[] = [
  { text: 'One', start: 0, end: 0.3 },
  { text: 'two', start: 0.4, end: 0.7 },
  { text: 'three.', start: 0.8, end: 1.2 },
]

describe('chapter audio source (ADR-0014: shelf manifest + on-device cache)', () => {
  test('fetchChapter resolves audio + word timings and caches them by asset URL', async () => {
    const m = makeFetch(MANIFEST)
    const cache = new MemoryCache()
    const src = createChapterAudioSource({ fetch: m.impl, cache, baseUrl: BASE })
    const entry = await src.fetchChapter('book-1', 0)
    expect(entry).not.toBeNull()
    expect(entry!.wordTimings).toEqual([
      { text: 'One', start: 0, end: 0.5 },
      { text: 'two.', start: 0.6, end: 1.0 },
    ])
    expect(new Uint8Array(entry!.audio)).toEqual(new Uint8Array(AUDIO_BYTES))
    expect(cache.map.size).toBe(1)
    expect(m.calls.some((c) => c.url.endsWith('/0.mp3'))).toBe(true)
  })

  test('cache hit: no network for the audio assets', async () => {
    const m = makeFetch(MANIFEST)
    const cache = new MemoryCache()
    const src = createChapterAudioSource({ fetch: m.impl, cache, baseUrl: BASE })
    await src.fetchChapter('book-1', 0)
    const callsAfterFirst = m.calls.length
    const again = await src.fetchChapter('book-1', 0)
    expect(again).not.toBeNull()
    expect(m.calls.length).toBe(callsAfterFirst) // manifest cached, audio cache hit
  })

  test('no pre-gen: a book absent from the manifest, or a null chapter, resolves null quietly', async () => {
    const m = makeFetch(MANIFEST)
    const src = createChapterAudioSource({ fetch: m.impl, cache: new MemoryCache(), baseUrl: BASE })
    expect(await src.fetchChapter('other-book', 0)).toBeNull()
    expect(await src.fetchChapter('book-1', 1)).toBeNull() // quota-skipped chapter
  })

  test('manifest fetch failure resolves null (unknown shelf) and retries on the next call', async () => {
    const m = makeFetch(MANIFEST)
    let fail = true
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('audio/manifest.json') && fail) throw new Error('offline')
      return m.impl(input)
    }) as unknown as typeof fetch
    const src = createChapterAudioSource({ fetch: impl, cache: new MemoryCache(), baseUrl: BASE })
    expect(await src.fetchChapter('book-1', 0)).toBeNull()
    fail = false // network returns
    expect(await src.fetchChapter('book-1', 0)).not.toBeNull() // auto-restore at the next call
  })

  test('a 404 manifest means the shelf has no audio at all (resolves null, cached)', async () => {
    const m = makeFetch('__404__')
    const src = createChapterAudioSource({ fetch: m.impl, cache: new MemoryCache(), baseUrl: BASE })
    expect(await src.fetchChapter('book-1', 0)).toBeNull()
  })

  test('asset fetch failure rejects (pre-gen exists but cannot be obtained)', async () => {
    const m = makeFetch(MANIFEST, false)
    const src = createChapterAudioSource({ fetch: m.impl, cache: new MemoryCache(), baseUrl: BASE })
    await expect(src.fetchChapter('book-1', 0)).rejects.toThrow()
  })

  test('a partial/malformed sidecar rejects', async () => {
    const m = makeFetch(MANIFEST, true, false)
    const src = createChapterAudioSource({ fetch: m.impl, cache: new MemoryCache(), baseUrl: BASE })
    await expect(src.fetchChapter('book-1', 0)).rejects.toThrow()
  })

  test('concurrent fetchChapter calls for the same chapter share one fetch', async () => {
    const m = makeFetch(MANIFEST)
    const src = createChapterAudioSource({ fetch: m.impl, cache: new MemoryCache(), baseUrl: BASE })
    const [a, b] = await Promise.all([src.fetchChapter('book-1', 0), src.fetchChapter('book-1', 0)])
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(m.calls.filter((c) => c.url.endsWith('/0.mp3')).length).toBe(1)
  })

  test('preload warms the cache without throwing', async () => {
    const m = makeFetch(MANIFEST)
    const cache = new MemoryCache()
    const src = createChapterAudioSource({ fetch: m.impl, cache, baseUrl: BASE })
    src.preload('book-1', 0)
    await new Promise((r) => setTimeout(r, 0))
    expect(cache.map.size).toBe(1)
  })

  test('prime() fetches the manifest eagerly (library/open time), so chapter opens never pay for it', async () => {
    const m = makeFetch(MANIFEST)
    const src = createChapterAudioSource({ fetch: m.impl, cache: new MemoryCache(), baseUrl: BASE })
    src.prime()
    await new Promise((r) => setTimeout(r, 0))
    expect(m.calls.some((c) => c.url.endsWith('audio/manifest.json'))).toBe(true)
  })
})

describe('chapter stream driver (ADR-0014: audio element is the clock)', () => {
  test('play emits words exactly on the timing table and seeks to the fromWord timestamp', async () => {
    const d = streamDeps()
    const s = createChapterStream(new Blob(['a']), TIMINGS, d.deps)
    const seen: number[] = []
    const done = s.play(0, 300, (i) => seen.push(i))
    const p = d.players[0]
    expect(p.seeks).toEqual([0])
    expect(p.rates).toEqual([1])
    p.t = 0.1
    d.pump()
    p.t = 0.5
    d.pump()
    p.t = 0.9
    d.pump()
    expect(seen).toEqual([0, 1, 2])
    p.endedFlag = true
    d.pump()
    await done
  })

  test('playing from a later word starts at that word (no replay of earlier words)', async () => {
    const d = streamDeps()
    const s = createChapterStream(new Blob(['a']), TIMINGS, d.deps)
    const seen: number[] = []
    const done = s.play(1, 300, (i) => seen.push(i))
    const p = d.players[0]
    expect(p.seeks).toEqual([0.4])
    p.t = 0.5
    d.pump()
    expect(seen).toEqual([1])
    p.endedFlag = true
    d.pump()
    await done
  })

  test('seekToWord scrubs the element and resumes emitting from that word', async () => {
    const d = streamDeps()
    const s = createChapterStream(new Blob(['a']), TIMINGS, d.deps)
    const seen: number[] = []
    const done = s.play(0, 300, (i) => seen.push(i))
    const p = d.players[0]
    p.t = 0.5
    d.pump()
    expect(seen).toEqual([0, 1])
    s.seekToWord(2)
    expect(p.seeks.at(-1)).toBe(0.8)
    p.t = 0.9
    d.pump()
    expect(seen).toEqual([0, 1, 2]) // no re-emission of 0/1
    p.endedFlag = true
    d.pump()
    await done
  })

  test('pause stops the element and polling; resume continues at the exact position', async () => {
    const d = streamDeps()
    const s = createChapterStream(new Blob(['a']), TIMINGS, d.deps)
    const seen: number[] = []
    const done = s.play(0, 300, (i) => seen.push(i))
    const p = d.players[0]
    p.t = 0.5
    d.pump()
    expect(seen).toEqual([0, 1])
    s.pause()
    expect(p.pauses).toBe(1)
    s.resume()
    expect(p.plays).toBe(2)
    p.t = 0.9
    d.pump()
    expect(seen).toEqual([0, 1, 2])
    p.endedFlag = true
    d.pump()
    await done
  })

  test('setWpm maps the dial onto playbackRate immediately', () => {
    const d = streamDeps()
    const s = createChapterStream(new Blob(['a']), TIMINGS, d.deps)
    const done = s.play(0, 300, () => {})
    const p = d.players[0]
    s.setWpm(360)
    s.setWpm(210)
    expect(p.rates).toEqual([1, 1.2, 0.7])
    void done
  })

  test('stop settles the play promise; a playback error rejects it', async () => {
    const d1 = streamDeps()
    const s1 = createChapterStream(new Blob(['a']), TIMINGS, d1.deps)
    const done1 = s1.play(0, 300, () => {})
    s1.stop()
    await done1 // settled, not rejected

    const d2 = streamDeps()
    const s2 = createChapterStream(new Blob(['a']), TIMINGS, d2.deps)
    const done2 = s2.play(0, 300, () => {})
    d2.players[0].onError?.()
    await expect(done2).rejects.toThrow()
  })
})

describe('chapter stream seam (ADR-0014: per-book resolver)', () => {
  test('open binds the bookId: resolves a stream for pre-gen, null for no pre-gen, rejects on failure', async () => {
    const m = makeFetch(MANIFEST)
    const src = createChapterAudioSource({ fetch: m.impl, cache: new MemoryCache(), baseUrl: BASE })
    const d = streamDeps()
    const seam = createChapterStreamSeam('book-1', src, d.deps)
    const s = await seam.open(0)
    expect(s).not.toBeNull()
    expect(await seam.open(1)).toBeNull()

    const failing = createChapterAudioSource({ fetch: makeFetch(MANIFEST, false).impl, cache: new MemoryCache(), baseUrl: BASE })
    const seam2 = createChapterStreamSeam('book-1', failing, d.deps)
    await expect(seam2.open(0)).rejects.toThrow()
  })
})
