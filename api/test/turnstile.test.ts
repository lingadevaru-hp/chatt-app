import { describe, it, expect } from "vitest";
import {
  verifyTurnstile,
  makeSession,
  checkSession,
  getSessionCookie,
} from "../src/turnstile";

const SECRET = "test-secret";

describe("turnstile sessions", () => {
  it("skips verification when no secret is configured", async () => {
    // Backward compatible: protection off means everything passes, no network.
    expect(await verifyTurnstile(undefined, "1.2.3.4", undefined)).toBe(true);
  });
  it("round-trips a session for the same IP", async () => {
    const s = await makeSession("1.2.3.4", SECRET);
    expect(await checkSession(s, "1.2.3.4", SECRET)).toBe(true);
  });
  it("rejects a session for a different IP", async () => {
    const s = await makeSession("1.2.3.4", SECRET);
    expect(await checkSession(s, "5.6.7.8", SECRET)).toBe(false);
  });
  it("rejects a session signed with another secret", async () => {
    const s = await makeSession("1.2.3.4", SECRET);
    expect(await checkSession(s, "1.2.3.4", "other-secret")).toBe(false);
  });
  it("rejects malformed and tampered cookies", async () => {
    expect(await checkSession(null, "1.2.3.4", SECRET)).toBe(false);
    expect(await checkSession("not-a-session", "1.2.3.4", SECRET)).toBe(false);
    const s = await makeSession("1.2.3.4", SECRET);
    const tampered = s.slice(0, -1) + (s.endsWith("0") ? "1" : "0");
    expect(await checkSession(tampered, "1.2.3.4", SECRET)).toBe(false);
  });
  it("rejects without a secret configured", async () => {
    const s = await makeSession("1.2.3.4", SECRET);
    expect(await checkSession(s, "1.2.3.4", undefined)).toBe(false);
  });
});

describe("getSessionCookie", () => {
  const req = (cookie: string | null) =>
    new Request("https://x.test/", cookie ? { headers: { cookie } } : {});
  it("extracts the session cookie among others", () => {
    expect(getSessionCookie(req("a=1; chatt_session=abc.def; b=2"))).toBe("abc.def");
  });
  it("returns null when absent", () => {
    expect(getSessionCookie(req("a=1"))).toBeNull();
    expect(getSessionCookie(req(null))).toBeNull();
  });
});
