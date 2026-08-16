import { describe, expect, test } from 'vitest'
import { formatDuration, timeRemainingMinutes } from '../src/engine/time'

describe('timeRemainingMinutes', () => {
  test('remaining words at current wpm', () => {
    expect(timeRemainingMinutes(600, 300)).toBe(2)
    expect(timeRemainingMinutes(0, 300)).toBe(0)
  })
})

describe('formatDuration', () => {
  test('seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(0.5)).toBe('30s')
    expect(formatDuration(45.3 / 60)).toBe('45s')
  })

  test('minutes under an hour, floored from whole seconds', () => {
    expect(formatDuration(1)).toBe('1m')
    expect(formatDuration(30)).toBe('30m')
    expect(formatDuration(59.9)).toBe('59m')
  })

  test('hours and minutes', () => {
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(195.9)).toBe('3h 15m')
    expect(formatDuration(120)).toBe('2h')
  })

  test('never negative', () => {
    expect(formatDuration(-5)).toBe('0s')
  })
})
