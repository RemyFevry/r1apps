import { describe, expect, it } from 'vitest'
import { MemoryDocStorage, type DocRecord } from '../src/store'
import { ShelfDocStorage } from '../src/ingestion/shelf'

function bundled(id: string, title: string): DocRecord {
  return {
    id,
    title,
    author: 'A',
    wordCount: 6,
    addedAt: 1,
    sourceUrl: 'bundled',
    kind: 'epub',
    chapters: [{ title: 'C', paragraphs: ['One two three.', 'Four five six.'] }],
  }
}

function stored(id: string, title: string): DocRecord {
  return { ...bundled(id, title), addedAt: 2, sourceUrl: 'https://x' }
}

describe('ShelfDocStorage (bundled docs over the device seam)', () => {
  it('lists bundled plus stored, hiding deleted-bundled; a stored copy shadows the bundle entry', async () => {
    const delegate = new MemoryDocStorage()
    await delegate.saveDoc(stored('s1', 'Stored'))
    await delegate.saveDoc(stored('b1', 'Shadowed stored copy'))
    const shelf = new ShelfDocStorage([bundled('b1', 'Bundled One'), bundled('b2', 'Bundled Two')], 'sha1', delegate)
    const metas = await shelf.listDocs()
    // b1's stored copy shadows its bundle entry (no duplicate); b2 lists from the bundle
    expect(metas.map((m) => m.id)).toEqual(['b2', 's1', 'b1'])
    expect(metas.find((m) => m.id === 'b1')?.sourceUrl).toBe('https://x')
    // loadDoc serves the stored copy over the bundle for shadowed ids
    expect((await shelf.loadDoc('b1'))?.sourceUrl).toBe('bundled')
  })

  it('serves bundled docs from the bundle, never round-tripping device storage', async () => {
    const delegate = new MemoryDocStorage()
    const shelf = new ShelfDocStorage([bundled('b1', 'Bundled One')], 'sha1', delegate)
    expect(await shelf.loadDoc('b1')).toMatchObject({ title: 'Bundled One', sourceUrl: 'bundled' })
    await delegate.saveDoc(stored('b1', 'Stored shadow'))
    expect(await delegate.loadDoc('b1')).not.toBeNull()
    const again = await shelf.loadDoc('b1')
    expect(again?.sourceUrl).toBe('bundled')
  })

  it('deleting a bundled doc hides it; a bundle change (new sha) restores it', async () => {
    const delegate = new MemoryDocStorage()
    const shelf = new ShelfDocStorage([bundled('b1', 'Bundled One')], 'sha1', delegate)
    await shelf.deleteDoc('b1')
    expect((await shelf.listDocs()).map((m) => m.id)).toEqual([])
    const resynced = new ShelfDocStorage([bundled('b1', 'Bundled One')], 'sha2', delegate)
    expect((await resynced.listDocs()).map((m) => m.id)).toEqual(['b1'])
  })

  it('saving goes to the delegate; positions and settings pass through', async () => {
    const delegate = new MemoryDocStorage()
    const shelf = new ShelfDocStorage([bundled('b1', 'Bundled One')], 'sha-save', delegate)
    await shelf.saveDoc(stored('s1', 'Stored'))
    expect(await delegate.loadDoc('s1')).not.toBeNull()
    await shelf.savePosition('b1', { chapter: 0, wordIndex: 3, wpm: 300, audioOn: true })
    expect(await delegate.loadPosition('b1')).toMatchObject({ wordIndex: 3, audioOn: true })
    await shelf.saveSettings({ ...(await shelf.loadSettings())!, engine: 'elevenlabs' })
    expect((await delegate.loadSettings())?.engine).toBe('elevenlabs')
  })

  it('health reports bundle for books while any bundled doc is visible', async () => {
    const delegate = new MemoryDocStorage()
    // Unique sha: the hidden list persists in ambient localStorage where it
    // exists (CI node), so a shared sha would leak deletions across tests.
    const shelf = new ShelfDocStorage([bundled('b1', 'Bundled One')], 'sha-health', delegate)
    expect(shelf.health().books).toBe('bundle')
    await shelf.deleteDoc('b1')
    expect(shelf.health().books).toBe('session')
  })
})
