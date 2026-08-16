import {
  buildChapterIndex,
  delayFor,
  sentenceAt,
  timeRemainingMinutes,
  type ChapterIndex,
  type DocChapter,
  type Pacing,
} from 'r1-kit'
import type { DocPosition } from '../store'

export const DOUBLE_CLICK_MS = 300
export const SAVE_EVERY = 50
export const CHAPTER_CARD_MS = 1500
export const WPM_MIN = 100
export const WPM_MAX = 800

/**
 * One status token owns the machine (ADR-0006/0012): exactly one clock runs —
 * the WPM timer in silent mode, the voice in voiced mode. `cardPaused` /
 * `cardPlaying` show a chapter card (ADR-0002 pattern); `finished` is sticky.
 */
export type ReadAlongStatus = 'cardPaused' | 'cardPlaying' | 'playing' | 'paused' | 'finished'

export interface ReadAlongSnapshot {
  status: ReadAlongStatus
  chapter: number
  wordIndex: number
  /** Sentence index within the chapter, derived from the structured document (ADR-0009). */
  sentence: number
  wordInSentence: number
  wpm: number
  audioOn: boolean
  /** Progress through the whole document, 0..1. */
  frac: number
  remaining: { chapter: number; book: number }
}

export type ReadAlongHudKind =
  | 'pause'
  | 'resume'
  | 'wpm'
  | 'speaking'
  | 'audioOn'
  | 'audioOff'
  | 'chapterSeek'
  | 'end'

export interface ReadAlongEvents {
  onWord?(s: ReadAlongSnapshot): void
  onStatus?(s: ReadAlongSnapshot): void
  onHud?(kind: ReadAlongHudKind, s: ReadAlongSnapshot): void
  onExit?(): void
}

/** Time and persistence seams, faked in tests. `save` is the single persistence path. */
export interface ReadAlongSeams {
  save(pos: DocPosition): void
  now(): number
  schedule(fn: () => void, ms: number): unknown
  cancel(handle: unknown): void
}

export interface TtsSpeakOptions {
  /** The WPM dial at speak time; adapters map it their own way (ADR-0012). */
  wpm: number
  /** The previous sentence's text, for prosody continuity (ADR-0012 prefetch). */
  previousText?: string
  onWord(wordInSentence: number): void
}

/**
 * The engine-facing half of the TTS seam (ADR-0011). `speak` resolves when the
 * utterance completes; a stalled engine simply never advances (never-skip,
 * ADR-0012). `stop` must settle any in-flight promise without side effects.
 * `prewarm`, when present, prefetches the next sentence (lookahead).
 */
export interface TtsVoice {
  speak(text: string, words: string[], opts: TtsSpeakOptions): Promise<void>
  stop(): void
  prewarm?(text: string, wpm: number, previousText?: string): void
}

export interface ReadAlongOptions {
  chapters: DocChapter[]
  initial: { chapter: number; wordIndex: number; wpm: number; audioOn: boolean }
  pacing: Pacing
  events: ReadAlongEvents
  seams: ReadAlongSeams
  voice: TtsVoice
}

export interface ReadAlong {
  click(): void
  pause(): void
  resume(): void
  /** Adjust wpm by delta, clamped 100..800. Silent: next word; voiced: next sentence. */
  setWpm(delta: number): void
  /** Toggle the audio layer without disturbing pacing state (ADR-0010). */
  toggleAudio(): void
  /** Sentence navigation while paused (ADR-0010): move to a sentence start. */
  seekBySentence(delta: number): void
  /** Land on a chapter's first word, paused (chapter-index pick). */
  seekChapter(chapter: number): void
  snapshot(): ReadAlongSnapshot
  flush(): void
  destroy(): void
}

