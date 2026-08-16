import { FONT_ORDER, PACING_ORDER, attachInputs, createListNav } from 'r1-kit'
import { DEFAULT_STEADY_SETTINGS, type EngineId, type SteadySettings } from '../store'
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
        settings.engine = (settings.engine === 'rabbit' ? 'elevenlabs' : 'rabbit') as EngineId
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
  const list = document.createElement('div')
  list.className = 'rows'
  screen.append(brand, list)
  root.append(screen)

  const total = () => rows.length + 1

  const nav = createListNav({
    count: total,
    onChange: () => render(),
  })

  function persist(): void {
    void storage.saveSettings({ ...settings }).catch(() => {})
  }

  function render(): void {
    list.replaceChildren()
    for (let i = 0; i < total(); i++) {
      const row = document.createElement('div')
      row.className = 'row' + (i === nav.selected ? ' selected' : '')
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
    ctx.nav.library()
  }

  const detach = attachInputs({
    onSideClick() {
      if (nav.selected < rows.length) {
        rows[nav.selected].act()
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
    onScrollUp: nav.up,
    onScrollDown: nav.down,
  })

  render()
  return detach
}
