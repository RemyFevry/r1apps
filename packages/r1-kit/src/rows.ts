/**
 * One row-rendering seam: list navigation + the visible window + DOM sync (#15).
 * Screens provide `renderRow` content only; the kit owns row elements, the
 * selected-class flip, and windowing. Two navigation shapes: `up`/`down` for
 * self-navigating screens (library, settings) and the `selected` setter for
 * screens whose selection lives elsewhere (the reader's chapter index, keyed
 * off the playback overlays state).
 */
export interface RowListOptions {
  count(): number
  /** Container class, if any — the kit styles nothing itself (CSS lives in the app). */
  className?: string
  /** Inline row height in px (also the windowing unit when viewHeight is set). */
  rowHeight: number
  /** Viewport height in px; omit to render every row (short lists). */
  viewHeight?: number
  /** Fill one row's content. Sentinel/pseudo rows are the caller's concern. */
  renderRow(row: HTMLElement, i: number, isSelected: boolean): void
  /**
   * Fires before a selection move — and even when the move clamps at the edge —
   * so modal row-states (e.g. the library's delete-confirm) clear before the
   * post-move re-render shows them.
   */
  onCancel?(): void
}

export interface RowList {
  /** Container the kit built; the caller appends and styles it. */
  readonly el: HTMLElement
  /** External navigation: assigning clamps, re-renders on change, never fires onCancel. */
  selected: number
  /** Self navigation: onCancel → move (clamped) → re-render. */
  up(): void
  down(): void
  /** Explicit re-render for data changes (reload, value cycle, mode flip). */
  render(): void
}

export function createRowList(opts: RowListOptions): RowList {
  let selected = 0
  const el = document.createElement('div')
  el.className = opts.className ?? ''

  function render(): void {
    const count = opts.count()
    el.replaceChildren()
    const visible = opts.viewHeight == null ? count : Math.max(1, Math.ceil(opts.viewHeight / opts.rowHeight))
    let start = 0
    if (count > visible) {
      start = selected - Math.floor(visible / 2)
      if (start < 0) start = 0
      if (start + visible > count) start = count - visible
    }
    for (let i = start; i < start + visible && i < count; i++) {
      const row = document.createElement('div')
      row.className = 'row' + (i === selected ? ' selected' : '')
      row.style.height = opts.rowHeight + 'px'
      opts.renderRow(row, i, i === selected)
      el.append(row)
    }
  }

  const list: RowList = {
    el,
    get selected() {
      return selected
    },
    set selected(i) {
      const next = Math.min(Math.max(i, 0), opts.count() - 1)
      if (next === selected) return
      selected = next
      render()
    },
    up() {
      opts.onCancel?.()
      if (selected > 0) {
        selected--
        render()
      }
    },
    down() {
      opts.onCancel?.()
      if (selected < opts.count() - 1) {
        selected++
        render()
      }
    },
    render,
  }
  render()
  return list
}
