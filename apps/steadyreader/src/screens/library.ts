import { attachInputs, createListNav, visibleWindow } from 'r1-kit'
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
  const storageLabel =
    ctx.storageHealth === 'device' ? 'storage:device' : ctx.storageHealth === 'write-lost' ? 'storage:broken' : 'storage:memory'
  version.textContent = ` · v${__APP_VERSION__} · ${storageLabel}`
  version.style.color = 'var(--dim)'
  brand.append(brandText, version)
  const rows = document.createElement('div')
  rows.className = 'rows'
  screen.append(brand, rows)
  root.append(screen)

  const rowCount = () => metas.length + 2
  const isDoc = (i: number) => i < metas.length

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
      if (isDoc(i)) {
        const m = metas[i]
        title.textContent = m.title
        if (confirmDelete && i === nav2.selected) {
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
      rows.append(row)
    }
  }

  async function reload(): Promise<void> {
    metas = await storage.listDocs()
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
      if (isDoc(nav2.selected) && !confirmDelete) {
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
