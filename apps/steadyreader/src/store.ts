import { fromB64, probeDeviceStorage, toB64, type CreationStorageArea, type DocChapter, type FontSize, type Pacing, type StorageHealth as KitStorageHealth, type StorageProbeResult } from 'r1-kit'

export type StorageHealth = KitStorageHealth

export type DocKind = 'epub' | 'article'

export interface DocMeta {
  id: string
  title: string
  author: string
  wordCount: number
  addedAt: number
  sourceUrl: string
  kind: DocKind
}

export interface DocRecord extends DocMeta {
  chapters: DocChapter[]
}

export interface DocPosition {
  chapter: number
  wordIndex: number
  wpm: number
  audioOn: boolean
  /** Progress through the whole document, 0..1. */
  frac?: number
}

export type EngineId = 'rabbit' | 'elevenlabs'

export interface SteadySettings {
  defaultWpm: number
  font: FontSize
  pacing: Pacing
  engine: EngineId
  elevenVoice: string
  elevenKey: string
}

export const DEFAULT_STEADY_SETTINGS: SteadySettings = {
  defaultWpm: 300,
  font: 'M',
  pacing: 'standard',
  engine: 'rabbit',
  elevenVoice: '',
  elevenKey: '',
}

export interface DocStorage {
  saveDoc(doc: DocRecord): Promise<void>
  loadDoc(id: string): Promise<DocRecord | null>
  listDocs(): Promise<DocMeta[]>
  deleteDoc(id: string): Promise<void>
  savePosition(id: string, pos: DocPosition): Promise<void>
  loadPosition(id: string): Promise<DocPosition | null>
  saveSettings(s: SteadySettings): Promise<void>
  loadSettings(): Promise<SteadySettings | null>
  /** What this adapter actually guarantees, per kind of data (r1-kit #13 pattern). */
  health(): StorageHealth
}

const DOC_PREFIX = 'doc:'
const INDEX_KEY = 'index'
const POS_PREFIX = 'steadyreader:pos:'
const SETTINGS_KEY = 'steadyreader:settings'
const CS_POS_PREFIX = 'pos:'
const CS_SETTINGS_KEY = 'settings'

export class DeviceDocStorage implements DocStorage {
  private memDocs = new Map<string, DocRecord>()
  private memIndex: DocMeta[] = []
  private probeResult: StorageProbeResult | null = null

  constructor(private cs: CreationStorageArea | (() => CreationStorageArea | undefined)) {}

  health(): StorageHealth {
    const area = this.area()
    if (!area) return { books: 'session', progress: 'session' }
    if (this.probeResult == null) {
      void probeDeviceStorage(() => area).then((r) => {
        this.probeResult = r
      })
      return { books: 'device', progress: 'session' } // optimistic until the probe lands
    }
    if (this.probeResult === 'write-lost') return { books: 'write-lost', progress: 'session' }
    return { books: 'device', progress: this.probeResult === 'device' ? 'device' : 'session' }
  }

  private area(): CreationStorageArea | undefined {
    return typeof this.cs === 'function' ? this.cs() : this.cs
  }

  private metaOf(doc: DocRecord): DocMeta {
    const { chapters: _c, ...meta } = doc
    return meta
  }

  private async writeIndex(metas: DocMeta[]): Promise<void> {
    const cs = this.area()
    if (!cs) {
      this.memIndex = metas
      return
    }
    await cs.setItem(INDEX_KEY, toB64(JSON.stringify(metas)))
  }

  async saveDoc(doc: DocRecord): Promise<void> {
    const cs = this.area()
    if (!cs) {
      this.memDocs.set(doc.id, doc)
      this.memIndex = this.memIndex.filter((m) => m.id !== doc.id)
      this.memIndex.unshift(this.metaOf(doc))
      return
    }
    await cs.setItem(DOC_PREFIX + doc.id, toB64(JSON.stringify(doc)))
    const next = (await this.listDocs()).filter((m) => m.id !== doc.id)
    next.unshift(this.metaOf(doc))
    await this.writeIndex(next)
  }

  async loadDoc(id: string): Promise<DocRecord | null> {
    const cs = this.area()
    if (!cs) return this.memDocs.get(id) ?? null
    const raw = await cs.getItem(DOC_PREFIX + id)
    return raw ? (JSON.parse(fromB64(raw)) as DocRecord) : null
  }

