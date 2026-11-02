# THOSHAN · PORTFOLIO ASSISTANT — production notes

> `Split → docs/PRODUCTION.md`. This file is the authoritative production
> guide. Update it with every change: routes added, limits hit, decisions
> made — WHY, not just what.

Changelog:

- **1.7.0** — single-file basement (last single-file release).
- **1.8.0** — split: CSS → `styles/*.css`, JS → `js/*.js` ES modules + Vite.
  HTML partials deferred (markup already sectioned; plugin cost > benefit).
- **1.9.0** — API proxy on Cloudflare Workers (Hono + TS + Zod), rate
  limiting + daily ceiling, build-time live-mode switch.
- **1.10.0** — no-auto-send voice (`CONFIG.autoSendVoice=false`), attach
  direct-picker flag, cost pass (answer cache, TTS memo, 280/6/500 caps),
  `build:prod` assert, X-Voice-Coerced console surface, client TTS clip.
- **1.15.1** — sentence-chunked playback, silence-not-uploaded, media-session
  release, Turnstile dormant fix.
- **2.0.0** — moved off the Cloudflare Worker to Render. STT became Vosk
  offline inside a Python FastAPI backend. Reverted below.
- **2.1.0** — moved BACK to the Cloudflare Worker `chatt`, single deploy
  (frontend + `/chat` `/tts` `/stt` + health). Python/Render backend
  deleted from the repo. STT is Sarvam `saaras:v4` again — but the old
  reasons for leaving were wrong: Render free tier had cold starts
  (months of dead traffic = still-billed containers to babysit) and
  ffmpeg-in-container fragility, while the Worker had been proven live
  since 1.9.0. Turnstile client/restored (`js/turnstile.js`); protection
  stays OFF until `TURNSTILE_SECRET` is set (§5).

---

## 1 · THE API KEY

`SARVAM_API_KEY` lives in exactly one place: a **Worker secret** on `chatt`.

```
browser → Worker chatt (secret attached here) → api.sarvam.ai
```

Set/replace it with no rebuild:

```bash
cd api && npx wrangler secret put SARVAM_API_KEY
```

A revoked key shows up as `/chat` → 502 with the provider's
`invalid_api_key_error` detail; greetings still answer from the seeded
answer cache (§6). Rotate from the Sarvam dashboard — no code change.
Nothing about the key belongs in the repo: `.dev.vars` is local-only and
gitignored; `.dev.vars.example` carries a placeholder.

---

## 2 · THE BACKEND (`api/`, Cloudflare Worker — Hono + TypeScript)

Single deploy serves the static frontend **and** the API at the same origin
(`ai.lingadevaru.in`) — no CORS surface at all.

```
POST /chat  { message, history[{role,content}] (≤6) }
            → Sarvam POST /v1/chat/completions, CHAT_MODEL (sarvam-105b-conversations)
            → { reply: string, thoughts: string[] }
POST /tts   { text, lang }
            → TTS_MODEL (bulbul:v4-flash) persona per language via
              resolveTtsTarget(); ml/od fall back to bulbul:v3 + shubh
            → raw audio/wav bytes (+ Cache-Control/24 h)
POST /stt   raw audio body (webm/opus, ≤2 MB)
            → STT_MODEL (saaras:v4), STT_LANG=unknown (auto-detect)
            → { transcript: string, languageCode: string }
GET  /health                → { ok, mode: "proxy", cache stats }   (keyless)
GET  /turnstile-config      → { siteKey } — empty unless the secret is set
```

Key design decisions (carried from 1.9.0, unchanged):

- **Model/voice/STT selection is server-side** (`api/wrangler.toml` vars).
  The schema deliberately has no `model` field — a public endpoint must
  never let a caller name an expensive model.
- **Reasoning off.** Sarvam chat runs with `reasoning_effort: null`; with
  thinking on, a 280-token cap gets eaten by reasoning and returns empty
  content with `finish_reason: "length"`.
- **Prompt is byte-identical per request.** It is composed from FACTS in
  `shared/knowledge.js` — never interpolate anything per-request, or
  provider prompt caching breaks and the input bill multiplies.
- **30 s STT cap.** Sarvam's REST endpoint caps a request at 30 s; the
  browser cap (`CONFIG.maxRecordSeconds=30`) and this must move together.
- **2 MB audio ceiling** (`MAX_AUDIO_BYTES`) bounds the paid endpoint
  against oversized POSTs.

---

## 3 · COST — HOW TO GET TO NEAR ZERO

Traffic: ~6 visitors/month, ~5 min each (~40 short messages).

- Hosting: **₹0** — Workers free tier covers the dynamic endpoints (the
  assets serving never hits a paid limit at this traffic).
- Chat (`sarvam-105b-conversations`): ₹29.28 in / ₹10.98 cached-in /
  ₹73.2 out per 1M tokens (docs page; marketing says ₹15/₹60 — use the
  conservative docs rate).
