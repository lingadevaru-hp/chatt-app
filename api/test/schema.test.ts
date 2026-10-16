import { describe, it, expect } from "vitest";
import { chatBody, ttsBody } from "../src/schema";
import { resolveVoice } from "../src/sarvam";

describe("chatBody", () => {
  it("accepts a minimal message", () => {
    expect(chatBody.safeParse({ message: "hi" }).success).toBe(true);
  });
  it("rejects empty / oversized messages", () => {
    expect(chatBody.safeParse({ message: "" }).success).toBe(false);
    expect(chatBody.safeParse({ message: "x".repeat(2001) }).success).toBe(false);
  });
  it("caps history at 12 and files at 4", () => {
    const hist = Array.from({ length: 13 }, (_, i) => ({ role: "user" as const, content: `m${i}` }));
    expect(chatBody.safeParse({ message: "hi", history: hist }).success).toBe(false);
    const files = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt` }));
    expect(chatBody.safeParse({ message: "hi", files }).success).toBe(false);
  });
  it("rejects unknown models", () => {
    expect(chatBody.safeParse({ message: "hi", model: "gpt-99" }).success).toBe(false);
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
