import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { MemoryStorage, type BookRecord } from 'r1-kit'
import { ensureBundledBooks } from '../src/ingestion/bundled'

function book(id: string): BookRecord {
  return {
    id,
    title: 'Book ' + id,
    author: 'A',
    wordCount: 2,
    addedAt: 1,
    sourceUrl: 'bundled',
    chapters: [{ title: 'c', words: ['x', 'y'], paras: [0] }],
  }
}

let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  })
})
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage
})

describe('ensureBundledBooks', () => {
  test('saves missing books once and skips when the bundle sha is unchanged', async () => {
    const s = new MemoryStorage()
    await ensureBundledBooks(s, [book('a'), book('b')], 'sha1')
    expect((await s.listBooks()).map((m) => m.id).sort()).toEqual(['a', 'b'])
    await s.deleteBook('a')
    await ensureBundledBooks(s, [book('a'), book('b')], 'sha1')
    expect((await s.listBooks()).map((m) => m.id)).toEqual(['b'])
  })

  test('a new bundle sha restores missing books but keeps existing records intact', async () => {
    const s = new MemoryStorage()
    await ensureBundledBooks(s, [book('a')], 'sha1')
    const before = await s.loadBook('a')
    await s.deleteBook('a')
    await ensureBundledBooks(s, [book('a'), book('c')], 'sha2')
    expect((await s.listBooks()).map((m) => m.id).sort()).toEqual(['a', 'c'])
    expect(await s.loadBook('a')).toEqual(before)
  })

  test('no books is a no-op', async () => {
    const s = new MemoryStorage()
    await ensureBundledBooks(s, [], 'sha1')
    expect(await s.listBooks()).toEqual([])
  })
})
