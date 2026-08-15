# Glossary — QuickReader domain

Working vocabulary for the r1apps monorepo and QuickReader. Terms land here as
decisions make them sharp.

- **Creation** — Rabbit's term for a third-party web app installed on the R1 by
  scanning an install QR. Runs in the R1's webview at 240×282.
- **Install QR** — QR whose JSON payload (`title`, `url`, `description`, `iconUrl`,
  `themeColor`) tells the R1 to open (and cache) a creation's URL.
- **Companion QR page** — page hosted with the app that renders install QRs and, for
  QuickReader, "add this book" deep-link QRs.
- **Book** — a DRM-free EPUB fetched from a static URL. Never committed to this repo.
- **Ingestion** — getting a Book onto the device: QR deep-link (`?add=<book-url>`) or
  typed URL, both feeding one fetch-and-store pipeline (ADR-0001).
- **Add-Book screen** — in-app screen with a textarea for typing/pasting a book URL.
- **Word stream** — the pre-extracted, flat sequence of display words (with chapter
  boundaries) that the RSVP engine consumes; what gets stored, not the raw EPUB.
- **RSVP** — Rapid Serial Visual Presentation: words flashed one at a time.
- **WPM** — words per minute; the reader's speed setting.
- **ORP** — Optimal Recognition Point; the letter of a word the eye fixates, marked
  (e.g. red) and used as the alignment anchor.
- **Position** — where the reader stopped: `{chapter, wordIndex}` plus the saved WPM.
- **Library** — the on-device list of stored books with progress; the app's home
  screen.
- **Chapter card** — brief (~1.5s) chapter-title screen before a chapter's first word.
- **Pacing preset** — relaxed / standard / snappy; scales the punctuation pause
  multipliers (ADR-0002).
- **Storage seam** — the one interface (`saveBook`/`loadBook`/`listBooks`/`deleteBook`/
  `savePosition`/`loadPosition`/`saveSettings`/`loadSettings`) with two adapters:
  on-device (creationStorage + localStorage) and in-memory for tests/desktop (ADR-0003).
- **install.html** — QR companion page per app: renders the install QR and, for
  QuickReader, book deep-link QRs; `?v=<sha>` cache-busting injected at deploy (ADR-0004).
- **r1-kit** — the shared monorepo package: R1 input events (with keyboard fallbacks),
  storage seam + adapters, screen/theme constants, list controller, QR-page generator,
  closeWebView helper (ADR-0004).
