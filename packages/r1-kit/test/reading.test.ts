import { describe, expect, it } from 'vitest'
import { baseDelay, delayFor, formatDuration, timeRemainingMinutes } from '../src/reading'
import type { Pacing } from '../src/storage'

const std = { wpm: 300, pacing: 'standard' as Pacing, nextIsPara: false }

describe('delayFor (ADR-0007 shaped dwells)', () => {
  it('base dwell is 60000/wpm', () => {
    expect(baseDelay(300)).toBe(200)
  })

  it('multiplies by clause, sentence, and paragraph shapes', () => {
    expect(delayFor('word', std)).toBe(200)
    expect(delayFor('word,', std)).toBeCloseTo(300, 5)
    expect(delayFor('word.', std)).toBeCloseTo(440, 5)
    expect(delayFor('word.', { ...std, nextIsPara: true })).toBeCloseTo(700, 5)
    expect(delayFor('word', { ...std, nextIsPara: true })).toBeCloseTo(700, 5)
  })

  it('long words add proportional dwell, capped at ×2 base', () => {
    expect(delayFor('extraordinarily', std)).toBeCloseTo(200 + 200 * 7 * 0.06, 5)
    expect(delayFor('a'.repeat(40), std)).toBeCloseTo(400, 5)
  })

  it('pacing presets scale the pause multipliers, not the base', () => {
    expect(delayFor('word', { ...std, pacing: 'relaxed' })).toBeCloseTo(200, 5)
    expect(delayFor('word.', { ...std, pacing: 'snappy' })).toBeCloseTo(200 * (1 + 1.2 * 0.75), 5)
    expect(delayFor('word,', { ...std, pacing: 'relaxed' })).toBeCloseTo(200 * (1 + 0.5 * 1.4), 5)
  })
})

describe('time', () => {
  it('formats remaining time like the R1 HUD', () => {
    expect(formatDuration(0.75)).toBe('45s')
    expect(formatDuration(30)).toBe('30m')
    expect(formatDuration(65)).toBe('1h 5m')
  })

  it('computes minutes remaining from words and wpm', () => {
    expect(timeRemainingMinutes(600, 300)).toBe(2)
  })
})
