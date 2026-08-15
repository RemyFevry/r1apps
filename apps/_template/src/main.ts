import { attachInputs, closeApp } from 'r1-kit'

const n = document.getElementById('n') as HTMLElement
let v = 0

function render(): void {
  n.textContent = String(v)
}

attachInputs({
  onSideClick() {
    v = 0
    render()
  },
  onLongPressStart() {
    closeApp()
  },
  onLongPressEnd() {},
  onScrollUp() {
    v++
    render()
  },
  onScrollDown() {
    v--
    render()
  },
})
