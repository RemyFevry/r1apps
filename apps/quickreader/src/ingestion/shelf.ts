import type { BookMeta, BookRecord, Position, Settings, Storage, StorageHealth } from 'r1-kit'

const HIDDEN_KEY = 'quickreader:shelf-hidden'

interface HiddenEntry {
  sha: string
  ids: string[]
}

/**
 * Library view over [bundled shelf books] + [device-stored books].
 *
 * Bundled books never round-trip through device storage — the bundle is their
 * durable copy (device creationStorage may be absent or lose async writes on
 * the R1, which stranded the library after the first open). Deleting a bundled
 * book records its id in a small hidden list; the list resets when the bundle
 * changes, so a re-synced shelf restores its books.
 */
export class ShelfStorage implements Storage {
  private bundled: Map<string, BookRecord>
  private hiddenIds: Set<string>

  constructor(
    bundled: BookRecord[],
    private sha: string,
    private delegate: Storage,
  ) {
    this.bundled = new Map(bundled.map((b) => [b.id, b]))
    this.hiddenIds = this.readHidden()
  }

  private readHidden(): Set<string> {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(HIDDEN_KEY) : null
      if (!raw) return new Set()
      const entry = JSON.parse(raw) as HiddenEntry
      if (entry.sha !== this.sha) return new Set()
      return new Set(entry.ids)
    } catch {
      return new Set()
    }
  }

  private writeHidden(ids: Set<string>): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify({ sha: this.sha, ids: [...ids] } satisfies HiddenEntry))
      }
    } catch {
      // best-effort: deletion just won't survive a reload
    }
  }

  async listBooks(): Promise<BookMeta[]> {
    const stored = await this.delegate.listBooks()
    const storedIds = new Set(stored.map((m) => m.id))
    const bundledMetas = [...this.bundled.values()]
      .filter((b) => !storedIds.has(b.id) && !this.hiddenIds.has(b.id))
      .map(({ chapters: _c, ...meta }) => meta)
    return [...bundledMetas, ...stored]
  }

  async loadBook(id: string): Promise<BookRecord | null> {
    const bundled = this.bundled.get(id)
    if (bundled && !this.hiddenIds.has(id)) return bundled
    return this.delegate.loadBook(id)
  }

  async deleteBook(id: string): Promise<void> {
    if (this.bundled.has(id)) {
      this.hiddenIds.add(id)
      this.writeHidden(this.hiddenIds)
    }
    await this.delegate.deleteBook(id)
  }

  async saveBook(book: BookRecord): Promise<void> {
    await this.delegate.saveBook(book)
  }

  async savePosition(id: string, pos: Position): Promise<void> {
    await this.delegate.savePosition(id, pos)
  }

  async loadPosition(id: string): Promise<Position | null> {
    return this.delegate.loadPosition(id)
  }

  async saveSettings(s: Settings): Promise<void> {
    await this.delegate.saveSettings(s)
  }

  async loadSettings(): Promise<Settings | null> {
    return this.delegate.loadSettings()
  }

  /**
   * Coarse by design (#13): with any bundled book visible, books report 'bundle'
   * (those are durable regardless of device storage); progress is always the
   * delegate's answer. A shelf build with broken device storage must not read
   * storage:broken for books that are fine.
   */
  health(): StorageHealth {
    const d = this.delegate.health()
    const anyBundled = [...this.bundled.values()].some((b) => !this.hiddenIds.has(b.id))
    return { books: anyBundled ? 'bundle' : d.books, progress: d.progress }
  }
}
