import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import app from "../src/index";
import { resetLimits } from "../src/limits";
import { makeSession, SESSION_COOKIE_NAME } from "../src/turnstile";

const BASE = {
  SARVAM_API_KEY: "test-key",
  RATE_LIMIT: "10",
  RATE_WINDOW_S: "60",
  DAILY_CEILING: "1000",
  CHAT_MODEL: "sarvam-105b-conversations",
  TTS_MODEL: "bulbul:v3",
  TTS_VOICE: "shubh",
};

/* Minimal asset stub: deterministic marker so tests can tell "reached the
   fallback" from "worker answered its own response". */
const assetsOk = async () => new Response("asset-ok");
const ASSETS = { fetch: assetsOk };
const SITE_KEY = "site-key";
const SECRET = "gate-secret";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => resetLimits());

describe("dormant gate (TURNSTILE_SECRET unset)", () => {
  const ENV = { ...BASE, ASSETS };
  it("navigations pass through to the asset fallback", async () => {
    const res = await app.request("/", {}, ENV);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset-ok");
  });
  it("deep SPA paths pass through too", async () => {
    const res = await app.request("/wiki/some-article?embed=0", {}, ENV);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset-ok");
  });
  it("verify endpoint reports disabled", async () => {
    const res = await app.request(
      "/__turnstile-verify",
      { method: "POST", body: JSON.stringify({ token: "x" }) },
      ENV,
    );
    expect(res.status).toBe(404);
  });
});

describe("gate server (TURNSTILE_SECRET set)", () => {
  const ENV = { ...BASE, ASSETS, TURNSTILE_SECRET: SECRET, TURNSTILE_SITE_KEY: SITE_KEY };

  it("unverified navigation gets the branded 403 page with key + hardening headers", async () => {
    const res = await app.request("/", {}, ENV);
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain(`data-sitekey="${SITE_KEY}"`);
    expect(html).toContain("Verify you are human");
    expect(html).toContain("ನೀವು ಮಾನವನೇ?");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    const csp = res.headers.get("content-security-policy") || "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("connect-src 'self'");
  });

  it("a valid session cookie passes the same navigation", async () => {
    const session = await makeSession("unknown", SECRET);   // no IP headers → clientIp "unknown" on both sides
    const res = await app.request("/", { headers: { cookie: `${SESSION_COOKIE_NAME}=${session}` } }, ENV);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset-ok");
  });

  it("?embed=1 skips the gate entirely (portfolio drawer)", async () => {
    const res = await app.request("/?embed=1", {}, ENV);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset-ok");
  });

  it("programmatic GET (asterisk Accept) passes to the asset fallback", async () => {
    const res = await app.request("/some.json", { headers: { accept: "*/*" } }, ENV);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset-ok");
  });

  it("kept peers ungated", async () => {
    const res = await app.request("/health", {}, ENV);
    expect(res.status).toBe(200);
    const res2 = await app.request("/turnstile-config", {}, ENV);
    expect(res2.status).toBe(200);
  });

  it("deep paths are covered by the gate when unverified", async () => {
    const res = await app.request("/wiki/some-article", {}, ENV);
    expect(res.status).toBe(403);
  });

  it("/__turnstile-verify: valid token → cookie → next navigation passes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: true }))),
    );
    const ip = "1.2.3.4";
    const res = await app.request(
      "/__turnstile-verify",
      { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify({ token: "tok" }) },
      ENV,
    );
    expect(res.status).toBe(200);
    const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);

    const next = await app.request(
      "/",
      { headers: { "cf-connecting-ip": ip, cookie } },
      ENV,
    );
    expect(next.status).toBe(200);
    expect(await next.text()).toBe("asset-ok");
  });

  it("/__turnstile-verify: siteverify failure → 403, no cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: false }))),
    );
    const res = await app.request(
      "/__turnstile-verify",
      { method: "POST", body: JSON.stringify({ token: "bad" }) },
      ENV,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("/__turnstile-verify: IP sliding window applies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: true }))),
    );
    const tight = { ...ENV, RATE_LIMIT: "1" };
    const ip = "9.9.9.9";
    const first = await app.request(
      "/__turnstile-verify",
      { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify({ token: "t" }) },
      tight,
    );
    expect(first.status).toBe(200);
    const second = await app.request(
      "/__turnstile-verify",
      { method: "POST", headers: { "cf-connecting-ip": ip }, body: JSON.stringify({ token: "t" }) },
      tight,
    );
    expect(second.status).toBe(429);
  });

  it("API guard semantics unchanged: POST /chat without token → 403 needTurnstile JSON", async () => {
    const res = await app.request(
      "/chat",
      { method: "POST", body: JSON.stringify({ message: "hi" }) },
      ENV,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ needTurnstile: true });
  });
});
