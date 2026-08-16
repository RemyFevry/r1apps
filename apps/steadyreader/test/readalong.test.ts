import { describe, expect, test } from 'vitest'
import type { DocChapter } from 'r1-kit'
import {
  createReadAlong,
  type ReadAlong,
  type ReadAlongEvents,
  type ReadAlongHudKind,
  type ReadAlongSnapshot,
  type ReadAlongStatus,
  type TimeSeams,
  type TtsSpeakOptions,
  type TtsVoice,
} from '../src/engine/readalong'
import type { DocPosition } from '../src/store'

/** Manual virtual clock: schedule/cancel/now seams, advance fires tasks in order. */
class FakeClock {
  t = 0
  private seq = 1
  private tasks = new Map<number, { at: number; fn: () => void }>()

  now(): number {
    return this.t
  }

  schedule(fn: () => void, ms: number): number {
    const id = this.seq++
    this.tasks.set(id, { at: this.t + ms, fn })
    return id
  }

  cancel(id: number): void {
    this.tasks.delete(id)
  }

  advance(ms: number): void {
    const target = this.t + ms
    const EPS = 1e-6
    for (;;) {
      let best: { id: number; at: number; fn: () => void } | null = null
      for (const [id, task] of this.tasks) {
        if (task.at <= target + EPS && (!best || task.at < best.at)) best = { id, ...task }
      }
      if (!best) break
      this.tasks.delete(best.id)
      this.t = best.at
      best.fn()
    }
    this.t = target
  }
}

/** Scripted voice: tests drive onWord/finish by hand; stop settles the utterance. */
class FakeVoice implements TtsVoice {
  texts: string[] = []
  wpms: number[] = []
  stops = 0
  private utter: { opts: TtsSpeakOptions; done: () => void } | null = null

  speak(text: string, _words: string[], opts: TtsSpeakOptions): Promise<void> {
    this.texts.push(text)
    this.wpms.push(opts.wpm)
    return new Promise<void>((done) => {
      this.utter = { opts, done }
    })
  }

  stop(): void {
    this.stops++
    const u = this.utter
    this.utter = null
    u?.done()
  }

  get speaking(): boolean {
    return this.utter != null
  }

  emit(i: number): void {
    this.utter?.opts.onWord(i)
  }

  finish(): void {
    const u = this.utter
    this.utter = null
    u?.done()
  }
}

interface Harness {
  ra: ReadAlong
  clock: FakeClock
  voice: FakeVoice
  saves: DocPosition[]
  words: Array<{ at: number; s: ReadAlongSnapshot }>
  statuses: ReadAlongStatus[]
  huds: Array<{ kind: ReadAlongHudKind; s: ReadAlongSnapshot }>
  exits: number
  snap(): ReadAlongSnapshot
  /** Let promise chains (speak → then) settle. */
  flush(): Promise<void>
}
/** Chapter 0: sentences ['One.', 'Two words.', 'Three words here.'] offsets [0,1,3]; Chapter 1: ['Alpha beta.', 'Gamma.'] offsets [0,2]. */
const CH: DocChapter[] = [
  { title: 'C1', paragraphs: ['One. Two words.', 'Three words here.'] },
  { title: 'C2', paragraphs: ['Alpha beta.', 'Gamma.'] },
]

