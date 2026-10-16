import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import app from "../src/index";
import { resetLimits } from "../src/limits";

const ENV = {
  SARVAM_API_KEY: "test-key",
  RATE_LIMIT: "10",
  RATE_WINDOW_S: "60",
  DAILY_CEILING: "1000",
  CHAT_MODEL: "sarvam-105b-conversations",
  TTS_MODEL: "bulbul:v3",
  TTS_VOICE: "shubh",
};

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => resetLimits());

describe("GET /health", () => {
  it("is keyless", async () => {
    const res = await app.request("/health", {}, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: "proxy" });
  });
});

describe("POST /chat", () => {
  it("400s on bad bodies", async () => {
    for (const body of [{}, { message: "" }, { message: "x".repeat(2001) }]) {
      const res = await app.request("/chat", { method: "POST", body: JSON.stringify(body) }, ENV);
      expect(res.status).toBe(400);
    }
  });
  it("500s without a key (never call the provider keyless)", async () => {
    const { SARVAM_API_KEY: _drop, ...noKey } = ENV;
    const res = await app.request(
      "/chat",
      { method: "POST", body: JSON.stringify({ message: "hi" }) },
      noKey,
    );
    expect(res.status).toBe(500);
  });
  it("proxies message+history and returns {reply, thoughts}", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "Hello!" } }] }))),
    );
    const res = await app.request(
      "/chat",
      {
        method: "POST",
        body: JSON.stringify({ message: "hi", history: [{ role: "user", content: "yo" }] }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as { reply: string; thoughts: string[] };
    expect(out.reply).toBe("Hello!");
    expect(Array.isArray(out.thoughts)).toBe(true);
    const [url, init] = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.sarvam.ai/v1/chat/completions");
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.model).toBe("sarvam-105b-conversations");
    expect(sent.max_tokens).toBe(400);
    expect(sent.reasoning_effort).toBeNull(); // thinking off, else the cap gets eaten
    expect((init.headers as Record<string, string>)["api-subscription-key"]).toBe("test-key");
  });
  it("429s past the per-IP limit with Retry-After", async () => {
    const tight = { ...ENV, RATE_LIMIT: "1" };
    const mk = () =>
      app.request("/chat", { method: "POST", body: JSON.stringify({ message: "x".repeat(50) }) }, tight);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }))));
    await mk();
    const second = await mk();
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBe("60");
  });
  it("429s past the daily ceiling", async () => {
    const capped = { ...ENV, DAILY_CEILING: "1", RATE_LIMIT: "100" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }))));
    const mk = () => app.request("/chat", { method: "POST", body: JSON.stringify({ message: "hi" }) }, capped);
    expect((await mk()).status).toBe(200);
    expect((await mk()).status).toBe(429);
  });
});

describe("POST /tts", () => {
  it("400s on bad bodies", async () => {
    const res = await app.request(
      "/tts",
      { method: "POST", body: JSON.stringify({ text: "" }) },
      ENV,
    );
    expect(res.status).toBe(400);
  });
  it("decodes base64 audios → wav bytes with a CDN cache header", async () => {
    const wav = btoa("RIFFfake-wav-bytes");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ request_id: "r1", audios: [wav] }))),
    );
    const res = await app.request(
      "/tts",
      { method: "POST", body: JSON.stringify({ text: "hello", lang: "en-IN" }) },
      ENV,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/wav");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()))).toBe("RIFFfake-wav-bytes");
  });
});
