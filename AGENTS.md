# AGENTS.md — handoff brief

Read this before touching anything. Then read `index.html` end to end. The file
documents itself; do not refactor on assumptions.

---

## 1 · ROLE

You are the lead engineer taking over a working frontend. Your job is to take it
from a single-file prototype to a deployed, production-ready voice chatbot —
without breaking anything that already works.

---

## 2 · THE PROJECT

A voice-enabled chatbot for a personal portfolio site (owner: Thoshan, a college
student in India). Visitors can type or talk; replies can be read aloud. There is
also a full-screen voice call mode.

Constraints that shape every decision:

- Budget is near zero. Target ₹0–100/month total.
- Traffic is tiny: roughly 5–30 minutes of conversation per MONTH (about 6
  visitors, ~5 minutes each). Some months have zero visitors.
- Hosting target: **Cloudflare, free tier.**
- Therefore correctness and cost discipline matter far more than scale.

---

## 3 · THE ARTIFACT

One file: `index.html`, version **1.7.0**.
Vanilla HTML + CSS + JavaScript. No frameworks. No build step. No dependencies.
It opens in a browser and runs immediately, with no API key and no server.

**Default theme is dark.** Do not change that.

It ships in DEMO mode: answers come from a local knowledge base inside the file.
Nothing is uploaded, nothing is billed.

Working features that MUST keep working:

- Chat with word-by-word streaming, and a Stop button that halts mid-reply
- Rich text rendering: tables, fenced code blocks with a copy button, links,
  bold/italic, bullet and numbered lists, inline and block math
- Browser speech-to-text (Web Speech API) and text-to-speech
- Full-screen voice call mode: hands-free listen → think → speak loop
- Dedicated full-screen search page (matches chat titles AND message content)
- Settings page: voice toggles, language, light/dark/system theme
- Attachments: the + opens a Photos / Take photo / Files menu; picked files
  preview as thumbnails INSIDE the composer; images render in the sent bubble
- Collapsible sidebar on desktop (icon rail), persisted
- Chat history with pin / rename / delete / share-as-PDF, in localStorage
- Mobile-first responsive; sidebar becomes a fixed column at ≥1024px

---

## 4 · HOW THE FILE IS ORGANISED

Every block is labelled with the file it should become. Search for `Split →`.

```
CSS   C1  Tokens & themes        → styles/tokens.css
      C2  Reset & base           → styles/base.css
      C3  Layout shell           → styles/layout.css
      C4  Sidebar                → styles/sidebar.css
      C5  Topbar & menus         → styles/topbar.css
      C6  Chat thread            → styles/thread.css
      C7  Composer               → styles/composer.css
      C8  Voice call             → styles/call.css
      C9  Overlays               → styles/overlays.css
      C10 Motion                 → styles/motion.css
      C11 Responsive             → styles/responsive.css   (also the sidebar rail)

HTML  H1  Icon sprite            → partials/icons.html
      H2  Sidebar                → partials/sidebar.html
      H3  Topbar                 → partials/topbar.html
      H4  Thread + composer      → partials/chat.html
      H5  Voice call             → partials/call.html
      H6  Search chats           → partials/search.html
      H7  Settings               → partials/settings.html
      H8  Modals + toast         → partials/modals.html

JS    J1  Config                 → js/config.js
      J2  Knowledge base         → js/knowledge.js
      J3  Utilities + renderer   → js/utils.js
      J4  Store (state)          → js/store.js
      J5  Brain (demo + API)     → js/brain.js
      J6  Chat view              → js/chat.js
      J7  Speech (TTS / STT)     → js/speech.js
      J8  Voice call             → js/call.js
      J9  Search                 → js/search.js
      J10 Settings, theme, boot  → js/settings.js
      J11 Attachments            → js/attachments.js
      J12 Production notes       → docs/PRODUCTION.md
```

**J12 is a long comment block inside the file. It is the authoritative
production guide** — API key handling, the proxy spec, cost levers, rate
limiting, caching, privacy, a go-live checklist, the split order, known limits,
and the UI conventions in §11. Read it before you write code.

---

## 5 · HARD RULES — NEVER BREAK THESE

1. NEVER put an API key in any file the browser downloads. Keys live only in an
   environment variable on the serverless host.
2. `CONFIG.mode` MUST default to `"demo"`. The app must run fully with no key, no
   network and no cost. A visitor with no backend must never see a broken app.
