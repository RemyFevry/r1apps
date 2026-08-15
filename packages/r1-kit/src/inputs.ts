export interface InputHandlers {
  onSideClick(): void
  onLongPressStart(): void
  onLongPressEnd(): void
  onScrollUp(): void
  onScrollDown(): void
}

export function attachInputs(h: InputHandlers): () => void {
  const side = () => h.onSideClick()
  const lps = () => h.onLongPressStart()
  const lpe = () => h.onLongPressEnd()
  const up = () => h.onScrollUp()
  const down = () => h.onScrollDown()

  window.addEventListener('sideClick', side)
  window.addEventListener('longPressStart', lps)
  window.addEventListener('longPressEnd', lpe)
  window.addEventListener('scrollUp', up)
  window.addEventListener('scrollDown', down)

  const keydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') side()
    else if (e.key === 'ArrowUp') up()
    else if (e.key === 'ArrowDown') down()
    else if (e.key === ' ' && !e.repeat) lps()
  }
  const keyup = (e: KeyboardEvent) => {
    if (e.key === ' ') lpe()
  }
  document.addEventListener('keydown', keydown)
  document.addEventListener('keyup', keyup)

  return () => {
    window.removeEventListener('sideClick', side)
    window.removeEventListener('longPressStart', lps)
    window.removeEventListener('longPressEnd', lpe)
    window.removeEventListener('scrollUp', up)
    window.removeEventListener('scrollDown', down)
    document.removeEventListener('keydown', keydown)
    document.removeEventListener('keyup', keyup)
  }
}
