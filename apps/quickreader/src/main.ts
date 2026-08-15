import './style.css'
import { DEFAULT_SETTINGS, FONT, SCREEN, THEME, createStorage, probeDeviceStorage, type BookRecord, type Settings, type Storage, type StorageHealth } from 'r1-kit'
import { decodeBookmark } from './ingestion/bookmark'
import { ShelfStorage } from './ingestion/shelf'
import { decodeTransitRef, transitRawUrl } from './ingestion/transit'
import { deepLinkScreen } from './screens/deeplink'
import { libraryScreen } from './screens/library'
import { readerScreen } from './screens/reader'
import { addBookScreen } from './screens/addbook'
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
  settings: Settings
  nav: Nav
  storageHealth: StorageHealth
}

const app = document.getElementById('app') as HTMLElement
const storage: Storage = new ShelfStorage(__BUNDLED_BOOKS__, __BUNDLED_BOOKS_SHA__, createStorage())
const settings: Settings = { ...DEFAULT_SETTINGS }
let storageHealth: StorageHealth = 'absent'

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
  cleanup = mount({ root, storage, settings, nav, storageHealth })
}

const nav: Nav = {
  library: () => show((ctx) => libraryScreen(ctx)),
  openBook: (book) => show((ctx) => readerScreen(ctx, book)),
  addBook: () => show((ctx) => addBookScreen(ctx)),
  settings: () => show((ctx) => settingsScreen(ctx)),
}

async function boot(): Promise<void> {
  applyPlatform()
  const saved = await storage.loadSettings()
  Object.assign(settings, saved ?? DEFAULT_SETTINGS)
  storageHealth = await probeDeviceStorage()
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
      show((ctx) => readerScreen(ctx, book))
      return
    }
  }
  const params = new URLSearchParams(location.search)
  const add = params.get('add') ?? (() => {
    const code = params.get('b')
    if (!code) return null
    const ref = decodeTransitRef(code)
    return ref ? transitRawUrl(ref) : null
  })()
  if (add) show((ctx) => deepLinkScreen(ctx, add))
  else nav.library()
}

void boot()
