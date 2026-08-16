import { FONT_ORDER, PACING_ORDER, attachInputs, createRowList, type Settings } from 'r1-kit'
import type { Ctx } from '../main'

interface Row {
  label: string
  value(): string
  act(): void
}

const ROW_H = 46

function cycle<T>(order: T[], current: T): T {
  return order[(order.indexOf(current) + 1) % order.length]
}

export function settingsScreen(ctx: Ctx, initial: Settings): () => void {
  const { root, storage } = ctx
  const settings: Settings = { ...initial }

  const rows: Row[] = [
    {
      label: 'Default speed',
      value: () => settings.defaultWpm + ' wpm',
      act: () => {
        settings.defaultWpm = settings.defaultWpm >= 800 ? 100 : settings.defaultWpm + 10
      },
    },
    {
      label: 'ORP marker',
      value: () => (settings.orp ? 'on' : 'off'),
      act: () => {
        settings.orp = !settings.orp
      },
    },
    {
      label: 'Font size',
      value: () => settings.font,
      act: () => {
        settings.font = cycle(FONT_ORDER, settings.font)
      },
    },
    {
      label: 'Pacing',
      value: () => settings.pacing,
      act: () => {
        settings.pacing = cycle(PACING_ORDER, settings.pacing)
      },
    },
  ]

  const screen = document.createElement('div')
  screen.className = 'screen'
  const brand = document.createElement('div')
  brand.className = 'brand'
  brand.textContent = 'Settings'
  screen.append(brand)
  root.append(screen)

  const list = createRowList({
    count: () => rows.length + 1,
    className: 'rows',
    rowHeight: ROW_H,
    renderRow(row, i) {
      const t = document.createElement('div')
      const s = document.createElement('div')
      s.className = 's'
      if (i < rows.length) {
        t.className = 't'
        t.textContent = rows[i].label
        s.textContent = rows[i].value()
      } else {
        t.className = 't pinned'
        t.textContent = 'Done'
      }
      row.append(t, s)
    },
  })
  screen.append(list.el)

  function persist(): void {
    void storage.saveSettings({ ...settings }).catch(() => {})
  }

  function done(): void {
    persist()
    ctx.nav.library()
  }

  const detach = attachInputs({
    onSideClick() {
      if (list.selected < rows.length) {
        rows[list.selected].act()
        persist()
        list.render()
      } else {
        done()
      }
    },
    onLongPressStart() {
      done()
    },
    onLongPressEnd() {},
    onScrollUp: list.up,
    onScrollDown: list.down,
  })

  return detach
}
