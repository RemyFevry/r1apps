import { attachInputs, buildChapterIndex, createListNav, formatDuration, visibleWindow, type ChapterIndex, type DocChapter } from 'r1-kit'
import { createReadAlong, type ReadAlong, type ReadAlongHudKind, type ReadAlongSnapshot, type TtsVoice } from '../engine/readalong'
import type { Ctx, DocRecord } from '../main'

const FONT_PX = { S: 15, M: 18, L: 22 } as const

/** Semantic HUD kinds → text + stickiness. Wording lives here, not the engine. */
function hudText(doc: DocRecord, kind: ReadAlongHudKind, s: ReadAlongSnapshot): [string, boolean] {
  switch (kind) {
    case 'pause':
      return [`⏸ ${s.wpm} wpm${s.audioOn ? ' · 🔊' : ''} · ${formatDuration(s.remaining.book)} left`, true]
    case 'resume':
      return [`${s.wpm} wpm${s.audioOn ? ' · 🔊' : ''}`, false]
    case 'wpm':
      return [s.audioOn ? `${s.wpm} wpm (voice speed, next sentence)` : `${s.wpm} wpm`, false]
    case 'audioOn':
      return ['🔊 voice on', false]
    case 'audioOff':
      return ['🔇 voice off', false]
    case 'chapterSeek':
      return [`Ⓒ ${s.chapter + 1}/${doc.chapters.length} — side = resume`, true]
    case 'end':
      return ['side button → library', true]
  }
}

/**
 * Wrap-and-follow pane (ADR-0007): the sentence wraps to as many lines as it
 * needs; the pane scrolls so the current word sits on the anchor line near
 * vertical center. A sentence taller than the pane becomes a moving window.
 */
function renderSentence(
  pane: HTMLElement,
  ci: ChapterIndex,
  s: ReadAlongSnapshot,
  fontPx: number,
): void {
  const sent = ci.sentences[Math.min(s.sentence, ci.sentences.length - 1)]
  pane.replaceChildren()
  const para = document.createElement('p')
  para.className = 'sentence' + (sent.paraAfter ? ' para' : '')
  sent.words.forEach((w, i) => {
    const span = document.createElement('span')
    span.textContent = w.text
    span.className = i === s.wordInSentence ? 'word current' : 'word'
    para.append(span, document.createTextNode(' '))
  })
  pane.append(para)
  pane.style.fontSize = fontPx + 'px'
  // Follow: scroll the current word toward the anchor line.
  const cur = para.children[s.wordInSentence] as HTMLElement | undefined
  if (cur) {
    const paneH = pane.clientHeight
    const target = cur.offsetTop - paneH / 2 + cur.offsetHeight / 2
    pane.scrollTop = Math.max(0, target)
    cur.classList.add('flash')
  }
}

