import { attachInputs } from 'r1-kit'
import { ingestDocument, ingestErrorMessage } from '../ingestion/ingest'
import type { Ctx } from '../main'

export function addDocScreen(ctx: Ctx): () => void {
  const { root, storage, nav } = ctx
  let busy = false

  const screen = document.createElement('div')
  screen.className = 'form'

  const h2 = document.createElement('h2')
  h2.textContent = 'Add document'
  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.textContent = 'Link to an EPUB or a web article:'
  const textarea = document.createElement('textarea')
  textarea.placeholder = 'https://example.com/book.epub'
  const status = document.createElement('div')
  status.className = 'status'
  const actions = document.createElement('div')
  actions.className = 'actions'
  const back = document.createElement('button')
  back.className = 'btn'
  back.textContent = 'Back'
  const add = document.createElement('button')
  add.className = 'btn primary'
  add.textContent = 'Add'
  actions.append(back, add)
  screen.append(h2, hint, textarea, status, actions)
  root.append(screen)

  async function onAdd(): Promise<void> {
    const url = textarea.value.trim()
    if (!url || busy) return
    busy = true
    add.textContent = '…'
    status.textContent = 'Fetching ' + url.slice(0, 40) + (url.length > 40 ? '…' : '')
    try {
      const doc = await ingestDocument(storage, url)
      nav.openDoc(doc)
    } catch (e) {
      status.textContent = ingestErrorMessage(e)
      busy = false
      add.textContent = 'Add'
    }
  }

  back.addEventListener('pointerup', () => nav.library())
  add.addEventListener('pointerup', () => void onAdd())

  const detach = attachInputs({
    onSideClick() {
      if (!busy) nav.library()
    },
    onLongPressStart() {},
    onLongPressEnd() {},
    onScrollUp() {},
    onScrollDown() {},
  })

  return detach
}
