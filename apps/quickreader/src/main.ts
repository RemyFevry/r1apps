import './style.css'
import { DEFAULT_SETTINGS, createStorage, type BookRecord, type Settings } from 'r1-kit'
import { addingScreen } from './screens/adding'
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

const app = document.getElementById('app') as HTMLElement
const storage = createStorage()
const settings: Settings = { ...DEFAULT_SETTINGS }

let cleanup: (() => void) | null = null

function show(mount: (root: HTMLElement) => () => void): void {
  cleanup?.()
  cleanup = null
  app.replaceChildren()
  const root = document.createElement('div')
  app.append(root)
  cleanup = mount(root)
}

const nav: Nav = {
  library: () => show((r) => libraryScreen(r, storage, settings, nav)),
  openBook: (book) => show((r) => readerScreen(r, storage, settings, book, nav)),
  addBook: () => show((r) => addBookScreen(r, storage, settings, nav)),
  settings: () => show((r) => settingsScreen(r, storage, settings, nav)),
}

async function boot(): Promise<void> {
  const saved = await storage.loadSettings()
  Object.assign(settings, saved ?? DEFAULT_SETTINGS)
  const add = new URLSearchParams(location.search).get('add')
  if (add) show((r) => addingScreen(r, storage, nav, add))
  else nav.library()
}

void boot()
