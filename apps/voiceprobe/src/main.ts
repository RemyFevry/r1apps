import { attachInputs, closeApp } from 'r1-kit'

/**
 * On-device timing probe for the Rabbit voice bridge — instrumentation for
 * ticket #38 (ADR-0012), not an app. The camera is the recorder and the screen
 * is the sensor: a millisecond clock restarts at each postMessage so filmed
 * audio onset reads directly as post→speech latency; every inbound channel
 * (onPluginMessage, message events, a dozen voice-event name variants) is
 * logged and tallied on-screen; the STOP entry fires the community stop
 * volley mid-speech. Duration estimates mirror the bridge adapter's estimator
 * (words × 400 ms — see apps/steadyreader/src/tts/bridge.ts).
 */

const MS_PER_WORD = 400
const EVENT_VARIANTS = [
  'r1:voice:start', 'r1:voice:end', 'r1:voice:stop', 'r1:voice:finish', 'r1:voice:complete',
  'voice:start', 'voice:end', 'voice:stop',
  'r1:speech:start', 'r1:speech:end', 'r1:tts:start', 'r1:tts:end',
]

interface Entry {
  id: string
  text: string
}

/** Fixed sentence set: S = 5 words, M = 15, L = 30 (numbered for the report). */
const ENTRIES: Entry[] = [
  { id: 'STOP', text: '' },
  { id: 'S1', text: 'The red fox jumps high.' },
  { id: 'S2', text: 'The rain falls softly tonight.' },
  { id: 'M1', text: 'The old library clock chimed twice before the lights flickered and the room fell silent.' },
  { id: 'M2', text: 'She packed her tools carefully, checked the map twice, and stepped into the morning light.' },
  { id: 'L1', text: 'When the storm finally passed, the village emerged slowly from beneath the grey clouds, and children ran outside to measure the deepest puddles left behind on the old stone road.' },
  { id: 'L2', text: 'The engineer studied the diagram for a long moment, erased one line, drew another, and whispered that the machine would finally work when the sun rose over the quiet harbour town.' },
]

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement
const clockEl = $('clock')
const bridgeEl = $('bridge')
const sentLine = $('sentline')
const sentText = $('senttext')
const selEl = $('sel')
const tallyEl = $('tally')
const logEl = $('log')

let sel = 1
let lastPostAt = 0
const loadAt = Date.now()
let postCount = 0
let volleyCount = 0
const inbound = new Map<string, number>()
const lines: string[] = []

function handler(): { postMessage(s: string): unknown } | null {
  return (globalThis as { PluginMessageHandler?: { postMessage(s: string): unknown } }).PluginMessageHandler ?? null
}

function relNow(): number {
  return (Date.now() - (lastPostAt || loadAt)) / 1000
}

function addLog(text: string): void {
  lines.push('+' + relNow().toFixed(3) + ' ' + text)
  if (lines.length > 4) lines.shift()
  logEl.textContent = lines.join('\n')
}

function renderTally(): void {
  const rows = ['post x' + postCount + ' volley x' + volleyCount]
  for (const [k, n] of [...inbound.entries()].slice(-3)) rows.push(k + ' x' + n)
  tallyEl.textContent = rows.join('\n')
}

function describe(data: unknown): string {
  if (typeof data !== 'string') return typeof data
  try {
    const msg = JSON.parse(data) as Record<string, unknown>
    const kind = [msg.type, msg.event, msg.name, msg.command, msg.action].find((v) => typeof v === 'string')
    const base = typeof kind === 'string' ? kind.slice(0, 14) : typeof msg.message === 'string' && msg.message ? 'msg:' + msg.message.slice(0, 10) : 'json'
    const rid = typeof msg.requestId === 'string' ? ' ' + msg.requestId.slice(0, 10) : ''
    return base + rid
  } catch {
    return 'raw:' + data.slice(0, 12)
  }
}

