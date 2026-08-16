import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { createBridgeVoice, type BridgeSeams } from '../src/tts/bridge'

class FakeClock {
  t = 0
  private seq = 1
  private tasks = new Map<number, { at: number; fn: () => void }>()
  now() {
    return this.t
  }
  schedule(fn: () => void, ms: number) {
    const id = this.seq++
    this.tasks.set(id, { at: this.t + ms, fn })
    return id
  }
  cancel(id: number) {
    this.tasks.delete(id)
  }
  advance(ms: number) {
    const target = this.t + ms
    for (;;) {
      let best: { id: number; at: number; fn: () => void } | null = null
      for (const [id, task] of this.tasks) {
        if (task.at <= target && (!best || task.at < best.at)) best = { id, ...task }
      }
      if (!best) break
      this.tasks.delete(best.id)
      this.t = best.at
      best.fn()
    }
    this.t = target
  }
}

interface Posted {
  json: string
  parsed: Record<string, unknown>
}

function makeSeams(clock: FakeClock) {
  const posted: Posted[] = []
  let listener: ((data: unknown) => void) | null = null
  const seams: BridgeSeams = {
    now: () => clock.now(),
    schedule: (fn, ms) => clock.schedule(fn, ms),
    cancel: (h) => clock.cancel(h as number),
    listen: (fn) => {
      listener = fn
      return () => {
        listener = null
      }
    },
    post: (payload) => {
      const json = JSON.stringify(payload)
      posted.push({ json, parsed: JSON.parse(json) })
      return true
    },
  }
  return {
    seams,
    posted,
    dispatch: (data: unknown) => listener?.(typeof data === 'string' ? data : JSON.stringify(data)),
  }
}

const WORDS = ['Hello', 'there,', 'friend.']

let clock: FakeClock
let env: ReturnType<typeof makeSeams>

beforeEach(() => {
  clock = new FakeClock()
  env = makeSeams(clock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('rabbit bridge voice (ADR-0012: simulated voice clock)', () => {
  test('speak posts a verbatim payload with correlation id', async () => {
    const voice = createBridgeVoice(env.seams)
    const done = voice.speak('Hello there, friend.', WORDS, { wpm: 300, onWord: () => {} })
    expect(env.posted.length).toBe(1)
    expect(env.posted[0].parsed).toMatchObject({ message: 'Hello there, friend.', useLLM: false, wantsR1Response: true })
    expect(typeof env.posted[0].parsed.requestId).toBe('string')
    env.dispatch({ type: 'r1:voice:end', requestId: env.posted[0].parsed.requestId })
    await done
  })

  test('estimate mode: char-weighted word timers fire, watchdog resolves, EMA learns', async () => {
    const voice = createBridgeVoice(env.seams)
    const words: number[] = []
    const done = voice.speak('Hello there, friend.', WORDS, { wpm: 300, onWord: (i) => words.push(i) })
    // default 400ms/word × 3 words = 1200ms watchdog
    clock.advance(1199)
    expect(words).toEqual([0, 1]) // first two word timers land inside the estimate
    clock.advance(2)
    await done
    // EMA: observed 1200ms/3 = 400 → next 2-word utterance estimates 800ms
    const words2: number[] = []
    const done2 = voice.speak('Two words.', ['Two', 'words.'], { wpm: 800, onWord: (i) => words2.push(i) })
    clock.advance(799)
    expect(words2).toEqual([0])
    clock.advance(2)
    await done2
    expect(words2).toEqual([0, 1])
  })

  test('punctuation weights push the highlighted word later within the estimate', async () => {
    const voice = createBridgeVoice(env.seams)
    const times: Array<{ i: number; at: number }> = []
    const done = voice.speak('a b c d e f g h.', Array.from({ length: 8 }, (_, i) => (i === 7 ? 'h.' : String.fromCharCode(97 + i))), {
      wpm: 300,
      onWord: (i) => times.push({ i, at: clock.now() }),
    })
    // 8 words × 400 = 3200ms; the sentence-final 'h.' carries extra weight → later start
    clock.advance(3200)
    await done
    const last = times.find((x) => x.i === 7)!
    const plain = times.find((x) => x.i === 0)!
    expect(last.at - plain.at).toBeGreaterThan((3200 / 8) * 6) // later than a uniform spread
  })

  test('wpm is inert: estimates do not change with the dial', async () => {
    const t1: number[] = []
    const voice1 = createBridgeVoice(env.seams)
    const d1 = voice1.speak('a b.', ['a', 'b.'], { wpm: 100, onWord: () => t1.push(clock.now()) })
    clock.advance(800)
    await d1
    const start = clock.now()
    const t2: number[] = []
    const voice2 = createBridgeVoice(env.seams)
    const d2 = voice2.speak('a b.', ['a', 'b.'], { wpm: 800, onWord: () => t2.push(clock.now() - start) })
    clock.advance(800)
    await d2
    expect(t2).toEqual(t1)
  })

  test('event mode: an end event resolves early and upgrades the session capability', async () => {
    const voice = createBridgeVoice(env.seams)
    const done = voice.speak('Hello there, friend.', WORDS, { wpm: 300, onWord: () => {} })
    const id = env.posted[0].parsed.requestId
    clock.advance(600)
    env.dispatch({ type: 'r1:voice:end', requestId: id })
    await done
    expect(voice.capability()).toBe('events')
    // second utterance: end event resolves before the (generous) watchdog
    let settled2 = false
    const done2 = voice.speak('Two words.', ['Two', 'words.'], { wpm: 300, onWord: () => {} }).then(() => {
      settled2 = true
    })
    const id2 = env.posted[1].parsed.requestId
    clock.advance(300)
    expect(settled2).toBe(false)
    env.dispatch({ event: 'r1:voice:end', requestId: id2 })
    await done2
    expect(settled2).toBe(true)
  })

  test('stop fires the volley (four payload shapes) and settles the utterance', async () => {
    const voice = createBridgeVoice(env.seams)
    const words: number[] = []
    const done = voice.speak('Hello there, friend.', WORDS, { wpm: 300, onWord: (i) => words.push(i) })
    clock.advance(100)
    const postsBefore = env.posted.length
    voice.stop()
    await done
    const volleys = env.posted.slice(postsBefore).map((p) => p.parsed)
    expect(volleys).toEqual([
      { command: 'stop_speech' },
      { message: 'stop_speech', useLLM: false },
      { command: 'stop', type: 'speech' },
      { action: 'stop_speech' },
    ])
    const fired = words.length
    clock.advance(5000)
    expect(words.length).toBe(fired) // timers cancelled
  })

  test('end events for stale request ids are ignored', async () => {
    const voice = createBridgeVoice(env.seams)
    const done = voice.speak('Hello there, friend.', WORDS, { wpm: 300, onWord: () => {} })
    env.dispatch({ type: 'r1:voice:end', requestId: 'not-mine' })
    clock.advance(100)
    clock.advance(1100)
    await done // only the watchdog (1200ms) settles it
    expect(voice.capability()).toBe('estimate')
  })

  test('a missing PluginMessageHandler still settles via the watchdog (never hangs)', async () => {
    const noPost = { ...env.seams, post: () => false }
    const voice = createBridgeVoice(noPost)
    const done = voice.speak('Hello there, friend.', WORDS, { wpm: 300, onWord: () => {} })
    clock.advance(1200)
    await done
  })
})
