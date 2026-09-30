# Research: Rabbit voice bridge timing signals — recheck on current rabbitOS

Date: 2026-08-16 · Ticket: [Re-verify bridge timing signals on current rabbitOS (SDK + community) (#39)](https://github.com/RemyFevry/r1apps/issues/39) · Parent map: [R1voice sync (#37)](https://github.com/RemyFevry/r1apps/issues/37)
Method: GitHub API on [rabbit-hmi-oss/creations-sdk](https://github.com/rabbit-hmi-oss/creations-sdk)
(commits, issues, full tree, reference doc, speak demo); Reabbit's deployed production
bundles fetched from reabbit.com and grepped for timing constants and event names;
official rabbitOS release notes via team-rabbit posts on r/rabbitr1; GitHub code
search for `r1:voice` / `stop_speech`. Confidence tagged per fact:
**[verified-from-source]**, **[verified-from-release-notes]** (official team posts),
**[community-reported]**, **[unverified]**.

## Headline

**Nothing at the bridge's timing surface has changed since this morning's research
pass** ([2026-08-16 speech-API doc](2026-08-16-rabbit-creations-speech-apis.md)).
The official SDK is frozen, Reabbit's deployed bundle still distrusts every voice
event, and three rabbitOS releases since April 2026 (2.1 → 2.3) added nothing to
voice timing, stop, pause, or rate for creations. The four open on-device
verification items in the prior doc all remain open.

## Official SDK repo — unchanged since 2025-09-08

- Full commit history is **two commits**: `a527951` "Initial commit"
  (2025-09-04) and `62ef8b3` "sneak-peek" (2025-09-08).
  **[verified-from-source]** (GitHub API, checked 2026-08-16)
- **Zero open or closed issues, zero PRs** on the repo — no community bug reports
  about voice events have ever landed there. **[verified-from-source]**
- `plugin-demo/reference/creation-triggers.md` re-fetched and re-read in full
  today: still documents only `PluginMessageHandler` (with `useLLM` /
  `wantsR1Response` / `wantsJournalEntry`), `closeWebView`, `TouchEventHandler`,
  `creationStorage`, `creationSensors`, and the hardware events
  (`sideClick`, `longPressStart/End`, `scrollUp/Down`, double-click = two
  sideClicks ~50 ms apart). **No voice start/end events, no stop, no pause, no
  rate, no chunk-length limit is documented anywhere in the tree.**
  **[verified-from-source]**
  https://github.com/rabbit-hmi-oss/creations-sdk/blob/main/plugin-demo/reference/creation-triggers.md
- The official speak demo (`plugin-demo/js/speak.js`) is itself timing-blind —
  after posting a speak request it resets the "Speaking…" status with a
  **hardcoded 3000 ms `setTimeout`** and never correlates completion:
  ```js
  PluginMessageHandler.postMessage(JSON.stringify(payload));
  this.updateStatus(useR1Response ? 'Speaking...' : 'Processing...');
  // Reset status after a delay
  setTimeout(() => { this.updateStatus('Ready'); }, 3000);
  ```
  **[verified-from-source]** — even Rabbit's own demo guesses duration with a
  fixed timer rather than an event. Corroborates "no timing feedback" at the
  highest level we have.
- The Apr 2026 STT announcement promised "code snippets soon for those building
  outside of intern" — **those snippets are still not in the repo** (tree above
  is the whole repo). **[verified-from-source]** +
  **[verified-from-release-notes]** (promise: r/rabbitr1 STT post, Apr 2026,
  https://old.reddit.com/r/Rabbitr1/comments/1sbqpoo/)

## Reabbit production bundle (fetched 2026-08-16) — same defensive architecture

Fetched `https://reabbit.com/assets/reader-BBbq1NIR.js` (418,503 bytes — same
"418 KB" as the prior pass) + `index-BTHeCn-8.js` (159,454 bytes). The deployed
app is the "MAGI 3.0" era (Gamaken; current default theme `magi`; cited on
r/rabbitr1 4 months ago via Discord
https://old.reddit.com/r/Rabbitr1/comments/1s66hpn/). All excerpts below are
from the live bundle. **[verified-from-source]**

### It still does not trust voice events

The start/end event volley is unchanged, listened for both as
`window.onPluginMessage` envelope types and as window CustomEvents, correlated
by `requestId`/`id`/`correlationId` against a `pendingVoiceStarts` map:

```js
// start volley (envelope type match):
t==="r1:voice:start"||t==="voiceStart"||t==="voice_start"||t==="VOICE_START"
 ||t==="speechStart"||t==="SPEECH_START"||t==="voice:start"||t==="VOICE:START"
// end volley adds completion variants:
t==="r1:voice:end"||t==="voiceEnd"||t==="voice_end"||t==="VOICE_END"
 ||t==="speechEnd"||t==="SPEECH_END"||t==="voice_complete"||t==="VOICE_COMPLETE"
 ||t==="voice:end"||t==="VOICE:END"
// plus: window.addEventListener("r1:voice:start", e => e.detail?.requestId ...)
```

No *new* event names were added since the prior pass — if a newer rabbitOS had
started emitting a documented timing event, the deepest production user would be
expected to adopt it. They didn't. **No event handler is the primary clock; the
EMA estimator is** (unchanged).

### Timing constants (all re-verified verbatim today)

```js
je.EMA_ALPHA=.3, je.DEFAULT_START_LATENCY=500, je.DEFAULT_WORD_MS=400,
  je.MIN_OBSERVATIONS=2                       // EMA calibrator class
De.INITIAL_TARGET_WORDS=70,  De.INITIAL_MAX_WORDS=90
De.FALLBACK_TARGET_WORDS=40, De.FALLBACK_MAX_WORDS=50
De.MIN_WORDS_AFTER_PERIOD=10, De.INTER_CHUNK_DELAY=200, De.TIMEOUT_THRESHOLD=2
```

```js
getEstimatedDuration(words){                    // per-chunk watchdog budget
  const t = this.avgStartLatency + words*this.avgWordMs;
  return Math.min(t*1.2, 2e4)                  // ×1.2 safety factor, 20 s cap
}
getStartDelay(){                                // post-send hold before advancing
  return Math.max(400, Math.min(1200, this.avgStartLatency*1.25))
}
```

- Bridge request timeout: `timeoutMs ?? 2e4` (20 s default) on dispatch.
- After **2 chunk timeouts** (watchdog fires before end event), it permanently
  downgrades chunks 70→40 words for the session ("Switching to fallback chunk
  size … after ${timeoutCount} timeouts").

### Stop volley unchanged; still no pause, no rate

All four stop payload shapes from the prior doc are still shipped:
`stop_speech` (as message), `command:"stop"`, `action:"stop"`,
`type:"speech"`. No pause primitive appears; no rate field is sent anywhere in
either bundle.

## rabbitOS release timeline vs the bridge (Apr–Aug 2026)

All from official team-rabbit posts on r/rabbitr1 **[verified-from-release-notes]**:

| Release (~date) | Voice/creations-relevant content | Bridge timing surface? |
| --- | --- | --- |
| STT cloud update (Apr 2026) | STT in creations via intern; snippets "soon" for others | none (input side only) — https://old.reddit.com/r/Rabbitr1/comments/1sbqpoo/ |
| rabbitOS 2.1 (Apr 2026) | Journal card, saved **magic voice slots**, PIN lock, creations card redesign | none — https://old.reddit.com/r/Rabbitr1/comments/1sedt0k/ |
| OTA 17 Apr 2026 | Custom personality prompt, PTT-continues-thread | none — https://old.reddit.com/r/Rabbitr1/comments/1sogswm/ |
| rabbitOS 2.2 (~Jul 2026) | Claude Code, terminal, **magic voice fallback fix** ("if your selected magic voice can't be found, r1 will fall back to the default voice rather than silence"), creations cards expanded | none — https://old.reddit.com/r/Rabbitr1/comments/1uakvrp/ |
| rabbitOS 2.3 (~Aug 2026) | Hermes agent, DLAM BYOK, **creations gallery 1.5**, proactive rabbit | none — https://old.reddit.com/r/Rabbitr1/comments/1ut08hj/ |

The 2.2 magic-voice fallback fix is the only change touching the voice leg at
all — it improves *robustness* (voice always plays), which is good for us, but
adds no signal. An older note (1 yr ago) that "text to speech has been modified
so audio output and text captions are aligned" applied to the R1's own captions,
not the creations bridge. **[verified-from-release-notes]**
https://old.reddit.com/r/Rabbitr1/comments/1f89njv/

## Community signal search — negative results

- **No post found on r/rabbitr1** (searched: creation voice stop/timing,
  reabbit, "voice latency", "text to speech") reporting `r1:voice:start`/`end`
  firing on current rabbitOS, any startup-latency measurement, `stop_speech`
  reliability data, or a per-request length ceiling. Absence of evidence only.
  **[unverified — negative search]**
- **GitHub code search** for `"r1:voice:start"` returns no public repo source —
  only deployed minified bundles (Reabbit) use it; no open-source creation has
  published event-based timing code to copy or audit. **[verified-from-source]**
- **JackRabbitOS** (community custom OS, announced ~15 h before this pass,
  ~50% done) explicitly plans "Creations work natively in this build." If it
  ships, the bridge gains a second, community-implemented runtime whose event
  behavior would be defined by them, not Rabbit. Watch item, nothing to build on
  yet. **[community-reported]** https://old.reddit.com/r/Rabbitr1/comments/1vpi0m7/

## Delta since 2026-08-16 (this morning's pass)

1. **SDK repo: zero delta.** No commits, issues, PRs, or doc edits; last push
   remains 2025-09-08. STT snippets still unpublished.
2. **Reabbit bundle: no architectural delta.** Same 418 KB main bundle, same
   event volley (no new names), same EMA constants (400 ms/word, 500 ms start
   latency, α=0.3), same 70/40-word chunking with 2-timeout downgrade, same
   4-payload stop volley, 200 ms inter-chunk delay. New precision captured this
   pass (not previously excerpted): ×1.2 watchdog safety factor with a 20 s hard
   cap, start-delay clamp 400–1200 ms, 20 s default dispatch timeout.
3. **rabbitOS: three releases shipped with no bridge timing additions.** Only
   adjacent change: magic-voice fallback-to-default fix in 2.2 (robustness, not
   signal).
4. **New horizon item:** JackRabbitOS intends native creations support → future
   runtime divergence risk.

## Answers to the ticket's target questions

| Question | Answer | Confidence |
| --- | --- | --- |
| Do `r1:voice:start`/`end` fire on current rabbitOS? | No public evidence they do; the heaviest production user still wraps 8–10 name variants of each in watchdog-gated, EMA-timed defensive listeners as of today's deployed bundle. On-device probe remains the only way to know for a given unit. | events-don't-fire-in-practice: verified-from-source (Reabbit's distrust); actual firing: unverified |
| Startup latency numbers | Only Reabbit's priors: default 500 ms start latency, EMA-adapted, start-delay clamp 400–1200 ms (`avg×1.25`). No community measurement published. | verified-from-source (their constants); real-world numbers: none found |
| Duration predictability | Still estimated client-side: `words × avgWordMs` with 400 ms/word default, α=0.3 EMA, ×1.2 safety factor, 20 s cap. | verified-from-source |
| Stop reliability | No new data; stop is still a 4-payload volley, none documented. Official SDK documents no stop at all. | verified-from-source (absence) |
| Pause / rate | Still nonexistent in SDK docs and Reabbit bundle. | verified-from-source (absence) |
| Chunk ceiling | Still undocumented; practical guide is Reabbit: target 70 / max 90 words initial, 40/50 fallback after 2 timeouts, ≤20 s per request. | verified-from-source (their constants); official ceiling: undocumented |

## Implications for the sync design (ADR-0012)

- **The session capability probe stays load-bearing.** Nothing today supersedes
  the "probe for `r1:voice:start/end` on first voiced play; if silent, the
  estimator is the clock" decision. Keep the probe's event-name list aligned
  with Reabbit's volley (both envelope-type and CustomEvent channels) since it
  is the most complete defensive set observed.
- **We have production-calibrated priors for the estimator.** Adopt Reabbit's
  tuned constants as starting values for our sentence-level estimator
  (400 ms/word, 500 ms start latency, α≈0.3, ×1.2 safety factor, 20 s per-chunk
  cap, ~200 ms inter-sentence gap) and let ADR-0012's sentence-level EMA
  re-anchoring tighten them — our sentences are far shorter than their 70-word
  chunks, so our per-unit variance should be lower.
- **Chunk ceiling is a non-issue for sentence-level chunking.** A 90-word / 20 s
  practical worst-case envelope comfortably contains any sentence we will send.
- **Stop volley: copy the shape, ship it as one primitive.** ADR-0012's
  resync-on-interaction (stop volley + re-speak current sentence) matches the
  only known-working practice; keep all four payload shapes until on-device
  testing proves one sufficient.
- **No pause, no rate: unchanged.** WPM dial remains inert on this leg while
  voiced (per ADR-0012); pause remains stop-and-resync.
- **Risk register additions:** (a) the bridge is still zero-documentation for
  verbatim speak (`useLLM:false`) — the soft spot flagged this morning stands;
  (b) JackRabbitOS, if it ships with creations support, makes "current
  rabbitOS" a set of runtimes — the probe result may differ per runtime, so
  record it per session rather than caching forever; (c) the still-unpublished
  STT snippets are the likeliest near-term SDK change — re-check the repo when
  they land, since new inbound-channel docs sometimes document outbound events
  too.
