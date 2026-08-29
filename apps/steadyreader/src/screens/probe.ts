import { attachInputs } from 'r1-kit'
import { toB64 } from 'r1-kit'
import type { Ctx } from '../main'

/**
 * On-device audio probe (#38 / ADR-0014): measures the R1 webview's real
 * audio facts the chapter-stream model must fit — does an `<audio>` element
 * play (object URL tone), does a hardware sideClick count as user activation
 * for autoplay, does playbackRate 0.7/1.2 change speed while currentTime stays
 * on the media timeline, and does pause freeze position. Built by the agent,
 * run by a human on real hardware; the report renders on screen, logs to
 * console, and persists to localStorage + creationStorage when present.
 */

interface ProbeReport {
  audioSupported: boolean
  preGesturePlay: { ok: boolean; error: string }
  afterGesture: { trusted: boolean; ok: boolean; error: string }
  playbackRate: { set07: number | null; read07: number | null; set12: number | null; read12: number | null }
  currentTimeAdvanced: boolean
  pausedFrozen: boolean
  resumed: boolean
  stopped: boolean
  note: string
}

function writeStr(dv: DataView, off: number, s: string): void {
  for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i))
}

/** A short looping 440 Hz tone as a WAV blob — no network needed (object URL). */
function toneWav(seconds = 0.6, freq = 440): Blob {
  const rate = 8000
  const n = Math.floor(rate * seconds)
  const buf = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(buf)
  writeStr(dv, 0, 'RIFF')
  dv.setUint32(4, 36 + n * 2, true)
  writeStr(dv, 8, 'WAVE')
  writeStr(dv, 12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, 1, true)
  dv.setUint32(24, rate, true)
  dv.setUint32(28, rate * 2, true)
  dv.setUint16(32, 2, true)
  dv.setUint16(34, 16, true)
  writeStr(dv, 36, 'data')
  dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const v = Math.sin((2 * Math.PI * freq * i) / rate) * 0.25
    dv.setInt16(44 + i * 2, Math.round(v * 32767), true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

function errName(e: unknown): string {
  return e instanceof DOMException ? e.name : e instanceof Error ? e.message : String(e)
}

export function probeScreen(ctx: Ctx): () => void {
  const { root } = ctx
  const screen = document.createElement('div')
  screen.className = 'screen'
  const brand = document.createElement('div')
  brand.className = 'brand'
  brand.textContent = 'Audio probe'
  screen.append(brand)
  const list = document.createElement('div')
  list.className = 'probe'
  screen.append(list)
  root.append(screen)

  const lines: string[] = []
  const report: ProbeReport = {
    audioSupported: false,
    preGesturePlay: { ok: false, error: '' },
    afterGesture: { trusted: false, ok: false, error: '' },
    playbackRate: { set07: null, read07: null, set12: null, read12: null },
    currentTimeAdvanced: false,
    pausedFrozen: false,
    resumed: false,
    stopped: false,
    note: '',
  }

  function render(): void {
    list.replaceChildren()
    for (const l of lines) {
      const d = document.createElement('div')
      d.className = 't'
      d.textContent = l
      list.append(d)
    }
  }

  function line(s: string): void {
    lines.unshift(s)
    render()
  }

  function persist(): void {
    try {
      localStorage.setItem('steadyreader:audio-probe', JSON.stringify(report))
    } catch {
      // best-effort
    }
    const cs = (globalThis as { creationStorage?: { plain?: { setItem(k: string, v: string): Promise<unknown> } } }).creationStorage
    cs?.plain?.setItem('steadyreader:audio-probe', toB64(JSON.stringify(report))).catch(() => {})
    console.log('audio probe report:', JSON.stringify(report, null, 2))
  }

  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  let detach: (() => void) | null = null
  let url: string | null = null

  function cleanup(): void {
    detach?.()
    detach = null
    if (url) {
      URL.revokeObjectURL(url)
      url = null
    }
  }

  function finish(): void {
    if (report.stopped) {
      cleanup()
      ctx.nav.settings()
      return
    }
    report.stopped = true
    report.note = 'closeWebView stop: verify by ear — audio should stop when the creation closes'
    line('✓ stop — verify silence on close by ear')
    persist()
    cleanup()
    ctx.nav.settings()
  }

  void (async () => {
    report.audioSupported = typeof Audio !== 'undefined'
    line(report.audioSupported ? '✓ <audio> supported' : '✗ no <audio>')
    if (!report.audioSupported) return
    const audio = new Audio()
    url = URL.createObjectURL(toneWav())
    audio.src = url
    audio.loop = true
    // Is the hardware sideClick delivered as a trusted event? (own listener —
    // attachInputs' handlers receive no event object).
    const trusted = { value: false }
    const onSide = (e: Event): void => {
      trusted.value = e.isTrusted
    }
    window.addEventListener('sideClick', onSide)
    // Step 1: autoplay policy — play before any user gesture.
    const before = await audio.play().then(
      () => ({ ok: true, error: '' }),
      (e: unknown) => ({ ok: false, error: errName(e) }),
    )
    report.preGesturePlay = before
    if (before.ok) line('⚠ pre-gesture play resolved (no activation needed?)')
    else line(`✓ pre-gesture blocked: ${before.error}`)
    line('press side to play after gesture')
    let ran = false
    let detachInputs: (() => void) | null = null
    detachInputs = attachInputs({
      onSideClick: () => {
        if (ran) return
        ran = true
        report.afterGesture.trusted = trusted.value
        void (async () => {
          const after = await audio.play().then(
            () => ({ ok: true, error: '' }),
            (e: unknown) => ({ ok: false, error: errName(e) }),
          )
          report.afterGesture.ok = after.ok
          report.afterGesture.error = after.error
          line(`sideClick trusted=${report.afterGesture.trusted}`)
          line(after.ok ? '✓ sideClick → play() resolved (activation counts)' : `✗ sideClick play failed: ${after.error}`)
          if (!after.ok) {
            persist()
            return
          }
          // Step 2: playbackRate round-trips.
          audio.playbackRate = 0.7
          report.playbackRate.set07 = 0.7
          report.playbackRate.read07 = audio.playbackRate
          audio.playbackRate = 1.2
          report.playbackRate.set12 = 1.2
          report.playbackRate.read12 = audio.playbackRate
          line(`✓ playbackRate round-trip 0.7→${report.playbackRate.read07} / 1.2→${report.playbackRate.read12}`)
          // Step 3: currentTime advances on the media timeline.
          await wait(1200)
          const t1 = audio.currentTime
          await wait(1200)
          const t2 = audio.currentTime
          report.currentTimeAdvanced = t2 > t1
          line(report.currentTimeAdvanced ? `✓ currentTime advances (${t1.toFixed(2)} → ${t2.toFixed(2)})` : '✗ currentTime frozen')
          // Step 4: pause keeps position.
          audio.pause()
          const p1 = audio.currentTime
          await wait(500)
          const p2 = audio.currentTime
          report.pausedFrozen = p2 === p1
          line(report.pausedFrozen ? `✓ pause froze position (${p2.toFixed(2)})` : '✗ position moved while paused')
          // Step 5: resume continues.
          audio.play().catch(() => {})
          await wait(500)
          const r = audio.currentTime
          report.resumed = r > p2
          line(report.resumed ? '✓ resume continues from position' : '✗ resume did not continue')
          audio.pause()
          audio.loop = false
          audio.src = ''
          line('done — long press to save & exit')
          persist()
        })()
      },
      onLongPressStart: finish,
      onLongPressEnd() {},
      onScrollUp: () => {},
      onScrollDown: () => {},
    })
    detach = () => {
      window.removeEventListener('sideClick', onSide)
      detachInputs?.()
      detachInputs = null
    }
  })()

  return cleanup
}
