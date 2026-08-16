# ADR-0010: Reading controls — audio gesture, paused scroll navigation

Date: 2026-08-16
Status: accepted
Map ticket: partial — feeds "Decide R1 controls and reading interactions" (#24)

## Context

SteadyReader needs an instant physical toggle for TTS amid quickreader's control
grammar (`sideClick` pause/resume with act-immediately semantics, `scrollUp`/
`scrollDown` WPM ±10, `longPress` exit; ADR-0002). The full mapping is ticket #24's
question; the audio gesture and paused-scroll semantics were decided here.

## Decision

- **`double-sideClick` toggles audio** while reading — one instant gesture, valid in
  both modes. Seek-back loses its dedicated gesture (quickreader uses the same
  gesture for it).
- **Scroll navigates by sentence while paused** and adjusts WPM ±10 while playing.
  In a read-along, re-hearing is navigating back, not a timed double-click.

## Consequences

- Audio toggling never disturbs pacing state (paused stays paused, playing stays
  playing).
- Ticket #24 inherits: library-screen mappings, paused-overlay contents (if any),
  and confirmation that no further reading-screen gestures are needed.
