import { describe, expect, test } from 'vitest'
import { decodeTransitRef, encodeTransitRef, rawUrlToTransitCode, transitRawUrl } from '../src/ingestion/transit'

describe('transit ref', () => {
  test('round-trips and produces slash-free codes', () => {
    const ref = { account: 'remyf-agent', repo: 'r1book-e64b6776ea', file: 'ethical-slut.epub' }
    const code = encodeTransitRef(ref)
    expect(code).not.toMatch(/[/+=]/)
    expect(decodeTransitRef(code)).toEqual(ref)
  })

  test('builds the raw URL', () => {
    expect(transitRawUrl({ account: 'a', repo: 'b', file: 'c.epub' })).toBe(
      'https://raw.githubusercontent.com/a/b/main/c.epub',
    )
  })

  test('extracts a code from a raw URL', () => {
    const code = rawUrlToTransitCode('https://raw.githubusercontent.com/remyf-agent/r1book-e64b6776ea/main/ethical-slut.epub')
    expect(code).toBeTruthy()
    expect(transitRawUrl(decodeTransitRef(code!)!)).toBe(
      'https://raw.githubusercontent.com/remyf-agent/r1book-e64b6776ea/main/ethical-slut.epub',
    )
  })

  test('rejects garbage codes', () => {
    expect(decodeTransitRef('not-a-valid-code!!')).toBeNull()
    expect(decodeTransitRef('YXxifA')).toBeNull()
  })
})
