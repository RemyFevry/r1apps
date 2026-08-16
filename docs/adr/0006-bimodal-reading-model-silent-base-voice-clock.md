# ADR-0006: Bimodal reading model — silent base, voice clock

Date: 2026-08-16
Status: accepted
Map ticket: none (whole-plan grilling session; feeds map #17)

## Context

The new accessibility-focused reader app (map: "accessible bimodal reader app (R1)",
issue #17) shows running text with the current phrase and current word highlighted,
advancing automatically — inspired by ElevenReader. TTS capability on the R1 browser
is not yet probed (map ticket "Probe TTS support on the R1 browser"), and cloud TTS is
still under survey. The reading model must be decided independently of which TTS
engine wins.

## Decision

- **Silent mode is the base mode.** A WPM clock drives the word highlight with no TTS
  involved; the app is fully usable if device TTS proves broken and cloud TTS is
  rejected. Audio is a toggle layered on top, not a prerequisite.
- **One clock at a time.** When audio is on, the voice is the clock: the highlight
  follows the TTS engine's word-boundary events. The WPM timer never runs
  simultaneously with the voice — no two-clock desync.
- **WPM is the single speed dial across modes.** In silent mode it is literal words
  per minute. In voiced mode it maps to the TTS rate multiplier (approximate
  calibration, refined in the sync-model ticket once the engine is known).

## Consequences

- The app de-risks the unprobed TTS question: worst case it ships as a silent
  read-along highlighter.
- The sync-model ticket (map #20) inherits a settled conceptual model; its remaining
  work is the boundary-event mechanics and fallback (timer-approximated sync if the
  engine emits no boundaries).
- WPM→rate calibration is engine-specific; its constants live with the TTS engine
  decision, not here.
