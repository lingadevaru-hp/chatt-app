# THOSHAN · PORTFOLIO ASSISTANT — production notes

> `Split → docs/PRODUCTION.md` (was J12, the comment block at the end of the
> single-file build). This file is the authoritative production guide. Update
> it with every change: routes added, limits hit, decisions made — WHY, not
> just what.

Changelog:

- **1.7.0** — single-file basement (last single-file release).
- **1.8.0** — split: CSS → `styles/*.css`, JS → `js/*.js` ES modules + Vite.
  HTML partials deferred (markup already sectioned; plugin cost > benefit).
- **1.9.0** — API proxy on Cloudflare Workers (Hono + TS + Zod), rate
  limiting + daily ceiling, build-time live-mode switch.

---

## 1 · THE API KEY

A key in `index.html`, `js/*` or `dist/*` is a PUBLIC key — every visitor
downloads those files. Never paste a key there, and never log it.

The key lives in exactly one place: the `SARVAM_API_KEY` secret on the
Worker (`wrangler secret put SARVAM_API_KEY` inside `api/`). The browser
talks only to your own endpoint; your endpoint talks to Sarvam:

```
browser  →  POST /chat  →  (key attached here)  →  api.sarvam.ai
```

If a key is ever exposed, rotate it from the Sarvam dashboard — no code
change needed. `.dev.vars` (local) is gitignored; the example file carries
a placeholder only.

## 2 · THE PROXY (`api/`, Hono + TypeScript, Zod-validated)

```
POST /chat  { message, history[{role,content}], files?[], model? }
            → Sarvam POST /v1/chat/completions, model sarvam-105b-conversations
            → { reply: string, thoughts: string[] }
POST /tts   { text, lang, voice?, model? }
            → Sarvam POST /text-to-speech, returns base64 in `audios`
            → raw audio bytes (audio/wav)
            → headers: Cache-Control: public, max-age=86400
GET  /health → { ok: true } (keyless; deploy + uptime checks only)
```

Verified against docs.sarvam.ai (10-2026), not guessed:

- Chat auth is the `api-subscription-key` header. The request is
  OpenAI-compatible: `{ messages, model, max_tokens, reasoning_effort }`.
- **Thinking mode is ON by default.** The proxy sends
  `reasoning_effort: null` to disable it — otherwise a 400-token cap gets
  eaten by reasoning and comes back as empty content with
  `finish_reason: "length"`. Temperature is pinned to 0.2 (the provider
  default with reasoning off) because defaults move without notice
  (10-2026 changelog).
- TTS fields are `text`, `language_code` (required, BCP-47), `speaker`,
  `model`, `output_audio_codec: "wav"` (explicit default). Response
  `audios[0]` is base64 WAV; the proxy decodes it so the frontend's
  `URL.createObjectURL(await res.blob())` keeps working unchanged.
- **Voice/model mismatch is real:** the frontend default `anushka` is a
  `bulbul:v2`-only voice (REST reference). On `bulbul:v3` (the deployed
  default) the proxy coerces unknown voices to `shubh` and sets
  `X-Voice-Coerced` — a stale default degrades instead of 400ing.
  (`api/test/schema.test.ts` pins this.)
- Caps mirror the frontend: message ≤2000 chars, history ≤12, files ≤4,
  TTS text ≤2000 chars (v3 ceiling is 2500).

## 3 · COST — HOW TO GET TO NEAR ZERO

Traffic: ~6 visitors/month, ~5 min each. Prices below are Sarvam's public
pricing (docs.sarvam.ai/api/getting-started/pricing, 10-2026):

- Chat (`sarvam-105b-conversations`): ₹15 in / ₹5 cached-in / ₹60 out per 1M.
- TTS (`bulbul:v3`): ₹30 / 10K chars. (`bulbul:v4-flash` is ₹20 / 10K —
  left as a documented upgrade; it needs persona speaker IDs.)
- Browser STT/TTS (the default): ₹0, private, no round trip.

Levers, cheapest first (all still apply):

a) Demo mode costs nothing at all. (The default.)
b) Prepaid credits with **AUTO-RECHARGE OFF**. At zero balance Sarvam
   answers 402 and stops — it cannot overspend. The proxy surfaces
   provider 402/401 as 502 "assistant unavailable", never a retry loop.
c) Pre-render audio for the ~10 most common answers as static files — ₹0
   forever (mapping point: `askBrain()` in `js/brain.js`).
d) Short system prompt (`SYSTEM_PROMPT` in `api/src/sarvam.ts`,
   portfolio facts only — every token bills every turn).
e) History capped at 12 (`historyWindow`); raising it multiplies input cost.
f) Output capped at 400 tokens in the proxy (spoken replies; long ones
   cost more and read worse).
g) TTS cached at the CDN (`Cache-Control`, §2).
h) Per-IP sliding window + daily ceiling (§5) so one scraper can't drain you.
i) Cheaper model/voice selected; server TTS only when the visitor taps
   read-aloud — browser speech otherwise.

## 4 · STAYING INSIDE THE PLAN

- Sarvam limits are per ACCOUNT. This app makes ~1 chat request per
  message + 1 TTS per spoken reply — a handful of visitors is nowhere
  near account limits.
- Check credits weekly for the first month, then monthly.
- The daily ceiling (`DAILY_CEILING`, default 300) is insurance: if the
  site ever goes viral, the limiter trips long before the bill does.

## 5 · RATE LIMITING (live)

- Per-IP sliding window (default 20 req / 60 s, `RATE_LIMIT` /
  `RATE_WINDOW_S`), 429 + `Retry-After` when tripped.
