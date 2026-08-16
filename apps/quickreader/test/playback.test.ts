import { describe, expect, test } from 'vitest'
import {
  createPlayback,
  DOUBLE_CLICK_MS,
  SAVE_EVERY,
  CHAPTER_CARD_MS,
  type Playback,
  type PlaybackEvents,
  type PlaybackHudKind,
  type PlaybackSeams,
  type PlaybackSnapshot,
  type PlaybackStatus,
} from '../src/engine/playback'
import type { Position } from 'r1-kit'

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

  /** Earliest-task-first to target time; now() is correct inside each callback. */
  advance(ms: number): void {
    const target = this.t + ms
    const EPS = 1e-6 // delayFor products carry float error (200×2.2 = 440.00000000000006)
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

interface Harness {
  pb: Playback
  clock: FakeClock
  saves: Position[]
  words: string[]
  statuses: PlaybackStatus[]
  huds: Array<{ kind: PlaybackHudKind; snap: PlaybackSnapshot }>
  exits: number
  snap(): PlaybackSnapshot
}

const CH: Array<{ words: string[]; paras: number[] }> = [
  { words: ['One.', 'Two', 'words.', 'Three.', 'Four.'], paras: [0] },
  { words: ['Alpha.', 'Beta', 'gamma.', 'Delta.'], paras: [0] },
  { words: ['Last.', 'Very', 'end.'], paras: [0] },
]
const WORD_COUNT = CH.reduce((n, c) => n + c.words.length, 0)

function harness(
  initial: { chapter: number; wordIndex: number; wpm: number },
  events: Partial<PlaybackEvents> = {},
  chapters: Array<{ words: string[]; paras: number[] }> = CH,
): Harness {
  const clock = new FakeClock()
  const saves: Position[] = []
  const words: string[] = []
  const statuses: PlaybackStatus[] = []
  const huds: Harness['huds'] = []
  const exits = { n: 0 }
  const seams: PlaybackSeams = {
    save: (p) => saves.push(p),
    now: () => clock.now(),
    schedule: (fn, ms) => clock.schedule(fn, ms),
    cancel: (h) => clock.cancel(h as number),
  }
  const pb = createPlayback({
    chapters,
    initial,
    pacing: 'standard',
    events: {
      onWord: (s) => words.push(CH[s.chapter].words[s.wordIndex]),
      onStatus: (s) => statuses.push(s.status),
      onHud: (kind, s) => huds.push({ kind, snap: s }),
      onExit: () => exits.n++,
      ...events,
    },
    seams,
  })
  return { pb, clock, saves, words, statuses, huds, snap: () => pb.snapshot(), get exits() { return exits.n } }
}

/** Advance exactly one word delay (all fixture words at 300 wpm: plain 200ms, '.' 440ms). */
const W300 = 200

describe('constants', () => {
  test('ADR-0002 numbers', () => {
    expect(DOUBLE_CLICK_MS).toBe(300)
    expect(SAVE_EVERY).toBe(50)
    expect(CHAPTER_CARD_MS).toBe(1500)
  })
})

describe('start', () => {
  test('saved mid-chapter position autoplays immediately from that word', () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300 })
    expect(h.snap().status).toBe('playing')
    expect(h.words).toEqual(['gamma.'])
    expect(h.saves).toEqual([])
  })
})

describe('play', () => {
  test('advances word by word on delayFor delays', () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300 })
    h.clock.advance(440) // 'gamma.' ends a sentence: 200ms × 2.2
    expect(h.words).toEqual(['gamma.', 'Delta.'])
    expect(h.snap().wordIndex).toBe(3)
  })
})

describe('pause', () => {
  test('click while playing pauses immediately, saves, and cancels the word timer', () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300 })
    h.pb.click()
    expect(h.snap().status).toBe('paused')
    expect(h.saves).toHaveLength(1)
    expect(h.saves[0]).toMatchObject({ chapter: 1, wordIndex: 2, wpm: 300, frac: 7 / 12 })
    expect(h.huds.map((x) => x.kind)).toEqual(['pause'])
    h.clock.advance(60_000)
    expect(h.words).toEqual(['gamma.'])
  })
})

