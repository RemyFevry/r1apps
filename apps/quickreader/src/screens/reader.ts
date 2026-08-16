import {
  attachInputs,
  installPayload,
  renderQr,
  visibleWindow,
  type Settings,
  type BookRecord,
} from 'r1-kit'
import { createPlayback, type Playback, type PlaybackHudKind, type PlaybackSnapshot } from '../engine/playback'
import { orpIndex } from '../engine/rsvp'
import { formatDuration } from '../engine/time'
import { bookmarkUrl } from '../ingestion/bookmark'
import {
  indexRowKind,
  initialOverlayState,
  overlayView,
  reduceOverlay,
  type OverlayEffect,
  type OverlayState,
  type OverlayView,
  type ReaderInput,
} from './overlays'
import type { Ctx } from '../main'

const FONT_PX: Record<Settings['font'], number> = { S: 20, M: 24, L: 30 }
const FIT_CHARS = 13
const ROW = 36

/** Semantic HUD kinds → text + stickiness. All wording lives here, not in the engine. */
function hudText(book: BookRecord, kind: PlaybackHudKind, s: PlaybackSnapshot): [string, boolean] {
  switch (kind) {
    case 'pause':
      return [`⏸ ${s.wpm} wpm · ch ${formatDuration(s.remaining.chapter)} · ${formatDuration(s.remaining.book)} left`, true]
    case 'resume':
      return [`${s.wpm} wpm`, false]
    case 'wpm':
      return [`${s.wpm} wpm · ${formatDuration(s.remaining.book)} left`, false]
    case 'chapterJump':
      return [`Ⓒ ${s.chapter + 1}/${book.chapters.length} · ${formatDuration(s.remaining.chapter)} in ch`, true]
    case 'chapterSeek':
      return [`Ⓒ ${s.chapter + 1}/${book.chapters.length} — side = resume`, true]
    case 'end':
      return ['side button → library', true]
  }
}

