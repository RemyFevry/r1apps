export interface Chapter {
  title: string
  words: string[]
  paras: number[]
}

export interface BookMeta {
  id: string
  title: string
  author: string
  wordCount: number
  addedAt: number
  sourceUrl: string
}

export interface BookRecord extends BookMeta {
  chapters: Chapter[]
}

export interface Position {
  chapter: number
  wordIndex: number
  wpm: number
  frac?: number
}

export type FontSize = 'S' | 'M' | 'L'
export type Pacing = 'relaxed' | 'standard' | 'snappy'

export const FONT_ORDER: FontSize[] = ['S', 'M', 'L']
export const PACING_ORDER: Pacing[] = ['relaxed', 'standard', 'snappy']

export interface Settings {
  defaultWpm: number
  orp: boolean
  font: FontSize
  pacing: Pacing
}

export interface Storage {
  saveBook(book: BookRecord): Promise<void>
  loadBook(id: string): Promise<BookRecord | null>
  listBooks(): Promise<BookMeta[]>
  deleteBook(id: string): Promise<void>
  savePosition(id: string, pos: Position): Promise<void>
  loadPosition(id: string): Promise<Position | null>
  saveSettings(s: Settings): Promise<void>
  loadSettings(): Promise<Settings | null>
}

export const DEFAULT_SETTINGS: Settings = {
  defaultWpm: 300,
  orp: true,
  font: 'M',
  pacing: 'standard',
}

export function toB64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

export function fromB64(b: string): string {
  const bin = atob(b)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export interface CreationStorageArea {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<unknown>
  removeItem(key: string): Promise<unknown>
}

const BOOK_PREFIX = 'book:'
const INDEX_KEY = 'library:index'
const POS_PREFIX = 'quickreader:pos:'
const SETTINGS_KEY = 'quickreader:settings'
const CS_POS_PREFIX = 'pos:'
const CS_SETTINGS_KEY = 'settings'

export class DeviceStorage implements Storage {
  /** Session-only fallback when creationStorage is (yet) unavailable. */
  private memBooks = new Map<string, BookRecord>()
  private memIndex: BookMeta[] = []

  constructor(
    private cs: CreationStorageArea | (() => CreationStorageArea | undefined),
  ) {}

  private area(): CreationStorageArea | undefined {
    return typeof this.cs === 'function' ? this.cs() : this.cs
  }

  private async writeIndex(metas: BookMeta[]): Promise<void> {
    const cs = this.area()
    if (!cs) {
      this.memIndex = metas
      return
    }
    await cs.setItem(INDEX_KEY, toB64(JSON.stringify(metas)))
  }

  async saveBook(book: BookRecord): Promise<void> {
    const cs = this.area()
    if (!cs) {
      this.memBooks.set(book.id, book)
      this.memIndex = this.memIndex.filter((m) => m.id !== book.id)
      this.memIndex.unshift({ id: book.id, title: book.title, author: book.author, wordCount: book.wordCount, addedAt: book.addedAt, sourceUrl: book.sourceUrl })
      return
    }
    await cs.setItem(BOOK_PREFIX + book.id, toB64(JSON.stringify(book)))
    const next = (await this.listBooks()).filter((m) => m.id !== book.id)
    next.unshift({ id: book.id, title: book.title, author: book.author, wordCount: book.wordCount, addedAt: book.addedAt, sourceUrl: book.sourceUrl })
    await this.writeIndex(next)
  }

  async loadBook(id: string): Promise<BookRecord | null> {
    const cs = this.area()
    if (!cs) return this.memBooks.get(id) ?? null
    const raw = await cs.getItem(BOOK_PREFIX + id)
    return raw ? (JSON.parse(fromB64(raw)) as BookRecord) : null
  }

  async listBooks(): Promise<BookMeta[]> {
    const cs = this.area()
    if (!cs) return [...this.memIndex]
    const raw = await cs.getItem(INDEX_KEY)
    return raw ? (JSON.parse(fromB64(raw)) as BookMeta[]) : []
  }

  async deleteBook(id: string): Promise<void> {
    const cs = this.area()
    if (cs) {
      await cs.removeItem(BOOK_PREFIX + id)
      await this.writeIndex((await this.listBooks()).filter((m) => m.id !== id))
      void cs.removeItem(CS_POS_PREFIX + id).catch(() => {})
    } else {
      this.memBooks.delete(id)
      this.memIndex = this.memIndex.filter((m) => m.id !== id)
    }
    localStorage.removeItem(POS_PREFIX + id)
  }

  async savePosition(id: string, pos: Position): Promise<void> {
    const raw = JSON.stringify(pos)
    localStorage.setItem(POS_PREFIX + id, raw)
    // Mirror to creationStorage: on firmware where localStorage does not
    // survive a webview restart, this is the durable copy. Small records
    // (the earlier failure mode was whole-book writes).
    const cs = this.area()
    if (cs) void cs.setItem(CS_POS_PREFIX + id, toB64(raw)).catch(() => {})
  }

  async loadPosition(id: string): Promise<Position | null> {
    const raw = localStorage.getItem(POS_PREFIX + id)
    if (raw) {
      try {
        return JSON.parse(raw) as Position
      } catch {
        // fall through to the mirror
      }
    }
    const cs = this.area()
    const mirrored = cs ? await cs.getItem(CS_POS_PREFIX + id).catch(() => null) : null
    if (mirrored) {
      try {
        return JSON.parse(fromB64(mirrored)) as Position
      } catch {
        return null
      }
    }
    return null
  }

  async saveSettings(s: Settings): Promise<void> {
    const raw = JSON.stringify(s)
    localStorage.setItem(SETTINGS_KEY, raw)
    const cs = this.area()
    if (cs) void cs.setItem(CS_SETTINGS_KEY, toB64(raw)).catch(() => {})
  }

  async loadSettings(): Promise<Settings | null> {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      try {
        return JSON.parse(raw) as Settings
      } catch {
        // fall through to the mirror
      }
    }
    const cs = this.area()
    const mirrored = cs ? await cs.getItem(CS_SETTINGS_KEY).catch(() => null) : null
    if (mirrored) {
      try {
        return JSON.parse(fromB64(mirrored)) as Settings
      } catch {
        return null
      }
    }
    return null
  }
}

