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
  /** Which clock drives the highlight right now (ADR-0014 degradation ladder). */
  narrator: Narrator
  /** Progress through the whole document, 0..1. */
  frac: number
  remaining: { chapter: number; book: number }
}

/** Which clock drives the highlight right now (ADR-0014 degradation ladder). */
export type Narrator = 'stream' | 'eleven' | 'silent'

export type ReadAlongHudKind =
  | 'pause'
  | 'resume'
  | 'wpm'
  | 'speaking'
  | 'audioOn'
  | 'audioOff'
  | 'chapterSeek'
  | 'audioUnavailable'
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

/**
 * The engine-facing half of the chapter-stream seam (ADR-0014): one chapter's
 * pre-generated audio played as a single gapless stream; the audio element is
 * the clock. `play` emits chapter-relative word indices from the timing table
 * and resolves when the chapter completes or the stream is stopped; it rejects
 * when the stream fails mid-chapter. `pause` keeps the exact position and the
 * in-flight promise pending; `resume` continues it from where it paused.
 */
export interface ChapterStream {
  play(fromWord: number, wpm: number, onWord: (index: number) => void): Promise<void>
  pause(): void
  resume(): void
  seekToWord(index: number): void
  setWpm(wpm: number): void
  stop(): void
}

/**
 * Per-book resolver the engine asks at every chapter boundary. `open` returns
 * null when the chapter simply has no pre-gen audio (the ladder falls to the
 * sentence-level voice, then silent); it rejects when pre-gen exists but cannot
 * be obtained (fetch/parse failure → silent from the current word + notice).
 */
export interface ChapterStreamSeam {
  open(chapter: number): Promise<ChapterStream | null>
  /** Warm the on-device cache for a chapter's pre-gen audio (fire-and-forget). */
  preload(chapter: number): void
}

export interface ReadAlongOptions {
  chapters: DocChapter[]
  initial: { chapter: number; wordIndex: number; wpm: number; audioOn: boolean }
  pacing: Pacing
  events: ReadAlongEvents
  seams: ReadAlongSeams
  /** Sentence-level TTS leg (ElevenLabs fallback); null when no key is set. */
  voice: TtsVoice | null
  /** Pre-generated chapter streams; null when the app has no audio source. */
  streams: ChapterStreamSeam | null
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
  const { chapters, pacing, events, seams, voice, streams } = opts
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
  let narrator: Narrator = 'silent'
  /** The active chapter stream, if the ladder picked one for this chapter. */
  let stream: ChapterStream | null = null
  let destroyed = false
  let cardTimer: ReturnType<ReadAlongSeams['schedule']> | null = null
  let wordTimer: ReturnType<ReadAlongSeams['schedule']> | null = null
  /** Words advanced since the last throttled save; NOT reset by pause or chapter boundary. */
  let sinceSave = 0
  /** Invalidates in-flight speak settlements after stop/seek/toggle. */
  let speakGen = 0
  /** Invalidates in-flight chapter-stream settlements after stop/seek/toggle-off/boundary. NOT bumped by pause — a paused stream survives it (exact-position resume). */
  let streamGen = 0
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
      narrator,
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

  // --- silent clock (ADR-0006): shaped dwells, word-granular. Also the
  // fetch-cover and degradation clock in voiced mode (ADR-0014) — the ladder
  // hands the highlight here at the current word while a chapter stream loads
  // or after a failure, so reading never blocks on audio. ---

  function stepSilent(): void {
    if (destroyed || st !== 'playing') return
    narrator = 'silent'
    events.onWord?.(snapshot())
    const ci = indexes[chapter]
    const word = ci.sentences[sentenceAt(ci, wordIndex).sentence].words
    const w = word[sentenceAt(ci, wordIndex).wordInSentence]?.text ?? ''
    const nextIsPara = wordIndex + 1 < ci.wordCount && paraStarts[chapter].has(wordIndex + 1)
    wordTimer = seams.schedule(advanceSilent, delayFor(w, { wpm, pacing, nextIsPara }))
  }

