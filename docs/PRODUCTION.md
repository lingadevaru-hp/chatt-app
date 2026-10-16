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
- **1.10.0** — no-auto-send voice (`CONFIG.autoSendVoice=false`), attach
  direct-picker flag, cost pass (answer cache, TTS memo, 280/6/500 caps),
  `build:prod` assert, X-Voice-Coerced console surface, client TTS clip.

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
// Responses carry X-Cache: HIT on answer-cache or TTS-memo hits.
// Visitor messages are truncated to 500 chars before the model (§D5).
POST /chat  { message, history[{role,content}] (≤6), files?[], model? }
            → Sarvam POST /v1/chat/completions, model sarvam-105b-conversations
            → { reply: string, thoughts: string[] }
POST /tts   { text, lang, voice?, model? }
            → Sarvam POST /text-to-speech, returns base64 in `audios`
            → raw audio bytes (audio/wav)
            → headers: Cache-Control: public, max-age=86400
GET  /health → { ok: true, cache: { answers: {hits,misses,size},
                                   tts: {hits,misses,size} } }
            (keyless; deploy checks + live hit-rate observation)
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
- Caps mirror the frontend: message ≤2000 chars transport (truncated to
  500 before the model), history ≤6, files ≤4,
  TTS text ≤2000 chars (v3 ceiling is 2500; client clips too).

## 3 · COST — HOW TO GET TO NEAR ZERO

Traffic: ~6 visitors/month, ~5 min each (~40 short messages).

PRICING NOTE (10-2026): Sarvam's two pricing pages disagree on chat rates —
the marketing page says ₹15 in / ₹60 out per 1M, the docs page says ₹29.28 /
₹73.2. Neither of us can see the account billing page from here, so every
estimate below uses the HIGHER docs-page rate (conservative). Owner: confirm
against Billing before trusting the paise. TTS agrees on both pages
(`bulbul:v3` ₹30 / 10K chars).

- Chat (`sarvam-105b-conversations`): ₹29.28 in / ₹10.98 cached-in / ₹73.2
  out per 1M (docs page; marketing says ₹15/₹60).
- TTS (`bulbul:v3`): ₹30 / 10K chars. (`bulbul:v4-flash` is ₹20 / 10K —
  left as a documented upgrade; it needs persona speaker IDs.)
- Browser STT/TTS (the default): ₹0, private, no round trip.
- Cheapest-model check (docs pricing, 10-2026): `sarvam-105b-conversations`
  (₹29.28/₹73.2) undercuts `gemma4` (₹35/₹90), `deepseekv4.1-flash`
  (₹25/₹105 out) and `glm5.3` (₹126/₹390). No reasoning model anywhere —
  `reasoning_effort: null` is pinned, and reasoning tokens would bill as
  output. Stays as deployed.

Levers, cheapest first (all still apply):

a) Demo mode costs nothing at all. (The default.)
b) Prepaid credits with **AUTO-RECHARGE OFF**. At zero balance Sarvam
   answers 402 and stops — it cannot overspend. The proxy surfaces
   provider 402/401 as 502 "assistant unavailable", never a retry loop.
c) Pre-render audio for the ~10 most common answers as static files — ₹0
   forever. Mechanism shipped: `js/prerendered.js` + `scripts/prerender.sh`
   + `audio/`. Files need a key + a week of live logs to pick the texts —
   owner step (see §13).
d) Short system prompt (`SYSTEM_PROMPT` in `api/src/sarvam.ts`,
   portfolio facts only — every token bills every turn).
e) History capped at 6 (`historyWindow`); raising it multiplies input cost.
f) Output capped at 280 tokens in the proxy + "under 60 words" instruction
   (spoken replies; long ones cost more and read worse).
g) TTS memoed server-side (`MemoCache`, 24 h) AND `Cache-Control` on the
   response. The memo is the real guard: POSTs are never CDN-cacheable, so
   the header alone could not prevent re-billing — measured, not assumed.
h) Per-IP sliding window + daily ceiling (§5) so one scraper can't drain you.
i) Cheaper model/voice selected; server TTS only when the visitor taps
   read-aloud — browser speech otherwise (verified: zero `/tts` traffic in
   demo mode).
j) Exact-match answer cache (`AnswerCache`, 6 h TTL, 200-entry cap):
   repeat questions cost zero model calls. Hit rate observable live at
   `GET /health`.

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

- Server memo (`MemoCache`, 24 h TTL, 30-entry cap) + `Cache-Control:
  public, max-age=86400` on `/tts`. The memo does the work; the header
  covers GET/CDN paths only.
- Pre-render the top answers once (`scripts/prerender.sh` → `audio/`,
  mapped in `js/prerendered.js`, checked in `apiSpeak()` before any
  network), play them directly — zero API calls on any isolate.
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
- [ ] Frontend built live: `VITE_MODE=api npm run build:prod` (refuses without the flag; source stays demo)
- [ ] `cd api && wrangler deploy` (Worker serves `../dist` + proxy, no CORS)
- [ ] `CHAT_MODEL` / `TTS_MODEL` / `TTS_VOICE` set to what you pay for
- [ ] `max_tokens` capped (280, in code), thinking off (`reasoning_effort: null`)
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
  `updateMicState`, back for the next prompt). Transcripts are NEVER
  auto-sent (`CONFIG.autoSendVoice=false`): they land in the composer for
  review, focus included; Send is the visitor's call.
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

