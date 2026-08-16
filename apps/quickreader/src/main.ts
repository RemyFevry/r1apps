import './style.css'
import { DEFAULT_SETTINGS, FONT, SCREEN, THEME, createStorage, inflateMode, probeDeviceStorage, type BookRecord, type InflateMode, type Settings, type Storage, type StorageHealth } from 'r1-kit'
import { decodeBookmark } from './deeplink/bookmark'
import { decodeBookParam } from './deeplink/params'
import { ShelfStorage } from './ingestion/shelf'
import { ingestionScreen } from './screens/ingestion-screen'
import { libraryScreen } from './screens/library'
import { readerScreen } from './screens/reader'
import { settingsScreen } from './screens/settings'

export interface Nav {
  library(): void
  openBook(book: BookRecord): void
  addBook(): void
  settings(): void
}

export interface Ctx {
  root: HTMLElement
  storage: Storage
  nav: Nav
}

/** Boot-time platform facts — only the library screen displays them (#16). */
export interface Diagnostics {
  storageHealth: StorageHealth
  zipMode: InflateMode
}

const app = document.getElementById('app') as HTMLElement
const storage: Storage = new ShelfStorage(__BUNDLED_BOOKS__, __BUNDLED_BOOKS_SHA__, createStorage('quickreader'))
const diag: Diagnostics = { storageHealth: 'absent', zipMode: 'fflate' }

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
  cleanup = mount({ root, storage, nav })
}

/** Settings travel by value through the storage interface, not a shared mutable ref (#16). */
function currentSettings(): Promise<Settings> {
  return storage.loadSettings().then((s) => ({ ...DEFAULT_SETTINGS, ...(s ?? {}) }))
}

const nav: Nav = {
  library: () => show((ctx) => libraryScreen(ctx, diag)),
  openBook: (book) => void currentSettings().then((settings) => show((ctx) => readerScreen(ctx, book, settings))),
  addBook: () => show((ctx) => ingestionScreen(ctx)),
  settings: () => void currentSettings().then((settings) => show((ctx) => settingsScreen(ctx, settings))),
}

async function boot(): Promise<void> {
  applyPlatform()
  diag.storageHealth = await probeDeviceStorage()
  diag.zipMode = await inflateMode()
  const hash = /#p=([A-Za-z0-9._-]+)/.exec(location.hash)
  const bookmark = hash ? decodeBookmark(hash[1]) : null
  if (bookmark) {
    const book = await storage.loadBook(bookmark.id)
    if (book) {
      await storage.savePosition(bookmark.id, {
        chapter: bookmark.chapter,
        wordIndex: bookmark.wordIndex,
        wpm: bookmark.wpm,
      })
      const settings = await currentSettings()
      show((ctx) => readerScreen(ctx, book, settings))
      return
    }
  }
  const add = decodeBookParam(new URLSearchParams(location.search), 'add')
  if (add) show((ctx) => ingestionScreen(ctx, add))
  else nav.library()
}

void boot()