function record(channel: string, label: string): void {
  inbound.set(channel + ' ' + label, (inbound.get(channel + ' ' + label) ?? 0) + 1)
  renderTally()
  addLog(channel + ' ' + label)
}

function speak(entry: Entry): void {
  const words = entry.text.split(/\s+/)
  postCount++
  lastPostAt = Date.now()
  renderTally()
  addLog('POST ' + entry.id + ' ' + words.length + 'w est' + ((words.length * MS_PER_WORD) / 1000).toFixed(1) + 's')
  const h = handler()
  if (!h) {
    addLog('NO BRIDGE not on R1')
    return
  }
  h.postMessage(JSON.stringify({ message: entry.text, useLLM: false, wantsR1Response: true, requestId: 'probe-' + postCount }))
}

function fireVolley(): void {
  volleyCount++
  renderTally()
  addLog('STOP volley 4x')
  const h = handler()
  if (!h) {
    addLog('NO BRIDGE not on R1')
    return
  }
  h.postMessage(JSON.stringify({ command: 'stop_speech' }))
  h.postMessage(JSON.stringify({ message: 'stop_speech', useLLM: false }))
  h.postMessage(JSON.stringify({ command: 'stop', type: 'speech' }))
  h.postMessage(JSON.stringify({ action: 'stop_speech' }))
}

function render(): void {
  for (let i = 0; i < selEl.children.length; i++) {
    ;(selEl.children[i] as HTMLElement).classList.toggle('on', i === sel)
  }
  const entry = ENTRIES[sel]
  if (entry.id === 'STOP') {
    sentLine.textContent = 'STOP · press fires stop volley'
    sentLine.classList.add('stop')
    sentText.textContent = '4 payload variants (bridge adapter volley)'
  } else {
    const words = entry.text.split(/\s+/).length
    sentLine.textContent = entry.id + ' · ' + words + 'w · est ' + ((words * MS_PER_WORD) / 1000).toFixed(1) + 's'
    sentLine.classList.remove('stop')
    sentText.textContent = entry.text
  }
}

bridgeEl.textContent = handler() ? 'bridge:yes' : 'bridge:NO'
for (const entry of ENTRIES) {
  const span = document.createElement('span')
  span.textContent = entry.id
  selEl.appendChild(span)
}
render()
renderTally()

window.addEventListener('message', (e) => record('M', describe(e.data)))

const w = window as unknown as { onPluginMessage?: (data: unknown) => void }
const prev = w.onPluginMessage
w.onPluginMessage = (data: unknown) => {
  if (prev) prev(data)
  record('P', describe(data))
}

for (const name of EVENT_VARIANTS) {
  window.addEventListener(name, (e) => {
    const detail = (e as CustomEvent).detail
    const extra =
      detail !== null && typeof detail === 'object' && typeof (detail as Record<string, unknown>).type === 'string'
        ? '/' + String((detail as Record<string, unknown>).type)
        : ''
    record('E', name + extra)
  })
}

// Digit color flips white/orange every whole second — a visible 1 Hz calibration
// beat so camera footage can be frame-aligned to the clock.
function frame(): void {
  const ms = Date.now() - (lastPostAt || loadAt)
  clockEl.textContent = (ms / 1000).toFixed(3)
  clockEl.classList.toggle('idle', lastPostAt === 0)
  clockEl.classList.toggle('beat', lastPostAt > 0 && Math.floor(ms / 1000) % 2 === 1)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

attachInputs({
  onSideClick() {
    const entry = ENTRIES[sel]
    if (entry.id === 'STOP') fireVolley()
    else speak(entry)
  },
  onLongPressStart() {
    closeApp()
  },
  onLongPressEnd() {},
  onScrollUp() {
    sel = Math.max(0, sel - 1)
    render()
  },
  onScrollDown() {
    sel = Math.min(ENTRIES.length - 1, sel + 1)
    render()
  },
})