3. Preserve every element `id` and class name. They are the contract between the
   CSS and the JS. If you split files, the ids do not change.
4. All colours, radii and fonts come from CSS custom properties in C1. Never
   hard-code a colour outside C1 — that is what makes the theme switch work.
5. Escape before innerHTML. `formatReply()` in J3 escapes first and inserts only
   its own tags. That ordering is the XSS boundary. Preserve it.
6. Do not add a frontend framework. No React, no Vue, no Tailwind.
7. Do not change the visual design. It was iterated against reference
   screenshots and is signed off by the owner.

---

## 6 · UI CONVENTIONS THAT MUST BE PRESERVED

These were each the fix for a real reported bug. Do not regress them.

**One voice capture per turn.** `CONFIG.maxRecordSeconds` is a hard 30-second
stop. When a recording ends — stopped by the visitor or cut off at the cap — the
mic is withdrawn via `updateMicState()`. It returns only when the composer is
cleared for the next prompt. A visitor cannot stack two spoken turns into one
message. `CONFIG.oneVoicePerTurn` toggles this; leave it `true`.

**Keyboard policy.** Nothing autofocuses. The keyboard stays closed on the
new-chat screen until the visitor taps the box. After a send, focus is restored
so the keyboard stays open through the reply. Never cancel `touchstart` on the
send button — cancelling it suppresses the `click` event and the button dies on
mobile. Only `pointerdown` is cancelled.

**Attach menu anchoring.** `.attach-pop` is positioned inside `.composer`, which
is `position:relative`. Anchoring it to the full-width wrapper put it far from
the + button on desktop. Keep it inside the composer.

**Sidebar rail.** `.app.collapsed` collapses the sidebar to `--sidebar-rail`
(64px) on desktop only. The toggle must remain visible in both states, or the
sidebar becomes unreachable. The choice persists in `settings.sidebarCollapsed`.

**Composer structure.** `.composer` is a column: an optional `.attach-preview`
strip on top, then `.composer__row` holding attach · input · mic · send. The
previews belong INSIDE the box.

**Empty chats are never stored.** A chat earns its history row on its first
message. Opening a new chat repeatedly must add nothing to the list.

**Topbar has two modes.** `renderTopbar()` switches between normal (title, call,
new-chat + kebab in one pill) and bare (fresh chat: menu and call only).

---

## 7 · YOUR TASK, IN ORDER

### Phase 1 — Split the file
Split into the structure in §4, in the order CSS → HTML → JS, using the labels.
Keep ids and class names identical. Vite is fine as a bundler if you want one;
keep the output a static site.

### Phase 2 — Build the API backend
Two routes plus STT. Deploy to **Render** (free tier, web service + static site).

Use Python FastAPI (`stt-service/main.py`). Validate request bodies with Pydantic.

```
POST /chat
  request   { message: string, history: {role,content}[], files?: [] }
  behaviour proxy to Sarvam chat (SARVAM_API_KEY held server-side)
  response  { reply: string, thoughts?: string[] }

POST /tts
  request   { text: string, lang: string }
  behaviour proxy to Sarvam TTS (SARVAM_API_KEY held server-side)
  response  raw audio/wav bytes

POST /stt
  request   raw audio body (webm/opus from MediaRecorder)
  behaviour Vosk offline STT (vosk-model-en-in-0.5, Indian English, no key)
  response  { transcript: string }
```

Provider: Sarvam AI (chat + TTS only; STT is Vosk offline).

```
Chat: POST https://api.sarvam.ai/v1/chat/completions
      header: api-subscription-key: <KEY>  (attached by Render backend)
      model:  sarvam-105b-conversations
      Cap max_tokens at 280. Disable thinking mode.
TTS:  POST https://api.sarvam.ai/text-to-speech
      returns base64 audio in an `audios` array.
STT:  Vosk vosk-model-en-in-0.5 (offline, ~54MB, downloaded at startup).
Key env var: SARVAM_API_KEY (Render env var, never in frontend)
```

### Phase 3 — Rate limiting and budget protection
- Per-IP sliding window on the Render backend (in-memory, one instance).
- Hard daily ceiling optional via `DAILY_CEILING` env var.
- Document that auto-recharge must be OFF: when prepaid credits hit zero the API
  returns an error and stops. It cannot overspend.
- **STT is free** (Vosk on Render) — no per-clip billing.

