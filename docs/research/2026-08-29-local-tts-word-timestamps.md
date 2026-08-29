# Research: local TTS engines with word-level timestamps (macOS build-time pre-synthesis)

Date: 2026-08-29 · Context: shelf-sync build pre-synthesizes chapter audio + per-word timing
on a macOS dev machine for an R1 (low-end Android webview) ebook reader. Requirement:
the generator must emit word start/end times (or phoneme timing) by construction —
estimated/forced-aligned sync is NOT acceptable.

## Kokoro TTS — meets the bar (recommended)

- **Timestamps: native, by construction.** Since v0.7.K, `KPipeline.Result.tokens` is a
  list of `misaki` `en.MToken` objects with `start_ts`/`end_ts` fields
  ([misaki token.py](https://github.com/hexgrad/misaki/blob/main/misaki/token.py)).
  `KModel.Output.pred_dur` (the model's own predicted phoneme durations, exposed by
  [PR #40](https://github.com/hexgrad/kokoro/pull/40)) is summed into word boundaries by
  `KPipeline.join_timestamps()` ([pipeline.py](https://github.com/hexgrad/kokoro/blob/main/kokoro/pipeline.py));
  the same durations drive synthesis, so boundaries land exactly on generated frames
  (12.5 ms resolution, 24 kHz). No ASR or forced alignment. Merged in
  [PR #46 "Word level timestamps"](https://github.com/hexgrad/kokoro/pull/46); usage
  documented by the maintainer in [issue #32](https://github.com/hexgrad/kokoro/issues/32).
  **English-only** (lang codes `a`/`b`); other languages emit no tokens.
- **macOS**: `pip install kokoro`; CPU or Apple-Silicon MPS (`PYTORCH_ENABLE_MPS_FALLBACK=1`)
  per the [README](https://github.com/hexgrad/kokoro); `brew install espeak-ng` for English
  OOD fallback.
- **Quality/languages**: good — "comparable quality to larger models" per the
  [README](https://github.com/hexgrad/kokoro); US/UK English voices.
- **License**: Apache-2.0 (repo API).
- **Output/batch**: 24 kHz WAV (soundfile); generator yields one Result per chunk — trivial
  chapter loop writing `.wav` + timing sidecar.
- **Speed**: RTF ≈ 0.12 on Apple M2 Max (faster than realtime) per
  [piper-plus's benchmark table](https://github.com/ayutaz/piper-plus).

## Piper / piper1-gpl — fails the bar

No word/character timing: requests are still open —
[rhasspy/piper #70](https://github.com/rhasspy/piper/issues/70),
[#364](https://github.com/rhasspy/piper/issues/364),
[OHF-Voice/piper1-gpl #22](https://github.com/OHF-Voice/piper1-gpl/issues/22). Development
moved to [OHF-Voice/piper1-gpl](https://github.com/OHF-Voice/piper1-gpl), now **GPL-3.0**
(was MIT); old [rhasspy/piper](https://github.com/rhasspy/piper) points there. `pip install
piper-tts`, WAV output, batch via input files, RTF ≈ 0.066, good quality — but no timing.

## piper-plus (fork) — strong fallback, verify mechanism

[piper-plus](https://github.com/ayutaz/piper-plus) added **phoneme timing output**
(`--output-timing FILE`, `--timing-format json|tsv`) across all six runtimes
([CLI guide](https://github.com/ayutaz/piper-plus/blob/dev/docs/guides/development/cli-usage.md));
feature issue closed as done ([#109](https://github.com/ayutaz/piper-plus/issues/109)).
MIT; macOS arm64 prebuilt binaries + CoreML; 8 languages incl. English; RTF ≈ 0.078.
**Caveat**: the CLI docs don't state how boundaries are derived — verify empirically that
timing matches the audio before trusting it as by-construction.

## espeak-ng — meets the bar, robotic voice

Native events: `espeakEVENT_WORD` ("Start of word") and `espeakEVENT_PHONEME`, each with
`audio_position` (ms) in the synthesis callback, plus SSML `<mark>` →
`espeakEVENT_MARK` ([speak_lib.h](https://github.com/espeak-ng/espeak-ng/blob/master/src/include/espeak-ng/speak_lib.h)).
CLI `--pho` writes mbrola phoneme data and `-w` writes WAV
([man page](https://github.com/espeak-ng/espeak-ng/blob/master/src/espeak-ng.1.ronn)).
`brew install espeak-ng`; GPL-3.0-or-later (copyleft); formant/robotic quality; ~instant
(RTF ≈ 0.001); 100+ languages. Guaranteed-sync fallback via a small C/ctypes helper.

## RHVoice — out

No documented timing mechanism; platforms are Windows/GNU/Linux/Android — no macOS;
GPL-2.0; American English supported; "very intelligible" but lacks naturalness
([README](https://github.com/RHVoice/RHVoice)).

## Coqui TTS — out

No timestamps in the Python API or `tts` CLI ([README](https://github.com/coqui-ai/TTS));
MPL-2.0; `pip install TTS`; good quality (VITS/XTTS); repo effectively unmaintained
(last push Aug 2024). Getting timing would need a separate aligner = estimated sync.

## Mimic 3 — out

Deprecated ("no longer actively maintained"), AGPL-3.0
([README](https://github.com/MycroftAI/mimic3)). A fork
([izuc/mimic3](https://github.com/izuc/mimic3)) adds a phonemes output file but no timing.

## OuteTTS — partial, fails the bar

Apache-2.0; runs on macOS (llama.cpp Metal/MLX, [README](https://github.com/edwko/OuteTTS)).
But the current [interface docs](https://github.com/edwko/OuteTTS/blob/main/docs/interface_usage.md)
expose no word-timestamp output, and the README credits **CTC forced alignment** — where
timestamps exist they are post-hoc alignment (estimated), which your bar excludes. Also the
heaviest option (0.6B/1B LLM).

## Recommendation

**Kokoro TTS** — the only good-quality engine that emits word timestamps by construction.

```python
from kokoro import KModel, KPipeline
import soundfile as sf
pipe = KPipeline(lang_code='a', model=KModel().to('cpu').eval())  # 'b' = British
for i, r in enumerate(pipe(chapter_text, voice='af_heart')):
    for t in r.tokens:                       # misaki en.MToken
        print(t.text, t.start_ts, t.end_ts)  # seconds in the generated audio
    sf.write(f'ch{ch}-{i}.wav', r.audio.numpy(), 24000)
```

Serialize `r.tokens` to a per-chapter JSON sidecar (word → start/end s); audio and timing
share the same synthesis pass, so highlighting is sync-by-construction. If you need a
non-English language or dislike the voice, piper-plus (`--output-timing`) is the 
good-quality fallback after one empirical check, and espeak-ng C-API events are the
guaranteed-by-construction fallback (robotic voice). Piper proper, Coqui, RHVoice, Mimic 3,
and OuteTTS do not meet the timestamp bar today.
