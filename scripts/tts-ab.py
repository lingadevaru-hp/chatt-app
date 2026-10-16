#!/usr/bin/env python3
"""
Audition the TTS voices on the SAME line, so switching model is a listening
decision instead of a guess.

WHY THIS EXISTS
The bot's whole personality is its Kannada-English mix, so the voice is the
product — not a detail. bulbul:v4-flash is cheaper (₹20 vs ₹30 / 10k chars)
and much faster (<250ms to first audio vs v3), which is a real win for a voice
agent. But Sarvam's own guidance says the Kannada roster on v4 is *narrow*
(3 voices) and to "audition carefully", and no one can judge a voice from a
price table. So: generate them all, listen, then flip one line.

USAGE
    export SARVAM_API_KEY=...        # or: set -a && . ./.env && set +a
    python3 scripts/tts-ab.py                 # default line
    python3 scripts/tts-ab.py "your own line"
    python3 scripts/tts-ab.py "line" outdir   # default outdir: /tmp/tts-ab

Then play every .wav in the output directory.

TO SWITCH AFTER LISTENING
Edit api/wrangler.toml, then rebuild and redeploy:
    TTS_MODEL = "bulbul:v4-flash"
    TTS_VOICE = "<the persona you preferred>"
    npm run deploy

NOTE the trap: v3 short names (shubh, priya) are REJECTED by v4-flash with a
400. v4 needs a persona ID in voice_language_style form. The pairs below are
already matched correctly — do not mix one from column A with the other model.
"""
import base64
import json
import os
import sys
import urllib.request

API = "https://api.sarvam.ai/text-to-speech"

# A line that exercises what actually matters here: Kannada script, Romanised
# Kanglish, an English loanword, a number, and an emoji-free tail.
DEFAULT_LINE = (
    "ನಮಸ್ಕಾರ guru! ನಾನು Thoshan, Lingadevaru ಅವರ portfolio assistant. "
    "ಅವರ projects, skills ಬಗ್ಗೆ ಏನಾದ್ರೂ details ಬೇಕಿದ್ರೆ ಕೇಳಿ. "
    "ನನಗೆ 2 ವರ್ಷಗಳ experience ಇದೆ, and I can chat in any Indian language you like!"
)

# (label, model, speaker, language_code)
# v3 uses SHORT names. v4-flash uses PERSONA IDs. Mixing them 400s.
CANDIDATES = [
    ("v3-shubh [CURRENT]",     "bulbul:v3",       "shubh",                  "kn-IN"),
    ("v4-default-enhi",        "bulbul:v4-flash", "shubh_enhi_ads",         "kn-IN"),
    ("v4-enhi-companion",      "bulbul:v4-flash", "shubh_enhi_companion",   "kn-IN"),
    ("v4-kannada-conv",        "bulbul:v4-flash", "chaitra_kn_conversation", "kn-IN"),
    ("v3-shubh-en-IN",         "bulbul:v3",       "shubh",                  "en-IN"),
    ("v4-simran-en-customer",  "bulbul:v4-flash", "simran_en_customer",     "en-IN"),
]


def synth(key: str, text: str, model: str, speaker: str, lang: str) -> bytes:
    body = json.dumps({
        "text": text,
        "language_code": lang,
        "model": model,
        "speaker": speaker,
        "output_audio_codec": "wav",
    }).encode()
    req = urllib.request.Request(
        API, data=body,
        headers={"api-subscription-key": key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        payload = json.load(res)
    audios = payload.get("audios") or []
    if not audios:
        raise RuntimeError("no audio in response")
    return base64.b64decode("".join(audios))


def main() -> int:
    key = os.environ.get("SARVAM_API_KEY")
    if not key:
        print("SARVAM_API_KEY is not set.\n"
              "  export SARVAM_API_KEY=...   (or: set -a && . ./.env && set +a)",
              file=sys.stderr)
        return 2

    text = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_LINE
    outdir = sys.argv[2] if len(sys.argv) > 2 else "/tmp/tts-ab"
    os.makedirs(outdir, exist_ok=True)

    print(f"line: {text[:70]}{'…' if len(text) > 70 else ''}\n")
    ok = 0
    for label, model, speaker, lang in CANDIDATES:
        path = os.path.join(outdir, f"{label}.wav")
        try:
            audio = synth(key, text, model, speaker, lang)
            with open(path, "wb") as fh:
                fh.write(audio)
            print(f"  ok    {label:<24} {len(audio):>7} bytes  -> {path}")
            ok += 1
        except Exception as exc:                       # noqa: BLE001 - a report tool
            # A 400 here usually means a speaker/model mismatch, or a persona
            # ID that Sarvam has renamed. The body carries the live list.
            detail = ""
            if hasattr(exc, "read"):
                try:
                    detail = exc.read().decode()[:300]   # type: ignore[attr-defined]
                except Exception:                        # noqa: BLE001
                    pass
            print(f"  FAIL  {label:<24} {exc} {detail}")

    print(f"\n{ok}/{len(CANDIDATES)} written to {outdir}")
    print("Listen to them, then flip TTS_MODEL/TTS_VOICE in api/wrangler.toml.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
