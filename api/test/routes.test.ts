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
    expect(await res.json()).toMatchObject({ ok: true, mode: "proxy" });
  });
  it("exposes cache hit-rate counters", async () => {
    const res = await app.request("/health", {}, {});
    const body = (await res.json()) as {
      cache: { answers: { hits: number }; tts: { hits: number } };
    };
    expect(typeof body.cache.answers.hits).toBe("number");
    expect(typeof body.cache.tts.hits).toBe("number");
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
    /* Deliberately NOT "hi": CACHE_SEED seeds the greeting and the project
       list, so those are answered from cache and never reach the provider.
       This test is about the passthrough, so it must ask something unseeded. */
    const res = await app.request(
      "/chat",
      {
        method: "POST",
        body: JSON.stringify({ message: "tell me about his skills", history: [{ role: "user", content: "yo" }] }),
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
    expect(sent.max_tokens).toBe(280);
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
  it("serves repeat questions from cache with ZERO provider calls", async () => {
    const provider = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "Cached me" } }] })),
    );
    vi.stubGlobal("fetch", provider);
    const mk = () =>
      app.request("/chat", { method: "POST", body: JSON.stringify({ message: "What SKILLS?" }) }, ENV);
    const first = await mk();
    expect(first.status).toBe(200);
    expect(first.headers.get("X-Cache")).toBe("MISS");
    const second = await app.request(
      "/chat",
      { method: "POST", body: JSON.stringify({ message: "what skills?!" }) },
      ENV,
    );
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect((await second.json()) as { reply: string }).toMatchObject({ reply: "Cached me" });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  // The flip side of the test above: the two most-asked questions are seeded,
  // so they must be answered WITHOUT a provider call on the very first ask —
  // not just on a repeat.
  it("answers the seeded questions with zero provider calls, first time", async () => {
    const provider = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "SHOULD NEVER BE CALLED" } }] })),
    );
    vi.stubGlobal("fetch", provider);
    for (const q of ["hi", "hello", "what projects has he built?", "tell me about his projects"]) {
      const res = await app.request("/chat", { method: "POST", body: JSON.stringify({ message: q }) }, ENV);
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Cache")).toBe("HIT");
      const out = (await res.json()) as { reply: string };
      expect(out.reply).not.toContain("SHOULD NEVER BE CALLED");
      expect(out.reply.length).toBeGreaterThan(20);
    }
    expect(provider).toHaveBeenCalledTimes(0);
  });

  it("truncates visitor messages to 500 chars before the model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }))),
    );
    await app.request(
      "/chat",
      { method: "POST", body: JSON.stringify({ message: "y".repeat(1500) }) },
      ENV,
    );
    const [, init] = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const userMsg = sent.messages[sent.messages.length - 1].content;
    expect(userMsg.length).toBe(500);
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
  it("memos repeat synthesis: provider called once, second served memo", async () => {
    const wav = btoa("RIFFmemo-bytes");
    const provider = vi.fn(
      async () => new Response(JSON.stringify({ request_id: "r2", audios: [wav] })),
    );
    vi.stubGlobal("fetch", provider);
    const mk = () =>
      app.request("/tts", { method: "POST", body: JSON.stringify({ text: "hello again", lang: "en-IN" }) }, ENV);
    const first = await mk();
    expect(first.headers.get("X-Cache")).toBe("MISS");
    const second = await mk();
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Cache")).toBe("HIT");
    expect(new TextDecoder().decode(new Uint8Array(await second.arrayBuffer()))).toBe("RIFFmemo-bytes");
    expect(provider).toHaveBeenCalledTimes(1);
  });
});
