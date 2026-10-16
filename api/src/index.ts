// Thoshan Assistant proxy — Cloudflare Worker (Hono + TypeScript).
// The browser never sees SARVAM_API_KEY; only this Worker does.
//
// Routes (exactly the two the frontend contract needs, plus a keyless
// health check used by the deploy checklist):
//   POST /chat  { message, history[], files?[], model? } → { reply, thoughts[] }
//   POST /tts   { text, lang }                           → audio/wav bytes
//   POST /stt   raw audio body + Content-Type            → { transcript }
//   GET  /health → { ok: true, mode: "proxy" }
//
// Order per request: validate (Zod, 400) → daily ceiling (429) →
// per-IP sliding window (429 + Retry-After) → provider (errors → 502,
// except provider 429 → 429). Prepaid credits with auto-recharge OFF are
// the final backstop: at zero balance Sarvam answers 402 and stops.
import { Hono, type Context } from "hono";
import { chatBody, ttsBody } from "./schema";
import { CACHE_SEED } from "../../shared/knowledge.js";
import { sarvamChat, sarvamTts, sarvamStt, resolveVoice, ProviderError } from "./sarvam";
import { AnswerCache, MemoCache } from "./cache";
import { allowRequest, underDailyCeiling, clientIp, type LimiterEnv } from "./limits";

type Env = LimiterEnv & {
  SARVAM_API_KEY?: string;
  CHAT_MODEL?: string;
  TTS_MODEL?: string;
  TTS_VOICE?: string;
  STT_MODEL?: string;
  STT_LANG?: string;
};

/* 30s of webm/opus is roughly 60-120 KB; 2 MB is generous headroom without
   letting someone POST an arbitrary payload at the paid endpoint. */
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

const app = new Hono<{ Bindings: Env }>();

// Per-isolate caches (same tradeoff as the limiter fallback — documented
// in cache.ts). Hit rates are observable via /health for the §D report.
const answerCache = new AnswerCache();
/* See the seeding block in the /chat handler. */
let cacheSeeded = false;
const ttsMemo = new MemoCache();

app.get("/health", (c) =>
  c.json({
    ok: true,
    mode: "proxy",
    cache: { answers: answerCache.stats(), tts: ttsMemo.stats() },
  }),
);

async function guard(c: Context<{ Bindings: Env }>, route: string) {
  if (!(await underDailyCeiling(c.env, route))) {
    return c.json({ error: "daily budget exhausted — try again tomorrow" }, 429);
  }
  const { ok, retryAfterS } = await allowRequest(c.env, `rl:${route}:${clientIp(c.req.raw)}`);
  if (!ok) {
    c.header("Retry-After", String(retryAfterS));
    return c.json({ error: "slow down" }, 429);
  }
  if (!c.env.SARVAM_API_KEY) {
    return c.json({ error: "key not set" }, 500);
  }
  return null;
}

function providerStatus(e: ProviderError): 502 | 429 {
  // Insufficient credit (402) and auth problems surface as 502 with the
  // provider's message, so the frontend shows "try again" instead of
  // retrying into a dead balance. Provider rate limits pass through as 429.
  if (e.status === 429) return 429;
  return 502;
}