export class MemoryStorage implements Storage {
  private books = new Map<string, BookRecord>()
  private positions = new Map<string, Position>()
  private settings: Settings | null = null

  async saveBook(book: BookRecord): Promise<void> {
    this.books.set(book.id, book)
  }

  async loadBook(id: string): Promise<BookRecord | null> {
    return this.books.get(id) ?? null
  }

  async listBooks(): Promise<BookMeta[]> {
    return [...this.books.values()]
      .map(({ chapters: _c, ...meta }) => meta)
      .sort((a, b) => b.addedAt - a.addedAt)
  }

  async deleteBook(id: string): Promise<void> {
    this.books.delete(id)
    this.positions.delete(id)
  }

  async savePosition(id: string, pos: Position): Promise<void> {
    this.positions.set(id, pos)
  }

  async loadPosition(id: string): Promise<Position | null> {
    return this.positions.get(id) ?? null
  }

  async saveSettings(s: Settings): Promise<void> {
    this.settings = s
  }

  async loadSettings(): Promise<Settings | null> {
    return this.settings
  }
}

function getCreationStorage(): CreationStorageArea | undefined {
  return (globalThis as { creationStorage?: { plain?: CreationStorageArea } }).creationStorage?.plain
}

export function hasCreationStorage(): boolean {
  return getCreationStorage() != null
}

export type StorageHealth = 'device' | 'write-lost' | 'absent'

/** Write→read-back probe: a fire-and-forget bridge reports write-lost. */
export async function probeDeviceStorage(): Promise<StorageHealth> {
  const area = getCreationStorage()
  if (!area) return 'absent'
  try {
    const token = 'probe-' + Date.now().toString(36)
    await area.setItem('r1kit:probe', toB64(token))
    const back = await area.getItem('r1kit:probe')
    void area.removeItem('r1kit:probe').catch(() => {})
    return back != null && fromB64(back) === token ? 'device' : 'write-lost'
  } catch {
    return 'write-lost'
  }
}

export function createStorage(): Storage {
  return new DeviceStorage(getCreationStorage)
}