export function createReadAlong(opts: ReadAlongOptions): ReadAlong {
  const { chapters, pacing, events, seams, voice } = opts
  const indexes: ChapterIndex[] = chapters.map(buildChapterIndex)
  const offsets: number[] = []
  let acc = 0
  for (const ci of indexes) {
    offsets.push(acc)
    acc += ci.wordCount
  }
  const wordCount = acc
  const paraStarts = indexes.map((ci) => {
    const starts = new Set<number>()
    ci.sentences.forEach((s, i) => {
      if (i === 0 || ci.sentences[i - 1].paraAfter) starts.add(s.wordOffset)
    })
    return starts
  })

  let chapter = Math.min(Math.max(opts.initial.chapter, 0), chapters.length - 1)
  let wordIndex = opts.initial.wordIndex
  let wpm = opts.initial.wpm
  let audioOn = opts.initial.audioOn
  let st: ReadAlongStatus = 'paused'
  let destroyed = false
  let cardTimer: ReturnType<ReadAlongSeams['schedule']> | null = null
  let wordTimer: ReturnType<ReadAlongSeams['schedule']> | null = null
  /** Words advanced since the last throttled save; NOT reset by pause or chapter boundary. */
  let sinceSave = 0
  /** Invalidates in-flight speak settlements after stop/seek/toggle. */
  let speakGen = 0
  /** Double-click latch (ADR-0010): the pacing state before click 1, at `at`. */
  let latch: { prior: 'playing' | 'paused'; at: number } | null = null

  const live = () => st === 'playing' || st === 'cardPlaying'

  function frac(): number {
    return (offsets[chapter] + wordIndex) / wordCount
  }

  function snapshot(): ReadAlongSnapshot {
    const at = sentenceAt(indexes[chapter], wordIndex)
    const globalIndex = offsets[chapter] + wordIndex
    return {
      status: st,
      chapter,
      wordIndex,
      sentence: at.sentence,
      wordInSentence: at.wordInSentence,
      wpm,
      audioOn,
      frac: frac(),
      remaining: {
        chapter: timeRemainingMinutes(indexes[chapter].wordCount - wordIndex, wpm),
        book: timeRemainingMinutes(wordCount - globalIndex, wpm),
      },
    }
  }

  function setStatus(next: ReadAlongStatus): void {
    if (st === next) return
    st = next
    events.onStatus?.(snapshot())
  }

  function save(): void {
    seams.save({ chapter, wordIndex, wpm, audioOn, frac: frac() })
  }

  function clearTimers(): void {
    if (wordTimer !== null) {
      seams.cancel(wordTimer)
      wordTimer = null
    }
    if (cardTimer !== null) {
      seams.cancel(cardTimer)
      cardTimer = null
    }
  }

  function countStep(): void {
    if (++sinceSave >= SAVE_EVERY) {
      sinceSave = 0
      save()
    }
  }

  // --- silent clock (ADR-0006): shaped dwells, word-granular ---

  function stepSilent(): void {
    if (destroyed || st !== 'playing' || audioOn) return
    events.onWord?.(snapshot())
    const ci = indexes[chapter]
    const word = ci.sentences[sentenceAt(ci, wordIndex).sentence].words
    const w = word[sentenceAt(ci, wordIndex).wordInSentence]?.text ?? ''
    const nextIsPara = wordIndex + 1 < ci.wordCount && paraStarts[chapter].has(wordIndex + 1)
    wordTimer = seams.schedule(advanceSilent, delayFor(w, { wpm, pacing, nextIsPara }))
  }

  function advanceSilent(): void {
    wordTimer = null
    if (destroyed || st !== 'playing' || audioOn) return
    const ci = indexes[chapter]
    if (wordIndex < ci.wordCount - 1) {
      wordIndex++
      countStep()
      stepSilent()
    } else {
      boundary()
    }
  }

  // --- voiced clock (ADR-0012): the voice drives the highlight ---

  function speakSentence(): void {
    if (destroyed || st !== 'playing' || !audioOn) return
    const ci = indexes[chapter]
    const at = sentenceAt(ci, wordIndex)
    wordIndex = ci.sentences[at.sentence].wordOffset
    const sent = ci.sentences[at.sentence]
    const previousText = at.sentence > 0 ? ci.sentences[at.sentence - 1].text : undefined
    events.onWord?.(snapshot())
    events.onHud?.('speaking', snapshot())
    // Lookahead prefetch (ADR-0012): warm the next sentence while this one plays.
    const next = ci.sentences[at.sentence + 1]
    if (next) voice.prewarm?.(next.text, wpm, sent.text)
    const gen = ++speakGen
    void voice
      .speak(sent.text, sent.words.map((w) => w.text), {
        wpm,
        previousText,
        onWord: (i) => {
          if (gen !== speakGen || destroyed || st !== 'playing') return
          const clamped = Math.min(Math.max(i, 0), sent.words.length - 1)
          wordIndex = sent.wordOffset + clamped
          countStep()
          events.onWord?.(snapshot())
        },
      })
      .then(() => {
        if (gen !== speakGen || destroyed || st !== 'playing' || !audioOn) return
        const cur = sentenceAt(indexes[chapter], wordIndex).sentence
        if (cur < indexes[chapter].sentences.length - 1) {
          wordIndex = indexes[chapter].sentences[cur + 1].wordOffset
          speakSentence()
        } else {
          boundary()
        }
      })
      .catch(() => {
        // Never-skip (ADR-0012): a failed utterance holds the highlight;
        // user interaction resyncs. No silent-clock fallback mid-session.
      })
  }

  // --- shared boundary: chapter card or the end ---

  function boundary(): void {
    if (chapter < chapters.length - 1) {
      chapter++
      wordIndex = 0
      sinceSave = 0
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
    if (audioOn) speakSentence()
    else stepSilent()
  }

  function pause(): void {
    if (destroyed || st !== 'playing') return
    st = 'paused'
    clearTimers()
    speakGen++
    voice.stop()
    save()
    events.onHud?.('pause', snapshot())
  }

  function resume(): void {
    if (destroyed || st !== 'paused') return
    setStatus('playing')
    events.onHud?.('resume', snapshot())
    if (audioOn) {
      // Sentence-start rule (ADR-0012): voice entry re-speaks the sentence.
      wordIndex = indexes[chapter].sentences[sentenceAt(indexes[chapter], wordIndex).sentence].wordOffset
      speakSentence()
    } else {
      stepSilent()
    }
  }

  function restartClocks(): void {
    clearTimers()
    speakGen++
    voice.stop()
    if (st === 'playing') {
      if (audioOn) speakSentence()
      else stepSilent()
    }
  }

  /** Resume mid-chapter → autoplay; word 0 or out of range → chapter card. */
  const ci0 = indexes[chapter]
  if (wordIndex > 0 && wordIndex < ci0.wordCount) {
    setStatus('playing')
    if (audioOn) {
      wordIndex = ci0.sentences[sentenceAt(ci0, wordIndex).sentence].wordOffset
      speakSentence()
    } else {
      stepSilent()
    }
  } else {
    wordIndex = 0
    openCard(false)
  }

  return {
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
      // A fresh latch means this is click 2 of a double press (~50ms apart on
      // the R1): toggle audio and restore the pacing state click 1 disturbed.
      if (latch && seams.now() - latch.at < DOUBLE_CLICK_MS) {
        const prior = latch.prior
        latch = null
        this.toggleAudio()
        if (prior === 'playing') this.resume()
        else this.pause()
        return
      }
      latch = { prior: live() ? 'playing' : 'paused', at: seams.now() }
      if (st === 'playing') pause()
      else resume()
    },
    pause,
    resume,
    setWpm(delta: number): void {
      if (destroyed) return
      wpm = Math.min(WPM_MAX, Math.max(WPM_MIN, wpm + delta))
      events.onHud?.(live() ? 'wpm' : 'pause', snapshot())
    },
    toggleAudio(): void {
      if (destroyed) return
      audioOn = !audioOn
      save()
      if (st === 'playing') {
        if (audioOn) {
          if (wordTimer !== null) {
            seams.cancel(wordTimer)
            wordTimer = null
          }
          speakSentence()
        } else {
          speakGen++
          voice.stop()
          stepSilent()
        }
      }
      events.onHud?.(audioOn ? 'audioOn' : 'audioOff', snapshot())
    },
    seekBySentence(delta: number): void {
      if (destroyed) return
      const ci = indexes[chapter]
      const cur = sentenceAt(ci, wordIndex).sentence
      const target = Math.min(Math.max(cur + delta, 0), ci.sentences.length - 1)
      wordIndex = ci.sentences[target].wordOffset
      sinceSave = 0
      save()
      restartClocks()
      events.onWord?.(snapshot())
    },
    seekChapter(target: number): void {
      if (destroyed) return
      clearTimers()
      speakGen++
      voice.stop()
      chapter = Math.min(Math.max(target, 0), chapters.length - 1)
      wordIndex = 0
      sinceSave = 0
      if (st !== 'finished') setStatus('paused')
      save()
      events.onWord?.(snapshot())
      events.onHud?.('chapterSeek', snapshot())
    },
    snapshot,
    flush(): void {
      if (!destroyed) save()
    },
    destroy(): void {
      if (destroyed) return
      destroyed = true
      clearTimers()
      speakGen++
      voice.stop()
      save()
    },
  }
}
