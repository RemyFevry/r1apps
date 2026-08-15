import { attachInputs, visibleWindow, type BookMeta, type Position, type Settings, type Storage } from 'r1-kit'
import type { Nav } from '../main'

const ROW_H = 46
const VIEW_H = 236

export function libraryScreen(root: HTMLElement, storage: Storage, _settings: Settings, nav: Nav): () => void {
  let metas: BookMeta[] = []
  let fracs = new Map<string, number>()
  let selected = 0
  let confirmDelete = false

  const screen = document.createElement('div')
  screen.className = 'screen'
  const brand = document.createElement('div')
  brand.className = 'brand'
  brand.textContent = 'QuickReader'
  const rows = document.createElement('div')
  rows.className = 'rows'
  screen.append(brand, rows)
  root.append(screen)

  const rowCount = () => metas.length + 2
  const isBook = (i: number) => i < metas.length

  function render(): void {
    rows.replaceChildren()
    const { start, end } = visibleWindow(selected, rowCount(), ROW_H, VIEW_H)
    for (let i = start; i < end; i++) {
      const row = document.createElement('div')
      row.className = 'row' + (i === selected ? ' selected' : '')
      const title = document.createElement('div')
      title.className = 't'
      const sub = document.createElement('div')
      sub.className = 's'
      if (isBook(i)) {
        const m = metas[i]
        title.textContent = m.title
        if (confirmDelete && i === selected) {
          sub.textContent = 'Delete this book? scroll to cancel'
        } else {
          const frac = fracs.get(m.id)
          sub.textContent = [m.author || null, frac != null ? Math.floor(frac * 100) + '%' : 'new'].filter(Boolean).join(' · ')
        }
      } else if (i === metas.length) {
        title.className = 't pinned'
        title.textContent = '+ Add book'
      } else {
        title.className = 't pinned'
        title.textContent = 'Settings'
      }
      row.append(title, sub)
      rows.append(row)
    }
  }

  async function reload(): Promise<void> {
    metas = await storage.listBooks()
    fracs = new Map()
    for (const m of metas) {
      const p: Position | null = await storage.loadPosition(m.id)
      if (p?.frac != null) fracs.set(m.id, p.frac)
    }
    selected = Math.min(selected, Math.max(0, rowCount() - 1))
    render()
  }

  const detach = attachInputs({
    async onSideClick() {
      if (confirmDelete) {
        const target = selected
        confirmDelete = false
        if (isBook(target)) await storage.deleteBook(metas[target].id)
        await reload()
        return
      }
      if (isBook(selected)) {
        const book = await storage.loadBook(metas[selected].id)
        if (book) nav.openBook(book)
      } else if (selected === metas.length) {
        nav.addBook()
      } else {
        nav.settings()
      }
    },
    onLongPressStart() {
      if (isBook(selected) && !confirmDelete) {
        confirmDelete = true
        render()
      }
    },
    onLongPressEnd() {},
    onScrollUp() {
      confirmDelete = false
      if (selected > 0) {
        selected--
        render()
      }
    },
    onScrollDown() {
      confirmDelete = false
      if (selected < rowCount() - 1) {
        selected++
        render()
      }
    },
  })

  void reload()
  return detach
}