export function readerScreen(ctx: Ctx, book: BookRecord): () => void {
  const { root, storage, settings, nav } = ctx

  let pb: Playback | null = null
  let unmounted = false
  let hudTimer: ReturnType<typeof setTimeout> | null = null

  const screen = document.createElement('div')
  screen.className = 'reader'

  const topbar = document.createElement('div')
  topbar.className = 'topbar'
  const topChapter = document.createElement('span')
  const topPct = document.createElement('span')
  topbar.append(topChapter, topPct)

  const stage = document.createElement('div')
  stage.className = 'stage'
  const wordline = document.createElement('div')
  wordline.className = 'wordline'
  const pre = document.createElement('span')
  pre.className = 'pre'
  const orp = document.createElement('span')
  const post = document.createElement('span')
  post.className = 'post'
  wordline.append(pre, orp, post)
  stage.append(wordline)

  const hud = document.createElement('div')
  hud.className = 'hud'

  const overlay = document.createElement('div')
  overlay.className = 'card-overlay'
  overlay.style.display = 'none'
  const overlayK = document.createElement('div')
  overlayK.className = 'k'
  const overlayT = document.createElement('div')
  overlayT.className = 't'
  overlay.append(overlayK, overlayT)

  screen.append(topbar, stage, hud, overlay)

  const chapterEl = document.createElement('div')
  chapterEl.className = 'card-overlay'
  chapterEl.style.justifyContent = 'flex-start'
  chapterEl.style.paddingTop = '16px'
  chapterEl.style.display = 'none'
  const chapterK = document.createElement('div')
  chapterK.className = 'k'
  chapterK.textContent = 'Navigate'
  chapterK.style.marginBottom = '8px'
  const chapterList = document.createElement('div')
  chapterList.style.width = '100%'
  chapterList.style.overflow = 'hidden'
  const chapterHint = document.createElement('div')
  chapterHint.className = 'status'
  chapterHint.textContent = 'scroll = move · side = open · hold = cancel'
  chapterHint.style.marginTop = '8px'
  chapterEl.append(chapterK, chapterList, chapterHint)

  const bookmarkEl = document.createElement('div')
  bookmarkEl.className = 'card-overlay'
  bookmarkEl.style.display = 'none'
  const bookmarkK = document.createElement('div')
  bookmarkK.className = 'k'
  bookmarkK.textContent = 'Bookmark — scan to resume here'
  const qrBox = document.createElement('div')
  qrBox.style.background = '#fff'
  qrBox.style.padding = '6px'
  qrBox.style.borderRadius = '8px'
  const bookmarkHint = document.createElement('div')
  bookmarkHint.className = 'status'
  bookmarkEl.append(bookmarkK, qrBox, bookmarkHint)

  root.append(screen, chapterEl, bookmarkEl)

  function renderWord(s: PlaybackSnapshot): void {
    const w = book.chapters[s.chapter].words[s.wordIndex]
    topChapter.textContent = `${book.chapters[s.chapter].title} · ${s.chapter + 1}/${book.chapters.length}`
    topPct.textContent = `${Math.floor(s.frac * 100)}% · ch ${formatDuration(s.remaining.chapter)} · ${formatDuration(s.remaining.book)}`
    const base = FONT_PX[settings.font]
    wordline.style.fontSize = Math.round(Math.min(base, (base * FIT_CHARS) / Math.max(w.length, 1))) + 'px'
    if (settings.orp) {
      const o = Math.min(orpIndex(w), Math.max(w.length - 1, 0))
      orp.className = 'orp'
      pre.textContent = w.slice(0, o)
      orp.textContent = w.slice(o, o + 1)
      post.textContent = w.slice(o + 1)
    } else {
      orp.className = 'plain'
      pre.textContent = ''
      orp.textContent = w
      post.textContent = ''
    }
  }

  function showHud(text: string, sticky = false): void {
    hud.textContent = text
    hud.classList.add('visible')
    if (hudTimer) clearTimeout(hudTimer)
    if (!sticky) hudTimer = setTimeout(() => hud.classList.remove('visible'), 900)
  }

  let ov: OverlayState = initialOverlayState()
  let view: OverlayView = 'none'

  function renderIndexRows(): void {
    const rowsCount = book.chapters.length + 2
    const cur = pb?.snapshot().chapter ?? -1
    chapterList.replaceChildren()
    const win = visibleWindow(ov.selected, rowsCount, ROW, 200)
    for (let i = win.start; i < win.end; i++) {
      const row = document.createElement('div')
      row.className = 'row' + (i === ov.selected ? ' selected' : '')
      row.style.height = ROW + 'px'
      const t = document.createElement('div')
      t.className = 't'
      const kind = indexRowKind(i, rowsCount)
      if (kind === 'bookmark') {
        t.className = 't pinned'
        t.textContent = '🔖 Bookmark here'
      } else if (kind === 'library') {
        t.className = 't pinned'
        t.textContent = 'Library'
      } else {
        const c = book.chapters[i - 1]
        t.textContent = `${i}. ${c.title}`
        if (i - 1 === cur) t.style.color = 'var(--accent)'
      }
      row.append(t)
      chapterList.append(row)
    }
  }

  function renderBookmark(): void {
    const s = pb?.snapshot()
    if (!s) return
    bookmarkHint.textContent = `ch ${s.chapter + 1} · word ${s.wordIndex} · ${s.wpm} wpm — side = back, hold = library`
    const base = location.href.split(/[?#]/)[0]
    renderQr(
      qrBox,
      installPayload({
        title: 'QuickReader bookmark',
        url: bookmarkUrl(base, __COMMIT_SHA__, { id: book.id, chapter: s.chapter, wordIndex: s.wordIndex, wpm: s.wpm }),
        description: 'Resume reading',
        themeColor: '#FE5000',
      }),
      180,
    )
  }

  /** The one DOM sync: overlay visibility is a function of (status, overlay state). */
  function sync(): void {
    if (unmounted) return
    const s = pb?.snapshot()
    const next = overlayView(s?.status ?? 'paused', ov)
    if (next !== view) {
      if (view === 'chapters') chapterEl.style.display = 'none'
      if (view === 'bookmark') bookmarkEl.style.display = 'none'
      if (next === 'chapters') chapterEl.style.display = ''
      if (next === 'bookmark') {
        renderBookmark()
        bookmarkEl.style.display = ''
      }
      view = next
    }
    if (next === 'chapters') renderIndexRows()
    if (next === 'card' && s) {
      overlayK.textContent = 'Chapter'
      overlayT.textContent = book.chapters[s.chapter].title
      overlay.style.display = 'flex'
    } else if (next === 'end' && s) {
      overlayK.textContent = 'The End'
      overlayT.textContent = book.title
      overlay.style.display = 'flex'
    } else {
      overlay.style.display = 'none'
    }
  }

  function exit(): void {
    pb?.flush()
    nav.library()
  }

  function runEffect(e: OverlayEffect): void {
    switch (e.t) {
      case 'click':
        pb?.click()
        break
      case 'wpm':
        pb?.setWpm(e.delta)
        break
      case 'jump':
        pb?.jump(e.delta)
        break
      case 'seekChapter':
        pb?.seekChapter(e.chapter)
        break
      case 'flush':
        pb?.flush()
        break
      case 'exit':
        exit()
        break
      case 'hint': {
        const s = pb?.snapshot()
        if (s) renderWord(s)
        showHud(`⏸ ${s?.wpm ?? settings.defaultWpm} wpm · hold = chapters`, true)
        break
      }
    }
  }

  /** Inputs before playback is ready are no-ops (nothing to route to yet). */
  function dispatch(input: ReaderInput): void {
    if (!pb) return
    const r = reduceOverlay(ov, pb.snapshot(), input, book.chapters.length + 2)
    ov = r.state
    for (const e of r.effects) runEffect(e)
    sync()
  }

  const flush = () => pb?.flush()
  const onVis = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', onVis)

  const detach = attachInputs({
    onSideClick: () => dispatch('sideClick'),
    onLongPressStart: () => dispatch('longPress'),
    onLongPressEnd() {},
    onScrollUp: () => dispatch('scrollUp'),
    onScrollDown: () => dispatch('scrollDown'),
  })

  void (async () => {
    const saved = await storage.loadPosition(book.id)
    if (unmounted) return
    const initial = saved
      ? { chapter: saved.chapter, wordIndex: saved.wordIndex, wpm: saved.wpm || settings.defaultWpm }
      : { chapter: 0, wordIndex: 0, wpm: settings.defaultWpm }
    pb = createPlayback({
      chapters: book.chapters,
      initial,
      pacing: settings.pacing,
      events: {
        onWord: renderWord,
        onStatus: sync,
        onHud: (kind, s) => showHud(...hudText(book, kind, s)),
        onExit: () => nav.library(),
      },
      seams: {
        save: (p) => {
          void storage.savePosition(book.id, p).catch(() => {})
        },
        now: () => Date.now(),
        schedule: (fn, ms) => setTimeout(fn, ms),
        cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
    })
    sync()
  })()

  return () => {
    unmounted = true
    pb?.destroy()
    if (hudTimer) clearTimeout(hudTimer)
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', onVis)
    chapterEl.remove()
    bookmarkEl.remove()
    detach()
  }
}
