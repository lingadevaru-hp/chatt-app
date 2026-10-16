import { describe, it, expect } from "vitest";
import { allowRequest, underDailyCeiling } from "../src/limits";

// Memory fallback path (no Upstash env): single-isolate semantics.
// Production uses Upstash; these tests pin the local contract.

describe("allowRequest (memory)", () => {
  it("allows up to the limit, then 429s inside the window", async () => {
    const env = { RATE_LIMIT: "3", RATE_WINDOW_S: "60" };
    const t = 1_000_000;
    expect((await allowRequest(env, "k1", t)).ok).toBe(true);
    expect((await allowRequest(env, "k1", t + 1)).ok).toBe(true);
    expect((await allowRequest(env, "k1", t + 2)).ok).toBe(true);
    const denied = await allowRequest(env, "k1", t + 3);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterS).toBe(60);
  });
  it("slides: old hits expire", async () => {
    const env = { RATE_LIMIT: "1", RATE_WINDOW_S: "60" };
    await allowRequest(env, "k2", 0);
    expect((await allowRequest(env, "k2", 61_000)).ok).toBe(true);
  });
});

describe("underDailyCeiling (memory)", () => {
  it("trips after the ceiling and resets next day", async () => {
    const env = { DAILY_CEILING: "2" };
    const day1 = new Date("2026-10-16T10:00:00Z").getTime();
    const day2 = new Date("2026-10-17T00:00:01Z").getTime();
    expect(await underDailyCeiling(env, "chat", day1)).toBe(true);
    expect(await underDailyCeiling(env, "chat", day1 + 1)).toBe(true);
    expect(await underDailyCeiling(env, "chat", day1 + 2)).toBe(false);
    expect(await underDailyCeiling(env, "chat", day2)).toBe(true);
  });
});
