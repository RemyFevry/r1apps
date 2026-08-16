import { tokenizeWords } from 'r1-kit'
import type { TtsSpeakOptions, TtsVoice } from '../engine/readalong'

/**
 * ElevenLabs leg (ADR-0012): the audio element is the authority — char
 * timestamps map to word-start offsets and the highlight follows
 * `currentTime`, so it can never outrun real audio. `speed = clamp(WPM/300,
 * 0.7, 1.2)` (next-sentence effect: the dial is sampled at speak time).
 * A persistent (voice, speed, text-hash) sentence cache makes re-reads,
 * back-jumps, and resumed sessions cost zero credits; `prewarm` implements
 * the one-sentence lookahead.
 */

export function wpmToSpeed(wpm: number): number {
  return Math.min(1.2, Math.max(0.7, wpm / 300))
}

export interface WordTiming {
  text: string
  start: number
  end: number
}

export interface ElevenAlignment {
  characters: string[]
  character_start_times_seconds: number[]
  character_end_times_seconds: number[]
}

export function wordTimings(text: string, alignment: ElevenAlignment): WordTiming[] {
  const n = alignment.characters.length
  return tokenizeWords(text).map((tok) => {
    const start = Math.min(Math.max(tok.start, 0), Math.max(n - 1, 0))
    const end = Math.min(Math.max(tok.end - 1, start), Math.max(n - 1, 0))
    const s = alignment.character_start_times_seconds[start] ?? 0
    const e = alignment.character_end_times_seconds[end]
    return { text: tok.text, start: s, end: e !== undefined ? e : s }
  })
}

export interface AudioPlayer {
  play(buffer: ArrayBuffer): void
  stop(): void
  readonly currentTime: number
  readonly ended: boolean
}

export interface CachedSentence {
  audio: ArrayBuffer
  timings: WordTiming[]
}

export interface SentenceCache {
  get(key: string): Promise<CachedSentence | null>
  put(key: string, entry: CachedSentence): Promise<void>
}

export interface ElevenDeps {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  cache: SentenceCache
  createPlayer(): AudioPlayer
  /** Repeat fn every ms until it returns false. */
  poll(fn: () => boolean, ms: number): unknown
  unpoll(handle: unknown): void
}

export interface ElevenVoice extends TtsVoice {
  /** Lookahead prefetch: generate + cache the next sentence without playing. */
  prewarm(text: string): Promise<void>
}

interface Utterance {
  stopped: boolean
  settle(): void
  fail(e: unknown): void
  player?: AudioPlayer
  unpoll?(): void
}

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

function cacheKey(voiceId: string, speed: number, text: string, previousText?: string): string {
  return `${voiceId}|${speed.toFixed(3)}|${djb2(text)}|${previousText ? djb2(previousText) : ''}`
}

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export function createElevenVoice(
  opts: { key: string; voiceId: string; model?: string },
  deps: ElevenDeps,
): ElevenVoice {
  const model = opts.model ?? 'eleven_flash_v2_5'
  const inflight = new Map<string, Promise<CachedSentence>>()

  function load(text: string, speed: number, previousText?: string): Promise<CachedSentence> {
    const k = cacheKey(opts.voiceId, speed, text, previousText)
    const existing = inflight.get(k)
    if (existing) return existing
    const p = (async () => {
      const cached = await deps.cache.get(k).catch(() => null)
      if (cached) return cached
      let res: Response
      try {
        res = await deps.fetch(`https://api.elevenlabs.io/v1/text-to-speech/${opts.voiceId}/stream/with-timestamps`, {
          method: 'POST',
          headers: { 'xi-api-key': opts.key, 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: { speed },
            ...(previousText ? { previous_text: previousText } : {}),
          }),
        })
      } finally {
        inflight.delete(k)
      }
      if (!res.ok) throw new Error(String(res.status))
      const json = (await res.json()) as { audio_base64: string; alignment: ElevenAlignment }
      const entry: CachedSentence = {
        audio: b64ToBuffer(json.audio_base64),
        timings: wordTimings(text, json.alignment),
      }
      await deps.cache.put(k, entry).catch(() => {})
      return entry
    })()
    inflight.set(k, p)
    return p
  }

  let current: Utterance | null = null

  function stopCurrent(): void {
    if (!current) return
    const u = current
    current = null
    u.stopped = true
    u.player?.stop()
    u.unpoll?.()
    u.settle()
  }

  return {
    async prewarm(text: string, wpm?: number, previousText?: string): Promise<void> {
      await load(text, wpmToSpeed(wpm ?? 300), previousText).catch(() => {})
    },
    speak(text: string, _words: string[], speakOpts: TtsSpeakOptions): Promise<void> {
      stopCurrent()
      const speed = wpmToSpeed(speakOpts.wpm)
      const u = {} as Utterance
      const done = new Promise<void>((resolve, reject) => {
        u.settle = resolve
        u.fail = reject
      })
      u.stopped = false
      current = u
      void (async () => {
        let entry: CachedSentence
        try {
          entry = await load(text, speed, speakOpts.previousText)
        } catch (e) {
          if (current === u) current = null
          u.fail(e)
          return
        }
        if (u.stopped) {
          u.settle()
          return
        }
        const player = deps.createPlayer()
        u.player = player
        player.play(entry.audio)
        let idx = 0
        const handle = deps.poll(() => {
          if (u.stopped || current !== u) return false
          const t = player.currentTime
          while (idx < entry.timings.length && entry.timings[idx].start <= t + 1e-6) {
            speakOpts.onWord(idx)
            idx++
          }
          if (player.ended) {
            if (current === u) current = null
            u.settle()
            return false
          }
          return true
        }, 100)
        u.unpoll = () => deps.unpoll(handle)
      })()
      return done
    },
    stop(): void {
      stopCurrent()
    },
  }
}

