import { beforeEach, describe, expect, test } from 'vitest'
import { DeviceStorage, MemoryStorage, fromB64, toB64, type BookRecord, type Settings } from '../src/storage'

function book(id: string, title: string, addedAt = 1000): BookRecord {
  return {
    id,
    title,
    author: 'Jane',
    wordCount: 10,
    addedAt,
    sourceUrl: 'https://example.com/' + id + '.epub',
    chapters: [{ title: 'One', words: ['a', 'b'], paras: [0] }],
  }
}

const settings: Settings = { defaultWpm: 320, orp: false, font: 'L', pacing: 'snappy' }

describe('MemoryStorage', () => {
  test('book and index round-trip', async () => {
    const s = new MemoryStorage()
    await s.saveBook(book('x', 'Book X'))
    await s.saveBook(book('y', 'Book Y', 2000))
    const metas = await s.listBooks()
    expect(metas.map((m) => m.id)).toEqual(['y', 'x'])
    expect(metas[0]).not.toHaveProperty('chapters')
    const loaded = await s.loadBook('x')
    expect(loaded?.chapters[0].words).toEqual(['a', 'b'])
    await s.deleteBook('x')
    expect(await s.loadBook('x')).toBeNull()
    expect((await s.listBooks()).map((m) => m.id)).toEqual(['y'])
  })

  test('positions and settings round-trip', async () => {
    const s = new MemoryStorage()
    await s.savePosition('x', { chapter: 1, wordIndex: 42, wpm: 400, frac: 0.5 })
    expect(await s.loadPosition('x')).toEqual({ chapter: 1, wordIndex: 42, wpm: 400, frac: 0.5 })
    await s.saveSettings(settings)
    expect(await s.loadSettings()).toEqual(settings)
    expect(await s.loadPosition('nope')).toBeNull()
  })
})

describe('DeviceStorage', () => {
  let store: Map<string, string>
  let ls: Map<string, string>

  function fakeArea() {
    return {
      async getItem(k: string) {
        return store.get(k) ?? null
      },
      async setItem(k: string, v: string) {
        store.set(k, v)
      },
      async removeItem(k: string) {
        store.delete(k)
      },
    }
  }

  beforeEach(() => {
    store = new Map()
    ls = new Map()
    ;(globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => ls.get(k) ?? null,
      setItem: (k: string, v: string) => void ls.set(k, v),
      removeItem: (k: string) => void ls.delete(k),
    }
  })

  test('stores base64 unicode-safe books and updates the index', async () => {
    const s = new DeviceStorage(fakeArea())
    const b = book('x', 'Café ☕ 日本語')
    await s.saveBook(b)
    const raw = store.get('book:x')!
    expect(() => atob(raw)).not.toThrow()
    expect(JSON.parse(fromB64(raw)).title).toBe('Café ☕ 日本語')
    expect((await s.listBooks()).map((m) => m.title)).toEqual(['Café ☕ 日本語'])
    await s.saveBook({ ...b, title: 'Renamed' })
    expect(await s.listBooks()).toHaveLength(1)
  })

  test('positions in localStorage, delete clears them', async () => {
    const s = new DeviceStorage(fakeArea())
    await s.savePosition('x', { chapter: 0, wordIndex: 3, wpm: 300 })
    expect(ls.get('quickreader:pos:x')).toBe('{"chapter":0,"wordIndex":3,"wpm":300}')
    await s.saveSettings(settings)
    expect(await s.loadSettings()).toEqual(settings)
    await s.saveBook(book('x', 'T'))
    await s.deleteBook('x')
    expect(ls.has('quickreader:pos:x')).toBe(false)
    expect(await s.listBooks()).toEqual([])
    expect(store.has('pos:x')).toBe(false)
  })

  test('positions mirror to creationStorage and load falls back when localStorage is empty', async () => {
    const s = new DeviceStorage(fakeArea())
    await s.savePosition('x', { chapter: 2, wordIndex: 45, wpm: 350, frac: 0.3 })
    expect(store.has('pos:x')).toBe(true)
    ls.delete('quickreader:pos:x')
    expect(await s.loadPosition('x')).toEqual({ chapter: 2, wordIndex: 45, wpm: 350, frac: 0.3 })
  })

  test('settings mirror and fall back the same way', async () => {
    const s = new DeviceStorage(fakeArea())
    await s.saveSettings(settings)
    ls.delete('quickreader:settings')
    expect(await s.loadSettings()).toEqual(settings)
  })
})

test('b64 helpers round-trip unicode', () => {
  const s = 'naïve — résumé 📚 "quotes"'
  expect(fromB64(toB64(s))).toBe(s)
})
