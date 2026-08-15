import { installPayload, renderQr } from 'r1-kit'

const themeColor = '#FE5000'
const appUrl = new URL('.', location.href).href
const versionedUrl = `${appUrl}?v=${__COMMIT_SHA__}`
const MAX_BYTES = 150 * 1024 * 1024

const installQr = document.getElementById('install-qr') as HTMLElement
const bookQr = document.getElementById('book-qr') as HTMLElement
const bookUrl = document.getElementById('book-url') as HTMLInputElement
const bookNote = document.getElementById('book-note') as HTMLElement
const makeQr = document.getElementById('make-qr') as HTMLButtonElement
const bookFile = document.getElementById('book-file') as HTMLInputElement
const bar = document.getElementById('bar') as HTMLElement
const uploadNote = document.getElementById('upload-note') as HTMLElement

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

function randomBin(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return 'qr' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  return cleaned.endsWith('.epub') ? cleaned : cleaned + '.epub'
}

function uploadToBin(file: File, bin: string, name: string, onProgress: (frac: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `https://filebin.net/${bin}/${encodeURIComponent(name)}`)
    xhr.setRequestHeader('Content-Type', 'application/epub+zip')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed (${xhr.status})`)))
    xhr.onerror = () => reject(new Error('upload failed — network error'))
    xhr.send(file)
  })
}

bookFile.addEventListener('change', () => {
  const file = bookFile.files?.[0]
  bookFile.value = ''
  if (!file) return
  if (!/\.epub$/i.test(file.name)) {
    uploadNote.textContent = 'That is not a .epub file.'
    return
  }
  if (file.size > MAX_BYTES) {
    uploadNote.textContent = 'Book too large (150 MB max).'
    return
  }
  const bin = randomBin()
  const name = sanitizeName(file.name)
  const url = `https://filebin.net/${bin}/${encodeURIComponent(name)}`
  bar.style.width = '0'
  uploadNote.textContent = `Uploading ${file.name} (${Math.round(file.size / 1024 / 1024)} MB)…`
  uploadToBin(file, bin, name, (frac) => {
    bar.style.width = Math.round(frac * 100) + '%'
  })
    .then(() => {
      bar.style.width = '100%'
      uploadNote.textContent = 'Uploaded ✓ — QR ready below. Link self-destructs ~6 days after its last download.'
      bookUrl.value = url
      generateBookQr(url)
    })
    .catch((e: Error) => {
      bar.style.width = '0'
      uploadNote.textContent = e.message + ' — try the manual URL box instead.'
    })
})
