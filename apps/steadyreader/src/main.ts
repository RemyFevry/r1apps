import './style.css'
import { FONT, SCREEN, THEME } from 'r1-kit'
import { createBridgeVoice } from './tts/bridge'
import { createElevenVoice, defaultElevenDeps, type ElevenVoice } from './tts/eleven'
import { createDocStorage, DEFAULT_STEADY_SETTINGS, type DocRecord, type DocStorage, type SteadySettings } from './store'
import { ShelfDocStorage } from './ingestion/shelf'
import { addDocScreen } from './screens/adddoc'
import { libraryScreen } from './screens/library'
import { readerScreen } from './screens/reader'
import { settingsScreen } from './screens/settings'

export type { DocRecord } from './store'

export interface Nav {
  library(): void
  openDoc(doc: DocRecord): void
  addDoc(): void
  settings(): void
}

export interface TtsCtx {
  rabbit: ReturnType<typeof createBridgeVoice>
  eleven: ElevenVoice | null
}

export interface Ctx {
  root: HTMLElement
  storage: DocStorage
  settings: SteadySettings
  nav: Nav
  tts: TtsCtx
}

const app = document.getElementById('app') as HTMLElement
const storage: DocStorage = new ShelfDocStorage(__BUNDLED_DOCS__, __BUNDLED_DOCS_SHA__, createDocStorage())
const settings: SteadySettings = { ...DEFAULT_STEADY_SETTINGS }

const tts: TtsCtx = {
  rabbit: createBridgeVoice(),
  eleven: null,
}

let cleanup: (() => void) | null = null

function applyPlatform(): void {
  const s = document.documentElement.style
  s.setProperty('--bg', THEME.bg)
  s.setProperty('--accent', THEME.accent)
  s.setProperty('--accent-dim', THEME.accentDim)
  s.setProperty('--text', THEME.text)
  s.setProperty('--dim', THEME.textDim)
  s.setProperty('--card', THEME.card)
  s.setProperty('--border', THEME.border)
  s.setProperty('--font', FONT.stack)
  document.body.style.width = SCREEN.width + 'px'
  document.body.style.height = SCREEN.height + 'px'
}

function show(mount: (ctx: Ctx) => () => void): void {
  cleanup?.()
  cleanup = null
  app.replaceChildren()
  const root = document.createElement('div')
  app.append(root)
  cleanup = mount({ root, storage, settings, nav, tts })
}

const nav: Nav = {
  library: () => show((ctx) => libraryScreen(ctx)),
  openDoc: (doc) => show((ctx) => readerScreen(ctx, doc)),
  addDoc: () => show((ctx) => addDocScreen(ctx)),
  settings: () => show((ctx) => settingsScreen(ctx)),
}

async function boot(): Promise<void> {
  applyPlatform()
  const saved = await storage.loadSettings()
  Object.assign(settings, saved ?? DEFAULT_STEADY_SETTINGS)
  if (settings.elevenKey) {
    // Rachel: ElevenLabs' canonical default premade voice; swappable in Settings.
    tts.eleven = createElevenVoice(
      { key: settings.elevenKey, voiceId: settings.elevenVoice || '21m00Tcm4TlvDq8ikWAM' },
      defaultElevenDeps(),
    )
  }
  const params = new URLSearchParams(location.search)
  const add = params.get('add')
  if (add) {
    // Ingest immediately into the library, then open it (deep link).
    const { ingestDocument } = await import('./ingestion/ingest')
    try {
      const doc = await ingestDocument(storage, add)
      show((ctx) => readerScreen(ctx, doc))
      return
    } catch {
      // fall through to the library
    }
  }
  nav.library()
}

void boot()
