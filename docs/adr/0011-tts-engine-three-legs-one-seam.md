# ADR-0011: TTS engine — three legs behind one seam

Date: 2026-08-16
Status: accepted
Map ticket: none (whole-plan grilling session; feeds map #17)

## Context

ADR-0006 made audio a toggle with the voice as the clock. The engine had to be
chosen among device `speechSynthesis` (R1 webview support unprobed), cloud services
(verdicts: ElevenLabs streams char-level timestamps and has a native speed scalar;
Azure Speech has `wordBoundary` events at ~10× lower per-char cost; OpenAI/Google
lack native word timing — survey ticket #19 confirms), and — per the human's call —
**in-browser neural TTS**: HuggingFace models run by transformers.js inside the R1
webview itself, no server.

## Decision

- **One narrow TTS seam**: `speak(sentence, rate) → word-timing events + audio`,
  with three adapters behind it:
  1. **Device leg** (default if the probe passes): webview `speechSynthesis`.
  2. **In-browser neural leg** (experimental): transformers.js in the webview —
     Kokoro-82M (q8) vs SpeechT5 benchmarked on-device; bench picks the model, and
     the leg **ships in v1 regardless of speed**. Weights fetch once from the HF CDN
     and cache; the download is a deliberate settings action.
  3. **Cloud leg** (opt-in premium): **ElevenLabs** (`stream/with-timestamps`,
     char timing, `voice_settings.speed` for the WPM→rate dial). BYO key typed once
     into a Settings field, stored via the storage seam, masked on display, never
     committed. Azure stays documented as the cost-alternative if usage turns
     book-length.
- **Derived timing for the in-browser leg** (amends ADR-0006's boundary-event rule
  for this leg): spread each sentence's *actual* audio duration across words
  (char-weighted, punctuation pauses); the audio element's `currentTime` is the
  authority; every sentence boundary re-anchors, bounding drift. No second model
  for forced alignment.
- **Never skip words**: when generation can't keep up, the highlight waits behind a
  small "generating" indicator and resumes — a read-along cannot silently drop text.

## Consequences

- The seam keeps leg viability a settings/default question, not an architecture
  question; probe (#18) and bench results choose defaults, not structure.
- Experimental status means slow-device stalls are expected; the wait indicator is
  the spec's mitigation, and the bench ticket records observed realtime factors.
- ElevenLabs per-char cost makes cloud leg suitable for short premium sessions;
  book-length reading belongs to device/in-browser legs.
- Key custody is entirely on-device; the repo and deploy artifacts stay keyless.

## Update (2026-08-16)

The R1 probe (#18) found **no `speechSynthesis` in the webview** — the device leg is
dropped. The bench (#26) found the webview is Chrome 101 without SharedArrayBuffer:
onnxruntime-web runs single-threaded, and SpeechT5 q8 generation is qualitatively
too slow — the **in-browser neural leg is parked** (still shipped, experimental,
never-skip-words wait indicator; revisit on a webview update). A **Rabbit-native
creations TTS** is confirmed to exist ("creations now have a voice", 29 Sep 2025
release notes; mechanics under investigation in #27) and is now the keyless-default
candidate, with ElevenLabs BYO-key as premium opt-in.


