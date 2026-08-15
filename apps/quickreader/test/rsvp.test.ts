import { describe, expect, test } from 'vitest'
import { baseDelay, delayFor, endsClause, endsSentence, orpIndex, previousSentenceStart, sentenceStart } from '../src/engine/rsvp'

describe('punctuation detection', () => {
  test('endsSentence', () => {
    expect(endsSentence('end.')).toBe(true)
    expect(endsSentence('no?')).toBe(true)
    expect(endsSentence('said!"')).toBe(true)
    expect(endsSentence('ellipses…')).toBe(true)
    expect(endsSentence('plain')).toBe(false)
    expect(endsSentence('Mr.')).toBe(true)
  })

  test('endsClause', () => {
    expect(endsClause('pause,')).toBe(true)
    expect(endsClause('semi;')).toBe(true)
    expect(endsClause('colon:')).toBe(true)
    expect(endsClause('plain')).toBe(false)
    expect(endsClause('end.')).toBe(false)
  })
})

describe('delayFor', () => {
  const std = { wpm: 300, pacing: 'standard' as const, nextIsPara: false }

  test('base delay at 300 wpm is 200ms', () => {
    expect(baseDelay(300)).toBe(200)
    expect(delayFor('word', std)).toBe(200)
  })

  test('clause multiplier 1.5x', () => {
    expect(delayFor('word,', std)).toBeCloseTo(300, 5)
  })

  test('sentence multiplier 2.2x', () => {
    expect(delayFor('word.', std)).toBeCloseTo(440, 5)
  })

  test('paragraph pause replaces the sentence pause when larger', () => {
    expect(delayFor('word.', { ...std, nextIsPara: true })).toBeCloseTo(700, 5)
    expect(delayFor('word', { ...std, nextIsPara: true })).toBeCloseTo(700, 5)
  })

  test('long words add proportional delay capped at 2x base', () => {
    expect(delayFor('extraordinarily', std)).toBeCloseTo(200 + 200 * 7 * 0.06, 5)
    expect(delayFor('a'.repeat(40), std)).toBeCloseTo(400, 5)
  })

  test('pacing presets scale the pause multipliers, not the base', () => {
    expect(delayFor('word', { ...std, pacing: 'relaxed' })).toBeCloseTo(200, 5)
    expect(delayFor('word.', { ...std, pacing: 'snappy' })).toBeCloseTo(200 * (1 + 1.2 * 0.75), 5)
    expect(delayFor('word,', { ...std, pacing: 'relaxed' })).toBeCloseTo(200 * (1 + 0.5 * 1.4), 5)
  })
})

describe('orpIndex', () => {
  test('standard offsets', () => {
    expect(orpIndex('a')).toBe(0)
    expect(orpIndex('to')).toBe(1)
    expect(orpIndex('horse')).toBe(1)
    expect(orpIndex('reading')).toBe(2)
    expect(orpIndex('wonderful')).toBe(2)
    expect(orpIndex('extraordinary')).toBe(3)
    expect(orpIndex('disestablishment')).toBe(4)
  })
})

describe('sentence navigation', () => {
  const words = ['One', 'two.', 'Three', 'four', 'five.', 'Six.']

  test('sentenceStart', () => {
    expect(sentenceStart(words, 0)).toBe(0)
    expect(sentenceStart(words, 1)).toBe(0)
    expect(sentenceStart(words, 2)).toBe(2)
    expect(sentenceStart(words, 4)).toBe(2)
    expect(sentenceStart(words, 5)).toBe(5)
  })

  test('previousSentenceStart replays current then previous', () => {
    expect(previousSentenceStart(words, 4)).toBe(2)
    expect(previousSentenceStart(words, 2)).toBe(0)
    expect(previousSentenceStart(words, 0)).toBe(0)
    expect(previousSentenceStart(words, 5)).toBe(2)
  })
})
