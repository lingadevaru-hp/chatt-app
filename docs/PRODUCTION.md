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
- **2.0.0** — moved off Cloudflare Worker to Render. STT replaced with
  Vosk offline Indian-English model (no API key). Chat + TTS still proxy
  to Sarvam via a Python FastAPI backend on Render holding `SARVAM_API_KEY`.

---

## 1 · THE API KEY

`SARVAM_API_KEY` lives in exactly one place: the Render environment
variable for the `chatt-api` web service. The browser never sees it —
every frontend call goes to the Render backend, which attaches the key
when calling Sarvam:

```
browser  →  POST /chat  →  Render backend (key attached here)  →  api.sarvam.ai
browser  →  POST /tts   →  Render backend (key attached here)  →  api.sarvam.ai
browser  →  POST /stt   →  Render backend → Vosk offline STT (no key at all)
```

If a key is ever exposed, rotate it from the Sarvam dashboard — no code
change needed. `.env` (local) is gitignored; `.env.example` carries a
placeholder only.

---

## 2 · THE BACKEND (`stt-service/`, Python FastAPI on Render)

```
POST /chat  { message, history[{role,content}] (≤6), files?[] }
            → proxy to Sarvam POST /v1/chat/completions,
              model sarvam-105b-conversations
            → { reply: string, thoughts: string[] }
POST /tts   { text, lang }
            → proxy to Sarvam POST /text-to-speech
            → raw audio/wav bytes
POST /stt   raw audio body (webm/opus from MediaRecorder)
            → Vosk offline STT (vosk-model-en-in-0.5, Indian English)
            → { transcript: string }
GET  /health → { ok: true, stt: "vosk-en-in", key_set: bool }
GET  /       → serves the built static frontend
```

Key design decisions:

- **STT is Vosk, not Sarvam.** Vosk runs offline inside the Render
  container — no API key, no per-clip billing, works in every browser.
  The model is `vosk-model-en-in-0.5` (~54MB, Indian English), downloaded
  once at startup. Browser audio (webm/opus) is converted to 16kHz mono
  PCM via ffmpeg before Vosk processes it.
- **Chat + TTS still use Sarvam.** The key stays server-side on Render.
  Model (`sarvam-105b-conversations`) and TTS voice (`shubh` on
  `bulbul:v3`) are hardcoded in `stt-service/main.py` — the frontend can
  never choose them, so a stranger can't burn the prepaid balance on an
  expensive model.
- **Frontend and API are separate Render services.** The static site
  (`chatt-frontend`) calls the web service (`chatt-api`) at
  `VITE_API_BASE`. Set this in the Render dashboard after creating the
  web service.

---

## 3 · COST — HOW TO GET TO NEAR ZERO

Traffic: ~6 visitors/month, ~5 min each (~40 short messages).

PRICING NOTE: Sarvam's two pricing pages disagree on chat rates — use the
higher docs-page rate (conservative). Owner: confirm against Billing
before trusting the paise.

- Chat (`sarvam-105b-conversations`): ₹29.28 in / ₹10.98 cached-in /
  ₹73.2 out per 1M (docs page; marketing says ₹15/₹60).
- TTS (`bulbul:v3`): ₹30 / 10K chars. (`bulbul:v4-flash` is ₹20 / 10K
  — left as a documented upgrade; it needs persona speaker IDs.)
- **STT (Vosk): ₹0** — runs offline on Render, no API key, no per-clip
  billing. This is the saving from moving off Sarvam Saaras.
- Browser TTS fallback (if Sarvam TTS fails): ₹0, private.

Levers, cheapest first (all still apply):

a) Demo mode costs nothing at all. (`VITE_MODE` not `api`.)
b) Prepaid credits with **AUTO-RECHARGE OFF**. At zero balance Sarvam
   answers 402 and stops — it cannot overspend.
c) Pre-render audio for the ~10 most common answers as static files — ₹0
   forever. Mechanism: `js/prerendered.js` + `scripts/prerender.sh` +
   `audio/`. Owner step (see §13).
d) Short system prompt (`SYSTEM_PROMPT` in `stt-service/main.py`,
   portfolio facts only — every token bills every turn).
e) History capped at 6 (`historyWindow`); raising it multiplies input cost.
f) Output capped at 280 tokens in the backend + "under 60 words"
   instruction (spoken replies; long ones cost more and read worse).
g) TTS memoed server-side (24 h TTL, small cap) on Render. Repeat
   sentences are served from memory, not re-billed.
h) Per-IP rate limiting on Render (in-memory per instance — adequate at
   this traffic). Hard daily ceiling optional via Render env var.
i) Cheaper model/voice selected; server TTS only when the visitor taps
   read-aloud — browser speech otherwise.
j) Exact-match answer cache on the Render backend (6 h TTL).

---

## 4 · STAYING INSIDE THE PLAN

- Sarvam limits are per ACCOUNT. This app makes ~1 chat request per
  message + 1 TTS per spoken reply — a handful of visitors is nowhere
  near account limits.
- **STT is now free** (Vosk on Render), removing the per-clip STT cost
  entirely.
- Check credits weekly for the first month, then monthly.

---

## 5 · RATE LIMITING

Render runs one instance per service on the free tier, so an in-memory
Map is shared across all requests to that instance — adequate at ~6
visitors/month. If traffic ever grows, add Redis/Upstash.

