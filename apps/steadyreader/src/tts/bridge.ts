import type { TtsSpeakOptions, TtsVoice } from '../engine/readalong'

/**
 * Rabbit creations voice bridge (research: docs/research/2026-08-16-rabbit-creations-speech-apis.md).
 *
 * The bridge speaks verbatim via `PluginMessageHandler.postMessage` with
 * `useLLM:false` (community-verified, officially undocumented) and offers no
 * timing, rate, or pause primitives — so this adapter is a **simulated voice
 * clock** (ADR-0012): char-weighted word-duration estimates, EMA-calibrated
 * against observed turn-taking, re-anchored every sentence (the engine's
 * speak granularity). Advancement prefers `r1:voice:end` events when they
 * prove real; otherwise an estimated-duration watchdog resolves — accepting
 * occasional clipping of a slow tail rather than holding indefinitely.
 * WPM is inert on this leg.
 */

export interface BridgeSeams {
  now(): number
  schedule(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
  listen(fn: (data: unknown) => void): () => void
  post(payload: unknown): boolean
}

const DEFAULT_MS_PER_WORD = 400 // community-observed default (Reabbit)
const EMA_ALPHA = 0.3
/** Extra duration weight for punctuation pauses, in char units (ADR-0011 family). */
const SENTENCE_WEIGHT = 5
const CLAUSE_WEIGHT = 2
/** Estimate-mode watchdog fires exactly at the estimate (clipping accepted). */
const EVENTS_WATCHDOG_FACTOR = 3

type Capability = 'unknown' | 'events' | 'estimate'

function endsSentence(w: string): boolean {
  return /[.!?…]["')\]»”’]*$/.test(w)
}

function endsClause(w: string): boolean {
  return /[,;:—–]["')\]»”’]*$/.test(w)
}

function wordWeight(w: string): number {
  let weight = Math.max(Array.from(w).length, 1)
  if (endsSentence(w)) weight += SENTENCE_WEIGHT
  else if (endsClause(w)) weight += CLAUSE_WEIGHT
  return weight
}

function looksLikeVoiceEnd(data: unknown): { end: boolean; requestId?: string } {
  if (typeof data !== 'string') return { end: false }
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(data) as Record<string, unknown>
  } catch {
    return { end: false }
  }
  const kind = [msg.type, msg.event, msg.name].find((v): v is string => typeof v === 'string')
  if (!kind) return { end: false }
  if (!/voice/i.test(kind) || !/end|finish|complete|stop/i.test(kind)) return { end: false }
  const requestId = typeof msg.requestId === 'string' ? msg.requestId : msg.id
  return { end: true, requestId: typeof requestId === 'string' ? requestId : undefined }
}

function defaultSeams(): BridgeSeams {
  return {
    now: () => Date.now(),
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    listen: (fn) => {
      const wrapper = (e: Event): void => fn((e as MessageEvent).data)
      window.addEventListener('message', wrapper)
      const prev = (window as unknown as { onPluginMessage?: (data: unknown) => void }).onPluginMessage
      ;(window as unknown as { onPluginMessage?: (data: unknown) => void }).onPluginMessage = (data) => {
        prev?.(data)
        fn(data)
      }
      return () => {
        window.removeEventListener('message', wrapper)
        ;(window as unknown as { onPluginMessage?: (data: unknown) => void }).onPluginMessage = prev
      }
    },
    post: (payload) => {
      const h = (globalThis as { PluginMessageHandler?: { postMessage(s: string): unknown } }).PluginMessageHandler
      if (!h) return false
      h.postMessage(JSON.stringify(payload))
      return true
    },
  }
}

export interface BridgeVoice extends TtsVoice {
  capability(): Capability
}

export function createBridgeVoice(seams?: Partial<BridgeSeams>): BridgeVoice {
  const s: BridgeSeams = { ...defaultSeams(), ...seams }
  let msPerWord = DEFAULT_MS_PER_WORD
  let cap: Capability = 'unknown'
  let seq = 0
  let detachListener: (() => void) | null = null
  /** The live utterance, if any. */
  let live: {
    requestId: string
    startedAt: number
    words: string[]
    estimateMs: number
    onWord: (i: number) => void
    settle: () => void
    timers: unknown[]
    ended: boolean
  } | null = null

  function ensureListener(): void {
    if (detachListener) return
    detachListener = s.listen((data) => {
      const info = looksLikeVoiceEnd(data)
      if (!info.end) return
      if (!live || live.ended) {
        if (cap === 'unknown') cap = 'events' // events are real even between utterances
        return
      }
      if (info.requestId && info.requestId !== live.requestId) return
      finish('event')
    })
  }

  function clearTimers(u: NonNullable<typeof live>): void {
    for (const t of u.timers) s.cancel(t)
    u.timers = []
  }

  function finish(reason: 'event' | 'watchdog' | 'stop'): void {
    if (!live) return
    const u = live
    live = null
    clearTimers(u)
    u.ended = true
    if (reason === 'event') cap = 'events'
    else if (reason === 'watchdog' && cap === 'unknown') cap = 'estimate'
    if (reason !== 'stop') {
      const observed = (s.now() - u.startedAt) / Math.max(u.words.length, 1)
      msPerWord = msPerWord * (1 - EMA_ALPHA) + observed * EMA_ALPHA
    }
    u.settle()
  }

  return {
    capability: () => cap,
    speak(text: string, words: string[], opts: TtsSpeakOptions): Promise<void> {
      ensureListener()
      const requestId = 'sr-' + ++seq
      const estimateMs = Math.max(words.length, 1) * msPerWord
      return new Promise<void>((resolve) => {
        const timers: unknown[] = []
        const u = {
          requestId,
          startedAt: s.now(),
          words,
          estimateMs,
          onWord: opts.onWord,
          settle: resolve,
          timers,
          ended: false,
        }
        live = u
        // Simulated voice clock: spread the estimate across words, char-weighted
        const weights = words.map(wordWeight)
        const total = weights.reduce((a, b) => a + b, 0)
        let acc = 0
        for (let i = 0; i < words.length; i++) {
          acc += weights[i]
          const at = (estimateMs * acc) / total
          timers.push(
            s.schedule(() => {
              if (live === u && !u.ended) opts.onWord(i)
            }, at),
          )
        }
        // Watchdog: exact at the estimate in estimate mode; generous when events
        // have proven real (they should win; this only clips runaway tails).
        const watchdogMs = cap === 'events' ? estimateMs * EVENTS_WATCHDOG_FACTOR : estimateMs
        timers.push(
          s.schedule(() => {
            if (live === u) finish('watchdog')
          }, watchdogMs),
        )
        s.post({ message: text, useLLM: false, wantsR1Response: true, requestId })
      })
    },
    stop(): void {
      if (!live) return
      finish('stop')
      // Undocumented stop: fire the community volley, hope one lands.
      s.post({ command: 'stop_speech' })
      s.post({ message: 'stop_speech', useLLM: false })
      s.post({ command: 'stop', type: 'speech' })
      s.post({ action: 'stop_speech' })
    },
  }
}
