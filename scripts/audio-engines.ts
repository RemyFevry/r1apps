// Dev-machine synthesis engines for `pnpm bookshelf audio` (ADR-0014).
// Both engines shell out to a Python helper that emits the exact synthesis
// pass: audio bytes + per-token timestamps from the same pass (Kokoro
// pred_dur / misaki start_ts+end_ts by construction; Azure wordBoundary).
// The helpers live next to this file and are never invoked by the app or CI —
// tests inject a fake engine instead. A helper that prints QUOTA to stderr
// (Azure 429/403) surfaces as a QuotaError so the CLI skips the rest of the
// book gracefully.

import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapTimings, QuotaError, type ChapterSynthInput, type SynthesisEngine, type SynthResult, type WordTiming } from './audio'

const HERE = dirname(fileURLToPath(import.meta.url))

interface HelperOutput {
  audio_base64: string
  mime?: string
  tokens: Array<{ text: string; start_ts: number; end_ts: number }>
}

function runHelper(script: string, input: ChapterSynthInput, voice: string): SynthResult {
  const payload = JSON.stringify({ text: input.text, voice })
  let out: string
  try {
    out = execFileSync('python3', [script], {
      input: payload,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch (e) {
    const stderr = (e as { stderr?: string }).stderr ?? String(e)
    if (/QUOTA/i.test(stderr)) throw new QuotaError(stderr)
    throw e
  }
  const parsed = JSON.parse(out) as HelperOutput
  if (!parsed.audio_base64 || !Array.isArray(parsed.tokens)) throw new Error(`${script} produced no audio/tokens`)
  const audio = Uint8Array.from(atob(parsed.audio_base64), (c) => c.charCodeAt(0))
  const tokens: Array<{ text: string; start: number; end: number }> = parsed.tokens.map((t) => ({
    text: t.text,
    start: t.start_ts,
    end: t.end_ts,
  }))
  const wordTimings: WordTiming[] = mapTimings(input.words, tokens)
  return { audio, mime: parsed.mime ?? 'audio/wav', wordTimings }
}

/** Kokoro (default): free, keyless, word timestamps by construction (ADR-0014). */
export function kokoroEngine(voice = 'af_heart'): SynthesisEngine {
  return {
    synthesize(input: ChapterSynthInput): Promise<SynthResult> {
      return Promise.resolve(runHelper(join(HERE, 'audio-kokoro.py'), input, voice))
    },
  }
}

/** Azure Speech free tier (opt-in): neural quality, wordBoundary events. Reads AZURE_SPEECH_KEY / AZURE_SPEECH_REGION from the environment. */
export function azureEngine(voice?: string): SynthesisEngine {
  return {
    synthesize(input: ChapterSynthInput): Promise<SynthResult> {
      return Promise.resolve(runHelper(join(HERE, 'audio-azure.py'), input, voice ?? 'en-US-JennyNeural'))
    },
  }
}
