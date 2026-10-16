# Proxy deploy runbook (Cloudflare Workers, free tier)

Worker serves the static frontend AND the API in one deploy — no CORS.

## First deploy

```bash
# 1. Frontend, live bundle (source default stays "demo"):
VITE_MODE=api npm run build          # from repo root → dist/

# 2. Key as a secret (never in code, never in wrangler.toml):
cd api
npx wrangler secret put SARVAM_API_KEY

# 3. Optional but recommended — shared rate-limit counters:
npx wrangler secret put UPSTASH_REDIS_REST_URL
npx wrangler secret put UPSTASH_REDIS_REST_TOKEN
# Without these the limiter falls back to per-isolate memory (dev-grade).

# 4. Deploy:
npx wrangler deploy
```

## Verify

```bash
curl https://<worker>.workers.dev/health
# → {"ok":true,"mode":"proxy"}

curl -X POST https://<worker>.workers.dev/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"What projects has Thoshan built?","history":[]}'
# → {"reply":"...","thoughts":[...]}
```

## Local

```bash
npm test          # 22 unit + route tests (no network, Sarvam stubbed)
npm run typecheck
cp .dev.vars.example .dev.vars   # placeholder key only
npx wrangler dev --ip 127.0.0.1  # needs normal loopback; sandbox ::1 may fail
```

## Sarvam dashboard (do this once)

- Auto-recharge **OFF** — at zero balance the API 402s and stops.
- Spend alert on. Check credits weekly for the first month.
- Voice note: `anushka` is a `bulbul:v2` voice. The deployed default is
  `bulbul:v3` + `shubh` (see `TTS_MODEL`/`TTS_VOICE` in `wrangler.toml`);
  the proxy coerces anything else per model and reports it via
  `X-Voice-Coerced`. Changing the frontend default is a voice choice, not
  a code fix — leave `CONFIG.ttsVoice` until the owner picks a v3 voice.
