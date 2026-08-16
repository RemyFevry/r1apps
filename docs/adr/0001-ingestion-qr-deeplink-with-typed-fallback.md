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

## Companion upload (amendment, 2026-08-15, revised same day)

Getting a local .epub to the device needs a host that (a) allows browser-side
upload or scripted upload, and (b) serves **raw bytes with CORS** to the R1's
browser user agent. Live testing eliminated the paste-host ecosystem: filebin
serves an HTML interstitial to browser UAs (curl gets bytes, browsers don't —
this produced "Not a readable EPUB" on-device); litterbox/0x0 are blocked or
disabled; catbox/uguu/x0 lack CORS on upload or download; pixeldrain requires
an API key; gofile's endpoint moved.

Adopted: **GitHub raw transit** — `scripts/host-book.mjs` (pnpm host-book)
pushes the epub to an unguessable public repo `r1book-<rand>` via the contents
API and prints the raw URL plus the companion deep-link. Verified:
`raw.githubusercontent.com` sends `Access-Control-Allow-Origin: *`, serves raw
bytes to browser UAs, no redirects, 30 MB round-trip hash-identical.
Ephemeral: `--clean` deletes the transit repos (needs `delete_repo` scope).
Books still never touch this repo's git history; the unguessable-URL exposure
matches what any public host gives. The manual-URL path remains first-class.

**Short-code deep-links (second revision, same day):** a full raw URL embedded
in the QR (`?add=<encoded-url>`, ~180-char install URL) produced on-device
404s — the R1 truncates/mangles long install URLs (the raw URL itself serves
200 under every UA). Deep-links now carry a compact base64url transit code
(`?b=<account|repo|file>`), keeping the install URL under ~110 chars; the app
reconstructs the raw URL (apps/quickreader/src/ingestion/transit.ts). Full
`?add=` URLs still work for arbitrary hosts. Ingest errors now display the
exact URL that failed.

**Versioned shelf artifacts (2026-08-16):** shelf syncs force-pushed a single
root build, so a `?v=<ver>` rescan URL was only a cache-buster — after the next
sync it silently served whatever shipped last, and the build a card (or bug
report quoting `v=`) actually ran became unrecoverable. Each sync now lands at
an immutable `v/<ver>/` path (incremental pushes accumulate versions in
`remyf-agent/r1-shelf`, ~1 MB each) and refreshes the root to the latest
build. Versioned QR URLs are permanent; the pre-versioning root build was
migrated to its own `v/<ver>/` on first run of the new sync.

## Consequences

- One pipeline, two doors — ingestion logic is testable headless.
- If param stripping or CORS blocks the primary path, the typed fallback keeps the MVP
  functional; degradation is UX, not feasibility.
