import { describe, expect, test } from 'vitest'
import type { PlaybackSnapshot, PlaybackStatus } from '../src/engine/playback'
import {
  indexRowKind,
  initialOverlayState,
  overlayView,
  reduceOverlay,
  type OverlayEffect,
  type OverlayState,
} from '../src/screens/overlays'

const STATUSES: PlaybackStatus[] = ['cardPaused', 'cardPlaying', 'playing', 'paused', 'finished']

/** 3 chapters → rows: bookmark | ch 0 | ch 1 | ch 2 | library (rowsCount 5). */
const R = 5

function snap(status: PlaybackStatus, chapter = 0): Pick<PlaybackSnapshot, 'status' | 'chapter'> {
  return { status, chapter }
}

function run(
  st: OverlayState,
  status: PlaybackStatus,
  input: Parameters<typeof reduceOverlay>[2],
  chapter = 0,
): { state: OverlayState; effects: OverlayEffect[] } {
  return reduceOverlay(st, snap(status, chapter), input, R)
}

describe('overlayView — one overlay at a time, by construction', () => {
  test('modal overlays suppress the card/end card under every status', () => {
    for (const status of STATUSES) {
      expect(overlayView(status, { kind: 'chapters', selected: 2 })).toBe('chapters')
      expect(overlayView(status, { kind: 'bookmark', selected: 0 })).toBe('bookmark')
    }
  })

  test('no modal: view follows status alone', () => {
    const none = initialOverlayState()
    expect(overlayView('cardPaused', none)).toBe('card')
    expect(overlayView('cardPlaying', none)).toBe('card')
    expect(overlayView('playing', none)).toBe('none')
    expect(overlayView('paused', none)).toBe('none')
    expect(overlayView('finished', none)).toBe('end')
  })

  test('initial state is no overlay', () => {
    expect(initialOverlayState()).toEqual({ kind: 'none', selected: 0 })
  })
})

describe('long-press', () => {
  test('while paused opens the chapter index at the current chapter, silently', () => {
    const r = run(initialOverlayState(), 'paused', 'longPress', 1)
    expect(r.state).toEqual({ kind: 'chapters', selected: 2 })
    expect(r.effects).toEqual([])
  })

  test('while cardPaused (fresh chapter card) also opens the index — card suppressed', () => {
    const r = run(initialOverlayState(), 'cardPaused', 'longPress', 0)
    expect(r.state).toEqual({ kind: 'chapters', selected: 1 })
  })

  test('while finished opens the index — end card suppressed, restored on cancel', () => {
    const open = run(initialOverlayState(), 'finished', 'longPress', 2)
    expect(open.state.kind).toBe('chapters')
    expect(overlayView('finished', open.state)).toBe('chapters')
    const cancel = reduceOverlay(open.state, snap('finished', 2), 'longPress', R)
    expect(cancel.state.kind).toBe('none')
    expect(overlayView('finished', cancel.state)).toBe('end')
  })

  test('while playing exits', () => {
    expect(run(initialOverlayState(), 'playing', 'longPress').effects).toEqual([{ t: 'exit' }])
  })

  test('while cardPlaying (boundary card) exits', () => {
    expect(run(initialOverlayState(), 'cardPlaying', 'longPress').effects).toEqual([{ t: 'exit' }])
  })

  test('while the index is open cancels it with a sticky pause hint', () => {
    const r = run({ kind: 'chapters', selected: 3 }, 'paused', 'longPress')
    expect(r.state.kind).toBe('none')
    expect(r.effects).toEqual([{ t: 'hint' }])
  })

  test('while the bookmark QR is open exits', () => {
    const r = run({ kind: 'bookmark', selected: 0 }, 'paused', 'longPress')
    expect(r.effects).toEqual([{ t: 'exit' }])
  })
})

describe('chapter index scroll', () => {
  test('moves the selection and clamps at both ends', () => {
    expect(run({ kind: 'chapters', selected: 2 }, 'paused', 'scrollUp').state.selected).toBe(1)
    expect(run({ kind: 'chapters', selected: 0 }, 'paused', 'scrollUp').state.selected).toBe(0)
    expect(run({ kind: 'chapters', selected: 3 }, 'paused', 'scrollDown').state.selected).toBe(4)
    expect(run({ kind: 'chapters', selected: 4 }, 'paused', 'scrollDown').state.selected).toBe(4)
  })

  test('never leaks to playback (no wpm/jump effects)', () => {
    for (const input of ['scrollUp', 'scrollDown', 'sideClick'] as const) {
      // sideClick on a chapter row also stays off playback except the explicit seek
      const r = run({ kind: 'chapters', selected: 2 }, 'playing', input)
      expect(r.effects.every((e) => e.t === 'seekChapter' || e.t === 'hint')).toBe(true)
    }
  })
})