### Phase 4 — Wire live mode
In `CONFIG`: set `VITE_API_BASE` to your Render web service URL (e.g.
`https://chatt-api.onrender.com`) and `VITE_MODE=api`. Nothing else in the
frontend changes — J5 already has `apiReply()` and `apiSpeak()`. STT now hits
`/stt` on the same backend (Vosk), not Sarvam.

### Phase 5 — Deploy to Render and verify
Run the testing checklist in §10 on the deployed URL, on a real phone.

---

## 8 · COST DISCIPLINE — APPLY ALL OF THESE

- Keep the system prompt SHORT (portfolio facts only). Every prompt token is
  billed on every request.
- Cap context. `CONFIG.historyWindow` already trims to the last 12 messages.
- Cap output at ~400 tokens.
- Cache TTS responses via Cache-Control so repeats are not re-billed.
- Pre-render audio for the ~10 most common answers as static files — those
  replies then cost ₹0 forever.
- Keep the cheaper chat model and TTS voice selected in CONFIG.
- Prefer browser speech (free, private) over server speech wherever quality
  allows.
- Expected running cost: ₹0–80/month. Idle months are ₹0.

---

## 9 · HOSTING

Render, free tier:

- Python Web Service (`stt-service/`): Vosk STT + Sarvam chat/TTS proxy.
  `SARVAM_API_KEY` is a Render env var (never in the repo).
- Static Site (repo root): Vite-built frontend. `VITE_API_BASE` points at
  the web service URL.
- `render.yaml` describes both services (blueprint deploy).
- Do not enable auto-recharge on the Sarvam dashboard.

---

## 10 · TESTING CHECKLIST — ALL MUST PASS

Run at 360px, 390px and 1280px wide.

- [ ] Demo mode works with no key and no network
- [ ] Sending a message streams a reply; Stop halts it mid-word and saves the partial
- [ ] Pressing Stop during the "thinking" phase adds no answer and leaves no empty bubble
- [ ] Tapping Send on a TOUCH device sends
- [ ] Keyboard stays open after Send and through the reply; closed on new chat
- [ ] Mic is visible at start; hidden after one capture; back for the next prompt
- [ ] The 30-second cap stops recording and says so
- [ ] Attach menu opens aligned with the composer, not floating off to the side
- [ ] Attachment thumbnails appear INSIDE the composer, and in the sent bubble
- [ ] Tables render as real tables and scroll horizontally on a narrow screen
- [ ] Code blocks render with a working copy button
- [ ] Links are tappable; inline and block math render
- [ ] Voice call: opens, runs listen→think→speak continuously, ends and saves the transcript
- [ ] Search page filters on both title and message content
- [ ] Theme switch (light/dark/system) applies and persists; dark is the default
- [ ] Sidebar collapses to a 64px rail, the toggle stays visible, and the state persists
- [ ] Opening "New chat" repeatedly creates no duplicate history rows
- [ ] No console errors. No horizontal page overflow at any width.

---

## 11 · DOCUMENTATION RULES

Update the in-file documentation every time you change something:

- Keep the header map at the top accurate.
- Keep every `Split → path` label correct.
- Update J12 with anything new: routes added, limits hit, decisions made.
- Bump the version string in Settings → About.
- Document WHY, not just what. A new engineer must understand the reasoning.

---

## 12 · DEFINITION OF DONE

- The frontend is split into the documented structure and behaves identically.
- The proxy is deployed on Cloudflare, the key is a secret, rate limiting is live.
- Demo mode still works with no key.
- Every item in §10 passes on a real phone.
- The in-file docs are accurate and current.
- You can state, in one paragraph, the running monthly cost and why.

---

## 13 · WHAT NOT TO DO

- Do not add a framework to the frontend.
- Do not redesign the UI.
- Do not build a realtime WebRTC voice pipeline. The current tap-to-interrupt
  voice call is the right level for this traffic. WebRTC only pays off for group
  calls, phone lines, or users on bad mobile networks — none of which apply.
- Do not add auth, a database, or server-side history. History is per-device in
  localStorage by design, and it is the visitor's data.
- Do not rewrite working code to make it "cleaner". If it works and it is
  documented, leave it.
- Do not guess at limits or prices. Check the provider's current pages and say
  what you found.

---

## 14 · FIRST STEPS

1. Read `index.html` fully. Do not skim — the docs are inside it.
2. Read J12 in particular, and §6 of this brief.
3. Restate back, in your own words: the section map, the rules in §5 and §6, and
   your plan for Phase 1.
4. Wait for confirmation before you start editing.
