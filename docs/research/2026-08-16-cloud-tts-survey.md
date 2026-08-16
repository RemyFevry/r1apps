# Research: cloud TTS for a keyless-install static web app (R1 / GitHub Pages)

Date: 2026-08-16 · Ticket: [Survey cloud TTS options for a static web app (#19)](https://github.com/RemyFevry/r1apps/issues/19)
Context: ADR-0011 chose ElevenLabs as steadyreader's opt-in cloud leg; this survey
confirms feasibility, pricing, and the alternatives. Companion finding: the
Rabbit-native voice bridge is the keyless default (see
`2026-08-16-rabbit-creations-speech-apis.md`).

## ElevenLabs — confirmed as the cloud leg

**Browser-direct call works.** Verified by CORS preflight from a GitHub Pages
origin against the streaming-with-timestamps endpoint:

```
OPTIONS …/v1/text-to-speech/{voice}/stream/with-timestamps
  Origin: https://remyfevry.github.io
→ access-control-allow-origin: *
  access-control-allow-headers: *   (xi-api-key accepted)
  access-control-allow-methods: POST, …
```

No proxy needed; the R1 webview can call it directly.

**Word timing + rate (verified earlier from API reference):**
`stream/with-timestamps` returns audio + **character-level timing**; the request
body carries `voice_settings.speed` — the WPM→rate lever (ADR-0006).
`optimize_streaming_latency` 0–4 trades quality for latency; WebSocket realtime
TTS exists for lower latency; `previous_text`/`next_text` aid prosody continuity
across sentence-sized requests.

**Pricing (verified from pricing page, 2026-08-16):**

| Plan | $/mo | Credits/mo | Notes |
| --- | --- | --- | --- |
| Free | 0 | 10k | no rollover |
| Starter | 6 | 30k | commercial license, cloning |
| Creator | 22 (11 first mo) | 121k | |
| Pro | 99 | 600k | 44.1kHz PCM + 192kbps via API |
| Scale / Business | 299 / 990 | 1.8M / 6M | Business: low-latency ~5¢/min |

- TTS costs **1 credit/char** on multilingual-v2-class models; **0.5/char** on
  Flash/Turbo models via API. Rollover up to 2 months. **Pay As You Go** top-up
  (12-month validity) exists — the right shape for occasional reading without a
  big subscription.
- **Book math**: a ~500k-char novel ≈ 250k credits on Flash ≈ Pro's whole monthly
  quota (~$99), or ~2 novels' worth; Free tier ≈ 2–3 chapters. Confirms the
  ADR-0011 stance: cloud = premium short sessions, not book-length reading.
- **Security posture**: ElevenLabs' own best-practices docs steer toward backend
  service accounts and key lifetimes; a BYO-key-on-device personal app deviates
  (key lives in the device storage seam, masked — ADR-0011). Acceptable for
  personal use; the app should say so next to the key field.

## Azure Speech — documented cost-alternative

- **F0 free tier: 0.5M TTS characters/month** (verified from pricing page) — an
  order of magnitude more free volume than ElevenLabs, enough for ~1 novel/mo.
- `SpeechSynthesizer.wordBoundary` events verified in the JS SDK reference
  (offset/duration/text per word) — timing story equivalent to ElevenLabs'.
- Paid S0 per-char rates exist but rendered as placeholders in the fetched page;
  commonly cited ~$15/1M chars neural — **verify at signup before relying on the
  number**. Commitment tiers at 80M/400M/2B chars/mo.
- Friction: Azure account + resource + region config; same BYO-key-in-browser
  caveat. Kept as the documented fallback if ElevenLabs costs bite, per ADR-0011.

## OpenAI / Google — ruled out (timing)

- **OpenAI**: API reference unreachable this session (403); no word-timing
  parameter is known to exist on any TTS model (tts-1 / tts-1-hd /
  gpt-4o-mini-tts return audio only). **Unverified — re-check if ever
  reconsidered.** Without word timing it would need estimated sync like the
  Rabbit bridge, while costing more than Azure — no niche.
- **Google Cloud TTS**: not surveyed this session; closest native mechanism is
  SSML `<mark>` timepoints (coarser than word events). Same conclusion: no niche
  vs Azure (cheaper, word events) for this app.

## Recommendation (upholds ADR-0011)

Ship **ElevenLabs** as the only cloud adapter in v1: browser-direct CORS
verified, char timestamps, native speed control, PAYG pricing shape. Document
Azure as the swap-in if usage grows book-length (free 0.5M chars/mo, wordBoundary
events). OpenAI/Google: out.
