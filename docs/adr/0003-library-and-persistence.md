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

## Amendment (2026-08-16, #13): mirrored persistence + storage health

- **Mirror reality**: positions and settings are *also* mirrored to
  `creationStorage.plain` (keys `pos:<id>`, `settings`) — on firmware where
  localStorage does not survive a webview restart, the mirror is the durable
  copy; loads fall back to it when localStorage is empty. Small records only
  (the earlier failure mode was whole-book writes).
- **localStorage is namespaced per app** (`<ns>:pos:<id>`, `<ns>:settings`;
  the adapter takes the namespace, the kit ships none).
- **Health is part of the seam**: `Storage.health()` answers what the adapter
  actually guarantees, per kind — `{books, progress}` each `device | bundle |
  session | write-lost`. The device adapter is presence-live (a bridge
  appearing after boot is picked up on the next call, which runs the write→
  read-back probe then — books flip immediately, progress verifies one call
  later; write-loss is sticky). The shelf adapter reports `books: 'bundle'`
  while any bundled book is visible: a shelf build with broken device storage
  must not call its books broken when the bundle is fine; progress is always
  the delegate's answer. The library header renders this as
  `storage:<books>/<progress>` (e.g. `storage:bundle/device`) — it is the
  string bug reports quote.
