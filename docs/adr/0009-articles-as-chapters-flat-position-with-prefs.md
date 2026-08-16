# ADR-0009: Articles as heading-chapters; flat position with prefs

Date: 2026-08-16
Status: accepted
Map ticket: none (whole-plan grilling session; feeds map #17)

## Context

SteadyReader ingests EPUBs and extracted web articles into the r1-kit structured
document (ADR-0008). Articles needed a document shape, and the reader needed a
resume state richer than quickreader's `{chapter, wordIndex}` + WPM (it also has an
audio toggle).

## Decision

- **Web articles normalize to the structured document with headings as chapters**:
  the article title maps to book metadata; each H2/H3 section becomes a chapter;
  body paragraphs become paragraphs. Extraction fragility is accepted for richer
  navigation. EPUBs keep their native chapter structure.
- **Position = `{chapter, wordIndex}` + WPM + audioOn**, saved on pause and exit and
  throttled mid-read (quickreader's discipline, ADR-0002/0003). Word index is flat
  within the chapter; sentence and word-within-sentence derive from the structured
  document at load. Audio resumes in its saved state — the toggle was the user's
  expressed preference.

## Consequences

- One document model and one reader engine serve both sources; articles are short
  multi-chapter books.
- Position remains derivable, not stored, against sentence re-tokenization.
- Shelf/bundling tooling remains EPUB-only in v1 (map ticket "Decide library and
  ingestion" owns that UX surface).
