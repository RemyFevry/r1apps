# ADR-0008: Unified document pipeline in r1-kit

Date: 2026-08-16
Status: accepted
Map ticket: none (whole-plan grilling session; feeds map #17)

## Context

The bimodal reader needs structured text (chapters → paragraphs → sentences), while
quickreader extracts and stores a flat word stream. Both consume EPUB via r1-kit's
zip reader and hand-rolled parsing (ADR-0005). Options were to fork the pipeline per
app or unify one document model in r1-kit. The effort scope originally ruled out
modifying quickreader; the human deliberately redrew that line to include the port.

## Decision

- **One common EPUB→document pipeline lives in r1-kit**: parsing produces a
  structured document — chapters → paragraphs → sentences (words with their text
  derive per sentence).
- **Both readers consume it.** The bimodal reader uses it directly. Quickreader is
  refactored to derive its word stream from the structured document; its existing
  tests prove behavioral parity. The port is inside this effort's scope.
- The stored artifact for each app remains its own concern (the bimodal reader
  stores the structured document via the storage seam; quickreader keeps storing
  its derived word stream).

## Consequences

- One parsing path to test and maintain; sentence/paragraph structure available to
  any future reader.
- Quickreader carries refactor risk inside this effort — mitigated by its test suite
  as the parity gate.
- The bimodal reader's ingestion UX (URL/deeplink/shelf) is decided separately
  (map ticket "Decide library and ingestion for the new app").
