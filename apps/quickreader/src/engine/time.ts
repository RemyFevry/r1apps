// Reading-time estimates: remaining words at the current WPM. Pacing pauses
// (sentence/clause/paragraph) add ~15-30% in practice; these numbers are the
// no-pauses ideal, chosen as the honest baseline.

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
