import type { DocMeta, DocPosition, DocRecord, DocStorage, SteadySettings, StorageHealth } from '../store'

const HIDDEN_KEY = 'steadyreader:shelf-hidden'

interface HiddenEntry {
  sha: string
  ids: string[]
}

/**
 * Library view over [bundled shelf docs] + [device-stored docs] — the
 * steadyreader port of quickreader's ShelfStorage (#11 pattern).
 *
 * Bundled docs never round-trip through device storage — the bundle is their
 * durable copy (device creationStorage may be absent or lose async writes on
 * the R1). Deleting a bundled doc records its id in a small hidden list; the
 * list resets when the bundle changes, so a re-synced shelf restores its docs.
 */
export class ShelfDocStorage implements DocStorage {
  private bundled: Map<string, DocRecord>
  private hiddenIds: Set<string>

  constructor(
    bundled: DocRecord[],
    private sha: string,
    private delegate: DocStorage,
  ) {
    this.bundled = new Map(bundled.map((d) => [d.id, d]))
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

  async listDocs(): Promise<DocMeta[]> {
    const stored = await this.delegate.listDocs()
    const storedIds = new Set(stored.map((m) => m.id))
    const bundledMetas = [...this.bundled.values()]
      .filter((d) => !storedIds.has(d.id) && !this.hiddenIds.has(d.id))
      .map(({ chapters: _c, ...meta }) => meta)
    return [...bundledMetas, ...stored]
  }

  async loadDoc(id: string): Promise<DocRecord | null> {
    const bundled = this.bundled.get(id)
    if (bundled && !this.hiddenIds.has(id)) return bundled
    return this.delegate.loadDoc(id)
  }

  async deleteDoc(id: string): Promise<void> {
    if (this.bundled.has(id)) {
      this.hiddenIds.add(id)
      this.writeHidden(this.hiddenIds)
    }
    await this.delegate.deleteDoc(id)
  }

  async saveDoc(doc: DocRecord): Promise<void> {
    await this.delegate.saveDoc(doc)
  }

  async savePosition(id: string, pos: DocPosition): Promise<void> {
    await this.delegate.savePosition(id, pos)
  }

  async loadPosition(id: string): Promise<DocPosition | null> {
    return this.delegate.loadPosition(id)
  }

  async saveSettings(s: SteadySettings): Promise<void> {
    await this.delegate.saveSettings(s)
  }

  async loadSettings(): Promise<SteadySettings | null> {
    return this.delegate.loadSettings()
  }

  /** Coarse by design (#13): any visible bundled doc makes books 'bundle'. */
  health(): StorageHealth {
    const d = this.delegate.health()
    const anyBundled = [...this.bundled.values()].some((d2) => !this.hiddenIds.has(d2.id))
    return { books: anyBundled ? 'bundle' : d.books, progress: d.progress }
  }
}
