/**
 * One ingestion flow for both entries (#12): the deep-link mount provides a URL
 * (auto: ingest starts immediately, no form); the typed-URL mount starts idle
 * (form shown, submit/retry). Pure transitions + a view derivation — the screen
 * is a dumb renderer, success navigates away before becoming a state.
 */
export type IngestFlow =
  | { t: 'idle' }
  | { t: 'busy'; url: string; auto: boolean }
  | { t: 'failed'; url: string; auto: boolean; message: string }

export interface IngestView {
  heading: string
  status: string
  /** The auto flow's provenance line: the full URL, break-all above the status. */
  linkUrl: string | null
  /** Typed flow keeps the textarea + buttons through busy/failed (retry). */
  form: boolean
  addLabel: string
  addLocked: boolean
  /** Side button exits to the library — never while a download is running. */
  sideExits: boolean
}

function trunc(s: string, n: number): string {
  return s.slice(0, n) + (s.length > n ? '…' : '')
}

export function startIngest(url?: string): IngestFlow {
  const trimmed = url?.trim()
  return trimmed ? { t: 'busy', url: trimmed, auto: true } : { t: 'idle' }
}

export function submitIngest(flow: IngestFlow, url: string): IngestFlow {
  if (flow.t === 'busy') return flow
  const trimmed = url.trim()
  return trimmed ? { t: 'busy', url: trimmed, auto: false } : flow
}

export function failIngest(flow: IngestFlow, message: string): IngestFlow {
  if (flow.t !== 'busy') return flow
  return { t: 'failed', url: flow.url, auto: flow.auto, message }
}

export function ingestView(flow: IngestFlow): IngestView {
  if (flow.t === 'idle') {
    return { heading: 'Add book', status: '', linkUrl: null, form: true, addLabel: 'Add', addLocked: false, sideExits: true }
  }
  if (flow.t === 'busy') {
    return flow.auto
      ? { heading: 'Adding book', status: 'Downloading…', linkUrl: flow.url, form: false, addLabel: 'Add', addLocked: true, sideExits: false }
      : {
          heading: 'Add book',
          status: 'Downloading ' + trunc(flow.url, 40),
          linkUrl: null,
          form: true,
          addLabel: '…',
          addLocked: true,
          sideExits: false,
        }
  }
  return flow.auto
    ? {
        heading: 'Adding book',
        status: flow.message + ' — ' + trunc(flow.url, 60),
        linkUrl: flow.url,
        form: false,
        addLabel: 'Add',
        addLocked: false,
        sideExits: true,
      }
    : { heading: 'Add book', status: flow.message, linkUrl: null, form: true, addLabel: 'Add', addLocked: false, sideExits: true }
}
