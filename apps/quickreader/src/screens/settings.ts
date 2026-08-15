import { attachInputs, type Settings, type Storage } from 'r1-kit'
import type { Nav } from '../main'

interface Row {
  label: string
  value(): string
  act(): void
}

export function settingsScreen(root: HTMLElement, storage: Storage, settings: Settings, nav: Nav): () => void {
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
        settings.font = settings.font === 'S' ? 'M' : settings.font === 'M' ? 'L' : 'S'
      },
    },
    {
      label: 'Pacing',
      value: () => settings.pacing,
      act: () => {
        settings.pacing = settings.pacing === 'relaxed' ? 'standard' : settings.pacing === 'standard' ? 'snappy' : 'relaxed'
      },
    },
  ]

  let selected = 0
  const total = () => rows.length + 1

  const screen = document.createElement('div')
  screen.className = 'screen'
  const brand = document.createElement('div')
  brand.className = 'brand'
  brand.textContent = 'Settings'
  const list = document.createElement('div')
  list.className = 'rows'
  screen.append(brand, list)
  root.append(screen)

  function persist(): void {
    void storage.saveSettings({ ...settings }).catch(() => {})
  }

  function render(): void {
    list.replaceChildren()
    for (let i = 0; i < total(); i++) {
      const row = document.createElement('div')
      row.className = 'row' + (i === selected ? ' selected' : '')
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
      list.append(row)
    }
  }

  function done(): void {
    persist()
    nav.library()
  }

  const detach = attachInputs({
    onSideClick() {
      if (selected < rows.length) {
        rows[selected].act()
        persist()
        render()
      } else {
        done()
      }
    },
    onLongPressStart() {
      done()
    },
    onLongPressEnd() {},
    onScrollUp() {
      if (selected > 0) {
        selected--
        render()
      }
    },
    onScrollDown() {
      if (selected < total() - 1) {
        selected++
        render()
      }
    },
  })

  render()
  return detach
}
