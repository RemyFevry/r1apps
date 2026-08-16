import { describe, expect, it, beforeEach } from 'vitest'
import { toB64, fromB64, type CreationStorageArea } from 'r1-kit'
import {
  DEFAULT_STEADY_SETTINGS,
  DeviceDocStorage,
  MemoryDocStorage,
  type DocRecord,
} from '../src/store'

function fakeArea(): CreationStorageArea & { dump: Map<string, string> } {
  const dump = new Map<string, string>()
  return {
    dump,
    getItem: (k) => Promise.resolve(dump.get(k) ?? null),
    setItem: (k, v) => {
      dump.set(k, v)
      return Promise.resolve()
    },
    removeItem: (k) => {
      dump.delete(k)
      return Promise.resolve()
    },
  }
}

function fakeLocalStorage(): Storage {
  const dump = new Map<string, string>()
  return {
    get length() {
      return dump.size
    },
    clear: () => dump.clear(),
    getItem: (k) => dump.get(k) ?? null,
    key: (i) => [...dump.keys()][i] ?? null,
    removeItem: (k) => void dump.delete(k),
    setItem: (k, v) => void dump.set(k, v),
  } as Storage
}

function doc(id: string, addedAt: number): DocRecord {
  return {
    id,
    title: 'Doc ' + id,
    author: 'A',
    wordCount: 3,
    addedAt,
    sourceUrl: 'https://x/' + id,
    kind: 'article',
    chapters: [{ title: 'C', paragraphs: ['One two three.'] }],
  }
}

describe('MemoryDocStorage', () => {
  let s: MemoryDocStorage
  beforeEach(() => {
    s = new MemoryDocStorage()
  })

  it('round-trips documents and lists newest-first without chapter payloads', async () => {
    await s.saveDoc(doc('a', 1))
    await s.saveDoc(doc('b', 2))
    const metas = await s.listDocs()
    expect(metas.map((m) => m.id)).toEqual(['b', 'a'])
    expect(metas[0]).not.toHaveProperty('chapters')
    const loaded = await s.loadDoc('a')
    expect(loaded?.chapters[0].paragraphs).toEqual(['One two three.'])
  })

  it('deletes documents and their positions', async () => {
    await s.saveDoc(doc('a', 1))
    await s.savePosition('a', { chapter: 0, wordIndex: 1, wpm: 300, audioOn: true })
    await s.deleteDoc('a')
    expect(await s.loadDoc('a')).toBeNull()
    expect(await s.loadPosition('a')).toBeNull()
  })

  it('round-trips positions with audioOn and settings', async () => {
    await s.savePosition('a', { chapter: 2, wordIndex: 5, wpm: 260, audioOn: true })
    expect(await s.loadPosition('a')).toEqual({ chapter: 2, wordIndex: 5, wpm: 260, audioOn: true })
    await s.saveSettings({ ...DEFAULT_STEADY_SETTINGS, engine: 'elevenlabs' })
    expect((await s.loadSettings())?.engine).toBe('elevenlabs')
  })
})

describe('DeviceDocStorage', () => {
  let area: ReturnType<typeof fakeArea>
  let ls: Storage

  beforeEach(() => {
    area = fakeArea()
    ls = fakeLocalStorage()
    ;(globalThis as { localStorage?: Storage }).localStorage = ls
  })

  it('stores docs + index in creationStorage, base64-encoded', async () => {
    const s = new DeviceDocStorage(area)
    await s.saveDoc(doc('a', 1))
    expect(area.dump.has('doc:a')).toBe(true)
    expect(JSON.parse(fromB64(area.dump.get('doc:a')!)).id).toBe('a')
    expect(JSON.parse(fromB64(area.dump.get('index')!))[0].id).toBe('a')
  })

  it('keeps positions in localStorage, mirrored to creationStorage, loads from the mirror when ls is empty', async () => {
    const s = new DeviceDocStorage(area)
    await s.savePosition('a', { chapter: 0, wordIndex: 2, wpm: 300, audioOn: false })
    expect(JSON.parse(ls.getItem('steadyreader:pos:a')!)).toEqual({ chapter: 0, wordIndex: 2, wpm: 300, audioOn: false })
    expect(area.dump.has('pos:a')).toBe(true)
    ls.removeItem('steadyreader:pos:a')
    expect(await s.loadPosition('a')).toEqual({ chapter: 0, wordIndex: 2, wpm: 300, audioOn: false })
  })

  it('deleteDoc clears both position copies', async () => {
    const s = new DeviceDocStorage(area)
    await s.saveDoc(doc('a', 1))
    await s.savePosition('a', { chapter: 0, wordIndex: 0, wpm: 300, audioOn: false })
    await s.deleteDoc('a')
    expect(ls.getItem('steadyreader:pos:a')).toBeNull()
    expect(area.dump.has('pos:a')).toBe(false)
    expect(await s.listDocs()).toEqual([])
  })

  it('falls back to in-memory session storage when the area is absent', async () => {
    const s = new DeviceDocStorage(() => undefined)
    await s.saveDoc(doc('a', 1))
    expect((await s.listDocs()).map((m) => m.id)).toEqual(['a'])
    expect((await s.loadDoc('a'))?.title).toBe('Doc a')
    await s.deleteDoc('a')
    expect(await s.loadDoc('a')).toBeNull()
  })

  it('encodes unicode docs losslessly through base64', async () => {
    const s = new DeviceDocStorage(area)
    await s.saveDoc({ ...doc('u', 1), title: 'Café ☕ 书' })
    expect((await s.loadDoc('u'))?.title).toBe('Café ☕ 书')
  })
})

describe('toB64 sanity (r1-kit re-export used by the seam)', () => {
  it('is unicode-safe', () => {
    expect(fromB64(toB64('don’t “quote” — 书'))).toBe('don’t “quote” — 书')
  })
})
