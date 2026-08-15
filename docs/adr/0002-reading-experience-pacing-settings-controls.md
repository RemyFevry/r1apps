# ADR-0002: Reading experience — pacing, settings, controls, position memory

Date: 2026-08-15
Status: accepted
Map ticket: Reading experience and controls (#5)

## Context

240×282 fixed screen, no body scroll, no external fonts, CSS transitions preferred.
Physical inputs: `sideClick`, `longPressStart/End`, `scrollUp`/`scrollDown`, shake via
DeviceMotion; keyboard on edit screens. Double-click detection requires debouncing,
which taxes single-click latency.

## Decision

### Pacing (the "standard RSVP package")

- Default 300 WPM; range 100–800, step 10.
- Base delay = `60000 / WPM` ms, adjusted by:
  - ×1.5 after a trailing comma
  - ×2.2 after sentence-ending punctuation
  - ×3.5 at paragraph breaks
  - words longer than 8 characters add proportional extra delay
- **ORP**: the fixation letter rendered in R1 orange; word horizontally aligned so the
  ORP sits at a fixed anchor point.
- **Chapter cards**: chapter title shown for ~1.5s before the chapter's first word.

### User settings (Settings screen, keyboard-driven)

- Default WPM (applies to new books)
- ORP on/off
- Font size: S / M / L
- Pacing preset: relaxed / standard / snappy (scales the pause multipliers)
- Raw multiplier tuning is post-MVP.

### Controls

Reader:
- `sideClick` = pause/resume, **act-immediately semantics**: first click pauses
  instantly; if a second `sideClick` lands within a 300ms window while paused, treat as
  double-click → seek back one sentence and resume. Single-click latency is never
  debounced; a double's only cost is a momentary pause.
- `scrollUp`/`scrollDown` = WPM −10/+10, live, paused or playing, with a HUD value.
- `longPress` = exit to Library (saves Position).

Library:
- `scrollUp`/`scrollDown` = move selection
- `sideClick` = open selected book / enter Add-Book or Settings when selected
- `longPress` on a book = delete, with a confirm step

### Position memory

Position = `{chapter, wordIndex}` plus current WPM, saved per book:
- immediately on pause and on exit
- throttled (every ~50 words) while playing

## Consequences

- Pause never lags; seek-back survives without shake detection.
- Pacing and ORP logic is pure and testable (word in → delay + render spec out).
- Position loss degrades gracefully: losing WPM or place is annoying, not fatal.