  async listDocs(): Promise<DocMeta[]> {
    const cs = this.area()
    if (!cs) return [...this.memIndex]
    const raw = await cs.getItem(INDEX_KEY)
    return raw ? (JSON.parse(fromB64(raw)) as DocMeta[]) : []
  }

  async deleteDoc(id: string): Promise<void> {
    const cs = this.area()
    if (cs) {
      await cs.removeItem(DOC_PREFIX + id)
      await this.writeIndex((await this.listDocs()).filter((m) => m.id !== id))
      void cs.removeItem(CS_POS_PREFIX + id).catch(() => {})
    } else {
      this.memDocs.delete(id)
      this.memIndex = this.memIndex.filter((m) => m.id !== id)
    }
    localStorage.removeItem(POS_PREFIX + id)
  }

  async savePosition(id: string, pos: DocPosition): Promise<void> {
    const raw = JSON.stringify(pos)
    localStorage.setItem(POS_PREFIX + id, raw)
    const cs = this.area()
    if (cs) void cs.setItem(CS_POS_PREFIX + id, toB64(raw)).catch(() => {})
  }

  async loadPosition(id: string): Promise<DocPosition | null> {
    const raw = localStorage.getItem(POS_PREFIX + id)
    if (raw) {
      try {
        return JSON.parse(raw) as DocPosition
      } catch {
        // fall through to the mirror
      }
    }
    const cs = this.area()
    const mirrored = cs ? await cs.getItem(CS_POS_PREFIX + id).catch(() => null) : null
    if (mirrored) {
      try {
        return JSON.parse(fromB64(mirrored)) as DocPosition
      } catch {
        return null
      }
    }
    return null
  }

  async saveSettings(s: SteadySettings): Promise<void> {
    const raw = JSON.stringify(s)
    localStorage.setItem(SETTINGS_KEY, raw)
    const cs = this.area()
    if (cs) void cs.setItem(CS_SETTINGS_KEY, toB64(raw)).catch(() => {})
  }

  async loadSettings(): Promise<SteadySettings | null> {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      try {
        return { ...DEFAULT_STEADY_SETTINGS, ...(JSON.parse(raw) as Partial<SteadySettings>) }
      } catch {
        // fall through to the mirror
      }
    }
    const cs = this.area()
    const mirrored = cs ? await cs.getItem(CS_SETTINGS_KEY).catch(() => null) : null
    if (mirrored) {
      try {
        return { ...DEFAULT_STEADY_SETTINGS, ...(JSON.parse(fromB64(mirrored)) as Partial<SteadySettings>) }
      } catch {
        return null
      }
    }
    return null
  }
}

export class MemoryDocStorage implements DocStorage {
  private docs = new Map<string, DocRecord>()
  private positions = new Map<string, DocPosition>()
  private settings: SteadySettings | null = null

  async saveDoc(doc: DocRecord): Promise<void> {
    this.docs.set(doc.id, doc)
  }

  async loadDoc(id: string): Promise<DocRecord | null> {
    return this.docs.get(id) ?? null
  }

  async listDocs(): Promise<DocMeta[]> {
    return [...this.docs.values()]
      .map(({ chapters: _c, ...meta }) => meta)
      .sort((a, b) => b.addedAt - a.addedAt)
  }

  async deleteDoc(id: string): Promise<void> {
    this.docs.delete(id)
    this.positions.delete(id)
  }

  async savePosition(id: string, pos: DocPosition): Promise<void> {
    this.positions.set(id, pos)
  }

  async loadPosition(id: string): Promise<DocPosition | null> {
    return this.positions.get(id) ?? null
  }

  async saveSettings(s: SteadySettings): Promise<void> {
    this.settings = s
  }

  async loadSettings(): Promise<SteadySettings | null> {
    return this.settings
  }

  health(): StorageHealth {
    return { books: 'session', progress: 'session' }
  }
}

function getCreationStorage(): CreationStorageArea | undefined {
  return (globalThis as { creationStorage?: { plain?: CreationStorageArea } }).creationStorage?.plain
}

export function createDocStorage(): DocStorage {
  return new DeviceDocStorage(getCreationStorage)
}
