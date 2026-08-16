import { describe, expect, test } from 'vitest'
import { decodeBookParam } from '../src/deeplink/params'
import { encodeTransitRef } from '../src/deeplink/transit'

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries)
}

describe('decodeBookParam — raw-URL primary', () => {
  test('returns the raw url under the given param name', () => {
    expect(decodeBookParam(params({ add: 'https://x.example/b.epub' }), 'add')).toBe('https://x.example/b.epub')
    expect(decodeBookParam(params({ book: 'https://x.example/b.epub' }), 'book')).toBe('https://x.example/b.epub')
  })

  test('primary wins over the transit code', () => {
    const p = params({ add: 'https://x.example/b.epub', b: encodeTransitRef({ account: 'a', repo: 'r', file: 'f.epub' }) })
    expect(decodeBookParam(p, 'add')).toBe('https://x.example/b.epub')
  })
})

describe('decodeBookParam — transit fallback (?b=)', () => {
  test('decodes the compact code to the raw URL', () => {
    const code = encodeTransitRef({ account: 'larky', repo: 'books', file: 'novel.epub' })
    expect(decodeBookParam(params({ b: code }), 'add')).toBe('https://raw.githubusercontent.com/larky/books/main/novel.epub')
  })

  test('undecodable code yields null', () => {
    expect(decodeBookParam(params({ b: 'zzz!!!' }), 'add')).toBeNull()
  })
})

describe('decodeBookParam — nothing provided', () => {
  test('empty params yield null', () => {
    expect(decodeBookParam(params({}), 'add')).toBeNull()
    expect(decodeBookParam(params({}), 'book')).toBeNull()
  })
})
