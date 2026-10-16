/* ================================================================
     J5 · BRAIN  (demo engine + live API)
     Split → js/brain.js
     ================================================================ */
import { CONFIG } from "./config.js";
import { KB, FALLBACK } from "./knowledge.js";
import { settings } from "./store.js";
import { sleep } from "./utils.js";
import { prerenderedUrl } from "./prerendered.js";

  const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  export function demoBrain(text) {
    const q = String(text || "").toLowerCase().trim();
    const tokens = q.split(/[^a-z0-9\u0900-\u097F\u0C80-\u0CFF]+/i).filter(Boolean);
    const scoreKey = (k) => {
      if (k.includes(" ")) {
        return new RegExp("(^|[^a-z0-9])" + rxEsc(k) + "([^a-z0-9]|$)", "i").test(q) ? 4 : 0;
      }
      for (const t of tokens) {
        if (t === k) return 2;
        if (t.length >= 4 && k.length >= 4 && (t.startsWith(k) || k.startsWith(t))) return 2;
      }
      return 0;
    };
    let best = null, bestScore = 0;
    for (const entry of KB) {
      let score = 0;
      for (const k of entry.keys) {
        if (entry.exactOnly) { if (q === k) score += 6; continue; }
        score += scoreKey(k);
      }
      if (score > bestScore) { bestScore = score; best = entry; }
    }
    if (best && bestScore >= 2) return { thoughts: best.thoughts, reply: best.reply };
    return { thoughts: FALLBACK.thoughts, reply: FALLBACK.reply };
  }

  /* Live mode. Your proxy adds the key and calls the provider.
     Request : { message, history[], model }
     Response: { reply: string, thoughts?: string[] }
     Attachments are sent as `files` (data URLs) when present — extend the
     proxy to forward them as multimodal parts if your model supports it. */
  export async function apiReply(text, history, files) {
    const res = await fetch(CONFIG.apiBase + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        history: history,
        model: CONFIG.chatModel,
        files: (files || []).map((f) => ({ name: f.name, type: f.type, dataUrl: f.dataUrl }))
      })
    });
    if (!res.ok) throw new Error("chat " + res.status);
    const data = await res.json();
    return { thoughts: data.thoughts || ["Answered by the language model."], reply: data.reply || data.text || "" };
  }

  /* Live TTS. The proxy returns audio bytes. Order of preference:
       1. committed pre-rendered file (₹0, any isolate),
       2. /tts (server memo, then provider).
     Sarvam rejects >2500 chars; the proxy 400s >2000. Truncate client-side
     too so a runaway reply degrades instead of erroring mid-call — replies
     are capped at ~280 tokens upstream, so this never binds in practice. */
  export async function apiSpeak(text) {
    const local = prerenderedUrl(text);
    if (local) return local;
    const clipped = String(text).slice(0, 2000);
    const res = await fetch(CONFIG.apiBase + "/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clipped, model: CONFIG.ttsModel, voice: CONFIG.ttsVoice, lang: settings.lang })
    });
    if (!res.ok) throw new Error("tts " + res.status);
    /* The proxy coerces model-incompatible voices (e.g. anushka on v3) and
       says so via X-Voice-Coerced. Log it once per reply so a silently
       substituted voice is never a mystery. */
    const coerced = res.headers.get("X-Voice-Coerced");
    if (coerced) console.info("[tts] voice coerced by proxy →", coerced);
    return URL.createObjectURL(await res.blob());
  }

  export async function askBrain(text, chat, files) {
    if (CONFIG.mode === "api") {
      const history = chat.messages.slice(-CONFIG.historyWindow)
        .map((m) => ({ role: m.role === "bot" ? "assistant" : "user", content: m.text }));
      return apiReply(text, history, files);
    }
    await sleep(600 + Math.random() * 500);      // pretend to think, for the demo
    return demoBrain(text);
  }

  