// Request validation (Zod). Caps mirror the frontend CONFIG so one scraper
// cannot turn a 400-token spoken reply into a 2500-char synthesis bill.
import { z } from "zod";

const historyItem = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const attachedFile = z.object({
  name: z.string().min(1).max(120),
  type: z.string().max(80).optional().default(""),
  // data URLs stay client-side unless a multimodal model is wired later;
  // accepted (and ignored) today so the frontend contract never breaks.
  dataUrl: z.string().max(6_000_000).optional().default(""),
});

export const chatBody = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(historyItem).max(6).default([]),
  files: z.array(attachedFile).max(4).default([]),
  /* NO `model` field, deliberately.

     This endpoint is PUBLIC. If a caller could name the model, a stranger
     could point it at the most expensive one and burn the prepaid balance.
     The model comes from the Worker's CHAT_MODEL env and nothing else.

     The old `z.enum([...])` enforced that by rejecting unknown names, but it
     also meant swapping to a cheaper model needed a code change. Dropping
     the field entirely does both jobs: Zod strips unknown keys by default,
     so a client that still sends `model` gets it silently discarded rather
     than a 400 — and it can never be honoured.

     To change the model: edit CHAT_MODEL in api/wrangler.toml and
     `wrangler deploy`. No code change, no frontend rebuild. */
});

const LANGS = [
  "en-IN", "hi-IN", "kn-IN", "ta-IN", "te-IN", "mr-IN", "bn-IN",
  "gu-IN", "ml-IN", "od-IN", "pa-IN",
] as const;

export const ttsBody = z.object({
  // Spoken replies are capped upstream (max_tokens 280 ≈ 1100 chars);
  // 2000 chars stays under Bulbul v3's 2500-char request ceiling.
  text: z.string().min(1).max(2000),
  lang: z.enum(LANGS).default("en-IN"),
  /* No `voice` and no `model` — same reason as chatBody. This endpoint is
     public, so neither is client-selectable. TTS_MODEL and TTS_VOICE in
     api/wrangler.toml decide. A caller that still sends them gets them
     stripped, not honoured. */
});

export type ChatBody = z.infer<typeof chatBody>;
export type TtsBody = z.infer<typeof ttsBody>;
