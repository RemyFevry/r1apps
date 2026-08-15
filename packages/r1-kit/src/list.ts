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
