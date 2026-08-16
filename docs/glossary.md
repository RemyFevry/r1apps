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
- **Add-Book screen** — the typed-URL mount of the unified ingestion screen
  (`screens/ingestion-screen.ts`, textarea + Add/Back); the deep-link mount starts
  the same screen auto-ingesting with no form (#12, ADR-0001).
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
  `savePosition`/`loadPosition`/`saveSettings`/`loadSettings`/`health`) with two adapters:
  on-device (creationStorage + localStorage) and in-memory for tests/desktop (ADR-0003).
- **install.html** — QR companion page per app: renders the install QR and, for
  QuickReader, book deep-link QRs; `?v=<sha>` cache-busting injected at deploy (ADR-0004).
- **Bimodal reading** — seeing and hearing the same text simultaneously: running text
  with the current phrase and word highlighted while TTS speaks (ADR-0006).
- **Silent mode** — the reader's base mode: WPM clock drives the highlight, no TTS
  (ADR-0006).
- **Voiced mode** — audio toggle on: the voice is the clock, highlight follows TTS
  word-boundary events; WPM maps to the TTS rate multiplier (ADR-0006).
- **Voice clock** — the rule that exactly one pacing authority runs: the WPM timer in
  silent mode, the TTS engine in voiced mode; never both (ADR-0006).
- **Phrase** — in the bimodal reader, the whole sentence: the unit highlighted around
  the current word (ADR-0007).
- **Anchor line** — the fixed vertical position the reading pane scrolls to so the
  current word always sits there (ADR-0007).
- **Shaped dwell** — silent-mode word duration: `60000/WPM` scaled by punctuation
  and word length, mirroring natural speech rhythm (ADR-0007).
- **Structured document** — the r1-kit parsing artifact: chapters → paragraphs →
  sentences; the common input to both readers (ADR-0008).
- **SteadyReader** — the bimodal read-along app (`apps/steadyreader/`): phrase/word
  highlight, WPM auto-advance, synced TTS (ADRs 0006–0010).
- **Article** — an extracted web page normalized into the structured document:
  title as book metadata, H2/H3 sections as chapters (ADR-0009).
- **audioOn** — the audio-toggle state persisted with Position; resumes as saved
  (ADR-0009).
- **Sentence nav** — scroll-wheel movement by sentence while paused (ADR-0010).
- **TTS seam** — the one engine interface `speak(sentence, rate) → word-timing
  events + audio`; three adapters sit behind it (ADR-0011).
- **In-browser TTS** — the experimental leg: HuggingFace models (Kokoro/SpeechT5)
  run by transformers.js inside the R1 webview itself (ADR-0011).
- **Proportional word estimate** — derived timing for engines without boundary
  events: char-weighted split of a sentence's real audio duration, re-anchored
  every sentence (ADR-0011).
- **Simulated voice clock** — the bridge leg's highlight timing: char-weighted
  estimates *of the voice's* pace, EMA-calibrated, re-anchored each sentence;
  WPM inert while voiced there (ADR-0012).
- **Never-skip hold** — when audio isn't ready or its completion isn't confirmed,
  the highlight waits behind the generating/speaking indicator; a read-along
  never silently drops or outruns text (ADRs 0011, 0012).
- **Sentence cache** — persistent (voice, speed, sentence-text hash) → audio +
  timestamps store for the ElevenLabs leg; re-reads and back-jumps cost zero
  credits; LRU-capped (ADR-0012).
- **Sentence-start rule** — any entry into voiced mode speaks the current sentence
  from its start; entry into silent mode resumes at the current word (ADR-0012).
- **r1-kit** — the shared monorepo package: R1 input events (with keyboard fallbacks),
  storage seam + adapters, screen/theme constants, row list controller
  (`createRowList`: navigation + windowing + DOM sync, ADR-0004), QR-page generator,
  closeWebView helper (ADR-0004).
- **R1 compatibility gate** — the CI sequence every push/PR must pass before
  anything can deploy: `chrome103` build target, post-build static scan
  (`r1:compat`), device-sim smoke (`r1:smoke`). Device profile constants live in
  `r1.config.mjs`; decision record in ADR-0013.
- **Device-sim smoke** — Playwright Chromium at 240×282 with
  `creationStorage`/`closeWebView` mocked, driving an app through R1 hardware
  events; fails on console errors or horizontal overflow (ADR-0013).
