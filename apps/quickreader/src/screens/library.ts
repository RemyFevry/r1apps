import { attachInputs, createListNav, visibleWindow } from 'r1-kit'
import type { Ctx } from '../main'

const ROW_H = 46
const VIEW_H = 236

export function libraryScreen(ctx: Ctx): () => void {
  const { root, storage, nav } = ctx
  let metas: Awaited<ReturnType<typeof storage.listBooks>> = []
  let fracs = new Map<string, number>()
  let confirmDelete = false

  const screen = document.createElement('div')
  screen.className = 'screen'
  const brand = document.createElement('div')
  brand.className = 'brand'
  const brandText = document.createElement('span')
  brandText.textContent = 'QuickReader'
  const version = document.createElement('span')
  version.textContent = ` · v${__COMMIT_SHA__.slice(0, 6)} · ${ctx.storageHealth === 'device' ? 'storage:device' : ctx.storageHealth === 'write-lost' ? 'storage:broken' : 'storage:memory'}`
  version.style.color = 'var(--dim)'
  brand.append(brandText, version)
  const rows = document.createElement('div')
  rows.className = 'rows'
  screen.append(brand, rows)
  root.append(screen)

  const rowCount = () => metas.length + 2
  const isBook = (i: number) => i < metas.length

  const nav2 = createListNav({
    count: rowCount,
    onChange: () => render(),
    onCancel: () => {
      if (confirmDelete) {
        confirmDelete = false
        render()
      }
    },
  })

  function render(): void {
    rows.replaceChildren()
    const { start, end } = visibleWindow(nav2.selected, rowCount(), ROW_H, VIEW_H)
    for (let i = start; i < end; i++) {
      const row = document.createElement('div')
      row.className = 'row' + (i === nav2.selected ? ' selected' : '')
      const title = document.createElement('div')
      title.className = 't'
      const sub = document.createElement('div')
      sub.className = 's'
      if (isBook(i)) {
        const m = metas[i]
        title.textContent = m.title
        if (confirmDelete && i === nav2.selected) {
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
      const p = await storage.loadPosition(m.id)
      if (p?.frac != null) fracs.set(m.id, p.frac)
    }
    render()
  }

  const detach = attachInputs({
    async onSideClick() {
      const selected = nav2.selected
      if (confirmDelete) {
        confirmDelete = false
        if (isBook(selected)) await storage.deleteBook(metas[selected].id)
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
      if (isBook(nav2.selected) && !confirmDelete) {
        confirmDelete = true
        render()
      }
    },
    onLongPressEnd() {},
    onScrollUp: nav2.up,
    onScrollDown: nav2.down,
  })

  void reload()
  return detach
}