export function readerScreen(ctx: Ctx, doc: DocRecord): () => void {
  const { root, storage, settings, nav, tts } = ctx

  let ra: ReadAlong | null = null
  let unmounted = false
  let hudTimer: ReturnType<typeof setTimeout> | null = null
  const indexes: ChapterIndex[] = doc.chapters.map(buildChapterIndex)

  const screen = document.createElement('div')
  screen.className = 'reader'

  const topbar = document.createElement('div')
  topbar.className = 'topbar'
  const topChapter = document.createElement('span')
  const topPct = document.createElement('span')
  topbar.append(topChapter, topPct)

  const pane = document.createElement('div')
  pane.className = 'pane'

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

  screen.append(topbar, pane, hud, overlay)
  root.append(screen)

  function renderWord(s: ReadAlongSnapshot): void {
    topChapter.textContent = `${doc.chapters[s.chapter].title} · ${s.chapter + 1}/${doc.chapters.length}`
    topPct.textContent = `${Math.floor(s.frac * 100)}% · ${formatDuration(s.remaining.book)}${s.audioOn ? ' · 🔊' : ''}`
    renderSentence(pane, indexes[s.chapter], s, FONT_PX[settings.font])
  }

  function showHud(text: string, sticky = false): void {
    hud.textContent = text
    hud.classList.add('visible')
    if (hudTimer) clearTimeout(hudTimer)
    if (!sticky) hudTimer = setTimeout(() => hud.classList.remove('visible'), 1200)
  }

  function onStatus(s: ReadAlongSnapshot): void {
    if (s.status === 'cardPaused' || s.status === 'cardPlaying') {
      overlayK.textContent = 'Chapter'
      overlayT.textContent = doc.chapters[s.chapter].title
      overlay.style.display = 'flex'
    } else if (s.status === 'finished') {
      overlayK.textContent = 'The End'
      overlayT.textContent = doc.title
      overlay.style.display = 'flex'
    } else {
      overlay.style.display = 'none'
    }
  }

  const live = () => {
    const st = ra?.snapshot().status
    return st === 'playing' || st === 'cardPlaying'
  }

  function exit(): void {
    ra?.flush()
    nav.library()
  }

  let chapterEl: HTMLElement | null = null
  let chapterNav: ReturnType<typeof createListNav> | null = null
  const ROW = 36

  function showChapterIndex(): void {
    hideChapterIndex()
    const rowsCount = () => doc.chapters.length + 1
    const isLibraryRow = (i: number) => i === rowsCount() - 1

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
    hint.textContent = 'scroll = move · side = open · hold = back'
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
          if (isLibraryRow(i)) {
            t.className = 't pinned'
            t.textContent = 'Library'
          } else {
            const c = doc.chapters[i]
            t.textContent = `${i + 1}. ${c.title}`
            if (i === ra?.snapshot().chapter) t.style.color = 'var(--accent)'
          }
          row.append(t)
          list.append(row)
        }
      },
    })
    chapterNav.jumpTo(ra?.snapshot().chapter ?? 0)
    root.append(el)
    chapterEl = el
  }

  function hideChapterIndex(): void {
    chapterEl?.remove()
    chapterEl = null
    chapterNav = null
  }

  const flush = () => ra?.flush()
  const onVis = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', onVis)

  const detach = attachInputs({
    onSideClick() {
      if (chapterEl) {
        const sel = chapterNav!.selected
        if (sel === doc.chapters.length) {
          hideChapterIndex()
          exit()
          return
        }
        hideChapterIndex()
        ra?.seekChapter(sel)
        return
      }
      ra?.click()
    },
    onLongPressStart() {
      if (chapterEl) {
        hideChapterIndex()
        const s = ra?.snapshot()
        if (s) renderWord(s)
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
      if (live()) ra?.setWpm(-10)
      else ra?.seekBySentence(-1)
    },
    onScrollDown() {
      if (chapterEl) {
        chapterNav!.down()
        return
      }
      if (live()) ra?.setWpm(10)
      else ra?.seekBySentence(1)
    },
  })

  void (async () => {
    const saved = await storage.loadPosition(doc.id)
    if (unmounted) return
    const voice: TtsVoice = settings.engine === 'elevenlabs' && settings.elevenKey ? tts.eleven : tts.rabbit
    const initial = saved
      ? { chapter: saved.chapter, wordIndex: saved.wordIndex, wpm: saved.wpm || settings.defaultWpm, audioOn: saved.audioOn }
      : { chapter: 0, wordIndex: 0, wpm: settings.defaultWpm, audioOn: false }
    ra = createReadAlong({
      chapters: doc.chapters as DocChapter[],
      initial,
      pacing: settings.pacing,
      events: {
        onWord: renderWord,
        onStatus,
        onHud: (kind, s) => showHud(...hudText(doc, kind, s)),
        onExit: () => nav.library(),
      },
      seams: {
        save: (p) => {
          void storage.savePosition(doc.id, p).catch(() => {})
        },
        now: () => Date.now(),
        schedule: (fn, ms) => setTimeout(fn, ms),
        cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      },
      voice,
    })
  })()

  return () => {
    unmounted = true
    ra?.destroy()
    if (hudTimer) clearTimeout(hudTimer)
    window.removeEventListener('pagehide', flush)
    document.removeEventListener('visibilitychange', onVis)
    hideChapterIndex()
    detach()
  }
}
