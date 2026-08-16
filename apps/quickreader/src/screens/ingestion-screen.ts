import { attachInputs } from 'r1-kit'
import { ingestBook, ingestErrorMessage } from '../ingestion/ingest'
import { failIngest, ingestView, startIngest, submitIngest, type IngestFlow } from './ingestion-flow'
import type { Ctx } from '../main'

/** One ingestion screen for both entries (#12): `url` given → auto deep-link flow, else typed-URL form. */
export function ingestionScreen(ctx: Ctx, url?: string): () => void {
  const { root, storage, nav } = ctx
  let flow: IngestFlow = startIngest(url)

  const screen = document.createElement('div')
  screen.className = 'form'

  const h2 = document.createElement('h2')
  const link = document.createElement('div')
  link.className = 'hint'
  link.style.wordBreak = 'break-all'
  const formBox = document.createElement('div')
  const hint = document.createElement('div')
  hint.className = 'hint'
  hint.textContent = 'Link to an EPUB on a public host (GitHub Pages, Netlify, …):'
  const textarea = document.createElement('textarea')
  textarea.placeholder = 'https://example.com/book.epub'
  const actions = document.createElement('div')
  actions.className = 'actions'
  const back = document.createElement('button')
  back.className = 'btn'
  back.textContent = 'Back'
  const add = document.createElement('button')
  add.className = 'btn primary'
  actions.append(back, add)
  formBox.append(hint, textarea, actions)
  const status = document.createElement('div')
  status.className = 'status'
  const exitHint = document.createElement('div')
  exitHint.className = 'status'
  exitHint.textContent = 'Side button → library'
  screen.append(h2, link, formBox, status, exitHint)
  root.append(screen)

  let v = ingestView(flow)

  function render(): void {
    v = ingestView(flow)
    h2.textContent = v.heading
    status.textContent = v.status
    link.textContent = v.linkUrl ?? ''
    link.style.display = v.linkUrl ? '' : 'none'
    formBox.style.display = v.form ? '' : 'none'
    exitHint.style.display = v.form ? 'none' : ''
    add.textContent = v.addLabel
    add.disabled = v.addLocked
  }

  async function run(url: string): Promise<void> {
    try {
      const book = await ingestBook(storage, url)
      nav.openBook(book)
    } catch (e) {
      flow = failIngest(flow, ingestErrorMessage(e))
      render()
    }
  }

  function submit(): void {
    const next = submitIngest(flow, textarea.value)
    if (next === flow) return
    flow = next
    render()
    if (flow.t === 'busy') void run(flow.url)
  }

  back.addEventListener('pointerup', () => {
    if (!v.addLocked) nav.library()
  })
  add.addEventListener('pointerup', submit)

  const detach = attachInputs({
    onSideClick() {
      if (v.sideExits) nav.library()
    },
    onLongPressStart() {
      if (flow.t === 'failed' && flow.auto) nav.library()
    },
    onLongPressEnd() {},
    onScrollUp() {},
    onScrollDown() {},
  })

  render()
  if (flow.t === 'busy') void run(flow.url)
  return detach
}