describe('chapter boundary', () => {
  test('saves, shows cardPlaying, auto-resumes next chapter after 1500ms', () => {
    const h = harness({ chapter: 1, wordIndex: 3, wpm: 300 }) // 'Delta.' is ch1's last word
    h.clock.advance(440) // 'Delta.' sentence delay → boundary
    expect(h.snap().status).toBe('cardPlaying')
    expect(h.saves).toHaveLength(1)
    expect(h.saves[0]).toMatchObject({ chapter: 2, wordIndex: 0, frac: 9 / 12 })
    expect(h.statuses).toEqual(['playing', 'cardPlaying'])
    expect(h.words).toEqual(['Delta.']) // next chapter's first word not rendered yet
    h.clock.advance(1500)
    expect(h.snap().status).toBe('playing')
    expect(h.snap().chapter).toBe(2)
    expect(h.words).toEqual(['Delta.', 'Last.'])
  })

  test('click during card closes it immediately; auto-close timer is cancelled', () => {
    const h = harness({ chapter: 1, wordIndex: 3, wpm: 300 })
    h.clock.advance(440)
    h.pb.click()
    expect(h.snap().status).toBe('playing')
    expect(h.words).toEqual(['Delta.', 'Last.'])
    h.clock.advance(10_000)
    expect(h.statuses.filter((s) => s === 'playing')).toHaveLength(2)
  })
})

describe('end of book', () => {
  test('finishing saves, reports finished with end hud; click saves and exits', () => {
    const h = harness({ chapter: 2, wordIndex: 2, wpm: 300 }) // 'end.' is the book's last word
    h.clock.advance(440)
    expect(h.snap().status).toBe('finished')
    expect(h.saves).toHaveLength(1)
    expect(h.saves[0]).toMatchObject({ chapter: 2, wordIndex: 2, frac: 11 / 12 })
    expect(h.huds.map((x) => x.kind)).toEqual(['end'])
    h.clock.advance(60_000)
    expect(h.exits).toBe(0)
    h.pb.click()
    expect(h.exits).toBe(1)
    expect(h.saves).toHaveLength(2)
  })

  test('finished stays finished across jump and seek; click still exits', () => {
    const h = harness({ chapter: 2, wordIndex: 2, wpm: 300 })
    h.clock.advance(440)
    h.pb.seekChapter(0)
    expect(h.snap().status).toBe('finished') // sticky: end overlay stays up
    h.pb.click()
    expect(h.exits).toBe(1)
  })
})

describe('fresh start', () => {
  test('wordIndex 0 opens with a chapter card; first word only after close', () => {
    const h = harness({ chapter: 0, wordIndex: 0, wpm: 300 })
    expect(h.snap().status).toBe('cardPaused')
    expect(h.statuses).toEqual(['cardPaused'])
    expect(h.words).toEqual([]) // stage empty behind the card
    h.clock.advance(1500)
    expect(h.snap().status).toBe('playing')
    expect(h.words).toEqual(['One.'])
  })

  test('out-of-range saved wordIndex falls back to the chapter card', () => {
    const h = harness({ chapter: 0, wordIndex: 99, wpm: 300 })
    expect(h.snap().status).toBe('cardPaused')
    expect(h.snap().wordIndex).toBe(0)
  })
})

