import { describe, it, expect } from "vitest";
import { chatBody, ttsBody } from "../src/schema";
import { resolveVoice, resolveTtsTarget } from "../src/sarvam";

describe("chatBody", () => {
  it("accepts a minimal message", () => {
    expect(chatBody.safeParse({ message: "hi" }).success).toBe(true);
  });
  it("rejects empty / oversized messages", () => {
    expect(chatBody.safeParse({ message: "" }).success).toBe(false);
    expect(chatBody.safeParse({ message: "x".repeat(2001) }).success).toBe(false);
  });
  it("caps history at 6 and files at 4", () => {
    const hist = Array.from({ length: 7 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    expect(chatBody.safeParse({ message: "hi", history: hist }).success).toBe(false);
    const files = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt` }));
    expect(chatBody.safeParse({ message: "hi", files }).success).toBe(false);
  });
  // The model is NOT client-selectable. This endpoint is public, so letting
  // a caller name the model would let a stranger point it at the most
  // expensive one. Zod strips unknown keys, so the request still succeeds —
  // the value is discarded, never honoured. (This replaces an older test that
  // asserted unknown models were rejected outright, from when the field was a
  // z.enum. Rejecting and stripping are different routes to the same
  // guarantee: the client cannot choose the model.)
  it("ignores a client-supplied model instead of honouring it", () => {
    const parsed = chatBody.safeParse({ message: "hi", model: "gpt-99" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).not.toHaveProperty("model");
  });
});

describe("ttsBody", () => {
  it("accepts text + lang", () => {
    expect(ttsBody.safeParse({ text: "hello", lang: "hi-IN" }).success).toBe(true);
  });
  it("caps text at 2000 chars (v3 ceiling is 2500)", () => {
    expect(ttsBody.safeParse({ text: "x".repeat(2001) }).success).toBe(false);
  });
  it("rejects unknown languages", () => {
    expect(ttsBody.safeParse({ text: "hi", lang: "xx-YY" }).success).toBe(false);
  });
  it("ignores a client-supplied voice and model", () => {
    const parsed = ttsBody.safeParse({ text: "hi", voice: "anushka", model: "bulbul:v2" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).not.toHaveProperty("voice");
    expect(parsed.success && parsed.data).not.toHaveProperty("model");
  });
});

describe("resolveVoice", () => {
  // anushka is the frontend CONFIG default but is bulbul:v2-only per the
  // REST reference — the proxy must coerce, never 400 on a stale default.
  it("coerces anushka on bulbul:v3 to shubh", () => {
    expect(resolveVoice("bulbul:v3", "anushka")).toEqual({ speaker: "shubh", coerced: true });
  });
  it("keeps valid v3 voices", () => {
    expect(resolveVoice("bulbul:v3", "priya")).toEqual({ speaker: "priya", coerced: false });
  });
  it("keeps anushka on bulbul:v2", () => {
    expect(resolveVoice("bulbul:v2", "anushka")).toEqual({ speaker: "anushka", coerced: false });
  });
  it("accepts v4-flash persona IDs, rejects short names", () => {
    expect(resolveVoice("bulbul:v4-flash", "simran_en_customer").coerced).toBe(false);
    expect(resolveVoice("bulbul:v4-flash", "simran")).toEqual({
      speaker: "shubh_enhi_ads",
      coerced: true,
    });
  });
});

describe("resolveTtsTarget", () => {
  // v4 personas are per-language: the speaker must follow the request lang.
  it("maps en/hi to the Shubh companion persona", () => {
    expect(resolveTtsTarget("bulbul:v4-flash", "", "en-IN")).toEqual({
      model: "bulbul:v4-flash", speaker: "shubh_enhi_companion", coerced: true,
    });
    expect(resolveTtsTarget("bulbul:v4-flash", "", "hi-IN").speaker).toBe("shubh_enhi_companion");
  });
  it("maps kn/ta/te to their conversational personas", () => {
    expect(resolveTtsTarget("bulbul:v4-flash", "", "kn-IN").speaker).toBe("chetan_kn_conversation");
    expect(resolveTtsTarget("bulbul:v4-flash", "", "ta-IN").speaker).toBe("gokul_ta_narration");
    expect(resolveTtsTarget("bulbul:v4-flash", "", "te-IN").speaker).toBe("kavitha_te_conversation");
  });
  it("falls back to v3 for ml/od, which have no v4 personas", () => {
    expect(resolveTtsTarget("bulbul:v4-flash", "", "ml-IN")).toEqual({
      model: "bulbul:v3", speaker: "shubh", coerced: true,
    });
    expect(resolveTtsTarget("bulbul:v4-flash", "", "od-IN").model).toBe("bulbul:v3");
  });
  it("honours a valid persona-ID override from env", () => {
    expect(resolveTtsTarget("bulbul:v4-flash", "simran_en_customer", "en-IN")).toEqual({
      model: "bulbul:v4-flash", speaker: "simran_en_customer", coerced: false,
    });
  });
  it("ignores lang for non-v4 models", () => {
    expect(resolveTtsTarget("bulbul:v3", "priya", "kn-IN")).toEqual({
      model: "bulbul:v3", speaker: "priya", coerced: false,
    });
  });
});
