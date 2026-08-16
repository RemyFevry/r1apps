import { describe, expect, test } from 'vitest'
import { createElevenVoice, wpmToSpeed, wordTimings, type AudioPlayer, type ElevenAlignment, type SentenceCache, type WordTiming } from '../src/tts/eleven'

describe('wpmToSpeed (ADR-0012: clamp(WPM/300, 0.7, 1.2))', () => {
  test('maps the dial onto the engine range with saturation', () => {
    expect(wpmToSpeed(300)).toBe(1)
    expect(wpmToSpeed(210)).toBeCloseTo(0.7, 10)
    expect(wpmToSpeed(360)).toBeCloseTo(1.2, 10)
    expect(wpmToSpeed(100)).toBeCloseTo(0.7, 10)
    expect(wpmToSpeed(800)).toBeCloseTo(1.2, 10)
    expect(wpmToSpeed(240)).toBeCloseTo(0.8, 10)
  })
})

describe('wordTimings (char timestamps → word offsets)', () => {
  test('maps alignment characters onto tokenizeWords spans', () => {
    const text = 'Hi there.'
    const chars = Array.from(text)
    const alignment: ElevenAlignment = {
      characters: chars,
      character_start_times_seconds: chars.map((_, i) => i * 0.1),
      character_end_times_seconds: chars.map((_, i) => i * 0.1 + 0.05),
    }
    const t = wordTimings(text, alignment)
    expect(t.map((x) => x.text)).toEqual(['Hi', 'there.'])
    expect(t[0].start).toBe(0)
    expect(t[0].end).toBeCloseTo(0.15, 10)
    expect(t[1].start).toBeCloseTo(0.3, 10)
    expect(t[1].end).toBeCloseTo(0.85, 10)
  })

  test('clamps when alignment runs short', () => {
    const text = 'One two three'
    const alignment: ElevenAlignment = {
      characters: ['O', 'n', 'e', ' ', 't'],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.3, 0.5],
    }
    const t = wordTimings(text, alignment)
    expect(t).toHaveLength(3)
    expect(t[2].start).toBeCloseTo(0.4, 10)
  })
})

class MemoryCache implements SentenceCache {
  map = new Map<string, { audio: ArrayBuffer; timings: WordTiming[] }>()
  async get(key: string) {
    return this.map.get(key) ?? null
  }
  async put(key: string, entry: { audio: ArrayBuffer; timings: WordTiming[] }) {
    this.map.set(key, entry)
  }
}

class FakePlayer implements AudioPlayer {
  played: ArrayBuffer[] = []
  stopped = 0
  t = 0
  endedFlag = false
  get currentTime() {
    return this.t
  }
  get ended() {
    return this.endedFlag
  }
  play(buffer: ArrayBuffer) {
    this.played.push(buffer)
  }
  stop() {
    this.stopped++
    this.endedFlag = true
  }
}

function b64(s: string): string {
  return btoa(s)
}

function alignmentFor(text: string): ElevenAlignment {
  const chars = Array.from(text)
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => i * 0.05),
    character_end_times_seconds: chars.map((_, i) => i * 0.05 + 0.04),
  }
}

function makeDeps(fetchImpl?: typeof fetch) {
  const cache = new MemoryCache()
  const players: FakePlayer[] = []
  let pumpFns: Array<() => void> = []
  const calls: Array<{ url: string; init: RequestInit }> = []
  const voice = createElevenVoice(
    { key: 'k1', voiceId: 'v9' },
    {
      fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} })
        return fetchImpl
          ? fetchImpl(url, init)
          : Promise.resolve(
              Response.json({
                audio_base64: b64('fakeaudio'),
                alignment: alignmentFor('Hello there friend.'),
              }),
            )
      }) as unknown as typeof fetch,
      cache,
      createPlayer: () => {
        const p = new FakePlayer()
        players.push(p)
        return p
      },
      poll: (fn) => {
        pumpFns.push(fn)
        return pumpFns.length - 1
      },
      unpoll: () => {},
    },
  )
  return {
    voice,
    cache,
    players,
    calls,
    pump: () => {
      const fns = pumpFns
      pumpFns = fns.filter((f) => f())
    },
  }
}

const WORDS = ['Hello', 'there', 'friend.']