function harness(
  initial: { chapter: number; wordIndex: number; wpm: number; audioOn: boolean },
  events: Partial<ReadAlongEvents> = {},
): Harness {
  const clock = new FakeClock()
  const voice = new FakeVoice()
  const saves: DocPosition[] = []
  const words: Array<{ at: number; s: ReadAlongSnapshot }> = []
  const statuses: ReadAlongStatus[] = []
  const huds: Array<{ kind: ReadAlongHudKind; s: ReadAlongSnapshot }> = []
  let exits = 0
  const seams: TimeSeams = {
    save: (p) => saves.push({ ...p }),
    now: () => clock.now(),
    schedule: (fn, ms) => clock.schedule(fn, ms),
    cancel: (h) => clock.cancel(h as number),
  }
  const ra = createReadAlong({
    chapters: CH,
    initial,
    pacing: 'standard',
    events: {
      onWord: (s) => words.push({ at: clock.now(), s: { ...s } }),
      onStatus: (s) => statuses.push(s.status),
      onHud: (kind, s) => huds.push({ kind, s: { ...s } }),
      onExit: () => exits++,
      ...events,
    },
    seams,
    voice,
  })
  return {
    ra,
    clock,
    voice,
    saves,
    words,
    statuses,
    huds,
    get exits() {
      return exits
    },
    snap: () => ra.snapshot(),
    flush: async () => {
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

describe('silent mode (ADR-0006: WPM clock, shaped dwells ADR-0007)', () => {
  test('mid-chapter start autoplays with shaped dwells; sentence ends dwell longer', () => {
    // chapter 0 word 0 is 'One.' — a sentence end inside one paragraph → ×2.2 dwell
    const h = harness({ chapter: 0, wordIndex: 0, wpm: 300, audioOn: false })
    expect(h.snap().status).toBe('cardPaused')
    h.clock.advance(1500) // card auto-closes → playing
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([0])
    h.clock.advance(439) // 440.00000000000006 with float error
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([0])
    h.clock.advance(2)
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([0, 1])
    expect(h.words[1]?.s).toMatchObject({ sentence: 1, wordIndex: 1, wordInSentence: 0 })
  })

  test('paragraph break dwells ×3.5 (word before a paragraph start)', () => {
    const h = harness({ chapter: 0, wordIndex: 2, wpm: 300, audioOn: false })
    // 'words.' is the last word of paragraph 1 → next word starts a paragraph → dwell max(440, 700) = 700
    h.clock.advance(699)
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([2])
    h.clock.advance(2)
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([2, 3])
  })

  test('word 0 starts with a chapter card, click dismisses', () => {
    const h = harness({ chapter: 0, wordIndex: 0, wpm: 300, audioOn: false })
    expect(h.snap().status).toBe('cardPaused')
    h.clock.advance(1500)
    expect(h.snap().status).toBe('playing')
    expect(h.words[0]?.s.wordIndex).toBe(0)
  })

  test('saves throttled every 50 words, and on chapter boundary', () => {
    const h = harness({ chapter: 1, wordIndex: 0, wpm: 300, audioOn: false })
    h.clock.advance(1500) // card → playing
    const savesBefore = h.saves.length
    h.clock.advance(60_000)
    expect(h.saves.length).toBeGreaterThan(savesBefore)
    expect(h.saves[h.saves.length - 1]).toMatchObject({ chapter: 1 })
    expect(h.snap().status).toBe('finished')
  })

  test('click pauses and resumes without losing the word', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: false })
    h.ra.click() // single click → pause (act-immediately)
    expect(h.snap().status).toBe('paused')
    expect(h.saves.at(-1)).toMatchObject({ chapter: 0, wordIndex: 1 })
    h.clock.advance(5000) // nothing fires while paused
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([1])
    h.clock.t = 10_000 // well past the double-click window
    h.ra.click()
    expect(h.snap().status).toBe('playing')
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([1, 1])
  })

  test('setWpm clamps and the next dwell uses the new wpm', () => {
    const h = harness({ chapter: 1, wordIndex: 0, wpm: 300, audioOn: false })
    h.clock.advance(1500) // card closes → 'Alpha' (plain word, 200ms dwell)
    h.ra.setWpm(-10) // 290; the in-flight dwell for 'Alpha' stays at 300 wpm
    h.clock.advance(200) // → word 1 'beta.'
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([0, 1])
    // 'beta.' precedes a paragraph → dwell max((60000/290)×2.2, 700) = 724.14ms
    h.clock.advance(723)
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([0, 1])
    h.clock.advance(2)
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([0, 1, 2])
    // 'Gamma.' dwell at 290 → (60000/290)×2.2 ≈ 455.17ms → end of book
    h.clock.advance(454)
    expect(h.snap().status).toBe('playing')
    h.clock.advance(2)
    expect(h.snap().status).toBe('finished')
    for (let i = 0; i < 60; i++) h.ra.setWpm(100)
    expect(h.snap().wpm).toBe(800)
  })

  test('paused scroll navigates by sentence (ADR-0010)', () => {
    const h = harness({ chapter: 0, wordIndex: 4, wpm: 300, audioOn: false })
    h.ra.click()
    h.clock.t = 10_000
    h.ra.seekBySentence(-1)
    expect(h.snap()).toMatchObject({ sentence: 1, wordIndex: 1, status: 'paused' })
    h.ra.seekBySentence(-1)
    expect(h.snap()).toMatchObject({ sentence: 0, wordIndex: 0 })
    h.ra.seekBySentence(-1) // clamps at chapter start
    expect(h.snap().wordIndex).toBe(0)
    h.ra.seekBySentence(2)
    expect(h.snap()).toMatchObject({ sentence: 2, wordIndex: 3 })
    h.ra.seekBySentence(1) // clamps at chapter end sentence
    expect(h.snap().sentence).toBe(2)
  })

  test('seekChapter lands paused at the chapter first word', () => {
    const h = harness({ chapter: 0, wordIndex: 4, wpm: 300, audioOn: false })
    h.ra.seekChapter(1)
    expect(h.snap()).toMatchObject({ chapter: 1, wordIndex: 0, status: 'paused' })
    expect(h.saves.at(-1)).toMatchObject({ chapter: 1, wordIndex: 0 })
  })

  test('chapter boundary saves and shows a card that auto-advances', () => {
    const h = harness({ chapter: 0, wordIndex: 5, wpm: 300, audioOn: false })
    h.clock.advance(440) // 'here.' dwell → boundary
    expect(h.snap()).toMatchObject({ status: 'cardPlaying', chapter: 1, wordIndex: 0 })
    expect(h.saves.at(-1)).toMatchObject({ chapter: 1, wordIndex: 0 })
    h.clock.advance(1500)
    expect(h.snap()).toMatchObject({ status: 'playing', chapter: 1 })
  })

  test('finished is sticky; click exits; destroy saves', () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300, audioOn: false })
    h.clock.advance(440) // 'Gamma.' → end of book
    expect(h.snap().status).toBe('finished')
    h.ra.seekChapter(0)
    expect(h.snap().status).toBe('finished')
    h.ra.click()
    expect(h.exits).toBe(1)
    const savesBefore = h.saves.length
    h.ra.flush()
    expect(h.saves.length).toBe(savesBefore + 1) // flush persists
    h.ra.destroy()
    expect(h.saves.length).toBe(savesBefore + 2) // destroy persists too
  })
})