Measured before → after the 1.10.0 cost pass (chars/4 token rule, docs-page
rates — the conservative ones):

| lever | before | after |
|---|---|---|
| system prompt | 45 words / ~88 tok | 43 words / ~85 tok (was already small; the win is the <60-word instruction) |
| context window | 12 msgs (≤48K chars worst) | 6 msgs (≤24K chars worst) |
| visitor message to model | ≤2000 chars | truncated to 500 |
| max output | 400 tok | 280 tok |
| repeat questions | full price | ₹0 (answer cache; `X-Cache: HIT`) |
| repeat synthesis | full price (POSTs bypass CDN) | ₹0 in-isolate (TTS memo; `X-Cache: HIT`) |

Per line item at ~40 messages/month:

- Chat, typical (~460 in-tok + ~80 out-tok): ≈ ₹0.02/msg → **≈ ₹0.80/mo**.
- Chat, pathological (6.2K in + 280 out): ≈ ₹0.20/msg — bounded, not typical.
- Server TTS: ~320 chars/reply → ≈ ₹0.96 per spoken reply. All-spoken
  worst case ≈ ₹38/mo; typical ≈ ₹0 (browser speech default + memo).
- Workers free tier: ~80 req/mo against 100k/day — ₹0. Idle months ₹0.

Cache hit rate: no live traffic yet, so no live number exists — counters
are live at `GET /health` (`cache.answers`, `cache.tts`); unit tests pin
100% on repeats. Expected high for a fixed-KB FAQ bot; confirm after week one.

Expected total: **₹0–40/month** (was ₹0–80), usually under ₹5. The remaining
variance is entirely "how many visitors tap read-aloud".

## 13 · KNOWLEDGE — THE SINGLE SOURCE OF TRUTH

All public facts live in **`shared/knowledge.js`**. Nothing else defines them.

```
shared/knowledge.js
  ├─ FACTS           structured public facts — the only place facts are written
  ├─ SYSTEM_PROMPT   composed from FACTS — what the live model reads every turn
  ├─ KB              demo-mode answers: same facts, same voice
  ├─ FALLBACK        what demo mode says when nothing matches
  └─ PROFILE         what the UI shows
```

Both sides import it:

```
api/src/sarvam.ts   import { SYSTEM_PROMPT } from "../../shared/knowledge.js";
js/knowledge.js     export { KB, FALLBACK, PROFILE, FACTS } from "../shared/knowledge.js";
```

**Why it is one file.** The facts used to live in two places and drifted apart:
the live system prompt named zero projects while demo mode named three that did
not exist. Editing facts in one file makes that structurally impossible.

**The guard test.** `api/test/knowledge.test.ts` fails the build if:

- the prompt and the KB disagree about a project
- any private string appears (phone, college, grades, graduation years)
- the prompt loses its privacy, scope, short-reply or voice rules
- the KB stops routing a common question, or loses its refusal entry

Run it with `cd api && npm test`.

**Private data must never enter `shared/`.** The forbidden list lives in the
test, not in the shared file — if it lived there it would be bundled into the
browser, shipping the very data it exists to protect. Verified: neither the
Worker bundle nor the frontend bundle contains the phone number, college names
or CGPA.

**Byte-identical rule.** `SYSTEM_PROMPT` must be identical on every request.
Anything dynamic inside it — a timestamp, the visitor's name, shuffled facts —
breaks provider prompt caching and multiplies the input bill. Compose it from
`FACTS`; never interpolate per-request values into it.

**Model and voice are chosen by the Worker, not the frontend** — `CHAT_MODEL`,
`TTS_MODEL` and `TTS_VOICE` in `api/wrangler.toml`. The frontend no longer sends
them, so a stale name there cannot fight the model the Worker picks. To change
the model or voice: edit those vars and `wrangler deploy`, no frontend rebuild.

**Adding a project** means three edits in one file: add it to `FACTS.projects`
with a `link`, and give it a KB entry. The test checks the two agree.

### Project links

Each entry in `FACTS.projects` carries a `links` array of `{ label, url }`
rather than a single URL, because most projects have more than one useful
destination — FOSS Coin has a repo, a wiki page and an on-chain explorer.

```js
{ name: "FOSS Coin", line: "...",
  links: [{ label: "Repo", url: "https://github.com/lingadevaru-hp/Foss-Token" },
          { label: "Wiki", url: "https://lingadevaru.in/wiki/foss-coin" },
          { label: "On-chain", url: "https://solscan.io/token/64AcK..." }] }
```

The system prompt renders every link under its project. The test asserts each
project has at least one `https://` link with a non-empty label, and pins FOSS
Coin specifically — if its repo or Solscan link ever regresses to the
portfolio fallback, the bot silently stops pointing anyone at the code.

