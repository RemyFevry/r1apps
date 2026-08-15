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

export class DeviceStorage implements Storage {
  constructor(private cs: CreationStorageArea) {}

  private async writeIndex(metas: BookMeta[]): Promise<void> {
    await this.cs.setItem(INDEX_KEY, toB64(JSON.stringify(metas)))
  }

  async saveBook(book: BookRecord): Promise<void> {
    await this.cs.setItem(BOOK_PREFIX + book.id, toB64(JSON.stringify(book)))
    const metas = await this.listBooks()
    const next = metas.filter((m) => m.id !== book.id)
    next.unshift({ id: book.id, title: book.title, author: book.author, wordCount: book.wordCount, addedAt: book.addedAt, sourceUrl: book.sourceUrl })
    await this.writeIndex(next)
  }

  async loadBook(id: string): Promise<BookRecord | null> {
    const raw = await this.cs.getItem(BOOK_PREFIX + id)
    return raw ? (JSON.parse(fromB64(raw)) as BookRecord) : null
  }

  async listBooks(): Promise<BookMeta[]> {
    const raw = await this.cs.getItem(INDEX_KEY)
    return raw ? (JSON.parse(fromB64(raw)) as BookMeta[]) : []
  }

  async deleteBook(id: string): Promise<void> {
    await this.cs.removeItem(BOOK_PREFIX + id)
    await this.writeIndex((await this.listBooks()).filter((m) => m.id !== id))
    localStorage.removeItem(POS_PREFIX + id)
  }

  async savePosition(id: string, pos: Position): Promise<void> {
    localStorage.setItem(POS_PREFIX + id, JSON.stringify(pos))
  }

  async loadPosition(id: string): Promise<Position | null> {
    const raw = localStorage.getItem(POS_PREFIX + id)
    return raw ? (JSON.parse(raw) as Position) : null
  }

  async saveSettings(s: Settings): Promise<void> {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  }

  async loadSettings(): Promise<Settings | null> {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? (JSON.parse(raw) as Settings) : null
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

export function createStorage(): Storage {
  const cs = (globalThis as { creationStorage?: { plain?: CreationStorageArea } }).creationStorage
  if (cs && cs.plain) return new DeviceStorage(cs.plain)
  return new MemoryStorage()
}