- Hard daily ceiling across all callers (default 300/day,
  `DAILY_CEILING`), 429 past it.
- **Upstash vs memory:** on Workers there is no shared memory, so the
  in-memory Map is a single-isolate fallback (local dev). Set
  `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in production and
  every isolate shares one counter. The fallback existing is deliberate:
  the proxy must still boot (and demo mode must still work) with zero
  add-ons.
- Order per request: Zod 400 → ceiling 429 → sliding window 429 →
  provider (provider-429 → 429, everything else → 502 with message).

## 6 · CACHING SPEECH

- `Cache-Control: public, max-age=86400` on `/tts` — repeats served by the
  CDN, not re-billed.
- Pre-render the top answers once, commit the files, play them directly —
  zero API calls. Mapping point: `askBrain()` in `js/brain.js`.
- Browser speech stays the default. Move to server TTS only if the voice
  quality is worth the cost to you.

## 7 · PRIVACY & SAFETY

- STT and default TTS run in the browser. Nothing uploads until api mode.
- Attachments are local data URLs; sent to the proxy only in api mode
  (accepted-and-ignored today; forward as multimodal parts later).
- localStorage history stays on the visitor's device — their data, not yours.
- `formatReply()` (`js/utils.js`) escapes first, inserts only its own tags.
  Preserve that order — it is the XSS boundary.

## 8 · GOING LIVE CHECKLIST

- [ ] `cd api && wrangler secret put SARVAM_API_KEY` (key set, never in code)
- [ ] Frontend built live: `VITE_MODE=api npm run build` (source stays demo)
- [ ] `cd api && wrangler deploy` (Worker serves `../dist` + proxy, no CORS)
- [ ] `CHAT_MODEL` / `TTS_MODEL` / `TTS_VOICE` set to what you pay for
- [ ] `max_tokens` capped (400, in code), thinking off (`reasoning_effort: null`)
- [ ] Upstash env set for shared rate limiting (else per-isolate fallback)
- [ ] Dashboard: auto-recharge OFF, spend alert on
- [ ] KB (`js/knowledge.js`) holds real projects, links, contact
- [ ] Tested on a real phone: mic, keyboard, voice call, search
- [ ] `GET /health` returns `{ ok: true }` on the deployed URL

## 9 · SPLIT NOTES (1.8.0 — WHY it looks like this)

- Order was CSS → JS; HTML partials deferred (see header map in
  `index.html`). CSS files are verbatim extracts, linked C1-first/C11-last.
- The old JS was one IIFE — one closure, everything shared. Splitting
  naively yields undefined variables, so each `js/*.js` is an ES module
  with explicit imports/exports, loaded via `js/main.js`.
- The import graph had real cycles (store↔chat, chat↔speech, chat↔search).
  Resolved by direction, not luck: **only `chat.js` orchestrates**; leaf
  modules (`speech`, `attachments`, `search`, `call`) own their DOM and
  receive callbacks via `init*()`. `settings.js` boots; `main.js` only
  calls `boot()`. Cycle inventory is in the file header of each module.
- Shared moves: `showToast`/`copyText` live in `js/utils.js` (single copy);
  `startNewChat` moved store→chat (it renders); `SR` is exported from
  `js/speech.js` (call.js needs it — this was a latent ReferenceError
  caught by testing the split).
- `npm run dev` is required (modules don't load over `file://` — expected,
  not a bug). `npm run build:single` keeps a portable one-file build.

## 10 · KNOWN LIMITS (unchanged from the basement)

- Demo answers from a fixed list; never invents facts about you.
- Voice-call interruption is tap-to-interrupt, not full duplex.
- STT quality is the browser's; Chrome is the only reliable one.
- No server history — per device by design. No auth — nothing private in KB.

## 11 · UI CONVENTIONS THAT MUST BE PRESERVED

- ONE VOICE CAPTURE PER TURN (`maxRecordSeconds` 30 s; mic withdrawn via
  `updateMicState`, back for the next prompt).
- KEYBOARD POLICY: no autofocus; focus restored after send; cancel only
  `pointerdown` on Send, never `touchstart`.
- ATTACH MENU anchored inside `.composer` (`position:relative`).
- SIDEBAR RAIL: `.app.collapsed` → 64 px rail, desktop only, toggle always
  visible, choice persisted.
- COMPOSER is a column: `.attach-preview` strip, then `.composer__row`.
- EMPTY CHATS ARE NEVER STORED (first message earns the history row).
- TOPBAR has two modes (`renderTopbar()`: normal vs bare).
- Load-bearing details: `[hidden]{display:none !important}` (C2),
  viewport meta, C1-first/C11-last stylesheet order, `data-theme` on
  `<html>`, icon sprite before any `<use>`.

## 12 · RUNNING COST (definition-of-done statement)

At ~6 visitors × ~5 min/month (~40 short messages): chat costs on the
order of ₹1–2 (roughly 30–50K input tokens @ ₹15/1M plus ~15K output @
₹60/1M). Server TTS is the only real variable: worst case — every reply
read aloud server-side — is ~25K chars ≈ ₹75 at Bulbul v3 rates; typical
case is near ₹0 because read-aloud defaults to free browser speech, TTS
responses cache for a day, and the top answers can be pre-rendered as
static files. Cloudflare Workers free tier (100k req/day) covers ~40
requests/month several thousand times over, and proxy-waiting consumes
negligible CPU time. Idle months are ₹0. Expected total: **₹0–80/month**,
usually at the bottom of that range.