describe('elevenlabs voice (ADR-0012: audio element is the authority)', () => {
  test('speak fetches with key/speed/text, decodes audio, drives onWord from currentTime, caches', async () => {
    const d = makeDeps()
    const seen: number[] = []
    const done = d.voice.speak('Hello there friend.', WORDS, { wpm: 300, onWord: (i) => seen.push(i) })
    await new Promise((r) => setTimeout(r, 0))
    expect(d.calls.length).toBe(1)
    expect(d.calls[0].url).toBe('https://api.elevenlabs.io/v1/text-to-speech/v9/stream/with-timestamps')
    const init = d.calls[0].init
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('k1')
    expect(JSON.parse(String(init.body))).toMatchObject({ text: 'Hello there friend.', voice_settings: { speed: 1 } })
    expect(d.players.length).toBe(1)
    expect(new TextDecoder().decode(new Uint8Array(d.players[0].played[0]))).toBe('fakeaudio')
    // highlight follows currentTime: word 0 starts at 0, word 1 at 0.3, word 2 at 0.6
    d.players[0].t = 0
    d.pump()
    d.players[0].t = 0.35
    d.pump()
    d.players[0].t = 0.7
    d.pump()
    expect(seen).toEqual([0, 1, 2])
    d.players[0].endedFlag = true
    d.pump()
    await done
    expect(d.cache.map.size).toBe(1)
  })

  test('cached sentences replay without a new fetch (re-reads cost zero credits)', async () => {
    const d = makeDeps()
    const done1 = d.voice.speak('Hello there friend.', WORDS, { wpm: 300, onWord: () => {} })
    await new Promise((r) => setTimeout(r, 0))
    d.players[0].endedFlag = true
    d.pump()
    await done1
    const seen2: number[] = []
    const done2 = d.voice.speak('Hello there friend.', WORDS, { wpm: 300, onWord: (i) => seen2.push(i) })
    await new Promise((r) => setTimeout(r, 0))
    expect(d.calls.length).toBe(1) // no second fetch
    d.players[1].t = 0.7
    d.pump()
    d.players[1].endedFlag = true
    d.pump()
    await done2
    expect(seen2).toEqual([0, 1, 2])
  })

  test('wpm shapes speed and the cache key (next-sentence effect)', async () => {
    const d = makeDeps()
    const p1 = d.voice.speak('Hello there friend.', WORDS, { wpm: 600, onWord: () => {} })
    await new Promise((r) => setTimeout(r, 0))
    d.players[0].endedFlag = true
    d.pump()
    await p1
    expect(JSON.parse(String(d.calls[0].init.body)).voice_settings.speed).toBeCloseTo(1.2, 10)
    const p2 = d.voice.speak('Hello there friend.', WORDS, { wpm: 300, onWord: () => {} })
    await new Promise((r) => setTimeout(r, 0))
    d.players[1].endedFlag = true
    d.pump()
    await p2
    expect(d.calls.length).toBe(2) // different speed → different cache key
    expect(JSON.parse(String(d.calls[1].init.body)).voice_settings.speed).toBe(1)
  })

  test('stop halts playback and settles the utterance', async () => {
    const d = makeDeps()
    const seen: number[] = []
    const done = d.voice.speak('Hello there friend.', WORDS, { wpm: 300, onWord: (i) => seen.push(i) })
    await new Promise((r) => setTimeout(r, 0))
    d.players[0].t = 0.35
    d.pump()
    d.voice.stop()
    await done
    expect(d.players[0].stopped).toBe(1)
    const count = seen.length
    d.players[0].t = 0.9
    d.pump()
    expect(seen.length).toBe(count)
  })

  test('prewarm fetches the next sentence without playing it (lookahead)', async () => {
    const d = makeDeps()
    await d.voice.prewarm('Hello there friend.')
    expect(d.calls.length).toBe(1)
    expect(d.players.length).toBe(0)
    expect(d.cache.map.size).toBe(1)
    // the follow-up speak is a cache hit → still one fetch
    const done = d.voice.speak('Hello there friend.', WORDS, { wpm: 300, onWord: () => {} })
    await new Promise((r) => setTimeout(r, 0))
    d.players[0].endedFlag = true
    d.pump()
    await done
    expect(d.calls.length).toBe(1)
  })

  test('HTTP failures reject (the engine holds; no partial audio)', async () => {
    const d = makeDeps(async () => new Response('denied', { status: 401 }))
    await expect(d.voice.speak('Hello there friend.', WORDS, { wpm: 300, onWord: () => {} })).rejects.toThrow('401')
    expect(d.players.length).toBe(0)
  })
})
