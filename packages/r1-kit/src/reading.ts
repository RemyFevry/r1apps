import type { Pacing } from './storage'

const PACE_SCALE: Record<Pacing, number> = { relaxed: 1.4, standard: 1, snappy: 0.75 }
const SENTENCE = 2.2
const CLAUSE = 1.5
const PARAGRAPH = 3.5
const LONG_THRESHOLD = 8
const LONG_MS_PER_CHAR = 0.06
const MAX_LONG_FACTOR = 2

export function baseDelay(wpm: number): number {
  return 60000 / wpm
}

export function endsSentence(w: string): boolean {
  return /[.!?…]["')\]»”’]*$/.test(w)
}

export function endsClause(w: string): boolean {
  return /[,;:—–]["')\]»”’]*$/.test(w)
}

function scaled(ms: number, mult: number, paceScale: number): number {
  return ms * (1 + (mult - 1) * paceScale)
}

export function delayFor(word: string, opts: { wpm: number; pacing: Pacing; nextIsPara: boolean }): number {
  const base = baseDelay(opts.wpm)
  const s = PACE_SCALE[opts.pacing]
  let ms = base
  if (endsSentence(word)) ms = scaled(ms, SENTENCE, s)
  else if (endsClause(word)) ms = scaled(ms, CLAUSE, s)
  if (word.length > LONG_THRESHOLD) {
    const extra = base * (word.length - LONG_THRESHOLD) * LONG_MS_PER_CHAR
    ms = Math.min(ms + extra, base * MAX_LONG_FACTOR)
  }
  if (opts.nextIsPara) ms = Math.max(ms, scaled(base, PARAGRAPH, s))
  return ms
}

export function timeRemainingMinutes(wordsLeft: number, wpm: number): number {
  return wordsLeft / wpm
}

export function formatDuration(minutes: number): string {
  const s = Math.max(0, Math.round(minutes * 60))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h}h ${mm}m` : `${h}h`
}
