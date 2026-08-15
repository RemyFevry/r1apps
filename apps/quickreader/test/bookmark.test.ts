import { describe, expect, test } from 'vitest'
import { bookmarkUrl, decodeBookmark, encodeBookmark } from '../src/ingestion/bookmark'

describe('bookmark', () => {
  test('round-trips', () => {
    const bm = { id: 'shelf-abc123', chapter: 12, wordIndex: 4567, wpm: 380 }
    expect(decodeBookmark(encodeBookmark(bm))).toEqual(bm)
  })

  test('builds a resumable url', () => {
    const url = bookmarkUrl('https://x.github.io/r1-shelf/app.html', 'deadbee', {
      id: 'shelf-1',
      chapter: 1,
      wordIndex: 2,
      wpm: 300,
    })
    expect(url).toBe('https://x.github.io/r1-shelf/app.html?v=deadbee#p=shelf-1.1.2.8c')
    expect(decodeBookmark(url.split('#p=')[1])).toEqual({ id: 'shelf-1', chapter: 1, wordIndex: 2, wpm: 300 })
  })

  test('rejects garbage', () => {
    expect(decodeBookmark('')).toBeNull()
    expect(decodeBookmark('a.b.c')).toBeNull()
    expect(decodeBookmark('a.b.c.d.e')).toBeNull()
    expect(decodeBookmark('bad id.0.0.300')).toBeNull()
    expect(decodeBookmark('x.0.0.99999')).toBeNull()
    expect(decodeBookmark('x.zz.zz.300')).toBeNull()
  })
})