describe('save cadence', () => {
  const LONG = [{ words: Array.from({ length: 200 }, (_, i) => `w${i}`), paras: [0] }]

  test('throttles saves to every 50 words while playing; pause does not reset the counter', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300 }, {}, LONG)
    for (let i = 0; i < 49; i++) h.pb.tick()
    expect(h.saves).toHaveLength(0)
    h.pb.tick()
    expect(h.saves).toHaveLength(1)
    expect(h.saves[0].wordIndex).toBe(51)
    for (let i = 0; i < 49; i++) h.pb.tick()
    expect(h.saves).toHaveLength(1)
    h.pb.tick()
    expect(h.saves).toHaveLength(2)
    expect(h.saves[1].wordIndex).toBe(101)
  })

  test('pause saves immediately without consuming the throttle counter', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300 }, {}, LONG)
    for (let i = 0; i < 30; i++) h.pb.tick()
    h.pb.click() // pause: saves
    expect(h.saves).toHaveLength(1)
    h.pb.click() // resume
    for (let i = 0; i < 19; i++) h.pb.tick()
    expect(h.saves).toHaveLength(1)
    h.pb.tick() // 50th advance since start
    expect(h.saves).toHaveLength(2)
  })

  test('chapter boundary saves but does not reset the throttle counter', () => {
    const TWO = [
      { words: Array.from({ length: 50 }, (_, i) => `a${i}`), paras: [0] },
      { words: Array.from({ length: 100 }, (_, i) => `b${i}`), paras: [0] },
    ]
    const h = harness({ chapter: 0, wordIndex: 0, wpm: 300 }, {}, TWO)
    h.pb.click() // close fresh-start card
    for (let i = 0; i < 50; i++) h.pb.tick() // 49 mid-chapter + 1 boundary tick
    expect(h.saves).toHaveLength(1) // boundary save only; counter left at 49
    h.pb.click() // close chapter card
    h.pb.tick() // one word into the new chapter — counter hits 50
    expect(h.saves).toHaveLength(2)
    expect(h.saves[1]).toMatchObject({ chapter: 1, wordIndex: 1 })
  })
})

describe('wpm', () => {
  test('setWpm clamps to 100..800', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 790 })
    h.pb.setWpm(10)
    expect(h.snap().wpm).toBe(800)
    h.pb.setWpm(10)
    expect(h.snap().wpm).toBe(800)
    h.pb.setWpm(-700)
    expect(h.snap().wpm).toBe(100)
    h.pb.setWpm(-10)
    expect(h.snap().wpm).toBe(100)
  })

  test('wpm hud while playing; pause hud while paused', () => {
    const h = harness({ chapter: 0, wordIndex: 1, wpm: 300 })
    h.pb.setWpm(10)
    expect(h.huds.map((x) => x.kind)).toEqual(['wpm'])
    h.pb.click() // pause
    h.pb.setWpm(10)
    expect(h.huds.map((x) => x.kind)).toEqual(['wpm', 'pause', 'pause'])
    expect(h.snap().wpm).toBe(320)
  })

  test('setWpm while playing applies to the next scheduled delay, not the pending one', () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300 })
    h.pb.setWpm(300) // → 600 wpm
    h.clock.advance(440) // 'gamma.' released at its original 300-wpm delay
    expect(h.words).toEqual(['gamma.', 'Delta.'])
    expect(h.snap().status).toBe('playing') // 'Delta.' now scheduled at 600 wpm: 100ms×2.2
    h.clock.advance(220) // old-wpm delay would have been 440 — it fires well before this
    expect(h.snap().status).toBe('cardPlaying')
  })
})

describe('jump', () => {
  test('paused jump carries the position fraction and saves', () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300 })
    h.pb.click() // pause
    h.pb.jump(1)
    expect(h.snap()).toMatchObject({ chapter: 2, wordIndex: 1, status: 'paused' }) // 2/3 of 3 words
    expect(h.saves).toHaveLength(2) // pause save + jump save
    expect(h.saves[1]).toMatchObject({ chapter: 2, wordIndex: 1, wpm: 300 })
    expect(h.huds.map((x) => x.kind)).toEqual(['pause', 'chapterJump'])
  })

  test('jump clamped to the same chapter still saves but hudless', () => {
    const h = harness({ chapter: 0, wordIndex: 2, wpm: 300 })
    h.pb.click()
    h.pb.jump(-1)
    expect(h.snap()).toMatchObject({ chapter: 0, wordIndex: 2, status: 'paused' })
    expect(h.saves).toHaveLength(2)
    expect(h.huds.map((x) => x.kind)).toEqual(['pause'])
  })
})

