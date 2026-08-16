import {
  attachInputs,
  createListNav,
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
import type { Ctx } from '../main'

const FONT_PX: Record<Settings['font'], number> = { S: 20, M: 24, L: 30 }
const FIT_CHARS = 13

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
  root.append(screen)

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

  function onStatus(s: PlaybackSnapshot): void {
    if (s.status === 'cardPaused' || s.status === 'cardPlaying') {
      overlayK.textContent = 'Chapter'
      overlayT.textContent = book.chapters[s.chapter].title
      overlay.style.display = 'flex'
    } else if (s.status === 'finished') {
      overlayK.textContent = 'The End'
      overlayT.textContent = book.title
      overlay.style.display = 'flex'
    } else {
      overlay.style.display = 'none'
    }
  }

  /** Scroll/long-press route by liveness — the old implicit `playing` boolean. */
  function live(): boolean {
    const st = pb?.snapshot().status
    return st === 'playing' || st === 'cardPlaying'
  }

  function exit(): void {
    pb?.flush()
    nav.library()
  }

  let bookmarkEl: HTMLElement | null = null
  let chapterEl: HTMLElement | null = null
  let chapterNav: ReturnType<typeof createListNav> | null = null

  const ROW = 36

  function showChapterIndex(): void {
    hideChapterIndex()
    if (bookmarkEl) hideBookmark()
    const rowsCount = () => book.chapters.length + 2
    const isBookmarkRow = (i: number) => i === 0
    const isLibraryRow = (i: number) => i === rowsCount() - 1
    const chapterRow = (i: number) => i - 1

    const el = document.createElement('div')
    el.className = 'card-overlay'
    el.style.justifyContent = 'flex-start'
    el.style.paddingTop = '16px'
    const k = document.createElement('div')
    k.className = 'k'
    k.textContent = 'Navigate'
    k.style.marginBottom = '8px'
    const list = document.createElement('div')
    list.style.width = '100%'
    list.style.overflow = 'hidden'
    const hint = document.createElement('div')
    hint.className = 'status'
    hint.textContent = 'scroll = move · side = open · hold = cancel'
    hint.style.marginTop = '8px'
    el.append(k, list, hint)

    chapterNav = createListNav({
      count: rowsCount,
      onChange: () => {
        list.replaceChildren()
        const win = visibleWindow(chapterNav!.selected, rowsCount(), ROW, 200)
        for (let i = win.start; i < win.end; i++) {
          const row = document.createElement('div')
          row.className = 'row' + (i === chapterNav!.selected ? ' selected' : '')
          row.style.height = ROW + 'px'
          const t = document.createElement('div')
          t.className = 't'
          if (isBookmarkRow(i)) {
            t.className = 't pinned'
            t.textContent = '🔖 Bookmark here'
          } else if (isLibraryRow(i)) {
            t.className = 't pinned'
            t.textContent = 'Library'
          } else {
            const c = book.chapters[chapterRow(i)]
            t.textContent = `${chapterRow(i) + 1}. ${c.title}`
            if (chapterRow(i) === pb?.snapshot().chapter) t.style.color = 'var(--accent)'
          }
          row.append(t)
          list.append(row)
        }
      },
    })
    chapterNav.jumpTo((pb?.snapshot().chapter ?? 0) + 1)
    root.append(el)
    chapterEl = el
  }

  function hideChapterIndex(): void {
    chapterEl?.remove()
    chapterEl = null
    chapterNav = null
  }

  function showBookmark(): void {
    hideBookmark()
    pb?.flush()
    const s = pb?.snapshot()
    if (!s) return
    const el = document.createElement('div')
    el.className = 'card-overlay'
    const k = document.createElement('div')
    k.className = 'k'
    k.textContent = 'Bookmark — scan to resume here'
    const qrBox = document.createElement('div')
    qrBox.style.background = '#fff'
    qrBox.style.padding = '6px'
    qrBox.style.borderRadius = '8px'
    const hint = document.createElement('div')
    hint.className = 'status'
    hint.textContent = `ch ${s.chapter + 1} · word ${s.wordIndex} · ${s.wpm} wpm — side = back, hold = library`
    el.append(k, qrBox, hint)
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
    root.append(el)
    bookmarkEl = el
  }

  function hideBookmark(): void {
    bookmarkEl?.remove()
    bookmarkEl = null
  }

  const flush = () => pb?.flush()
  const onVis = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', onVis)

  const detach = attachInputs({
    onSideClick() {
      if (chapterEl) {
        const sel = chapterNav!.selected
        const rowsCount = book.chapters.length + 2
        if (sel === 0) {
          hideChapterIndex()
          showBookmark()
          return
        }
        if (sel === rowsCount - 1) {
          hideChapterIndex()
          exit()
          return
        }
        hideChapterIndex()
        pb?.seekChapter(sel - 1)
        return
      }
      if (bookmarkEl) {
        hideBookmark()
        return
      }
      pb?.click()
    },
    onLongPressStart() {
      if (chapterEl) {
        hideChapterIndex()
        const s = pb?.snapshot()
        if (s) renderWord(s)
        showHud(`⏸ ${s?.wpm ?? settings.defaultWpm} wpm · hold = chapters`, true)
        return
      }
      if (bookmarkEl) {
        hideBookmark()
        exit()
        return
      }
      if (live()) {
        exit()
        return
      }
      showChapterIndex()
    },
    onLongPressEnd() {},
    onScrollUp() {
      if (chapterEl) {
        chapterNav!.up()
        return
      }
      if (live()) pb?.setWpm(-10)
      else pb?.jump(-1)
    },
    onScrollDown() {
      if (chapterEl) {
        chapterNav!.down()
        return
      }
      if (live()) pb?.setWpm(10)
      else pb?.jump(1)
    },
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
        onStatus,
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
  })()

  return () => {
    unmounted = true
    pb?.destroy()
    if (hudTimer) clearTimeout(hudTimer)
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', onVis)
    hideChapterIndex()
    hideBookmark()
    detach()
  }
}
