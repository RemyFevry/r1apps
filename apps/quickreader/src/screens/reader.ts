import { attachInputs, type Position, type Settings, type BookRecord } from 'r1-kit'
import { delayFor, orpIndex, previousSentenceStart } from '../engine/rsvp'
import type { Ctx } from '../main'

const FONT_PX: Record<Settings['font'], number> = { S: 20, M: 24, L: 30 }
const CHAPTER_CARD_MS = 1500
const DOUBLE_CLICK_MS = 300
const SAVE_EVERY = 50
const FIT_CHARS = 13

export function readerScreen(ctx: Ctx, book: BookRecord): () => void {
  const { root, storage, settings, nav } = ctx
  const offsets: number[] = []
  let acc = 0
  for (const c of book.chapters) {
    offsets.push(acc)
    acc += c.words.length
  }
  const paraSets = book.chapters.map((c) => new Set(c.paras))

  let pos: Position = { chapter: 0, wordIndex: 0, wpm: settings.defaultWpm }
  let playing = false
  let finished = false
  let destroyed = false
  let pausedByClick = false
  let pausedAt = 0
  let sinceSave = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let cardTimer: ReturnType<typeof setTimeout> | null = null
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

  const curWord = () => book.chapters[pos.chapter].words[pos.wordIndex]
  const globalIndex = () => offsets[pos.chapter] + pos.wordIndex

  function renderWord(): void {
    const w = curWord()
    topChapter.textContent = book.chapters[pos.chapter].title
    topPct.textContent = Math.floor((globalIndex() / book.wordCount) * 100) + '%'
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

  function saveNow(): void {
    pos.frac = globalIndex() / book.wordCount
    void storage.savePosition(book.id, { ...pos }).catch(() => {})
  }

  function step(): void {
    if (destroyed || !playing) return
    renderWord()
    const ch = book.chapters[pos.chapter]
    const nextIsPara = pos.wordIndex + 1 < ch.words.length && paraSets[pos.chapter].has(pos.wordIndex + 1)
    timer = setTimeout(advance, delayFor(curWord(), { wpm: pos.wpm, pacing: settings.pacing, nextIsPara }))
  }

  function showCard(): void {
    overlayK.textContent = 'Chapter'
    overlayT.textContent = book.chapters[pos.chapter].title
    overlay.style.display = 'flex'
    cardTimer = setTimeout(closeCard, CHAPTER_CARD_MS)
  }

  function closeCard(): void {
    if (cardTimer) {
      clearTimeout(cardTimer)
      cardTimer = null
    }
    overlay.style.display = 'none'
    playing = true
    step()
  }

  function advance(): void {
    const ch = book.chapters[pos.chapter]
    if (pos.wordIndex < ch.words.length - 1) {
      pos.wordIndex++
      if (++sinceSave >= SAVE_EVERY) {
        sinceSave = 0
        saveNow()
      }
      step()
    } else if (pos.chapter < book.chapters.length - 1) {
      pos.chapter++
      pos.wordIndex = 0
      saveNow()
      showCard()
    } else {
      finished = true
      playing = false
      saveNow()
      overlayK.textContent = 'The End'
      overlayT.textContent = book.title
      overlay.style.display = 'flex'
      showHud('side button → library', true)
    }
  }

  function pause(): void {
    playing = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    pausedAt = Date.now()
    saveNow()
    showHud(`⏸ ${pos.wpm} wpm`, true)
  }

  function resume(): void {
    showHud(`${pos.wpm} wpm`)
    playing = true
    step()
  }

  function adjustWpm(delta: number): void {
    pos.wpm = Math.min(800, Math.max(100, pos.wpm + delta))
    if (playing) showHud(`${pos.wpm} wpm`)
    else showHud(`⏸ ${pos.wpm} wpm`, true)
  }

  function exit(): void {
    saveNow()
    nav.library()
  }

  const detach = attachInputs({
    onSideClick() {
      if (cardTimer) {
        closeCard()
        return
      }
      if (finished) {
        exit()
        return
      }
      if (playing) {
        pausedByClick = true
        pause()
        return
      }
      if (pausedByClick && Date.now() - pausedAt < DOUBLE_CLICK_MS) {
        pausedByClick = false
        const ch = book.chapters[pos.chapter]
        pos.wordIndex = previousSentenceStart(ch.words, pos.wordIndex)
        resume()
        return
      }
      pausedByClick = false
      resume()
    },
    onLongPressStart() {
      exit()
    },
    onLongPressEnd() {},
    onScrollUp() {
      adjustWpm(-10)
    },
    onScrollDown() {
      adjustWpm(10)
    },
  })

  void (async () => {
    const saved = await storage.loadPosition(book.id)
    if (saved) {
      pos = { ...saved }
      if (!pos.wpm) pos.wpm = settings.defaultWpm
    }
    if (
      pos.chapter < book.chapters.length &&
      pos.wordIndex > 0 &&
      pos.wordIndex < book.chapters[pos.chapter].words.length
    ) {
      playing = true
      step()
    } else {
      pos.wordIndex = 0
      showCard()
    }
  })()

  return () => {
    destroyed = true
    if (timer) clearTimeout(timer)
    if (cardTimer) clearTimeout(cardTimer)
    if (hudTimer) clearTimeout(hudTimer)
    saveNow()
    detach()
  }
}
