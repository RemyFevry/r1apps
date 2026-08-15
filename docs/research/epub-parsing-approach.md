# Research: EPUB parsing approach for QuickReader

Date: 2026-08-15
Ticket: EPUB parsing approach (#3)
Method: verified against primary sources (npm registry, GitHub repos/source, bundlephobia/jsDelivr APIs, W3C EPUB 3.3 spec, MDN browser-compat-data); sizes measured with esbuild `--bundle --minify` + gzip on the exact import surface needed.

## Constraint profile

240×282 webview, no WebGL, no external fonts, weak CPU, bundle size matters. The app
needs only `{title, author, chapters → word arrays}` — no paginated rendering.

## Comparison table

| | **epubjs** (futurepress) | **foliate-js** (johnfactotum) | **Hand-rolled** (native DecompressionStream / fflate) |
|---|---|---|---|
| License | BSD-2-Clause ("FreeBSD") — MIT-repo-compatible | MIT — compatible | fflate: MIT; pako: MIT AND Zlib; jszip: MIT OR GPL-3.0; native: none |
| Where it lives | npm [`epubjs`](https://registry.npmjs.org/epubjs/latest) (⚠️ npm `epub.js` is a different, dead 0.2.x package) | GitHub only; ⚠️ npm `foliate-js`@1.0.1 is a **third-party** Skillsoft publish | — |
| Min / gzip (measured, esbuild) | 360.8 kB / **107.9 kB** (+9 deps) | 25.9 kB / **10.0 kB** (EPUB module only) + zip loader | **~0 kB** native / **2.8–3.8 kB** (fflate fallback); ~200–300 LOC own code |
| Plain-text extraction | Not a first-class API; possible via `spine.get(i).load()` + `textContent` | First-class: `sections[i].createDocument()` → DOM; `book.metadata` | You own it — trivial `textContent`/TreeWalker |
| EPUB 2 + 3 | Yes (NCX + nav) | Yes (NCX + nav + legacy meta) | Yes if you handle both (small extra code) |
| Maintenance | Last stable Feb 2022; alphas 2023; 517 open issues | Active (pushed 2026-05-01); no semver releases | fflate active (0.8.3, 2026-05); native = platform-maintained |
| Fit verdict | ❌ Poor (render-oriented, heavy) | ✅ Good "buy" option | ✅ Best for minimal bundle |

## 1. epub.js (npm: `epubjs`, repo `futurepress/epub.js`)

**Package-name gotcha.** npm has two packages:
- [`epub.js`](https://registry.npmjs.org/epub.js/latest): latest **0.2.15, published 2016** — a dead 0.2.x line; do not install.
- [`epubjs`](https://registry.npmjs.org/epubjs/latest): latest stable **0.3.93 (2022-02-16)**; last activity `0.5.0-alpha.3` (2023-09-26).

**License:** BSD-2-Clause ([repo license file](https://raw.githubusercontent.com/futurepress/epub.js/master/license)) — permissive, MIT-repo-compatible.

**Maintenance:** [repo](https://api.github.com/repos/futurepress/epub.js) alive-ish (6,941 stars, last push 2026-03) but **no stable npm release in 4+ years**; 517 open issues.

**Size/deps:** [bundlephobia](https://bundlephobia.com/api/size?package=epubjs) 346.5 kB min / 103.6 kB gz, 9 dependencies — jszip (97.8 kB), @xmldom/xmldom, localforage (wants IndexedDB — wasted on R1), lodash, core-js, path-webpack, etc. Poor tree-shaking confirmed by measurement (360.8 kB min import).

**Text extraction:** it's a rendering pipeline (Rendition → iframes, CSS injection); `book.spine.get(i).load()` → `doc.body.textContent` works but ships the whole renderer.

**Verdict:** bundle ✗, text ~, license ✓, maintenance ~.

## 2. foliate-js (repo `johnfactotum/foliate-js`)

- MIT, actively maintained (pushed 2026-05-01). **Not officially on npm** — intended to be vendored as plain ESM ([package.json](https://raw.githubusercontent.com/johnfactotum/foliate-js/main/package.json) is `0.0.0`); the npm `foliate-js` is a third-party publish — avoid.
- The EPUB parser ([`epub.js` module](https://raw.githubusercontent.com/johnfactotum/foliate-js/main/epub.js)) imports only `epubcfi.js`; I/O is injected (`new EPUB({loadText, loadBlob, …})`), workers optional/off ([view.js:30](https://raw.githubusercontent.com/johnfactotum/foliate-js/main/view.js)) — standalone main-thread browser use works.
- First-class text: `book.sections[i].createDocument(): Promise<Document>`, `book.metadata` (EPUB 2 legacy + EPUB 3 refinements), NCX + nav.
- Measured: parser 25.9 kB min / **10.0 kB gz**; its vendored zip.js would add 14.3 kB gz — but any loader can be injected instead.

**Verdict:** bundle ✓, text ✓✓, license ✓, maintenance ✓ (but vendor-tracking, no semver).

## 3. Hand-rolled minimal extractor

**Inflate options:**

| Library | Version | License | min / gz (measured) |
|---|---|---|---|
| `DecompressionStream('deflate-raw')` | platform API | none | **0 B** — Chrome/WebView **103+**, Firefox 113, Safari 16.4 ([MDN BCD](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/DecompressionStream.json); [Safari 16.4 notes](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)) |
| [fflate](https://registry.npmjs.org/fflate) | 0.8.3 (2026-05) | MIT, 0 deps | `unzipSync` 5,525 / **2,785 B** |
| [pako](https://registry.npmjs.org/pako) | 3.0.1 | MIT AND Zlib | inflate 30.3 kB / 10.0 kB |
| [jszip](https://registry.npmjs.org/jszip) | 3.10.1 (2022) | MIT OR GPL-3.0 | 96.0 kB / 27.9 kB |

The R1's Android 13-era webview should support `deflate-raw` (Android 13 shipped Aug 2022 with WebView ≥104) — but the webview version isn't independently verifiable, so **feature-detect at runtime and lazy-load fflate as fallback**. Expected cost: zero JS bytes for inflate on the common path.

**Pipeline (~200–300 LOC total):**

1. **ZIP layer** (~80–120 LOC): read End-of-Central-Directory (last 64 KB), parse central directory, per entry: method 0 = slice, method 8 = `DecompressionStream('deflate-raw')`. Sizes from central directory (data-descriptor bit 3 safe).
2. **container.xml** (~10 LOC) → OPF path ([EPUB 3.3 §OCF](https://www.w3.org/TR/epub-33/#sec-container-metainf)).
3. **OPF** (~60–80 LOC): `dc:title`/`dc:creator`, manifest map, spine order with `linear="no"` handling ([EPUB 3.3 §spine](https://www.w3.org/TR/epub-33/#sec-spine-elem)).
4. **Per-chapter extraction** (~60–80 LOC): inflate → `DOMParser` `'application/xhtml+xml'` with **`'text/html'` fallback** for malformed books (HTML parser accepts anything and resolves named entities — no manual entity handling). Paragraph-aware TreeWalker → word arrays. Images/CSS/fonts discarded by construction.
5. **Cleanup**: strip soft hyphens (U+00AD), zero-width chars (U+200B–200D, U+FEFF), collapse whitespace, split on `/[\p{L}\p{N}'’-]+/u`.

**Encodings:** EPUB 3 is UTF-8; EPUB 2 may declare others — sniff the XML prolog, `TextDecoder` handles the rest. **DRM:** unreadable by every approach (only font-obfuscation exists; doesn't touch text). **EPUB 2 vs 3 deltas:** ~0 extra LOC for text extraction.

The risk isn't code volume — it's the long tail of broken real-world EPUBs, which foliate-js has already absorbed.

## Recommendation (adopted — see ADR-0005)

**Hand-rolled extractor: native `DecompressionStream('deflate-raw')` with feature-detect + lazy fflate fallback (2.8 kB gz), ~250 LOC.** Wins every axis for an RSVP reader. **Named fallback:** if malformed-EPUB reports arrive from real books, vendor foliate-js's `epub.js`+`epubcfu.js` parser (MIT, 10 kB gz) fed by our own zip layer — pre-agreed de-risk path, not a default. **Skip epubjs** (renderer weight, frozen releases).
