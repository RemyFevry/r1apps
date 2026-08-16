import { attachInputs, createRowList } from 'r1-kit'
import type { Ctx } from '../main'

const ROW_H = 46
const VIEW_H = 236

export function libraryScreen(ctx: Ctx): () => void {
  const { root, storage, nav } = ctx
  let metas = [] as Awaited<ReturnType<typeof storage.listDocs>>
  let fracs = new Map<string, number>()
  let confirmDelete = false

  const screen = document.createElement('div')
  screen.className = 'screen'
  const brand = document.createElement('div')
  brand.className = 'brand'
  const brandText = document.createElement('span')
  brandText.textContent = 'SteadyReader'
  const version = document.createElement('span')
  const h = storage.health()
  version.textContent = ` · v${__APP_VERSION__} · storage:${h.books}/${h.progress}`
  version.style.color = 'var(--dim)'
  brand.append(brandText, version)
  screen.append(brand)
  root.append(screen)

  const isDoc = (i: number) => i < metas.length

  const list = createRowList({
    count: () => metas.length + 2,
    className: 'rows',
    rowHeight: ROW_H,
    viewHeight: VIEW_H,
    onCancel: () => {
      if (confirmDelete) {
        confirmDelete = false
        list.render()
      }
    },
    renderRow(row, i) {
      const title = document.createElement('div')
      title.className = 't'
      const sub = document.createElement('div')
      sub.className = 's'
      if (isDoc(i)) {
        const m = metas[i]
        title.textContent = m.title
        if (confirmDelete && i === list.selected) {
          sub.textContent = 'Delete this document? scroll to cancel'
        } else {
          const frac = fracs.get(m.id)
          sub.textContent = [m.kind, m.author || null, frac != null ? Math.floor(frac * 100) + '%' : 'new']
            .filter(Boolean)
            .join(' · ')
        }
      } else if (i === metas.length) {
        title.className = 't pinned'
        title.textContent = '+ Add document'
      } else {
        title.className = 't pinned'
        title.textContent = 'Settings'
      }
      row.append(title, sub)
    },
  })
  screen.append(list.el)

  async function reload(): Promise<void> {
    metas = await storage.listDocs()
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
        if (isDoc(selected)) await storage.deleteDoc(metas[selected].id)
        await reload()
        return
      }
      if (isDoc(selected)) {
        const doc = await storage.loadDoc(metas[selected].id)
        if (doc) nav.openDoc(doc)
      } else if (selected === metas.length) {
        nav.addDoc()
      } else {
        nav.settings()
      }
    },
    onLongPressStart() {
      if (isDoc(list.selected) && !confirmDelete) {
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
