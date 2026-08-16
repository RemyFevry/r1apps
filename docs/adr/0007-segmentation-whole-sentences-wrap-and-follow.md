# ADR-0007: Segmentation — whole sentences, wrap and follow, shaped dwells

Date: 2026-08-16
Status: accepted
Map ticket: none (whole-plan grilling session; feeds map #17)

## Context

The bimodal reader (ADR-0006) highlights a current phrase and, within it, the current
word, on the R1's 240×282 screen. The display chunking, long-sentence behavior, and
silent-mode rhythm had to be fixed before the reading screen could be prototyped
(map ticket "Prototype the reading screen").

## Decision

- **The phrase is the whole sentence.** Text splits on sentence boundaries only —
  no clause splitting, no fixed word-count windows. Paragraph and chapter boundaries
  always end a phrase.
- **Wrap and follow.** A sentence wraps to as many lines as it needs; the reading
  pane scrolls so the current word always sits on a fixed **anchor line** (near
  vertical center). Font size is a user setting and never auto-shrinks; a sentence
  taller than the pane is shown as a moving window.
- **Shaped dwells in silent mode.** Base dwell `60000 / WPM` ms, multiplied:
  ×1.5 after a trailing comma, ×2.2 after sentence-ending punctuation, ×3.5 at
  paragraph breaks; words longer than 8 characters add proportional extra dwell.
  (Scheme inherited from QuickReader, ADR-0002.)

## Consequences

- Punctuation does all the segmentation work; no tunable cap constants. Very long
  sentences remain fully visible via the moving window rather than being broken.
- Silent and voiced modes share a cadence family (the voice supplies equivalent
  pauses natively), reinforcing the bimodal feel.
- The reading-screen prototype decides the visual treatment (dimming, highlight
  styles, anchor-line placement); this ADR fixes only the mechanics.