describe('voiced mode (ADR-0012: the voice is the clock)', () => {
  test('speaks sentence by sentence; onWord drives the highlight across sentence spans', async () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: true })
    expect(h.snap().status).toBe('playing')
    expect(h.voice.texts).toEqual(['Two words.'])
    h.voice.emit(0)
    expect(h.words.at(-1)?.s).toMatchObject({ sentence: 1, wordIndex: 1, wordInSentence: 0 })
    h.voice.emit(1)
    expect(h.words.at(-1)?.s).toMatchObject({ sentence: 1, wordIndex: 2, wordInSentence: 1 })
    h.voice.finish()
    await h.flush()
    expect(h.voice.texts).toEqual(['Two words.', 'Three words here.'])
    h.voice.emit(0)
    expect(h.words.at(-1)?.s).toMatchObject({ sentence: 2, wordIndex: 3 })
  })

  test('never-skip: an unresolved utterance holds the highlight forever', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: true })
    h.clock.advance(120_000)
    expect(h.voice.texts).toEqual(['Two words.'])
    expect(h.words.at(-1)?.s.wordIndex).toBe(1)
  })

  test('wpm is sampled at speak time — mid-sentence nudges apply next sentence', async () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: true })
    h.ra.setWpm(40)
    expect(h.voice.wpms[0]).toBe(300)
    h.voice.finish()
    await h.flush()
    expect(h.voice.wpms[1]).toBe(340)
  })

  test('last sentence of a chapter resolves into a card, then the next chapter speaks', async () => {
    const h = harness({ chapter: 0, wordIndex: 3, wpm: 300, audioOn: true })
    h.voice.finish() // 'Three words here.' → boundary → card
    await h.flush()
    expect(h.snap()).toMatchObject({ status: 'cardPlaying', chapter: 1 })
    h.clock.advance(1500)
    expect(h.voice.texts).toEqual(['Three words here.', 'Alpha beta.'])
  })

  test('end of book finishes after the last sentence resolves', async () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300, audioOn: true })
    h.voice.finish()
    await h.flush()
    expect(h.snap().status).toBe('finished')
    expect(h.huds.some((x) => x.kind === 'end')).toBe(true)
  })

  test('pause stops the voice and saves; resume re-speaks the sentence from its start (sentence-start rule)', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: true })
    h.voice.emit(1) // highlight on wordIndex 2, mid-sentence
    h.clock.t = 5_000
    h.ra.click()
    expect(h.snap().status).toBe('paused')
    expect(h.voice.stops).toBe(1)
    expect(h.saves.at(-1)).toMatchObject({ chapter: 0, wordIndex: 2, audioOn: true })
    h.clock.t = 5_500 // past the double-click window
    h.ra.click()
    expect(h.snap().status).toBe('playing')
    expect(h.voice.texts.at(-1)).toBe('Two words.')
    expect(h.words.at(-1)?.s).toMatchObject({ wordIndex: 1 }) // snapped back to sentence start
  })

  test('toggling audio off mid-sentence hands the clock to the timer from the current word', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: true })
    h.voice.emit(1) // current word = 2
    h.ra.toggleAudio()
    expect(h.snap().audioOn).toBe(false)
    expect(h.voice.stops).toBe(1)
    expect(h.words.at(-1)?.s.wordIndex).toBe(2) // no jump; stepSilent re-emits the word
    h.clock.advance(699) // 'words.' precedes a paragraph → dwell max(440, 700) = 700
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([1, 2, 2])
    h.clock.advance(2)
    expect(h.words.map((w) => w.s.wordIndex)).toEqual([1, 2, 2, 3])
  })

  test('toggling audio on mid-sentence re-speaks the sentence from its start', () => {
    const h = harness({ chapter: 0, wordIndex: 2, wpm: 300, audioOn: false })
    h.ra.toggleAudio()
    expect(h.snap().audioOn).toBe(true)
    expect(h.voice.texts).toEqual(['Two words.'])
    expect(h.words.at(-1)?.s).toMatchObject({ wordIndex: 1, sentence: 1 })
  })

  test('toggle while paused only flips the saved flag (ADR-0010: pacing undisturbed)', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: false })
    h.clock.t = 5_000
    h.ra.click() // pause
    h.clock.t = 9_000
    h.ra.toggleAudio()
    expect(h.snap()).toMatchObject({ status: 'paused', audioOn: true })
    expect(h.voice.texts).toEqual([])
    expect(h.saves.at(-1)).toMatchObject({ audioOn: true })
  })

  test('double-sideClick toggles audio and restores the prior pacing state (ADR-0010)', () => {
    // from playing: click 1 pauses, click 2 within 300ms toggles audio + resumes
    const a = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: false })
    a.ra.click()
    expect(a.snap().status).toBe('paused')
    a.clock.t = 100
    a.ra.click()
    expect(a.snap()).toMatchObject({ status: 'playing', audioOn: true })
    expect(a.voice.texts).toEqual(['Two words.']) // voice entry at sentence start
    expect(a.huds.map((x) => x.kind)).toContain('audioOn')

    // from paused: click 1 resumes, click 2 toggles audio + re-pauses
    const b = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: true })
    b.clock.t = 5_000
    b.ra.click() // pause
    b.clock.t = 20_000
    b.ra.click() // resume (no latch)
    expect(b.snap().status).toBe('playing')
    b.clock.t = 20_100
    b.ra.click() // double: toggle + restore paused
    expect(b.snap()).toMatchObject({ status: 'paused', audioOn: false })
    expect(b.voice.stops).toBeGreaterThanOrEqual(1)
  })

  test('a slow second click is just pause→resume, no audio toggle', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: false })
    h.ra.click()
    h.clock.t = 400 // past the 300ms window
    h.ra.click()
    expect(h.snap()).toMatchObject({ status: 'playing', audioOn: false })
    expect(h.voice.texts).toEqual([])
  })

  test('seekBySentence while voiced restarts speech at the new sentence', () => {
    const h = harness({ chapter: 0, wordIndex: 3, wpm: 300, audioOn: true })
    h.ra.seekBySentence(-2)
    expect(h.voice.texts.at(-1)).toBe('One.')
    expect(h.words.at(-1)?.s).toMatchObject({ sentence: 0, wordIndex: 0 })
  })

  test('destroy stops the voice and persists', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300, audioOn: true })
    h.ra.destroy()
    expect(h.voice.stops).toBe(1)
    expect(h.saves.at(-1)).toMatchObject({ chapter: 0, wordIndex: 1, audioOn: true, wpm: 300 })
  })
})
