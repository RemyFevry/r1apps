export function visibleWindow(
  selected: number,
  count: number,
  rowHeight: number,
  viewHeight: number,
): { start: number; end: number } {
  const visible = Math.max(1, Math.ceil(viewHeight / rowHeight))
  if (count <= visible) return { start: 0, end: count }
  let start = selected - Math.floor(visible / 2)
  if (start < 0) start = 0
  if (start + visible > count) start = count - visible
  return { start, end: start + visible }
}

export interface ListNavOptions {
  count(): number
  onChange(): void
  onCancel?(): void
}

export interface ListNav {
  readonly selected: number
  up(): void
  down(): void
}

export function createListNav(opts: ListNavOptions): ListNav {
  const state = { selected: 0 }
  return {
    get selected() {
      return state.selected
    },
    up() {
      opts.onCancel?.()
      if (state.selected > 0) {
        state.selected--
        opts.onChange()
      }
    },
    down() {
      opts.onCancel?.()
      if (state.selected < opts.count() - 1) {
        state.selected++
        opts.onChange()
      }
    },
  }
}
