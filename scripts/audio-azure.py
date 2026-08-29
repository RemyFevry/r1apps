#!/usr/bin/env python3
"""Azure Speech free tier chapter synthesis with word boundaries (ADR-0014, opt-in).

Dev machine only. Setup:
    pip install azure-cognitiveservices-speech
    export AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=...

Reads JSON {text, voice} on stdin; writes the same contract as audio-kokoro.py.
On quota exhaustion (429/403) prints QUOTA to stderr and exits non-zero so the
CLI skips the rest of the book gracefully (ADR-0014).
"""

import base64
import json
import os
import sys

try:
    import azure.cognitiveservices.speech as speechsdk
except ImportError:
    sys.stderr.write("azure-cognitiveservices-speech not installed\n")
    sys.exit(2)


def main():
    payload = json.load(sys.stdin)
    key = os.environ.get("AZURE_SPEECH_KEY")
    region = os.environ.get("AZURE_SPEECH_REGION")
    if not key or not region:
        sys.stderr.write("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION not set\n")
        sys.exit(4)
    cfg = speechsdk.SpeechConfig(subscription=key, region=region)
    cfg.set_property(
        speechsdk.PropertyId.SpeechServiceConnection_SynthOutputFormat,
        "audio-24khz-96kbitrate-mono-mp3",
    )
    cfg.speech_synthesis_voice_name = payload.get("voice", "en-US-JennyNeural")
    synthesizer = speechsdk.SpeechSynthesizer(speech_config=cfg, audio_config=None)
    words = []

    def on_boundary(evt):
        if evt.boundary_type == speechsdk.SpeechSynthesisBoundaryType.Word:
            words.append(
                {
                    "text": evt.text,
                    "start_ts": evt.audio_offset / 10_000_000,
                    "end_ts": (evt.audio_offset + evt.duration) / 10_000_000,
                }
            )

    synthesizer.synthesizing.connect(on_boundary)
    result = synthesizer.speak_text_async(payload["text"]).get()
    if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
        sys.stdout.write(
            json.dumps(
                {
                    "audio_base64": base64.b64encode(result.audio_data).decode(),
                    "mime": "audio/mpeg",
                    "tokens": words,
                }
            )
        )
        sys.stdout.write("\n")
    else:
        sys.stderr.write(f"QUOTA synthesis failed: {result.reason}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