- Per-IP sliding window (default 20 req / 60 s).
- Optional hard daily ceiling (set `DAILY_CEILING` env var on Render).
- Order per request: Zod 400 → rate limit → backend (provider errors →
  502, provider 429 → 429). Prepaid credits with auto-recharge OFF are
  the final backstop.

---

## 6 · CACHING SPEECH

- Server-side TTS memo (24 h TTL) on the Render backend.
- Pre-render the top answers once (`scripts/prerender.sh` → `audio/`,
  mapped in `js/prerendered.js`, checked in `apiSpeak()` before any
  network), play them directly — zero API calls.
- Browser speech stays the default.

---

## 7 · PRIVACY & SAFETY

- STT runs offline via Vosk on Render — audio never leaves the server,
  and no third-party STT provider receives it.
- Default TTS (browser Web Speech) sends nothing anywhere.
- Server TTS (Sarvam) only when the visitor taps read-aloud; audio goes
  Render → Sarvam, nowhere else.
- localStorage history stays on the visitor's device — their data.
- `formatReply()` (`js/utils.js`) escapes first, inserts only its own
  tags. Preserve that order — it is the XSS boundary.

---

## 8 · GOING LIVE CHECKLIST (Render)

- [ ] Push this branch to GitHub (`lingadevaru-hp/chatt-app`).
- [ ] Render dashboard: create "Web Service" from `stt-service/`,
      Python runtime, build `pip install -r requirements.txt && apt-get
      update && apt-get install -y ffmpeg`, start
      `uvicorn main:app --host 0.0.0.0 --port $PORT`.
- [ ] Render dashboard: set `SARVAM_API_KEY` secret on `chatt-api`.
- [ ] Render dashboard: create "Static Site" from repo root, build
      `npm install && VITE_MODE=api npm run build`, publish `dist/`.
- [ ] Render dashboard: set `VITE_API_BASE` on `chatt-frontend` to the
      `chatt-api` external URL (e.g. https://chatt-api.onrender.com).
- [ ] Redeploy `chatt-frontend`.
- [ ] `GET https://<render-url>/health` returns `{ ok: true }`.
- [ ] Tested on a real phone: mic (Vosk STT), keyboard, voice call,
      search, theme, sidebar.
- [ ] No console errors. No horizontal page overflow at any width.

---

## 9 · RENDER BLUEPRINT (`render.yaml`)

`render.yaml` describes both services (Web Service + Static Site). Use
it for the initial deploy via the Render dashboard ("Blueprint" deploy),
then manage env vars in the dashboard thereafter.

---

## 10 · TESTING CHECKLIST — ALL MUST PASS

Run at 360px, 390px and 1280px wide.

- [ ] Live mode works with `VITE_API_BASE` set and `SARVAM_API_KEY` set
      on Render.
- [ ] Sending a message streams a reply; Stop halts it mid-word and
      saves the partial.
- [ ] Pressing Stop during "thinking" adds no answer and leaves no
      empty bubble.
- [ ] Tapping Send on a TOUCH device sends.
- [ ] Keyboard stays open after Send and through the reply; closed on
      new chat.
- [ ] Mic is visible at start; hidden after one capture; back for the
      next prompt.
- [ ] The 30-second cap stops recording and says so.
- [ ] **Vosk STT transcribes Indian English and Kannada-accented English
      offline — no API key involved.**
- [ ] Attach menu opens aligned with the composer.
- [ ] Attachment thumbnails appear INSIDE the composer, and in the sent
      bubble.
- [ ] Tables render as real tables and scroll horizontally on narrow
      screens.
- [ ] Code blocks render with a working copy button.
- [ ] Links are tappable; inline and block math render.
- [ ] Theme switch (light/dark/system) applies and persists; dark is
      the default.
- [ ] Sidebar collapses to a 64px rail, the toggle stays visible, and
      the state persists.
- [ ] Opening "New chat" repeatedly creates no duplicate history rows.
- [ ] No console errors. No horizontal page overflow at any width.

---

## 11 · UI CONVENTIONS THAT MUST BE PRESERVED

(Unchanged from 1.15.1 — see the full list in AGENTS.md §6. Key ones:
one voice capture per turn, keyboard policy, attach menu inside
composer, sidebar rail, empty chats never stored, topbar two modes.)

---

## 12 · KNOWLEDGE — THE SINGLE SOURCE OF TRUTH

All public facts live in **`shared/knowledge.js`**. The live system
prompt is mirrored in **`stt-service/main.py`** (`SYSTEM_PROMPT`).
Edit `shared/knowledge.js` first, then mirror the SYSTEM_PROMPT into
`main.py` so they cannot drift.

---

## 13 · RUNNING COST (definition-of-done statement)

| lever | before (Sarvam STT) | after (Vosk STT) |
|---|---|---|
| STT per 5s clip | ≈ ₹0.04 | **₹0** (Vosk offline) |
| Chat per message | ≈ ₹0.02 | ≈ ₹0.02 (unchanged) |
| Server TTS per reply | ≈ ₹0.40 | ≈ ₹0.40 (unchanged) |
| Workers free tier | ₹0 | ₹0 (Render free tier) |

Expected total: **₹0–30/month**, usually under ₹5. The STT move saves
roughly ₹1–2/month at this traffic — small in absolute terms, but it
removes an API key entirely and makes STT work in Safari/Firefox too.

---
