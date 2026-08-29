# ADR-0014: Audio architecture — pre-generated chapter streams, bridge leg removed

Date: 2026-08-29
Status: accepted
Map ticket: [Wayfinder map: accessible bimodal reader app (R1)](https://github.com/RemyFevry/r1apps/issues/17) (whole-plan grilling session, 2026-08-29)

## Context

The bridge leg cannot meet the sync bar, and synthesis on the R1 is a dead end:

- **The Rabbit voice bridge** (`PluginMessageHandler`, ADR-0011 update / #27) has no
  word timings, no rate control, no pause, and unreliable stop. ADR-0012's answer was
  a *simulated voice clock* — an estimate of the voice, not a following of it — and
  its symptom was already observed: the highlight runs ahead of the voice (#37),
  because the estimate clock starts at post time, not at audio start. The whole
  #37/#40/#41/#42 design family existed to patch that leg toward a ±150–250 ms band
  it may not be able to meet.
- **On-device synthesis is unavailable or unusable**: the R1 webview has no
  `speechSynthesis` (probe #18), and in-browser neural TTS (Kokoro-82M/SpeechT5 via
  transformers.js) is qualitatively too slow — Chrome-101-era webview, no
  SharedArrayBuffer, single-threaded WASM (bench #26, ADR-0011 update).
- **Cloud cost shapes**: ElevenLabs is premium-only for book-length reading
  (novel ≈ 250k Flash credits, survey #19); Azure free tier ≈ one novel/month with
  `wordBoundary` events.
- **Human call (2026-08-29 session)**: the R1 should not synthesize at read time at
  all — local TTS is too much for the device. Audio is produced *ahead of reading*
  (pre-generated), and the engineering focus is sync between audio and the word
  highlight.
- **Open-source engines** (research: `docs/research/2026-08-29-local-tts-word-timestamps.md`):
  only **Kokoro TTS** and espeak-ng emit word timestamps by construction today.
  Kokoro's `pred_dur` phoneme durations drive synthesis and are summed into word
  boundaries — exact against the generated audio, no forced alignment. Apache-2.0,
  runs on macOS (CPU/MPS), RTF ≈ 0.12, English-only timestamps. Piper/Coqui/RHVoice/
  Mimic3/OuteTTS fail the timestamp bar; espeak-ng passes but is robotic (GPL-3.0).

## Decision

- **Bridge leg removed.** No Rabbit voice bridge anywhere: `bridge.ts`, its simulated
  voice clock, capability probe, watchdog, and stop volley are deleted. The keyless
  experience is the existing silent WPM mode. Supersedes ADR-0012's bridge-leg
  sections and the #37/#40/#41/#42 family.
- **Two audio producers behind one contract** (`{ audio, wordTimings[] }` per chapter):
  1. **Pre-generated chapter audio (primary)** — synthesized at shelf-sync time on
     the dev machine (`pnpm bookshelf audio`, separate from `sync` so builds never
     block on synthesis). Pluggable engine interface: **Kokoro** (default — free,
     keyless, sync-by-construction) and **Azure Speech free tier** (opt-in — neural
     quality, `wordBoundary` events). Generation is hash-incremental keyed by
     (book, chapter text): re-syncing a generated book touches nothing; quota-
     exhausted chapters are skipped and fall to the runtime ladder; re-running the
     step after a reset fills gaps automatically.
  2. **ElevenLabs on-demand (fallback)** — for URL-added books and chapters without
     pre-gen. Existing leg retained as-is: char timestamps, persistent sentence
     cache, lookahead prefetch, BYO key in device storage (ADR-0011).
- **Read-time model.** A chapter's mp3 + word-timing sidecar are fetched from the
  shelf's static hosting at chapter start and cached on-device; each chapter plays
  as one gapless stream. Books' audio never ships inside the app bundle (hundreds of
  MB).
- **Sync-by-construction.** The audio element is the authority: the highlight is
  `currentTime` mapped through the word-timing table. All three producers'
  timestamps derive from the same synthesis pass as the audio, so the highlight can
  never outrun or lag the voice — no estimation anywhere.
- **Speed.** `audio.playbackRate = clamp(WPM/300, 0.7, 1.2)` (same formula as the
  old ElevenLabs leg). `currentTime` lives on the media timeline, so word timestamps
  stay exact at any speed; live WPM nudges apply immediately, no regeneration.
- **Pause / resume / seek.** Plain audio-element operations: pause = `pause()`,
  resume = `play()` from the same position, highlight re-derived from `currentTime`;
  seek-by-word/sentence = `audio.currentTime = <word timestamp>` (scrubbing). No
  sentence-restart seam.
- **Degradation ladder** (reading never blocks on audio): pre-gen stream → if
  missing or failed, ElevenLabs at the next sentence boundary → if no key /
  unavailable / out of credits, silent WPM mode at the current word (position
  preserved). Auto-restore to audio at the next chapter boundary; HUD shows
  "audio unavailable — reading silently"; the `audioOn` preference is never flipped
  silently.
- **Engine change.** Voiced mode becomes "play chapter stream, poll `currentTime` →
  word" when pre-gen exists, else the sentence-level ElevenLabs speak path. The
  `TtsVoice` seam stays for the fallback leg.

## Consequences

- `apps/steadyreader/src/tts/bridge.ts` and its tests are deleted; the read-along
  engine's voiced path simplifies to a stream player + index mapper.
- #37/#40/#41/#42 close as superseded; #43 (record the sync design) is fulfilled by
  this ADR; #38 re-scopes to on-device *audio playback* verification.
- Cost shape: Kokoro = zero forever; Azure = ≤ ~novel/month free; ElevenLabs only for
  chapters that lack pre-gen.
- Voice consistency: a pre-gen book always uses one engine's voice; a URL-added book
  uses the ElevenLabs voice. Per-book consistent, cross-book different.
- Reading a pre-gen book needs network at chapter start (fetch + cache); first-pass
  offline reading of un-cached chapters remains unresolved (accepted; the shelf
  itself already requires network).
- On-device verification still required (adds to #9): the R1 webview actually plays
  `<audio>` elements; a hardware `sideClick` counts as Chrome user activation for
  autoplay; `playbackRate` behaves on-device.
- Supersedes: ADR-0012's bridge-leg sections (simulated voice clock, capability
  probe, stall handling, WPM-inert); ADR-0011's in-browser neural leg stays parked
  and is not revived — pre-generation replaces it. ADR-0012's ElevenLabs-leg
  decisions (audio as authority, sentence cache, transitions) are retained.