  function advanceSilent(): void {
    wordTimer = null
    if (destroyed || st !== 'playing') return
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
    if (destroyed || st !== 'playing' || !audioOn || !voice) return
    narrator = 'eleven'
    const v: TtsVoice = voice
    const ci = indexes[chapter]
    const at = sentenceAt(ci, wordIndex)
    wordIndex = ci.sentences[at.sentence].wordOffset
    const sent = ci.sentences[at.sentence]
    const previousText = at.sentence > 0 ? ci.sentences[at.sentence - 1].text : undefined
    events.onWord?.(snapshot())
    events.onHud?.('speaking', snapshot())
    // Lookahead prefetch (ADR-0012): warm the next sentence while this one plays.
    const next = ci.sentences[at.sentence + 1]
    if (next) v.prewarm?.(next.text, wpm, sent.text)
    const gen = ++speakGen
    void v
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
        // ADR-0014: a failed utterance is a mid-chapter failure — the ladder
        // falls to the WPM clock at the current word (an unresolved utterance
        // still never advances; never-skip, ADR-0012).
        if (gen !== speakGen || destroyed || st !== 'playing') return
        degradeToSilent()
      })
  }

  // --- voiced entry (ADR-0014): pick the driver per chapter at a boundary ---

  /** Entry into the sentence-level leg: sentence-start snap, then speak. */
  function startVoiceSentence(): void {
    if (destroyed || st !== 'playing' || !audioOn) return
    if (!voice) {
      narrator = 'silent'
      events.onHud?.('audioUnavailable', snapshot())
      return
    }
    if (wordTimer !== null) {
      seams.cancel(wordTimer)
      wordTimer = null
    }
    const ci = indexes[chapter]
    wordIndex = ci.sentences[sentenceAt(ci, wordIndex).sentence].wordOffset
    speakSentence()
  }

  /**
   * Voiced entry: try the chapter stream, else the sentence leg, else silent.
   * Reading never blocks on the fetch — the WPM clock covers it and the stream
   * joins at the word it reached (exact position, no jump). Rejects from the
   * seam (pre-gen exists but cannot be obtained) land on silent + notice.
   */
  function startVoiced(): void {
    if (destroyed || st !== 'playing' || !audioOn) return
    if (!streams) {
      startVoiceSentence()
      return
    }
    // Next chapter's audio ready when reached (story 6): warm it at chapter entry.
    if (chapter + 1 < chapters.length) streams.preload(chapter + 1)
    stepSilent()
    void (async () => {
      let handle: ChapterStream | null = null
      try {
        handle = await streams.open(chapter)
      } catch {
        handle = null
      }
      if (destroyed || st !== 'playing' || !audioOn || stream !== null) {
        handle?.stop()
        return
      }
      if (!handle) {
        startVoiceSentence()
        return
      }
      if (wordTimer !== null) {
        seams.cancel(wordTimer)
        wordTimer = null
      }
      stream = handle
      const gen = ++streamGen
      narrator = 'stream'
      events.onHud?.('speaking', snapshot())
      stream.setWpm(wpm)
      const ci = indexes[chapter]
      const maxWord = Math.max(ci.wordCount - 1, 0)
      void stream
        .play(wordIndex, wpm, (i) => {
          if (gen !== streamGen || destroyed || st !== 'playing') return
          wordIndex = Math.min(Math.max(i, 0), maxWord)
          countStep()
          events.onWord?.(snapshot())
        })
        .then(() => {
          if (gen !== streamGen || destroyed) return
          stream = null
          if (wordIndex >= maxWord) boundary()
          else stepSilent() // audio ran short: finish the chapter on the WPM clock
        })
        .catch(() => {
          if (gen !== streamGen || destroyed) return
          degradeToSilent()
        })
    })()
  }

  /** Mid-chapter audio failure: WPM clock at the current word, notice, audioOn untouched (auto-restore at the next boundary). */
  function degradeToSilent(): void {
    stream = null
    streamGen++
    narrator = 'silent'
    events.onHud?.('audioUnavailable', snapshot())
    if (st === 'playing') stepSilent()
  }

  // --- shared boundary: chapter card or the end ---

  function boundary(): void {
    stream = null
    streamGen++
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
    if (audioOn) startVoiced()
    else stepSilent()
  }

  function pause(): void {
    if (destroyed || st !== 'playing') return
    st = 'paused'
    clearTimers()
    speakGen++
    voice?.stop()
    stream?.pause() // exact position kept; the in-flight play stays pending
    save()
    events.onHud?.('pause', snapshot())
  }

  function resume(): void {
    if (destroyed || st !== 'paused') return
    setStatus('playing')
    events.onHud?.('resume', snapshot())
    if (audioOn) {
      if (stream) stream.resume() // exact-position resume (ADR-0014)
      else startVoiced()
    } else {
      stepSilent()
    }
  }

  function restartClocks(): void {
    clearTimers()
    speakGen++
    voice?.stop()
    if (st === 'playing') {
      if (audioOn) startVoiced()
      else stepSilent()
    }
  }

  /** Resume mid-chapter → autoplay; word 0 or out of range → chapter card. */
  const ci0 = indexes[chapter]
  if (wordIndex > 0 && wordIndex < ci0.wordCount) {
    setStatus('playing')
    if (audioOn) startVoiced()
    else stepSilent()
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
      stream?.setWpm(wpm) // live WPM nudge → playbackRate immediately (ADR-0014)
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
          startVoiced()
        } else {
          speakGen++
          voice?.stop()
          if (stream !== null) {
            stream.stop()
            stream = null
            streamGen++
          }
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
      if (stream) stream.seekToWord(wordIndex) // the audio jumps to that word (story 4)
      else restartClocks()
      events.onWord?.(snapshot())
    },
    seekChapter(target: number): void {
      if (destroyed) return
      clearTimers()
      speakGen++
      voice?.stop()
      if (stream !== null) {
        stream.stop()
        stream = null
        streamGen++
      }
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
      voice?.stop()
      if (stream !== null) {
        stream.stop()
        stream = null
        streamGen++
      }
      save()
    },
  }
}
