import { isLive, type PlaybackSnapshot, type PlaybackStatus } from '../engine/playback'

/**
 * Reader overlays as dumb components keyed off playback status (#14).
 *
 * One scalar `kind` owns which modal overlay is up; `overlayView` derives the
 * single visible overlay from (status, kind), so mutual exclusion holds by
 * construction: a modal (chapters/bookmark) suppresses the chapter/end card,
 * and the card is a pure function of the playback status otherwise. Input
 * handlers shrink to one `reduceOverlay` call plus effect execution — no
 * element-nullness dispatch.
 */
export interface OverlayState {
  kind: 'none' | 'chapters' | 'bookmark'
  /** Chapter-index cursor (row 0 = bookmark, rowsCount-1 = library); unused otherwise. */
  selected: number
}

export type OverlayView = 'none' | 'chapters' | 'bookmark' | 'card' | 'end'

/** What reduceOverlay reads from playback — the status contract, nothing positional. */
export type OverlaySnap = Pick<PlaybackSnapshot, 'status' | 'chapter'>

export interface OverlayResult {
  state: OverlayState
  effects: OverlayEffect[]
}

export type ReaderInput = 'sideClick' | 'longPress' | 'scrollUp' | 'scrollDown'

/** Sentinel rows of the chapter index: bookmark first, library last, chapters between. */
export function indexRowKind(i: number, rowsCount: number): 'bookmark' | 'library' | 'chapter' {
  if (i === 0) return 'bookmark'
  if (i === rowsCount - 1) return 'library'
  return 'chapter'
}

export type OverlayEffect =
  | { t: 'click' }
  | { t: 'wpm'; delta: number }
  | { t: 'jump'; delta: number }
  | { t: 'seekChapter'; chapter: number }
  | { t: 'flush' }
  | { t: 'exit' }
  | { t: 'hint' }

export function initialOverlayState(): OverlayState {
  return { kind: 'none', selected: 0 }
}

/** The single visible overlay. Modals win over status-driven cards. */
export function overlayView(status: PlaybackStatus, st: OverlayState): OverlayView {
  if (st.kind !== 'none') return st.kind
  if (status === 'cardPaused' || status === 'cardPlaying') return 'card'
  if (status === 'finished') return 'end'
  return 'none'
}

export function reduceOverlay(
  st: OverlayState,
  snap: OverlaySnap,
  input: ReaderInput,
  rowsCount: number,
): OverlayResult {
  if (st.kind === 'chapters') return chapters(st, input, rowsCount)
  if (st.kind === 'bookmark') return bookmark(st, input)
  return noModal(snap, input, rowsCount)
}

function chapters(st: OverlayState, input: ReaderInput, rowsCount: number): OverlayResult {
  switch (input) {
    case 'sideClick': {
      const kind = indexRowKind(st.selected, rowsCount)
      if (kind === 'bookmark') return { state: { kind: 'bookmark', selected: 0 }, effects: [{ t: 'flush' }] }
      if (kind === 'library') return { state: initialOverlayState(), effects: [{ t: 'exit' }] }
      return { state: initialOverlayState(), effects: [{ t: 'seekChapter', chapter: st.selected - 1 }] }
    }
    case 'longPress':
      return { state: initialOverlayState(), effects: [{ t: 'hint' }] }
    case 'scrollUp':
      return { state: { ...st, selected: Math.max(0, st.selected - 1) }, effects: [] }
    case 'scrollDown':
      return { state: { ...st, selected: Math.min(rowsCount - 1, st.selected + 1) }, effects: [] }
  }
}

function bookmark(st: OverlayState, input: ReaderInput): OverlayResult {
  switch (input) {
    case 'sideClick':
      return { state: initialOverlayState(), effects: [] }
    case 'longPress':
      return { state: initialOverlayState(), effects: [{ t: 'exit' }] }
    case 'scrollUp':
    case 'scrollDown':
      return { state: st, effects: [] }
  }
}

function noModal(snap: OverlaySnap, input: ReaderInput, rowsCount: number): OverlayResult {
  switch (input) {
    case 'sideClick':
      return { state: initialOverlayState(), effects: [{ t: 'click' }] }
    case 'longPress':
      if (isLive(snap.status)) return { state: initialOverlayState(), effects: [{ t: 'exit' }] }
      return { state: { kind: 'chapters', selected: Math.min(snap.chapter + 1, rowsCount - 1) }, effects: [] }
    case 'scrollUp':
      return isLive(snap.status)
        ? { state: initialOverlayState(), effects: [{ t: 'wpm', delta: -10 }] }
        : { state: initialOverlayState(), effects: [{ t: 'jump', delta: -1 }] }
    case 'scrollDown':
      return isLive(snap.status)
        ? { state: initialOverlayState(), effects: [{ t: 'wpm', delta: 10 }] }
        : { state: initialOverlayState(), effects: [{ t: 'jump', delta: 1 }] }
  }
}
