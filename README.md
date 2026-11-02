# Thoshan · Portfolio Assistant — Web App

A voice-enabled chatbot for Thoshan's personal portfolio site. Visitors can type or talk, replies can be read aloud, and there is a full-screen voice-call mode. Vanilla HTML/CSS/JS — no frameworks.

**Version:** 2.1.0
**Last Updated:** 02-11-2026
**Status:** ✅ Live on Cloudflare Workers — `https://ai.lingadevaru.in`

## Architecture

Everything runs in **one Cloudflare Worker** (`chatt`), which serves both the
static frontend and the API at the same origin — no CORS, one deploy:

```
browser ─ same origin ─→ Worker chatt (api/src)  — ai.lingadevaru.in
                            ├── /chat  → Sarvam chat (sarvam-105b-conversations)
                            ├── /tts   → Sarvam TTS (bulbul:v4-flash, per-language)
                            ├── /stt   → Sarvam STT (saaras:v4, language auto-detect)
                            ├── /health, /turnstile-config
                            └── static assets (dist/, SPA fallback)

SARVAM_API_KEY lives only as a Worker secret — the browser never sees it.
```

The frontend is baked with `VITE_MODE=api`; source default stays `"demo"`
(no key, no network, no cost). Model/voice selection is server-side
(`api/wrangler.toml` vars), so a visitor can never ask for an expensive model.

## Quick start

```bash
npm install            # dev deps (Vite)
npm run dev            # demo mode at http://localhost:5173

# Worker proxy (api/)
cd api && npm ci
npm test               # 78 unit + route tests (network stubbed)
npm run typecheck

# Prod build + deploy (root)
VITE_MODE=api npm run build:prod   # refuses to build if the flag is missing
npm run deploy                     # asserts dist/ is an api bundle, then wrangler deploy
```

## Swap or set the API key

```bash
cd api && npx wrangler secret put SARVAM_API_KEY   # paste the key, Enter
```

No code change, no rebuild — the Worker picks it up on the next request.
Auto-recharge must stay **OFF** in the Sarvam dashboard: at zero balance the
API errors out and stops; it cannot overspend.

## Endpoints & protections (api/src)

| Route | Request → Response | Guards |
|-------|--------------------|--------|
| `POST /chat` | `{message, history[]}` → `{reply, thoughts[]}` | Zod 400 → daily ceiling 429 → per-IP sliding window 429 (+`Retry-After`) → provider (errors 502, provider 429 passes) |
| `POST /tts` | `{text, lang}` → `audio/wav` | same guard chain; per-isolate memo + `Cache-Control: public, max-age=86400` |
| `POST /stt` | raw audio body (`audio/webm;…`) → `{transcript, languageCode}` | same guard chain; ≤2 MB, 30 s provider cap → 422 passes through |
| `GET /health` | `{ok, mode, cache stats}` | none (keyless) |

Turnstile: the client (`js/turnstile.js`) renders the widget only when the
Worker advertises a site key (`/turnstile-config`). Site key sits in
`api/wrangler.toml`; protection flips ON the moment `TURNSTILE_SECRET` is set
(`npx wrangler secret put TURNSTILE_SECRET`) — the widget's allowed-domain
list in the Cloudflare dashboard must include `ai.lingadevaru.in`.

## Language support

- **Chat**: 23 Indian languages; the prompt lives in `shared/knowledge.js`
  (single source of truth — the Worker imports it directly).
- **STT**: `saaras:v4` auto-detects (English, Kannada, Hindi, …); Sarvam's
  REST endpoint caps a request at 30 s of audio (`CONFIG.maxRecordSeconds=30`,
  keep both in step).
- **TTS**: `bulbul:v4-flash` persona per language (`shubh_enhi_companion`,
  `chetan_kn_conversation`, …); Malayalam/Odia fall back to `bulbul:v3`.

## Costs

- Hosting: ₹0 — Cloudflare Workers free tier.
- Sarvam: prepaid credits only (chat ₹29.28 in/1M in, ~₹73/1M out; TTS
  v4-flash ₹20/10K chars; STT per second of audio). At ~6 visitors ×
  ~5 min/month the bill is roughly **₹0–30**; idle months are ₹0.
- Cost levers: exact-match answer cache (seeded greetings), TTS memo +
  CDN caching, 500-char message cap, history window 6, output cap 280,
  pre-rendered audio for top questions (`scripts/prerender.sh` → `audio/`),
  browser TTS fallback.

## Testing checklist (360px / 390px / 1280px)

- [x] Demo mode works with no key and no network
- [x] Streaming reply, Stop halts mid-word and saves the partial
- [x] Send works on touch; keyboard stays open through the reply
- [x] Mic visible at start, hidden after one capture, back next turn
- [x] 30-second cap with a clear notice
- [x] Attach menu aligned with composer; thumbnails inside it
- [x] Tables scroll horizontally; code blocks copy; links tappable
- [x] Voice call loop, search page, theme, sidebar rail, history
- [x] No console errors; no horizontal overflow

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `/chat` → 502 `invalid_api_key_error` | key revoked/missing | `cd api && npx wrangler secret put SARVAM_API_KEY` |
| 429 `daily budget exhausted` | `DAILY_CEILING` hit (default 300/day) | wait for reset or raise `DAILY_CEILING` in `api/wrangler.toml` |
| `chrome.cloudflarechallenge…` never shows | Turnstile secret unset | expected — protection off; see §Turnstile |
| Stale answers / wrong mode live | demo bundle shipped | deploy guard prevents it; verify `dist/.build-mode` says `api` |
| `chatt.lingadevaru203.workers.dev` dead | old pasted URL | use `chatt.thoshan.workers.dev` or the custom domain `ai.lingadevaru.in` |

## Project structure

```
chatt-app/
├── api/                      # Cloudflare Worker proxy (Hono + TS + Zod)
│   ├── src/                  # routes, sarvam.ts providers, limits, cache, turnstile
│   ├── test/                 # 78 tests (vitest, network stubbed)
│   └── wrangler.toml         # worker name `chatt`, assets dir, tunables, site key
├── js/                       # frontend modules (config, brain, speech, …)
├── styles/                   # CSS modules
├── shared/knowledge.js       # SYSTEM_PROMPT + facts — single source of truth
├── scripts/                  # prod asserts, prerender pipeline
├── docs/PRODUCTION.md        # authoritative production notes
└── dist/                     # Vite build (gitignored)
```

## Privacy

- `SARVAM_API_KEY` only ever lives as a Worker secret.
- STT audio goes browser → Worker → Sarvam only; it is not stored (≤2 MB,
  30 s cap) and not logged. Browser/buffer STT stays the free path.
- Chat history stays in the visitor's localStorage — per-device by design.
- No analytics, no accounts, no server-side history.

## Repository

- **Source:** `github.com/lingadevaru-hp/chatt-app` (private) — commits/PRs mirrored where applicable
- **Live:** `https://ai.lingadevaru.in` · Worker name: `chatt`
- **Docs:** `docs/PRODUCTION.md` · `DEPLOYMENT.md` (workspace root)
