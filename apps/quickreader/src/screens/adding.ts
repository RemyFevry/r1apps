import { attachInputs, type Storage } from 'r1-kit'
import { ingestBook, ingestErrorMessage } from '../ingestion/ingest'
import type { Nav } from '../main'

export function addingScreen(root: HTMLElement, storage: Storage, nav: Nav, url: string): () => void {
  let failed = false

  const screen = document.createElement('div')
  screen.className = 'form'
  const h2 = document.createElement('h2')
  h2.textContent = 'Adding book'
  const link = document.createElement('div')
  link.className = 'hint'
  link.textContent = url
  const status = document.createElement('div')
  status.className = 'status'
  status.textContent = 'Downloading…'
  screen.append(h2, link, status)
  root.append(screen)

  const detach = attachInputs({
    onSideClick() {
      if (failed) nav.library()
    },
    onLongPressStart() {
      if (failed) nav.library()
    },
    onLongPressEnd() {},
    onScrollUp() {},
    onScrollDown() {},
  })

  void (async () => {
    try {
      const book = await ingestBook(storage, url)
      nav.openBook(book)
    } catch (e) {
      failed = true
      status.textContent = ingestErrorMessage(e)
      link.textContent = 'Side button → library'
    }
  })()

  return detach
}