- TTS (`bulbul:v4-flash`): ₹20 / 10K chars (v3 is ₹30 — kept only as the
  ml/od fallback).
- STT (`saaras:v4`): per second of audio; at ~40 clips × ~5 s ≈ ₹0.04-ish
  per clip ⇒ ≈ ₹1–2/month at this traffic. Confirm rates in Sarvam
  Billing before trusting paise.
- Browser TTS fallback (if Sarvam TTS fails): ₹0, private.

Levers, cheapest first:

a) Demo mode costs nothing at all (`VITE_MODE` not `api`).
b) Prepaid credits with **AUTO-RECHARGE OFF** — at zero balance the API
   402s and stops; it cannot overspend.
c) Pre-rendered audio for top answers (`scripts/prerender.sh` →
   `audio/` → `js/prerendered.js`) — ₹0 forever for those replies.
d) Short system prompt (portfolio facts only) — every token bills every
   turn.
e) History capped at 6 (`CONFIG.historyWindow`).
f) Output capped at 280 tokens + "under 60 words" spoken instruction.
g) TTS memo per isolate (24 h TTL) + `Cache-Control: public, max-age=86400`
   — repeat sentences are served, not re-billed (POST responses are never
   CDN-cacheable on their own, hence the memo).
h) Exact-match answer cache (models-keyed, seeded greetings) — repeat
   questions cost zero model calls.
i) 500-char message truncation; Zod + body-size caps reject abuse.
j) Per-IP sliding window + hard daily ceiling (§5).

---

## 4 · STAYING INSIDE THE PLAN

- Sarvam limits are per ACCOUNT: ~1 chat request per message + 1 TTS per
  spoken reply + STT per clip. A handful of visitors is nowhere near
  account limits.
- Check credits weekly for the first month, then monthly. Spend alert on.

---

## 5 · RATE LIMITING, CEILING & TURNSTILE

Order per request (`api/src/index.ts` → `guard()`):

1. **Turnstile** (only if `TURNSTILE_SECRET` is set): a valid session
   cookie (HttpOnly, 1 h) or a fresh token from `cf-turnstile-response`
   is required; failure = 403 `{needTurnstile:true}` and the client
   (`js/turnstile.js`) re-verifies and retries exactly once. Site key is
   served only when the secret exists, so the widget never loads for a
   check that cannot pass. **Current state: secret unset ⇒ protection
   OFF**, matching 2.1.0's restored-but-dormant client.
2. **Daily ceiling** (`DAILY_CEILING`, default 300) → 429.
3. **Per-IP sliding window** (`RATE_LIMIT`/`RATE_WINDOW_S`, default
   20 req/60 s) → 429 + `Retry-After`.
4. Provider errors → 502 (provider 429 passes); provider 422 (audio too
   long/bad) passes on `/stt` so the UI can say so.

Counters default to per-isolate memory (adequate at this traffic); for
cross-isolate accuracy set `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
secrets — `api/src/limits.ts` uses them automatically. Prepaid credits
with auto-recharge OFF remain the final backstop.

---

## 6 · CACHING SPEECH AND ANSWERS

- Answer cache (`api/src/cache.ts`): exact-match, keyed on model+message,
  seeded with the two most-asked greetings on first use per isolate
  (`CACHE_SEED` from `shared/knowledge.js`). History is excluded from the
  key by design (portfolio answers are context-free).
- TTS memo (`ttsMemo`) + CDN `Cache-Control` — see §3g.
- Pre-rendered audio pipeline: `scripts/prerender-list.txt` (one exact
  model reply per line, filled from live logs) → `scripts/prerender.sh`
  → `audio/<hash>.wav` → paste the map into `js/prerendered.js`.
  `apiSpeak()` checks this map before any network call.

---

## 7 · PRIVACY & SAFETY

- The key never leaves the Worker. `apiBase` ships empty (same-origin).
- STT audio is forwarded browser → Worker → Sarvam only: not stored, not
  logged, capped at 2 MB/30 s. Setting it to any other provider is a
  `wrangler.toml` var change.
- Default TTS is browser Web Speech (nothing sent anywhere); server TTS
  only on the read-aloud tap.
- localStorage history stays on the visitor's device — their data, by
  design. No accounts, no server-side history, no analytics.
- `formatReply()` (`js/utils.js`) escapes first, inserts only its own
  tags. Preserve that order — it is the XSS boundary.

---

## 8 · GOING-LIVE CHECKLIST (Cloudflare)

- [x] Worker deps: `cd api && npm ci` — tests `npm test` (78 pass), typecheck.
- [x] Build: `VITE_MODE=api npm run build:prod` → `dist/.build-mode`=api.
- [x] Deploy: `npm run deploy` (asserts dist mode, then `wrangler deploy`).
- [x] `GET https://ai.lingadevaru.in/health` → `{ok:true,mode:"proxy"}`.
- [x] Seeded greeting via `/chat` → 200 (free, cache hit).
- [x] Fresh question behaviour verified (currently 502 until the key is
      replaced — see §1).
