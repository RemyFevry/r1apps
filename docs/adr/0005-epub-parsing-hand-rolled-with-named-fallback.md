# ADR-0005: EPUB parsing — hand-rolled extractor with native inflate, foliate-js as named fallback

Date: 2026-08-15
Status: accepted
Map ticket: EPUB parsing approach (#3)

## Context

QuickReader needs `{title, author, chapters → word arrays}` from a DRM-free EPUB on the
R1's constrained webview — text extraction, not layout. Full comparison with measured
sizes and citations: [docs/research/epub-parsing-approach.md](../research/epub-parsing-approach.md).
epubjs is 108 kB gz of render-oriented machinery with frozen releases; foliate-js's
parser is excellent (10 kB gz, MIT) but vendor-tracked; the platform offers native zip
inflate.

## Decision

1. **Hand-rolled extractor, ~250 LOC:**
   - ZIP layer reading the central directory; inflate via native
     `DecompressionStream('deflate-raw')` (WebView ≥ 103), **feature-detected at
     runtime**, with lazy-loaded **fflate** (`unzipSync`, 2.8 kB gz, MIT) as fallback.
   - container.xml → OPF (`dc:title`, `dc:creator`, manifest, spine order with
     `linear="no"` handling) → per-chapter `DOMParser` (`application/xhtml+xml` with
     `text/html` fallback for malformed books) → paragraph-aware TreeWalker.
   - Word-stream cleanup owned here: strip soft hyphens (U+00AD) and zero-width chars,
     collapse whitespace, split on
     `/["'(\[«]*[\p{L}\p{N}'’-]+[\])}"'’»…,;:!?.\-—–]*/gu` — words keep leading quotes
     and trailing punctuation so the RSVP pause logic (ADR-0002) can see them.
   - Images/CSS/fonts never inflated. DRM unreadable by any approach — out of scope.
2. **Named fallback:** if malformed-EPUB reports arrive from real books, vendor
   foliate-js's `epub.js` + `epubcfi.js` (MIT, 10 kB gz) fed by our own zip layer —
   pre-agreed de-risk path, not the default.
3. **epubjs rejected** for this use case.

The extractor lives behind the ingestion pipeline (ADR-0001) as a pure function:
EPUB bytes in → `{title, author, chapters: [{title, words[]}]}` out, testable headless.

## Consequences

- Zero dependencies in the common path; ~3 kB gz worst-case (fflate).
- We own the long tail of broken EPUBs; the fallback bounds that risk.
- On-device verification item: confirm `deflate-raw` availability in the R1 webview
  (expected: yes, Android 13-era); fflate covers the negative case automatically.