app.post("/chat", async (c) => {
  const parsed = chatBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "bad request", detail: parsed.error.issues.slice(0, 3) }, 400);
  }
  const denied = await guard(c, "chat");
  if (denied) return denied;

  const { history } = parsed.data;
  // Cost cap (§D5): the model never sees more than 500 chars of visitor
  // text. Truncate-and-proceed (not reject) so long pastes still answer.
  const message = parsed.data.message.slice(0, 500);
  /* Model is SERVER-SIDE ONLY. This endpoint is public, so a caller must
     never be able to name the model — otherwise a stranger could point it
     at the most expensive one. See the note in schema.ts. */
  const chatModel = c.env.CHAT_MODEL || "sarvam-105b-conversations";
  /* Seed the two most-asked questions on first use. The cache is keyed on
     model + message, and the model is per-request env, so this cannot run at
     module load. Once per isolate is enough — the entries carry the cache's
     own TTL. */
  if (!cacheSeeded) {
    cacheSeeded = true;
    /* Typed here because CACHE_SEED is a plain-JS export from the shared
       module, so its shape is inferred rather than declared. */
    const seed = CACHE_SEED as Array<{ q: string; reply: string; thoughts: string[] }>;
    for (const s of seed) answerCache.set(chatModel, s.q, { reply: s.reply, thoughts: s.thoughts });
  }
  // Exact-match cache: repeat questions cost zero model calls. History is
  // excluded from the key by design (portfolio answers are context-free);
  // requests carrying files always go to the model.
  if (!parsed.data.files.length) {
    const hit = answerCache.get(chatModel, message);
    if (hit) {
      c.header("X-Cache", "HIT");
      return c.json(hit);
    }
  }
  try {
    const out = await sarvamChat(c.env.SARVAM_API_KEY!, chatModel, history, message);
    if (!parsed.data.files.length) answerCache.set(chatModel, message, out);
    c.header("X-Cache", "MISS");
    return c.json(out);
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError(502, "provider error");
    return c.json({ error: "assistant unavailable", detail: pe.message }, providerStatus(pe));
  }
});

app.post("/tts", async (c) => {
  const parsed = ttsBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "bad request", detail: parsed.error.issues.slice(0, 3) }, 400);
  }
  const denied = await guard(c, "tts");
  if (denied) return denied;

  /* Model and voice are SERVER-SIDE ONLY — same reason as chat. */
  const model = c.env.TTS_MODEL || "bulbul:v3";
  const { speaker, coerced } = resolveVoice(model, c.env.TTS_VOICE || "");
  const memoKey = ttsMemo.key(model, speaker, parsed.data.lang, parsed.data.text);
  const memoHit = ttsMemo.get(memoKey);
  if (memoHit) {
    // Served from the server memo, not re-billed. (POSTs are never
    // CDN-cacheable, so Cache-Control alone could not do this.)
    return new Response(memoHit.buffer as ArrayBuffer, {
      headers: {
        "Cache-Control": "public, max-age=86400",
        "Content-Type": "audio/wav",
        "X-Cache": "HIT",
      },
    });
  }
  try {
    const audio = await sarvamTts(c.env.SARVAM_API_KEY!, model, speaker, parsed.data.lang, parsed.data.text);
    ttsMemo.set(memoKey, audio);
    // Repeat sentences are served by the CDN, not re-billed.
    const headers: Record<string, string> = {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "audio/wav",
      "X-Cache": "MISS",
    };
    if (coerced) headers["X-Voice-Coerced"] = speaker;
    return new Response(audio.buffer as ArrayBuffer, { headers });
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError(502, "provider error");
    return c.json({ error: "speech unavailable", detail: pe.message }, providerStatus(pe));
  }
});

app.post("/stt", async (c) => {
  const denied = await guard(c, "stt");
  if (denied) return denied;

  const audio = await c.req.arrayBuffer();
  if (!audio.byteLength) return c.json({ error: "empty audio" }, 400);
  if (audio.byteLength > MAX_AUDIO_BYTES) return c.json({ error: "audio too large" }, 413);

  /* Model and language are SERVER-SIDE ONLY, like chat and tts. */
  const model = c.env.STT_MODEL || "saaras:v4";
  const lang = c.env.STT_LANG || "unknown";
  /* Browsers send e.g. "audio/webm;codecs=opus" — the provider wants just
     the mime type, so strip the parameters. */
  const mime = (c.req.header("content-type") || "audio/webm").split(";")[0].trim();

  try {
    const { transcript, languageCode } = await sarvamStt(
      c.env.SARVAM_API_KEY!,
      model,
      lang,
      audio,
      mime,
    );
    return c.json({ transcript, languageCode });
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError(502, "provider error");
    /* 422 from Sarvam means bad format or audio over 30s. Passing it
       through lets the frontend say something specific instead of a
       generic "try again" when the visitor simply spoke too long. */
    const status = pe.status === 422 ? 422 : providerStatus(pe);
    return c.json({ error: "could not transcribe", detail: pe.message }, status);
  }
});

export default app;
