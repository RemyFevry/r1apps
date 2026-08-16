import type { Pacing, Position } from 'r1-kit'
import { delayFor, jumpChapter, previousSentenceStart } from './rsvp'
import { timeRemainingMinutes } from './time'

export const DOUBLE_CLICK_MS = 300
export const SAVE_EVERY = 50
export const CHAPTER_CARD_MS = 1500
export const WPM_MIN = 100
export const WPM_MAX = 800

/**
 * One status token owns the whole machine (ADR-0002):
 * - `cardPaused` / `cardPlaying` — a chapter card is up. The variant records what
 *   the old implicit `playing` boolean did: a fresh-start card lets scroll jump
 *   chapters; a chapter-boundary card routes scroll to WPM.
 * - `finished` is sticky: jump/seek from the end card keep it (the end card stays).
 */
export type PlaybackStatus = 'cardPaused' | 'cardPlaying' | 'playing' | 'paused' | 'finished'

export interface PlaybackSnapshot {
  status: PlaybackStatus
  chapter: number
  wordIndex: number
  wpm: number
  /** Progress through the whole book, 0..1. */
  frac: number
  /** Minutes remaining at the current wpm. */
  remaining: { chapter: number; book: number }
}

export type PlaybackHudKind = 'pause' | 'resume' | 'wpm' | 'chapterJump' | 'chapterSeek' | 'end'

export interface PlaybackEvents {
  onWord?(s: PlaybackSnapshot): void
  onStatus?(s: PlaybackSnapshot): void
  onHud?(kind: PlaybackHudKind, s: PlaybackSnapshot): void
  onExit?(): void
}

