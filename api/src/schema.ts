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
  /* Deliberately a plain string, not an enum. The Worker's CHAT_MODEL env is
     authoritative, and an enum here blocked swapping to a cheaper model
     without a code change. The frontend no longer sends this at all — it is
     only reachable by a direct API caller. */
  model: z.string().max(64).optional(),
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
  voice: z.string().max(60).optional().default(""),
  model: z.enum(["bulbul:v2", "bulbul:v3", "bulbul:v4-flash"]).optional(),
});

export type ChatBody = z.infer<typeof chatBody>;
export type TtsBody = z.infer<typeof ttsBody>;
