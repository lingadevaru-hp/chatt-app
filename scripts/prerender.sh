#!/usr/bin/env bash
# Generate committed audio for the top replies (see js/prerendered.js).
# Usage: SARVAM_API_KEY=sk_... bash scripts/prerender.sh
# Reads scripts/prerender-list.txt (one reply per line, EXACT model text),
# writes audio/<sha1-of-normalised-text>.wav via the Sarvam REST endpoint,
# then prints the map entries to paste into js/prerendered.js.
set -euo pipefail
: "${SARVAM_API_KEY:?Set SARVAM_API_KEY first}"
mkdir -p audio
while IFS= read -r line || [ -n "$line" ]; do
  [ -z "$line" ] && continue
  norm=$(printf '%s' "$line" | tr '[:upper:]' '[:lower:]' | tr -s '[:space:]' ' ' | sed 's/^ *//;s/ *$//')
  hash=$(printf '%s' "$norm" | sha1sum | cut -c1-12)
  out="audio/$hash.wav"
  if [ -f "$out" ]; then echo "skip (exists) $out"; continue; fi
  resp=$(curl -s -X POST https://api.sarvam.ai/text-to-speech \
    -H "api-subscription-key: $SARVAM_API_KEY" \
    -H 'Content-Type: application/json' \
    -d "$(printf '{"text":%s,"language_code":"en-IN","speaker":"shubh","model":"bulbul:v3","output_audio_codec":"wav"}' "$(printf '%s' "$line" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")")
  printf '%s' "$resp" | python3 -c "import json,sys,base64; open('$out','wb').write(base64.b64decode(''.join(json.load(sys.stdin)['audios'])))"
  echo "wrote $out"
  printf '  "%s": "%s",\n' "$norm" "$out"
done < scripts/prerender-list.txt