describe('chapter index activation (side click rows)', () => {
  test('bookmark row (0) swaps the index for the bookmark QR after flushing', () => {
    const r = run({ kind: 'chapters', selected: 0 }, 'paused', 'sideClick')
    expect(r.state).toEqual({ kind: 'bookmark', selected: 0 })
    expect(r.effects).toEqual([{ t: 'flush' }])
  })

  test('library row (last) exits', () => {
    const r = run({ kind: 'chapters', selected: R - 1 }, 'paused', 'sideClick')
    expect(r.state.kind).toBe('none')
    expect(r.effects).toEqual([{ t: 'exit' }])
  })

  test('chapter row seeks and closes', () => {
    const r = run({ kind: 'chapters', selected: 3 }, 'paused', 'sideClick')
    expect(r.state.kind).toBe('none')
    expect(r.effects).toEqual([{ t: 'seekChapter', chapter: 2 }])
  })
})

describe('bookmark QR', () => {
  test('side click closes it, silently', () => {
    const r = run({ kind: 'bookmark', selected: 0 }, 'paused', 'sideClick')
    expect(r.state.kind).toBe('none')
    expect(r.effects).toEqual([])
  })

  test('scroll is inert while open', () => {
    for (const input of ['scrollUp', 'scrollDown'] as const) {
      const r = run({ kind: 'bookmark', selected: 0 }, 'playing', input)
      expect(r.state.kind).toBe('bookmark')
      expect(r.effects).toEqual([])
    }
  })
})

describe('scroll routing without a modal (the old live() rule)', () => {
  test('live statuses route scroll to wpm', () => {
    expect(run(initialOverlayState(), 'playing', 'scrollUp').effects).toEqual([{ t: 'wpm', delta: -10 }])
    expect(run(initialOverlayState(), 'playing', 'scrollDown').effects).toEqual([{ t: 'wpm', delta: 10 }])
    expect(run(initialOverlayState(), 'cardPlaying', 'scrollUp').effects).toEqual([{ t: 'wpm', delta: -10 }])
  })

  test('non-live statuses route scroll to chapter jumps', () => {
    expect(run(initialOverlayState(), 'paused', 'scrollUp').effects).toEqual([{ t: 'jump', delta: -1 }])
    expect(run(initialOverlayState(), 'paused', 'scrollDown').effects).toEqual([{ t: 'jump', delta: 1 }])
    expect(run(initialOverlayState(), 'cardPaused', 'scrollDown').effects).toEqual([{ t: 'jump', delta: 1 }])
    expect(run(initialOverlayState(), 'finished', 'scrollDown').effects).toEqual([{ t: 'jump', delta: 1 }])
  })
})

describe('side click without a modal', () => {
  test('passes through to playback under every status, state untouched', () => {
    for (const status of STATUSES) {
      const r = run(initialOverlayState(), status, 'sideClick')
      expect(r.effects).toEqual([{ t: 'click' }])
      expect(r.state.kind).toBe('none')
    }
  })
})

describe('indexRowKind — sentinel rows', () => {
  test('bookmark first, library last, chapters between', () => {
    expect(indexRowKind(0, R)).toBe('bookmark')
    expect(indexRowKind(R - 1, R)).toBe('library')
    for (let i = 1; i < R - 1; i++) expect(indexRowKind(i, R)).toBe('chapter')
  })
})

describe('mutual exclusion under reduction', () => {
  test('from bookmark, no input opens the chapter index', () => {
    const inputs = ['sideClick', 'longPress', 'scrollUp', 'scrollDown'] as const
    for (const input of inputs) {
      expect(run({ kind: 'bookmark', selected: 0 }, 'paused', input).state.kind).not.toBe('chapters')
    }
  })

  test('from chapters, only the bookmark row opens bookmark; nothing opens two', () => {
    for (let sel = 0; sel < R; sel++) {
      const inputs = ['sideClick', 'longPress', 'scrollUp', 'scrollDown'] as const
      for (const input of inputs) {
        const r = run({ kind: 'chapters', selected: sel }, 'paused', input)
        expect(['none', 'chapters', 'bookmark']).toContain(r.state.kind)
        if (r.state.kind === 'bookmark') {
          expect(input).toBe('sideClick')
          expect(sel).toBe(0)
        }
      }
    }
  })
})
