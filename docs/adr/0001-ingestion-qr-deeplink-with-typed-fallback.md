# ADR-0001: Book ingestion via QR deep-link with typed-URL fallback

Date: 2026-08-15
Status: accepted
Map ticket: Book ingestion design (#4)

## Context

The R1 installs creations by scanning a QR whose JSON payload contains a URL the device
then opens. There is no evidence a creation can invoke the camera/QR scanner in-app —
the camera is only known to be usable at install time. The R1 keyboard works reliably
(pointer-events model, textarea + focus). Books must live on static hosts; the repo is
public so committing books into it is effectively distribution and is ruled out.

## Decision

1. **Primary path — QR deep-link.** A companion page (hosted with the app) takes a book
   URL and renders a QR encoding the app URL plus `?add=<url-encoded book URL>`.
   Scanning it opens the app, which detects the param, fetches the book, parses it,
   stores it, and opens it.
2. **Fallback path — typed URL.** An Add-Book screen with a textarea (R1 keyboard)
   accepts a typed or pasted book URL. Same fetch-and-store pipeline.
3. **Shared pipeline.** Both paths converge on one fetch-and-store step with distinct,
   screen-appropriate failure states: bad URL, network/CORS failure, oversized file,
   not-an-EPUB.
4. **Book hosting.** Any static host that sends permissive CORS headers (GitHub Pages
   does). The companion page documents this.

## On-device verification items (handed to implementation)

- Does the R1 preserve the `?add=` query param when opening an installed creation?
- Does the webview allow cross-origin `fetch()` (GitHub Pages as origin)?
- Does the R1's cache-by-URL behavior treat each `?add=` variant as a new install
  card? If yes, the companion page warns; the typed fallback is the escape hatch.

## Companion upload (amendment, 2026-08-15)

The companion page can also upload a local .epub (≤150 MB) to
[filebin.net](https://filebin.net) — a public temporary host with unguessable bin
URLs and `Access-Control-Allow-Origin: *` on upload and download (verified) — and
QR the resulting link through the same deep-link pipeline. Ephemeral hosting
suffices because ingestion copies the book into on-device storage; the link
self-destructs ~6 days after its last download. Books still never touch this
repo. The manual-URL path remains first-class; the third-party transit is
disclosed on the page.

## Consequences

- One pipeline, two doors — ingestion logic is testable headless.
- If param stripping or CORS blocks the primary path, the typed fallback keeps the MVP
  functional; degradation is UX, not feasibility.
