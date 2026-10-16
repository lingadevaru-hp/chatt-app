// Sarvam AI provider calls. Shapes verified against docs.sarvam.ai (10-2026):
// - Chat: POST /v1/chat/completions, OpenAI-compatible {messages, model,
//   max_tokens, reasoning_effort}. Thinking mode is ON by default — pass
//   reasoning_effort:null to disable, otherwise a 400-token cap gets eaten
//   by reasoning and returns empty content with finish_reason "length".
// - TTS: POST /text-to-speech {text, language_code, speaker, model,
//   output_audio_codec}, responds {request_id, audios:[base64 wav]}.
// - TTS speaker names are per-model. Notably "anushka" (the frontend
//   CONFIG default) is bulbul:v2-only; bulbul:v3 wants short names like
//   "shubh". VOICES_BY_MODEL enforces that so a stale default 400s loudly
//   nowhere — it falls back to the model default instead.

export const CHAT_URL = "https://api.sarvam.ai/v1/chat/completions";
export const TTS_URL = "https://api.sarvam.ai/text-to-speech";

// Short-name voices valid on bulbul:v3 (REST reference, 10-2026). v2 keeps
// its own four; v4-flash takes persona IDs (name_lang_style) instead.
const V3_VOICES = new Set([
  "shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan",
  "simran", "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun",
  "manan", "sumit", "roopa", "kabir", "aayan", "ashutosh", "advait",
  "anand", "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti",
  "suhani", "mohit", "kavitha", "rehan", "soham", "rupali",
]);
const V2_VOICES = new Set(["anushka", "manisha", "vidya", "arya", "abhilash", "karun", "hitesh"]);

export const MODEL_DEFAULT_VOICE: Record<string, string> = {
  "bulbul:v3": "shubh",
  "bulbul:v2": "anushka",
  "bulbul:v4-flash": "shubh_enhi_ads",
};

/** Coerce a frontend-provided voice to one the model accepts. */
export function resolveVoice(model: string, voice: string): { speaker: string; coerced: boolean } {
  const fallback = MODEL_DEFAULT_VOICE[model] || "shubh";
  const v = (voice || "").trim().toLowerCase();
  if (!v) return { speaker: fallback, coerced: true };
  if (model === "bulbul:v3") return V3_VOICES.has(v) ? { speaker: v, coerced: false } : { speaker: fallback, coerced: true };
  if (model === "bulbul:v2") return V2_VOICES.has(v) ? { speaker: v, coerced: false } : { speaker: fallback, coerced: true };
  // v4-flash: persona IDs look like name_lang_style; accept that shape.
  if (model === "bulbul:v4-flash") {
    return /^[a-z]+_[a-z]+_[a-z]+$/.test(v) ? { speaker: v, coerced: false } : { speaker: fallback, coerced: true };
  }
  return { speaker: fallback, coerced: true };
}

/* The system prompt lives in shared/knowledge.js — the single source of
   truth, shared with the frontend's demo KB so the two cannot drift apart.
   api/test/knowledge.test.ts fails the build if they disagree, or if any
   private detail (phone, college, grades, graduation years) leaks in.

   It MUST stay byte-identical between requests. Anything dynamic — a
   timestamp, the visitor's name, shuffled facts — breaks provider prompt
   caching and multiplies the input bill. Compose it from FACTS, never
   interpolate per-request values into it. */
import { SYSTEM_PROMPT } from "../../shared/knowledge.js";
export { SYSTEM_PROMPT };

export interface ChatResult {
  reply: string;
  thoughts: string[];
}

export async function sarvamChat(
  apiKey: string,
  model: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  message: string,
): Promise<ChatResult> {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": apiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: message },
      ],
      max_tokens: 280, // spoken replies: <60 words instructed, 280 caps cost
      reasoning_effort: null, // thinking off so the first word arrives fast
      temperature: 0.2, // provider default when reasoning is off; pin it (defaults move)
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new ProviderError(res.status, err.slice(0, 300));
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const reply = data.choices?.[0]?.message?.content?.trim() || "";
  if (!reply) throw new ProviderError(502, "empty reply from provider");
  return { reply, thoughts: ["Answered by the language model."] };
}

export async function sarvamTts(
  apiKey: string,
  model: string,
  speaker: string,
  languageCode: string,
  text: string,
): Promise<Uint8Array> {
  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-subscription-key": apiKey },
    body: JSON.stringify({
      text,
      language_code: languageCode,
      speaker,
      model,
      output_audio_codec: "wav", // default; explicit so codec moves never surprise us
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new ProviderError(res.status, err.slice(0, 300));
  }
  const data = (await res.json()) as { audios?: string[] };
  const b64 = (data.audios || []).join("");
  if (!b64) throw new ProviderError(502, "no audio in provider response");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export class ProviderError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