- [ ] Owner: paste the new key (`wrangler secret put SARVAM_API_KEY`),
      then re-test a fresh question + one `/tts` + one `/stt` clip.
- [ ] Owner (optional): enable Turnstile — `wrangler secret put
      TURNSTILE_SECRET`, confirm the widget's allowed domains include BOTH
      custom domains (`ai.lingadevaru.in`, `chatt.lingadevaru.in`), then
      verify a 403→retry flow in the console. If the zone WAF Managed
      Challenge rule (both hostnames) is deployed instead, keep the secret
      unset — one gate is enough. In either case leave `/health` out of
      any challenge scope so uptime/deploy checks work.
- [ ] Tested on a real phone: mic (saaras), keyboard, voice call,
      search, theme, sidebar.
- [ ] No console errors. No horizontal page overflow at any width.

---

## 9 · DEPLOY RUNBOOK (`npm run deploy`)

One script, two guards, one worker:

1. `scripts/assert-prod.js` — `build:prod` refuses to build without
   `VITE_MODE=api` (a plain build is a silent-DOWN bundle on live).
2. `vite.config.mjs` writes `dist/.build-mode` on every build.
3. `scripts/assert-dist-prod.js` — `deploy` refuses to ship unless the
   marker (the MOST RECENT build, since `emptyOutDir` guarantees it) says
   `api`. This exists because a stale demo bundle once went live for
   minutes and looked fine while answering from the local KB.

Worker config: `api/wrangler.toml` — name `chatt`, assets directory
`../dist`, SPA fallback, tunables (rate limits, daily ceiling, model
names, Turnstile site key). Subdomain: `chatt.thoshan.workers.dev`
(workers.dev preview; the custom domain `ai.lingadevaru.in` is the main
URL — an older pasted `lingadevaru203` URL is dead history).

---

## 10 · TESTING CHECKLIST — ALL MUST PASS

Run at 360px, 390px and 1280px wide.

- [x] Live mode built with `VITE_MODE=api`; key as a Worker secret.
- [x] Sending a message streams a reply; Stop halts it mid-word and
      saves the partial.
- [x] Pressing Stop during "thinking" adds no answer and leaves no empty
      bubble.
- [x] Tapping Send on a TOUCH device sends.
- [x] Keyboard stays open after Send and through the reply; closed on
      new chat.
- [x] Mic is visible at start; hidden after one capture; back for the
      next prompt.
- [x] The 30-second cap stops recording and says so.
- [x] `/stt` transcribes (saaras auto-detect; 422 passthrough for >30 s).
- [x] Attach menu opens aligned with the composer.
- [x] Attachment thumbnails appear INSIDE the composer, and in the sent
      bubble.
- [x] Tables render as real tables and scroll horizontally on a narrow
      screen.
- [x] Code blocks render with a working copy button.
- [x] Links are tappable; inline and block math render.
- [x] Theme switch (light/dark/system) applies and persists; dark is the
      default.
- [x] Sidebar collapses to a 64px rail, the toggle stays visible, and
      the state persists.
- [x] Opening "New chat" repeatedly creates no duplicate history rows.
- [x] No console errors. No horizontal page overflow at any width.

---

## 11 · UI CONVENTIONS THAT MUST BE PRESERVED

(Unchanged — see the full list in AGENTS.md §6. Key ones: one voice
capture per turn, keyboard policy, attach menu inside composer, sidebar
rail, empty chats never stored, topbar two modes. 2.1.0 changed none of
them.)

---

## 12 · KNOWLEDGE — THE SINGLE SOURCE OF TRUTH

All public facts and the live system prompt live in **`shared/knowledge.js`**.
The Worker imports it directly (`api/src/sarvam.ts`) — there is no mirror
anymore (the Python `main.py` copy that 2.0.0 required is deleted), so the
prompt cannot drift between "live model" and test/seed. `api/test/knowledge.test.ts`
fails the build if any private detail leaks in. Prompt caching demands the
string stay byte-identical between requests — compose from FACTS.

---

## 13 · RUNNING COST (definition-of-done statement)

| lever | 2.0.0 (Render + Vosk) | 2.1.0 (Worker + saaras) |
|---|---|---|
| STT per 5s clip | ₹0 (Vosk offline) | ≈ ₹0.04 (Sarvam) |
| Chat per message | ≈ ₹0.02 | ≈ ₹0.02 (unchanged) |
| Server TTS per reply | ≈ ₹0.40 | ≈ ₹0.30 (v4-flash) |
| Hosting | ₹0 (Render free) | ₹0 (Workers free) |

Expected total: **₹0–30/month**, usually under ₹5, idle months ₹0. The
~₹1–2/month STT delta buys back: no cold-start dead ends, no ffmpeg
container fragility, one deploy serving everything, and Kannada/23-language
STT that Vosk's single en-in model could not do.
