import { FONT_ORDER, PACING_ORDER, attachInputs, createRowList } from 'r1-kit'
import type { SteadySettings } from '../store'
import type { Ctx } from '../main'

interface Row {
  label: string
  value(): string
  act(): void
}

function cycle<T>(order: T[], current: T): T {
  return order[(order.indexOf(current) + 1) % order.length]
}

export function settingsScreen(ctx: Ctx): () => void {
  const { root, storage, settings } = ctx

  const rows: Row[] = [
    {
      label: 'Default speed',
      value: () => settings.defaultWpm + ' wpm',
      act: () => {
        settings.defaultWpm = settings.defaultWpm >= 800 ? 100 : settings.defaultWpm + 10
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
      label: 'Pacing (silent)',
      value: () => settings.pacing,
      act: () => {
        settings.pacing = cycle(PACING_ORDER, settings.pacing)
      },
    },
    {
      label: 'Voice engine',
      value: () => (settings.engine === 'rabbit' ? 'r1 voice' : 'ElevenLabs'),
      act: () => {
        settings.engine = settings.engine === 'rabbit' ? 'elevenlabs' : 'rabbit'
      },
    },
    {
      label: 'ElevenLabs voice id',
      value: () => settings.elevenVoice || 'default',
      act: () => {
        const v = prompt('ElevenLabs voice id (from elevenlabs.io/voice-library):', settings.elevenVoice)
        if (v != null) settings.elevenVoice = v.trim()
      },
    },
    {
      label: 'ElevenLabs key',
      value: () => (settings.elevenKey ? '•••• ' + settings.elevenKey.slice(-4) : 'not set'),
      act: () => {
        const k = prompt('ElevenLabs API key (stays on this device):', '')
        if (k != null) settings.elevenKey = k.trim()
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

  const total = () => rows.length + 1

  const list = createRowList({
    count: total,
    className: 'rows',
    rowHeight: 46,
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
