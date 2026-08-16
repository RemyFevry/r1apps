// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest'
import { createRowList } from '../src/rows'

/** rowHeight 46 × viewHeight 200 → 5 visible rows, matching the library's geometry. */
const ROW = 46
const VIEW = 200

describe('createRowList — full render (no viewHeight)', () => {
  test('renders one .row per count, content from renderRow, height inline', () => {
    const list = createRowList({
      count: () => 4,
      className: 'rows',
      rowHeight: ROW,
      renderRow(row, i) {
        row.textContent = `row ${i}`
      },
    })
    expect(list.el.className).toBe('rows')
    expect(list.el.children.length).toBe(4)
    const first = list.el.children[0] as HTMLElement
    expect(first.className).toBe('row selected')
    expect(first.style.height).toBe('46px')
    expect(first.textContent).toBe('row 0')
    expect((list.el.children[3] as HTMLElement).className).toBe('row')
  })

  test('styles nothing itself without a className option', () => {
    const list = createRowList({ count: () => 1, rowHeight: ROW, renderRow() {} })
    expect(list.el.className).toBe('')
  })

  test('renderRow receives the selection so content can branch without reading the list', () => {
    const seen: boolean[] = []
    const list = createRowList({
      count: () => 3,
      rowHeight: ROW,
      renderRow(row, i, isSelected) {
        seen.push(isSelected)
        row.textContent = `${i}${isSelected ? ' ✓' : ''}`
      },
    })
    expect(seen).toEqual([true, false, false])
    expect(list.el.children[0].textContent).toBe('0 ✓')
    list.down()
    expect(list.el.children[0].textContent).toBe('0')
    expect(list.el.children[1].textContent).toBe('1 ✓')
  })

  test('selection class flips on down/up and clamps at both ends', () => {
    const list = createRowList({ count: () => 3, rowHeight: ROW, renderRow() {} })
    list.up()
    expect(list.selected).toBe(0)
    list.down()
    list.down()
    list.down()
    expect(list.selected).toBe(2)
    const cls = (i: number) => (list.el.children[i] as HTMLElement).className
    expect(cls(0)).toBe('row')
    expect(cls(1)).toBe('row')
    expect(cls(2)).toBe('row selected')
  })
})

describe('createRowList — selected setter (external navigation)', () => {
  test('clamps into range and re-renders on change', () => {
    let renders = 0
    const list = createRowList({
      count: () => 3,
      rowHeight: ROW,
      renderRow() {
        renders++
      },
    })
    renders = 0
    list.selected = 99
    expect(list.selected).toBe(2)
    expect(renders).toBe(3) // one re-render × 3 rows
    list.selected = -5
    expect(list.selected).toBe(0)
    expect(renders).toBe(6)
  })

  test('same value is a no-op (no re-render)', () => {
    let renders = 0
    const list = createRowList({
      count: () => 3,
      rowHeight: ROW,
      renderRow() {
        renders++
      },
    })
    renders = 0
    list.selected = 0
    expect(renders).toBe(0)
  })
})

describe('createRowList — windowing (viewHeight)', () => {
  test('renders exactly the visible window and follows the selection down', () => {
    const list = createRowList({
      count: () => 12,
      rowHeight: ROW,
      viewHeight: VIEW,
      renderRow(row, i) {
        row.textContent = String(i)
      },
    })
    expect(list.el.children.length).toBe(5)
    expect(list.el.children[0].textContent).toBe('0')
    list.selected = 5 // centered: 3..8
    expect(list.el.children[0].textContent).toBe('3')
    list.selected = 11 // clamped bottom: 7..12
    expect(list.el.children.length).toBe(5)
    expect(list.el.children[0].textContent).toBe('7')
    list.selected = 0 // clamped top
    expect(list.el.children[0].textContent).toBe('0')
  })

  test('fewer rows than the window renders everything', () => {
    const list = createRowList({
      count: () => 3,
      rowHeight: ROW,
      viewHeight: VIEW,
      renderRow(row, i) {
        row.textContent = String(i)
      },
    })
    expect(list.el.children.length).toBe(3)
  })

  test('dynamic count re-windows on render()', () => {
    let n = 12
    const list = createRowList({
      count: () => n,
      rowHeight: ROW,
      viewHeight: VIEW,
      renderRow(row, i) {
        row.textContent = String(i)
      },
    })
    list.selected = 11
    n = 4 // library after a delete
    list.render()
    expect(list.el.children.length).toBe(4)
    expect(list.el.children[0].textContent).toBe('0')
  })
})

describe('createRowList — pinned/pseudo rows pass through renderRow', () => {
  test('kit hands renderRow the raw index and keeps whatever classes/content it sets', () => {
    const seen: number[] = []
    const list = createRowList({
      count: () => 3,
      rowHeight: ROW,
      renderRow(row, i) {
        seen.push(i)
        if (i === 0) {
          const pinned = document.createElement('div')
          pinned.className = 't pinned'
          pinned.textContent = '🔖 sentinel'
          row.append(pinned)
        } else {
          row.textContent = `chapter ${i}`
        }
      },
    })
    expect(seen).toEqual([0, 1, 2])
    const first = list.el.children[0].firstElementChild as HTMLElement
    expect(first.className).toBe('t pinned')
    expect(first.textContent).toBe('🔖 sentinel')
    expect(list.el.children[1].textContent).toBe('chapter 1')
  })
})

describe('createRowList — cancel ordering', () => {
  test('onCancel fires BEFORE the move (selection still old inside the callback)', () => {
    let observed = -1
    const list = createRowList({
      count: () => 3,
      rowHeight: ROW,
      renderRow() {},
      onCancel: () => {
        observed = list.selected
      },
    })
    list.down()
    expect(observed).toBe(0)
    expect(list.selected).toBe(1)
  })

  test('onCancel fires even when the move clamps at the top', () => {
    let cancels = 0
    const list = createListWithCancel(() => cancels++)
    list.up()
    expect(cancels).toBe(1)
    expect(list.selected).toBe(0)
  })

  test('onCancel does NOT fire on setter or render', () => {
    let cancels = 0
    const list = createListWithCancel(() => cancels++)
    list.selected = 2
    list.render()
    expect(cancels).toBe(0)
  })
})

function createListWithCancel(onCancel: () => void) {
  return createRowList({ count: () => 3, rowHeight: ROW, renderRow() {}, onCancel })
}