describe('seek', () => {
  test('seekChapter lands on word 0 paused, saves, renders, huds', () => {
    const h = harness({ chapter: 0, wordIndex: 2, wpm: 300 })
    h.pb.click()
    h.pb.seekChapter(2)
    expect(h.snap()).toMatchObject({ chapter: 2, wordIndex: 0, status: 'paused' })
    expect(h.saves[h.saves.length - 1]).toMatchObject({ chapter: 2, wordIndex: 0 })
    expect(h.huds.map((x) => x.kind)).toEqual(['pause', 'chapterSeek'])
    expect(h.words).toEqual(['words.', 'Last.'])
  })

  test('seekChapter while playing cancels the pending word advance and pauses', () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300 })
    h.pb.seekChapter(0)
    expect(h.snap().status).toBe('paused')
    h.clock.advance(60_000)
    expect(h.words).toEqual(['gamma.', 'One.']) // the orphaned old timer never fires
  })
})

describe('lifecycle saves', () => {
  test('flush saves the current position with frac', () => {
    const h = harness({ chapter: 0, wordIndex: 2, wpm: 300 })
    h.pb.flush()
    expect(h.saves).toHaveLength(1)
    expect(h.saves[0]).toMatchObject({ chapter: 0, wordIndex: 2, wpm: 300, frac: 2 / 12 })
  })

  test('destroy saves once, stops timers, and is idempotent', () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300 })
    h.pb.destroy()
    h.pb.destroy()
    expect(h.saves).toHaveLength(1)
    h.clock.advance(60_000)
    expect(h.words).toEqual(['gamma.'])
    h.pb.flush()
    expect(h.saves).toHaveLength(1) // a dead module persists nothing more
  })

  test('destroy during a card cancels the card timer', () => {
    const h = harness({ chapter: 0, wordIndex: 0, wpm: 300 })
    h.pb.destroy()
    h.clock.advance(10_000)
    expect(h.statuses).toEqual(['cardPaused']) // never auto-closed, never played
    expect(h.saves).toHaveLength(1)
  })

  test('commands on a destroyed module are inert', () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300 })
    h.pb.destroy()
    h.pb.click()
    h.pb.resume()
    h.pb.setWpm(10)
    h.pb.seekChapter(0)
    expect(h.snap().status).toBe('playing') // frozen at destroy time
    expect(h.snap().wpm).toBe(300)
    expect(h.saves).toHaveLength(1)
  })
})

describe('snapshot', () => {
  test('carries times remaining at the current wpm', () => {
    const h = harness({ chapter: 1, wordIndex: 2, wpm: 300 })
    const s = h.snap()
    expect(s.frac).toBe(7 / 12)
    expect(s.remaining.chapter).toBeCloseTo(2 / 300, 5) // 2 words left in ch1
    expect(s.remaining.book).toBeCloseTo(5 / 300, 5) // 5 of 12 words left
  })
})

describe('double-click', () => {
  test('second click inside 300ms rewinds exactly one sentence and resumes', () => {
    const h = harness({ chapter: 0, wordIndex: 3, wpm: 300 }) // 'Three.' starts sentence 3
    h.pb.click()
    h.clock.advance(299)
    h.pb.click()
    expect(h.snap().status).toBe('playing')
    expect(h.snap().wordIndex).toBe(1) // 'Two' — start of sentence 2
    expect(h.huds.map((x) => x.kind)).toEqual(['pause', 'resume'])
    expect(h.words).toEqual(['Three.', 'Two'])
  })

  test('click at or after 300ms resumes without rewinding', () => {
    const h = harness({ chapter: 0, wordIndex: 3, wpm: 300 })
    h.pb.click()
    h.clock.advance(300)
    h.pb.click()
    expect(h.snap().status).toBe('playing')
    expect(h.snap().wordIndex).toBe(3)
  })

  test('pause not caused by click never double-clicks', () => {
    const h = harness({ chapter: 0, wordIndex: 0, wpm: 300 })
    // chapter 0 word 0 → fresh card, not playing; close card via click
    h.pb.click()
    h.pb.click() // paused? no — playing. pause via click:
    expect(h.snap().status).toBe('paused')
    // now seek (pause not via click) then click quickly
    h.pb.seekChapter(2)
    h.pb.click()
    expect(h.snap().status).toBe('playing') // single resume, no rewind weirdness
    expect(h.snap().wordIndex).toBe(0)
  })
})
