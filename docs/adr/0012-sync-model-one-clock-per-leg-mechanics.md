# ADR-0012: Sync model — one clock, per-leg timing mechanics

Date: 2026-08-16
Status: accepted
Map ticket: [Decide the sync model: what drives the word highlight](https://github.com/RemyFevry/r1apps/issues/20)

## Context

ADR-0006 fixed the principle — one clock at a time: WPM timer in silent mode, the
voice in voiced mode — but left the boundary mechanics and the timer-approximation
fallback to this ticket. Since then the legs changed shape (ADR-0011 update): the
keyless default is the Rabbit voice bridge, which has no word timings, no reliable
start/end events, and no rate control; the premium leg is ElevenLabs, which has char
timestamps and a native `speed` scalar. "The voice is the clock" therefore means
something different per leg.

## Decision

- **Model upheld, two modes only.** Silent (WPM timer drives the highlight) and
  voiced (the voice — or an estimate of it — drives the highlight). The highlight is
  always live; there is no listen-only mode (different app, hides the accessibility
  value).
- **Rabbit bridge leg — simulated voice clock.** Highlight timings are estimates *of
  the voice*: char-weighted word durations with punctuation pauses (ADR-0011's
  estimator family), EMA-calibrated against observed turn-taking, re-anchored every
  sentence. The WPM dial is inert while voiced on this leg — shaping estimates to
  WPM would guarantee desync from the actual audio.
  - **Session capability probe**: on first voiced play, listen for
    `r1:voice:start/end` (all name variants). If they fire, advancement is
    event-driven (end event confirms completion, immediately speak N+1); if not,
    an estimated-duration watchdog advances — accepting occasional clipping of a
    slow tail sentence rather than holding indefinitely.
  - **Stall handling**: a dead bridge is undetectable, so the highlight holds
    behind the "speaking…" indicator (never skip); any user interaction triggers a
    resync — stop volley + re-speak the current sentence from its start. No
    automatic mid-session fallback to the silent clock.
- **ElevenLabs leg — audio element is the authority.** Char timestamps map to
  word-start offsets; the highlight follows `currentTime`, so it can never outrun
  real audio. `speed = clamp(WPM/300, 0.7, 1.2)` — 300 WPM = natural pace; outside
  210–360 the dial saturates (HUD shows "max"); live WPM nudges take effect at the
  next sentence.
  - **One-sentence lookahead prefetch** (`previous_text`/`next_text` for prosody);
    on a miss the highlight holds behind the generating indicator (never-skip,
    extended from ADR-0011's neural leg).
  - **Persistent sentence cache**: IndexedDB keyed by (voice, speed, sentence-text
    hash) holding audio + timestamps; re-reads, back-jumps, and resumed sessions
    cost zero credits; LRU eviction above a size cap.
- **Transitions.** Any entry into voiced mode (toggle on, engine switch) speaks the
  current sentence from its start — the only sync-safe entry. Entry into silent
  mode takes over from the current word — no jump. Position (ADR-0009) is
  engine-agnostic and unaffected.

## Consequences

- The reading-screen prototype ("Prototype the reading screen") is unblocked: the
  screen renders a word-clock stream regardless of which clock feeds it.
- See+hear agreement is the invariant everywhere: structurally guaranteed on the
  ElevenLabs leg, estimated-and-re-anchored on the bridge leg.
- The bridge's sync quality is a runtime fact (probe), not a design guess; the
  on-device verification items in the speech-API research doc fold into first
  build.
- The WPM dial's meaning is leg-dependent (literal in silent, clamped map on
  ElevenLabs, inert voiced-bridge); the settings-surface ticket inherits "show it
  as silent-mode-only on the bridge leg".
