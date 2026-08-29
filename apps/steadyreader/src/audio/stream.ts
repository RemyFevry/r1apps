import { wpmToSpeed, type WordTiming } from '../tts/eleven'
import type { ChapterStream } from '../engine/readalong'
import type { ChapterPlayer } from './player'

/**
 * Chapter-stream driver (ADR-0014): plays one chapter's pre-generated audio and
 * emits chapter-relative word indices from the timing sidecar — the audio
 * element is the clock, so sync is by construction at any playbackRate.
 *
 * `play` resolves on natural end or `stop`, and rejects on a playback error.
 * `pause` keeps the element loaded and the in-flight promise pending; `resume`
 * continues from the exact position. `seekToWord` scrubs to a word's timestamp
 * and resumes emitting from there (no replay of earlier words). One play per
 * driver — the seam creates a fresh driver per chapter open.
 */

export interface ChapterStreamDeps {
  createPlayer(): ChapterPlayer
  /** Repeat fn every ms until it returns false. */
  poll(fn: () => boolean, ms: number): unknown
  unpoll(handle: unknown): void
}

export function createChapterStream(audio: Blob, timings: WordTiming[], deps: ChapterStreamDeps): ChapterStream {
  const maxIdx = Math.max(timings.length - 1, 0)
  let player: ChapterPlayer | null = null
  let idx = 0
  let pollHandle: unknown = null
  let active = false
  let stopped = false
  let onWord: ((i: number) => void) | null = null
  let settle: (() => void) | null = null
  let fail: ((e: unknown) => void) | null = null

  function stopPoll(): void {
    if (pollHandle !== null) {
      deps.unpoll(pollHandle)
      pollHandle = null
    }
  }

  function startPoll(): void {
    if (pollHandle !== null || !player) return
    pollHandle = deps.poll(() => {
      if (stopped || !player) return false
      const t = player.currentTime
      while (idx < timings.length && timings[idx].start <= t + 1e-6) {
        const cur = idx
        idx++
        onWord?.(cur)
      }
      if (player.ended) {
        stopPoll()
        const s = settle
        settle = null
        fail = null
        s?.()
        return false
      }
      return true
    }, 100)
  }

  function failPlay(): void {
    if (stopped) return
    stopPoll()
    player?.destroy()
    player = null
    const f = fail
    settle = null
    fail = null
    f?.(new Error('audio playback failed'))
  }

  return {
    play(fromWord: number, wpm: number, onWordCb: (index: number) => void): Promise<void> {
      onWord = onWordCb
      idx = Math.min(Math.max(fromWord, 0), maxIdx)
      const p = deps.createPlayer()
      player = p
      p.onError = () => failPlay()
      p.load(audio)
      p.setPlaybackRate(wpmToSpeed(wpm))
      p.seek(timings[idx]?.start ?? 0)
      p.play()
      active = true
      startPoll()
      return new Promise<void>((res, rej) => {
        settle = res
        fail = rej
      })
    },
    pause(): void {
      if (!player || !active) return
      player.pause()
      stopPoll()
      active = false
    },
    resume(): void {
      if (!player || active || stopped) return
      player.play()
      active = true
      startPoll()
    },
    seekToWord(i: number): void {
      const clamped = Math.min(Math.max(i, 0), maxIdx)
      if (player) {
        player.seek(timings[clamped]?.start ?? 0)
        idx = clamped
      }
    },
    setWpm(wpm: number): void {
      player?.setPlaybackRate(wpmToSpeed(wpm))
    },
    stop(): void {
      if (stopped) return
      stopped = true
      stopPoll()
      player?.destroy()
      player = null
      const s = settle
      settle = null
      fail = null
      s?.()
    },
  }
}
