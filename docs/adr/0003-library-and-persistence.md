# ADR-0003: Library and persistence — word stream in creationStorage, positions in localStorage, behind a seam

Date: 2026-08-15
Status: accepted
Map ticket: Library and persistence design (#6)

## Context

Two storage engines are verified on-device: `localStorage` (sync, size undocumented)
and `window.creationStorage.plain` (async, base64, per-plugin isolation, designed to
survive app reinstalls). Raw EPUBs are 1–5 MB before base64's +33% tax; a novel's
extracted word stream is a few hundred KB of JSON. Position and settings are tiny and
written frequently (every ~50 words).

## Decision

### What is stored

- Per book: the extracted **Word stream** (chapters → display words with boundaries),
  plus metadata (title, author, word count). The raw EPUB is never persisted.
- Per book, separately: **Position** `{chapter, wordIndex, wpm}`.
- Global: **Settings** (default WPM, ORP on/off, font size, pacing preset).

### Where

- Word streams + library index → `creationStorage.plain`, keys `book:<id>` and
  `library:index` (base64-encoded JSON per platform requirement). Books survive
  reinstalls.
- Positions + settings → `localStorage`, keys `quickreader:pos:<id>` and
  `quickreader:settings` (namespaced — every app on the Pages origin shares one
  localStorage). Cheap sync writes for throttled saves.

### The seam

All storage access goes through one interface —
`saveBook / loadBook / listBooks / deleteBook / savePosition / loadPosition /
saveSettings / loadSettings` — implemented twice: the on-device adapter
(creationStorage + localStorage) and an in-memory adapter for tests and desktop dev.
The RSVP engine and library UI never touch a storage engine directly.

### Failure and lifecycle

- Write failure → explicit "Storage full" screen naming the culprit; delete-to-make-room
  via the library. Actual quota size is an on-device verification item.
- Reinstall: books survive (creationStorage promise); positions/settings may not —
  acceptable degradation (annoying, not fatal).
- Delete removes the word stream, the index entry, and the position.

### Library UI (home screen)

- Single item-based list (fixed row height, `translateY` scroll per platform pattern):
  book rows (title, author, progress %), pinned rows **Add book** and **Settings**.
- Select-then-open interaction (pointer events, no `preventDefault`); `longPress` on a
  book row = delete with confirm.
- Dark theme `#0e0e10`, accent `#FE5000`, system font, sizes per platform guide.

## Consequences

- Ingestion pipeline ends at `saveBook`; reader starts at `loadBook` — both testable
  headless against the in-memory adapter.
- If creationStorage quotas or behavior disappoint on-device, only the adapter changes.