// --- production wiring ---

export function memorySentenceCache(): SentenceCache {
  const map = new Map<string, CachedSentence>()
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async put(key, entry) {
      map.set(key, entry)
    },
  }
}

interface StoredSentence extends CachedSentence {
  ts: number
}

/** IndexedDB-backed cache with LRU eviction above a byte-size cap (ADR-0012). */
export function idbSentenceCache(dbName = 'steadyreader-tts', maxBytes = 50 * 1024 * 1024): SentenceCache {
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('sentences')) req.result.createObjectStore('sentences')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('idb open failed'))
    })
  const tx = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction('sentences', mode)
      const req = fn(t.objectStore('sentences'))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('idb request failed'))
      t.oncomplete = () => db.close()
    })
  }
  const sizeOf = (e: StoredSentence): number => e.audio.byteLength + e.timings.length * 32
  const cache = {
    async get(key: string): Promise<CachedSentence | null> {
      try {
        const v = (await tx('readonly', (s) => s.get(key))) as StoredSentence | undefined
        if (!v) return null
        void tx('readwrite', (s) => s.put({ ...v, ts: Date.now() }, key)).catch(() => {}) // LRU touch
        return { audio: v.audio, timings: v.timings }
      } catch {
        return null
      }
    },
    async put(key: string, entry: CachedSentence): Promise<void> {
      try {
        await tx('readwrite', (s) => s.put({ ...entry, ts: Date.now() } as StoredSentence, key))
        const keys = (await tx('readonly', (s) => s.getAllKeys())) as IDBValidKey[]
        const entries = (
          await Promise.all(keys.map(async (k) => [k, await tx('readonly', (s) => s.get(k))] as const))
        ).filter((x): x is readonly [IDBValidKey, StoredSentence] => x[1] != null)
        let total = entries.reduce((a, [, e]) => a + sizeOf(e), 0)
        if (total <= maxBytes) return
        const victims = entries.sort((a, b) => a[1].ts - b[1].ts)
        for (const [k, e] of victims) {
          if (total <= maxBytes) break
          if (k === key) continue // never evict the entry just written
          total -= sizeOf(e)
          await tx('readwrite', (s) => s.delete(k)).catch(() => {})
        }
      } catch {
        // cache is best-effort
      }
    },
  }
  return cache
}

export class HtmlAudioPlayer implements AudioPlayer {
  private el = new Audio()
  private url: string | null = null

  play(buffer: ArrayBuffer): void {
    this.url = URL.createObjectURL(new Blob([buffer], { type: 'audio/mpeg' }))
    this.el.src = this.url
    void this.el.play().catch(() => {})
  }

  stop(): void {
    this.el.pause()
    if (this.url) {
      URL.revokeObjectURL(this.url)
      this.url = null
    }
  }

  get currentTime(): number {
    return this.el.currentTime
  }

  get ended(): boolean {
    return this.el.ended
  }
}

export function defaultElevenDeps(cache?: SentenceCache): ElevenDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    cache: cache ?? (typeof indexedDB !== 'undefined' ? idbSentenceCache() : memorySentenceCache()),
    createPlayer: () => new HtmlAudioPlayer(),
    poll: (fn, ms) => {
      const h = setInterval(() => {
        if (!fn()) clearInterval(h)
      }, ms)
      return h
    },
    unpoll: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  }
}
