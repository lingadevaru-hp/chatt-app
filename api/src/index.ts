// Thoshan Assistant proxy — Cloudflare Worker (Hono + TypeScript).
// The browser never sees SARVAM_API_KEY; only this Worker does.
//
// Routes (exactly the two the frontend contract needs, plus a keyless
// health check used by the deploy checklist):
//   POST /chat  { message, history[], files?[], model? } → { reply, thoughts[] }
//   POST /tts   { text, lang, voice?, model? }           → audio/wav bytes
//   GET  /health → { ok: true, mode: "proxy" }
//
// Order per request: validate (Zod, 400) → daily ceiling (429) →
// per-IP sliding window (429 + Retry-After) → provider (errors → 502,
// except provider 429 → 429). Prepaid credits with auto-recharge OFF are
// the final backstop: at zero balance Sarvam answers 402 and stops.
import { Hono, type Context } from "hono";
import { chatBody, ttsBody } from "./schema";
import { sarvamChat, sarvamTts, resolveVoice, ProviderError } from "./sarvam";
import { allowRequest, underDailyCeiling, clientIp, type LimiterEnv } from "./limits";

type Env = LimiterEnv & {
  SARVAM_API_KEY?: string;
  CHAT_MODEL?: string;
  TTS_MODEL?: string;
  TTS_VOICE?: string;
};

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ ok: true, mode: "proxy" }));

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

  const { message, history, model } = parsed.data;
  try {
    const out = await sarvamChat(c.env.SARVAM_API_KEY!, model || c.env.CHAT_MODEL || "sarvam-105b-conversations", history, message);
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

  const model = parsed.data.model || c.env.TTS_MODEL || "bulbul:v3";
  const { speaker, coerced } = resolveVoice(
    model,
    parsed.data.voice || c.env.TTS_VOICE || "",
  );
  try {
    const audio = await sarvamTts(c.env.SARVAM_API_KEY!, model, speaker, parsed.data.lang, parsed.data.text);
    // Repeat sentences are served by the CDN, not re-billed.
    const headers: Record<string, string> = {
      "Cache-Control": "public, max-age=86400",
      "Content-Type": "audio/wav",
    };
    if (coerced) headers["X-Voice-Coerced"] = speaker;
    return new Response(audio.buffer as ArrayBuffer, { headers });
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError(502, "provider error");
    return c.json({ error: "speech unavailable", detail: pe.message }, providerStatus(pe));
  }
});

export default app;