/** Time and persistence seams, faked in tests. `save` is the single persistence path. */
export interface PlaybackSeams {
  save(pos: Position): void
  now(): number
  schedule(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
}

export interface PlaybackOptions {
  chapters: Array<{ words: string[]; paras: number[] }>
  initial: Pick<Position, 'chapter' | 'wordIndex' | 'wpm'>
  pacing: Pacing
  events: PlaybackEvents
  seams: PlaybackSeams
}

export interface Playback {
  /** The word-timer fired: advance one word (chapter boundary / end handled inside). */
  tick(): void
  click(): void
  pause(): void
  resume(): void
  /** Adjust wpm by delta, clamped to 100..800. */
  setWpm(delta: number): void
  /** Jump delta chapters with position fraction carry (ADR-0002 jump semantics). */
  jump(delta: number): void
  /** Land on a chapter's first word, paused (chapter-index pick). */
  seekChapter(chapter: number): void
  snapshot(): PlaybackSnapshot
  /** Persist now (pagehide/hidden, bookmark, exit) — the module decides what. */
  flush(): void
  destroy(): void
}

export function createPlayback(opts: PlaybackOptions): Playback {
  const { chapters, pacing, events, seams } = opts
  const offsets: number[] = []
  let acc = 0
  for (const c of chapters) {
    offsets.push(acc)
    acc += c.words.length
  }
  const wordCount = acc
  const paraSets = chapters.map((c) => new Set(c.paras))

  let chapter = Math.min(Math.max(opts.initial.chapter, 0), chapters.length - 1)
  let wordIndex = opts.initial.wordIndex
  let wpm = opts.initial.wpm
  let st: PlaybackStatus = 'paused'
  let destroyed = false
  let cardTimer: ReturnType<PlaybackSeams['schedule']> | null = null
  let wordTimer: ReturnType<PlaybackSeams['schedule']> | null = null
  /** Words advanced since the last throttled save; NOT reset by pause or chapter boundary. */
  let sinceSave = 0
  /** Double-click latch: the pause came from a side click, at `pausedAt`. */
  let pausedViaClick = false
  let pausedAt = 0

  const live = () => st === 'playing' || st === 'cardPlaying'

  function frac(): number {
    return (offsets[chapter] + wordIndex) / wordCount
  }

  function snapshot(): PlaybackSnapshot {
    const globalIndex = offsets[chapter] + wordIndex
    return {
      status: st,
      chapter,
      wordIndex,
      wpm,
      frac: frac(),
      remaining: {
        chapter: timeRemainingMinutes(chapters[chapter].words.length - wordIndex, wpm),
        book: timeRemainingMinutes(wordCount - globalIndex, wpm),
      },
    }
  }

  function setStatus(next: PlaybackStatus): void {
    if (st === next) return
    st = next
    events.onStatus?.(snapshot())
  }

  function save(): void {
    seams.save({ chapter, wordIndex, wpm, frac: frac() })
  }

  function clearWordTimer(): void {
    if (wordTimer !== null) {
      seams.cancel(wordTimer)
      wordTimer = null
    }
  }

  function step(): void {
    if (destroyed || st !== 'playing') return
    events.onWord?.(snapshot())
    const ch = chapters[chapter]
    const nextIsPara = wordIndex + 1 < ch.words.length && paraSets[chapter].has(wordIndex + 1)
    wordTimer = seams.schedule(advance, delayFor(ch.words[wordIndex], { wpm, pacing, nextIsPara }))
  }

  function advance(): void {
    wordTimer = null
    if (destroyed || st !== 'playing') return
    const ch = chapters[chapter]
    if (wordIndex < ch.words.length - 1) {
      wordIndex++
      if (++sinceSave >= SAVE_EVERY) {
        sinceSave = 0
        save()
      }
      step()
    } else if (chapter < chapters.length - 1) {
      chapter++
      wordIndex = 0
      save()
      openCard(true)
    } else {
      save()
      setStatus('finished')
      events.onHud?.('end', snapshot())
    }
  }

  function openCard(fromPlaying: boolean): void {
    cardTimer = seams.schedule(closeCard, CHAPTER_CARD_MS)
    setStatus(fromPlaying ? 'cardPlaying' : 'cardPaused')
  }

  function closeCard(): void {
    if (cardTimer !== null) {
      seams.cancel(cardTimer)
      cardTimer = null
    }
    setStatus('playing')
    step()
  }

  function pause(): void {
    if (destroyed || st !== 'playing') return
    st = 'paused'
    clearWordTimer()
    pausedAt = seams.now()
    save()
    events.onHud?.('pause', snapshot())
  }

  function resume(): void {
    if (destroyed || st !== 'paused') return
    setStatus('playing')
    events.onHud?.('resume', snapshot())
    step()
  }

  function seekChapter(target: number): void {
    if (destroyed) return
    clearWordTimer()
    if (cardTimer !== null) {
      seams.cancel(cardTimer)
      cardTimer = null
    }
    chapter = Math.min(Math.max(target, 0), chapters.length - 1)
    wordIndex = 0
    sinceSave = 0
    if (st !== 'finished') setStatus('paused')
    save()
    events.onWord?.(snapshot())
    events.onHud?.('chapterSeek', snapshot())
  }

  /** Resume mid-chapter → autoplay; word 0 or out of range → chapter card. */
  if (chapter < chapters.length && wordIndex > 0 && wordIndex < chapters[chapter].words.length) {
    setStatus('playing')
    step()
  } else {
    wordIndex = 0
    openCard(false)
  }

  return {
    tick: advance,
    click() {
      if (destroyed) return
      if (st === 'cardPaused' || st === 'cardPlaying') {
        closeCard()
        return
      }
      if (st === 'finished') {
        save()
        events.onExit?.()
        return
      }
      if (st === 'playing') {
        pausedViaClick = true
        pause()
        return
      }
      if (pausedViaClick && seams.now() - pausedAt < DOUBLE_CLICK_MS) {
        pausedViaClick = false
        wordIndex = previousSentenceStart(chapters[chapter].words, wordIndex)
        resume()
        return
      }
      pausedViaClick = false
      resume()
    },
    pause,
    resume,
    setWpm(delta: number): void {
      if (destroyed) return
      wpm = Math.min(WPM_MAX, Math.max(WPM_MIN, wpm + delta))
      events.onHud?.(live() ? 'wpm' : 'pause', snapshot())
    },
    jump(delta: number): void {
      if (destroyed) return
      const next = jumpChapter(chapters, { chapter, wordIndex }, delta)
      const changed = next.chapter !== chapter
      chapter = next.chapter
      wordIndex = next.wordIndex
      sinceSave = 0
      save()
      if (!live()) events.onWord?.(snapshot())
      if (changed) events.onHud?.('chapterJump', snapshot())
    },
    seekChapter,
    snapshot,
    flush(): void {
      if (!destroyed) save()
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      clearWordTimer()
      if (cardTimer !== null) {
        seams.cancel(cardTimer)
        cardTimer = null
      }
      save()
    },
  }
}
