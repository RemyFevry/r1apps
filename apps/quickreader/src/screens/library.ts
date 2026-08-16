import { attachInputs, createRowList } from 'r1-kit'
import type { Ctx, Diagnostics } from '../main'

const ROW_H = 46
const VIEW_H = 236

export function libraryScreen(ctx: Ctx, diag: Diagnostics): () => void {
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
  const h = storage.health()
  const storageLabel = `storage:${h.books}/${h.progress}`
  version.textContent = ` · v${__APP_VERSION__} · ${storageLabel} · zip:${diag.zipMode}`
  version.style.color = 'var(--dim)'
  brand.append(brandText, version)
  screen.append(brand)
  root.append(screen)

  const isBook = (i: number) => i < metas.length

  const list = createRowList({
    count: () => metas.length + 2,
    className: 'rows',
    rowHeight: ROW_H,
    viewHeight: VIEW_H,
    renderRow(row, i, isSelected) {
      const title = document.createElement('div')
      title.className = 't'
      const sub = document.createElement('div')
      sub.className = 's'
      if (isBook(i)) {
        const m = metas[i]
        title.textContent = m.title
        if (confirmDelete && isSelected) {
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
    },
    onCancel: () => {
      if (confirmDelete) {
        confirmDelete = false
        list.render()
      }
    },
  })
  screen.append(list.el)

  async function reload(): Promise<void> {
    metas = await storage.listBooks()
    fracs = new Map()
    for (const m of metas) {
      const p = await storage.loadPosition(m.id)
      if (p?.frac != null) fracs.set(m.id, p.frac)
    }
    list.render()
  }

  const detach = attachInputs({
    async onSideClick() {
      const selected = list.selected
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
      if (isBook(list.selected) && !confirmDelete) {
        confirmDelete = true
        list.render()
      }
    },
    onLongPressEnd() {},
    onScrollUp: list.up,
    onScrollDown: list.down,
  })

  void reload()
  return detach
}