Projects with nothing published yet (the insurance D-App) say so in their
`line` — "code on request" — rather than linking somewhere unhelpful.

### The mic dead-end (fixed in 1.11.1)

`CONFIG.oneVoicePerTurn` withdraws the mic once a capture ends, so a visitor
cannot stack two spoken turns into one message. That rule had a hole: if the
speech-to-text came out wrong, the mic stayed hidden until they sent, and
editing a bad transcription is not always possible.

`js/chat.js` now calls `resetVoiceTurn()` whenever the composer is emptied. An
empty box means there is no capture left to protect, so re-recording is
legitimate. The mic is still withdrawn after a capture — it just is not a trap.

### One voice per reply (1.11.2)

The live model once opened with **"Thoshan here ... check out HIS projects"** —
first person and third person in a single sentence, which reads like two
different people. The owner likes the warmer first-person voice ("it feels more
human"), so `SYSTEM_PROMPT` **allows** the bot to speak as him and only forbids
**mixing** the two voices inside one reply. The test `allows speaking as him,
but requires one consistent voice` keeps that rule from being dropped.

Note: demo mode's 22 KB replies are still written in the third person ("He's
Lingadevaru H P..."), so the two modes differ in voice. That only shows if the
API is unreachable, since live mode is the deployed default. A first-person pass
over the KB would make them match — not done yet.

### Deploy guard (1.11.2)

`npm run build:prod` guards the **build**. Nothing guarded the **deploy**, and
`wrangler deploy` ships whatever is in `dist/` at that moment — which is how a
stale demo bundle reached the live URL once: a build failed in the wrong
directory, the deploy ran anyway, and the site quietly answered from the local
KB instead of the model.

- `vite.config.mjs` writes `dist/.build-mode` at the end of every build.
  `build.emptyOutDir` clears `dist/` first, so the marker always describes the
  most recent build.
- `scripts/assert-dist-prod.js` reads it and exits 1 unless it says `api`.
- `npm run deploy` runs that check, then `wrangler deploy`.

Always deploy with `npm run deploy`, never bare `wrangler deploy`.

## 14 · SPEECH-TO-TEXT (1.12.0)

The mic used to be the browser's Web Speech API. It is now **Sarvam Saaras,
through our own Worker** — the same key as chat and TTS.

**Why it moved.** The browser API only really works in Chrome, it hands the
audio to Google, and it is not the API the owner pays for. `MediaRecorder`
works in every browser and the audio goes Worker → Sarvam, nowhere else.

```
js/speech.js  recordToBlob()  →  POST /stt  →  api/src/sarvam.ts sarvamStt()
                                                   → api.sarvam.ai/speech-to-text
```

`recordToBlob()` is the ONE place this app touches the microphone, shared by
the composer mic and by call mode (`js/call.js`), so the audio path exists once.

### The 30-second cap is load-bearing

Sarvam's REST endpoint **rejects audio longer than 30 seconds with a 422**.
`CONFIG.maxRecordSeconds` (30) and call mode's `maxSeconds` (25) both sit
under it deliberately. Raising one without the other produces a 422 the
visitor reads as a failure.

### Honest tradeoff: batch, not streaming

The browser API returned text **while you spoke**. Sarvam's REST endpoint is
**batch** — one round trip after the recording stops, so the text appears when
you stop. Live-as-you-speak needs the Realtime WebSocket API, which is a much
larger change (a WebSocket proxy in the Worker).

### Call mode has no Stop button

So `recordToBlob({ stopOnSilence: true })` ends the clip itself after ~1.6s of
quiet, measured with an `AnalyserNode` energy check. It is deliberately
forgiving so a pause mid-sentence does not cut the visitor off. Batch STT
gives no interim words, so the call screen shows a small "…" whenever there is
voice energy, to show the mic is live.

### Demo mode has no mic

There is no server to transcribe with, so `canRecord()` returns false and the
mic says so rather than opening a recorder that would fail.

### Malformed links in model output (1.12.1)

The live projects answer came back with this:

```
On-chain: [https://solscan.io/token/64AcK…coin
-](https://solscan.io/token/64AcK…coin
-)
```

The model slid the list break **inside** the markdown link, so the href contained
a newline. `richInline()`'s href pattern requires a whitespace-free URL, so the
link never matched and the reply rendered literal `[`, `]`, `(` plus a dead href.

Fixed at both ends:

1. **The prompt asks for BARE URLs**, not `[text](url)`. `richInline()` already
   linkifies bare URLs, so there is no link syntax to mangle. The project list is
   also one line each now — the old hanging-indent layout invited the re-wrapping.
2. **`formatReply()` repairs the construct anyway** if a model slips. It has to
   run on the RAW text **before** line splitting: `richInline()` runs per line, so
   once the construct spans two lines neither half is recognisable. The stray `-`
   is restored as a real newline so it survives as a bullet — collapsing the
   whitespace instead would glue it onto the URL and corrupt the address.

Verified against the exact broken string: 0 literal brackets, 0 dead hrefs, the
URL linkified, and the bullet rendered as `<ul><li>`.
