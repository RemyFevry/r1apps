# Research: Rabbit creations speech APIs (TTS + STT)

Date: 2026-08-16 · Ticket: [Investigate Rabbit's creations speech APIs (#27)](https://github.com/RemyFevry/r1apps/issues/27)
Method: source inspection of gallery creations (Repeat After Me, Reabbit, ChronoCrypt,
lil snips) + official release notes. All code excerpts below are from those apps.

## The bridge (undocumented, reverse-engineered by the community)

The R1 webview injects two JS objects into every creation:

- **Outbound**: `window.PluginMessageHandler.postMessage(jsonString)` — the page → R1.
- **Inbound**: `window.onPluginMessage = (jsonString) => {...}` — R1 → page (also
  observed: `window.postMessage` / `message` events; creations listen to both).

### TTS — "your r1's voice"

Speak text with the R1's own voice (user's genvoice, multi-language):

```js
PluginMessageHandler.postMessage(JSON.stringify({
  message: "text to speak",
  useLLM: false,          // false = speak verbatim; true = let the agent answer
  wantsR1Response: true,  // the R1 speaks the response aloud
  requestId: "voice_..."  // optional correlation id (Reabbit also sends id/correlationId)
}))
```

- No API key, no cost, works from any page loaded in the R1 webview — gallery apps
  on `*.netlify.app`, `*.github.io`, and custom domains all use it (it is NOT
  intern-only). Nothing in the protocol ties to the deploy origin.
- **No timing feedback in practice.** The documented-ish events (`r1:voice:start`,
  `r1:voice:end` with requestId correlation, plus `message` events) are listened for
  defensively by Reabbit across a dozen name variants — with timeout watchdogs and
  an adaptive client-side word timer (default **400 ms/word**, EMA-smoothed) as the
  primary mechanism. Reabbit speaks in **chunks of ~70 words (fallback 40)** and
  estimates each chunk's duration client-side (`getEstimatedDuration(words)`).
- **Stop is unreliable/undocumented**: Reabbit fires *four* different stop payloads
  (`{command:"stop_speech"}`, `{message:"stop_speech",useLLM:false}`,
  `{command:"stop",type:"speech"}`, `{action:...}`) hoping one lands.
- **No pause** — pause is implemented as stop-and-resync (Reabbit: "pause=stop now").
- **No rate control** observed anywhere.

### STT — voice input

- **PTT in a text field**: hold push-to-talk with a focused text input — the webview
  transcribes into the field (Magic Kamera's entire "with speech" feature; zero JS).
  Partially verified: inferred from gallery descriptions, not from source.
- **Programmatic**: the R1 delivers transcripts to the page via
  `window.onPluginMessage` with `{message: "process_voice_input", transcript: "..."}`
  and a `sttEnded` event type (ChronoCrypt). Trigger mechanism not fully verified
  (ChronoCrypt's voice module 404s in its deployed bundle).

## Reference implementations

| App | What it proves |
| --- | --- |
| Repeat After Me (intern) | Minimal speak: one postMessage; SpeechSynthesisUtterance fallback off-device |
| Reabbit (reabbit.com) | Long-form reading with R1 voice: chunking, watchdog timing, stop volley, 418 KB production app |
| ChronoCrypt (netlify) | Inbound STT shape; non-intern deployment using the bridge |
| lil snips (github.io) | useLLM / wantsR1Response toggles exposed in settings |

## Fit for steadyreader

- The Rabbit voice bridge is a real **keyless, free, natural-voice leg** — usable
  from our GitHub Pages app, answering the "who is the default engine" question
  left open by the probe (#18) and bench (#26).
- But it violates ADR-0006's voice-clock assumptions for this leg: **no word
  timings, no reliable start/end events, no rate control**. Word highlight on this
  leg must use **proportional estimates** (already sanctioned by ADR-0011 for
  timestamp-less engines), with chunk-level re-anchoring (sentence-level in our
  design, finer than Reabbit's ~70-word chunks).
- WPM→rate mapping (ADR-0006) has no lever on this leg: WPM shaping applies only
  where the engine accepts a rate (ElevenLabs `speed`, silent-mode dwells).
- STT via PTT-in-text-field would give voice URL-entry in ingestion (#22) for free
  if verified on-device.
- Risks: undocumented API (may change with rabbitOS updates), no pause primitive,
  stop reliability, unknown per-request length limits (Reabbit's 70-word chunks
  hint at a practical ceiling).

## Open items for on-device verification (fold into steadyreader's first build)

1. Do `r1:voice:start/end` events actually fire on current rabbitOS? (Reabbit's
   defensiveness suggests at least historically not.)
2. Practical chunk length ceiling and start latency on current rabbitOS.
3. PTT-in-text-field STT with a plain `<input>` (voice URL entry).
4. Does the R1's `stop_speech` volley actually stop promptly?

## Addendum (same day): official SDK repo

[rabbit-hmi-oss/creations-sdk](https://github.com/rabbit-hmi-oss/creations-sdk)
("rabbit r1 creations docs for devs", pushed 2025-09-08 — the "creations have a
voice" era) confirms and extends the above:

- `plugin-demo/reference/creation-triggers.md` is the **official reference** for the
  plugin channels; `plugin-demo/js/speak.js` the official speak demo.
- `PluginMessageHandler.postMessage`: **`pluginId` is automatically
  injected/overridden by the system to prevent spoofing.**
- Officially documented speak flow: `useLLM: true` + `wantsR1Response: true`
  (agent generates + speaks; `wantsJournalEntry` optional). **Verbatim speak with
  `useLLM: false` — what a reader needs — is community-verified but NOT in the
  official docs.** Treat as the bridge's soft spot.
- Additional official surface: `TouchEventHandler` (synthesized taps),
  `window.creationStorage` (plain + secure, Base64 — already wrapped by r1-kit's
  storage seam, ADR-0003), `window.creationSensors.accelerometer`,
  `closeWebView` (already in r1-kit).
- Hardware events confirmed official: `sideClick`, `longPressStart/End`,
  `scrollUp/Down` — and **"Double click triggers two sideClick events ~50ms apart"**
  (constrains ADR-0010's double-sideClick audio toggle).
- No STT API documented (docs predate the Apr 2026 STT rollout); no timing, rate,
  or pause primitives documented — the sync constraints above stand.

