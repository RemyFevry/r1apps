import { installPayload, renderQr } from 'r1-kit'

const themeColor = '#FE5000'
const appUrl = new URL('.', location.href).href
const versionedUrl = `${appUrl}?v=${__COMMIT_SHA__}`

const installQr = document.getElementById('install-qr') as HTMLElement
const bookQr = document.getElementById('book-qr') as HTMLElement
const bookUrl = document.getElementById('book-url') as HTMLInputElement
const bookNote = document.getElementById('book-note') as HTMLElement
const makeQr = document.getElementById('make-qr') as HTMLButtonElement

renderQr(
  installQr,
  installPayload({
    title: 'QuickReader',
    url: versionedUrl,
    description: 'RSVP speed reader for EPUB ebooks',
    themeColor,
  }),
)

function generateBookQr(url: string): void {
  const deepUrl = `${versionedUrl}&add=${encodeURIComponent(url)}`
  renderQr(
    bookQr,
    installPayload({
      title: 'QuickReader + book',
      url: deepUrl,
      description: 'Open QuickReader and download this book',
      themeColor,
    }),
  )
  bookNote.textContent = 'Scan with your R1 camera — QuickReader opens and downloads the book.'
}

makeQr.addEventListener('click', () => {
  const url = bookUrl.value.trim()
  if (!/^https?:\/\//i.test(url)) {
    bookNote.textContent = 'Enter a full http(s) URL.'
    return
  }
  generateBookQr(url)
})

const prefill = new URLSearchParams(location.search).get('book')
if (prefill && /^https?:\/\//i.test(prefill)) {
  bookUrl.value = prefill
  generateBookQr(prefill)
}
