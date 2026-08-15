import { attachInputs } from 'r1-kit'
import { ingestBook, ingestErrorMessage } from '../ingestion/ingest'
import type { Ctx } from '../main'

export function deepLinkScreen(ctx: Ctx, url: string): () => void {
  const { root, storage, nav } = ctx
  let failed = false

  const screen = document.createElement('div')
  screen.className = 'form'
  const h2 = document.createElement('h2')
  h2.textContent = 'Adding book'
  const link = document.createElement('div')
  link.className = 'hint'
  link.textContent = url
  link.style.wordBreak = 'break-all'
  const status = document.createElement('div')
  status.className = 'status'
  status.textContent = 'Downloading…'
  const hint = document.createElement('div')
  hint.className = 'status'
  hint.textContent = 'Side button → library'
  screen.append(h2, link, status, hint)
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
      status.textContent = ingestErrorMessage(e) + ' — ' + url.slice(0, 60) + (url.length > 60 ? '…' : '')
    }
  })()

  return detach
}
