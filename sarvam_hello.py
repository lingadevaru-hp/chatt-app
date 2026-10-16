"""One working Sarvam chat call. Key comes from the SARVAM_API_KEY env var."""

import os
import sys

from sarvamai import SarvamAI

key = os.environ.get("SARVAM_API_KEY")
if not key:
    sys.exit("SARVAM_API_KEY is not set. Paste your key into .env, then run:\n"
             "  set -a && . ./.env && set +a && python3 sarvam_hello.py")

client = SarvamAI(api_subscription_key=key)

resp = client.chat.completions(
    messages=[{"role": "user", "content": "Say hello in one short sentence."}],
    model="sarvam-105b-conversations",
    max_tokens=100,
)

print(resp.choices[0].message.content)
