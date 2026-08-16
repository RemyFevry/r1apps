import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { MemoryStorage, type BookRecord } from 'r1-kit'
import { ShelfStorage } from '../src/ingestion/shelf'

function bundled(id: string): BookRecord {
  return {
    id,
    title: 'Bundled ' + id,
    author: 'S',
    wordCount: 3,
    addedAt: 1,
    sourceUrl: 'bundled',
    chapters: [{ title: 'c', words: ['a', 'b', 'c'], paras: [0] }],
  }
}

function stored(id: string): BookRecord {
  return {
    id,
    title: 'Stored ' + id,
    author: 'D',
    wordCount: 1,
    addedAt: 2,
    sourceUrl: 'https://x/' + id,
    chapters: [{ title: 'c', words: ['z'], paras: [0] }],
  }
}

let ls: Map<string, string>
beforeEach(() => {
  ls = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => ls.get(k) ?? null,
      setItem: (k: string, v: string) => void ls.set(k, v),
      removeItem: (k: string) => void ls.delete(k),
    },
  })
})
afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage
})

describe('ShelfStorage', () => {
  test('lists bundled and stored books together, without chapters', async () => {
    const s = new ShelfStorage([bundled('shelf-1')], 'sha1', new MemoryStorage())
    await s.saveBook(stored('url-1'))
    const metas = await s.listBooks()
    expect(metas.map((m) => m.id)).toEqual(['shelf-1', 'url-1'])
    expect(metas[0]).not.toHaveProperty('chapters')
  })

  test('serves bundled books from the bundle, not storage', async () => {
    const mem = new MemoryStorage()
    const s = new ShelfStorage([bundled('shelf-1')], 'sha1', mem)
    expect(await s.loadBook('shelf-1')).toEqual(bundled('shelf-1'))
    expect(await mem.loadBook('shelf-1')).toBeNull()
  })

  test('deleting a bundled book hides it and clears its position; reload keeps it hidden', async () => {
    const s = new ShelfStorage([bundled('shelf-1')], 'sha1', new MemoryStorage())
    await s.savePosition('shelf-1', { chapter: 0, wordIndex: 1, wpm: 300 })
    await s.deleteBook('shelf-1')
    expect((await s.listBooks()).map((m) => m.id)).toEqual([])
    expect(await s.loadBook('shelf-1')).toBeNull()
    expect(await s.loadPosition('shelf-1')).toBeNull()

    const reopened = new ShelfStorage([bundled('shelf-1')], 'sha1', new MemoryStorage())
    expect((await reopened.listBooks()).map((m) => m.id)).toEqual([])
  })

  test('a changed bundle restores hidden books', async () => {
    const s = new ShelfStorage([bundled('shelf-1')], 'sha1', new MemoryStorage())
    await s.deleteBook('shelf-1')
    const resynced = new ShelfStorage([bundled('shelf-1')], 'sha2', new MemoryStorage())
    expect((await resynced.listBooks()).map((m) => m.id)).toEqual(['shelf-1'])
  })

  test('positions and settings delegate through', async () => {
    const s = new ShelfStorage([bundled('shelf-1')], 'sha1', new MemoryStorage())
    await s.savePosition('shelf-1', { chapter: 1, wordIndex: 2, wpm: 420 })
    expect(await s.loadPosition('shelf-1')).toEqual({ chapter: 1, wordIndex: 2, wpm: 420 })
    const settings = { defaultWpm: 250, orp: false, font: 'L' as const, pacing: 'snappy' as const }
    await s.saveSettings(settings)
    expect(await s.loadSettings()).toEqual(settings)
  })

  test('survives without localStorage (deletion just does not persist)', async () => {
    delete (globalThis as Record<string, unknown>).localStorage
    const s = new ShelfStorage([bundled('shelf-1')], 'sha1', new MemoryStorage())
    await s.deleteBook('shelf-1')
    expect((await s.listBooks()).map((m) => m.id)).toEqual([])
    const reopened = new ShelfStorage([bundled('shelf-1')], 'sha1', new MemoryStorage())
    expect((await reopened.listBooks()).map((m) => m.id)).toEqual(['shelf-1'])
  })

  test('health: books are bundle-backed while any bundled book is visible; progress is the delegate\'s (#13)', async () => {
    const s = new ShelfStorage([bundled('shelf-1')], 'sha1', new MemoryStorage())
    expect(s.health()).toEqual({ books: 'bundle', progress: 'session' })
    await s.deleteBook('shelf-1')
    expect(s.health()).toEqual({ books: 'session', progress: 'session' })
  })
})
