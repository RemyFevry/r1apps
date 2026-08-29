#!/usr/bin/env python3
"""Kokoro chapter synthesis with word timestamps by construction (ADR-0014).

Dev machine only (never invoked by the app or CI). Setup:
    pip install kokoro
    brew install espeak-ng        # English OOD fallback
    PYTORCH_ENABLE_MPS_FALLBACK=1 # Apple Silicon

Reads JSON {text, voice} on stdin; writes JSON on stdout:
    { audio_base64, mime, tokens: [{text, start_ts, end_ts}] }
The tokens come from the same pass that produced the audio (KPipeline
join_timestamps over pred_dur), so the sidecar is exact against the bytes.
Audio is 24 kHz WAV; converted to mp3 when ffmpeg is available.
"""

import base64
import io
import json
import sys

try:
    import numpy as np
    import soundfile as sf
    from kokoro import KPipeline
except ImportError:
    sys.stderr.write("kokoro not installed — pip install kokoro\n")
    sys.exit(2)


def main():
    payload = json.load(sys.stdin)
    text = payload["text"]
    voice = payload.get("voice", "af_heart")
    pipeline = KPipeline(lang_code="a")  # English
    chunks = []
    tokens = []
    for result in pipeline(text, voice=voice):
        audio = getattr(result, "audio", None)
        if audio is not None:
            chunks.append(np.asarray(audio))
        for tok in getattr(result, "tokens", []) or []:
            start_ts = getattr(tok, "start_ts", None)
            end_ts = getattr(tok, "end_ts", None)
            if start_ts is not None:
                tokens.append({"text": tok.text, "start_ts": start_ts, "end_ts": end_ts if end_ts is not None else start_ts})
    if not chunks:
        sys.stderr.write("kokoro produced no audio\n")
        sys.exit(3)
    audio = np.concatenate(chunks)
    buf = io.BytesIO()
    sf.write(buf, audio, 24000, format="WAV")
    wav = buf.getvalue()
    mime = "audio/wav"
    try:
        import subprocess

        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", "pipe:0", "-f", "mp3", "pipe:1"],
            input=wav,
            capture_output=True,
        )
        if proc.returncode == 0 and proc.stdout:
            wav = proc.stdout
            mime = "audio/mpeg"
    except FileNotFoundError:
        pass  # wav plays fine; the manifest carries the mime
    sys.stdout.write(
        json.dumps(
            {
                "audio_base64": base64.b64encode(wav).decode(),
                "mime": mime,
                "tokens": tokens,
            }
        )
    )
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
