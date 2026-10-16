import { describe, it, expect } from "vitest";
import { AnswerCache, MemoCache, normalizeQuestion } from "../src/cache";

describe("normalizeQuestion", () => {
  it("case/space/punctuation-insensitive", () => {
    expect(normalizeQuestion("  What PROJECTS?! ")).toBe("what projects");
    expect(normalizeQuestion("what   projects")).toBe("what projects");
  });
});

describe("AnswerCache", () => {
  it("misses, then hits the same question in any casing", () => {
    const c = new AnswerCache();
    expect(c.get("m", "What projects?")).toBeNull();
    c.set("m", "What projects?", { reply: "r", thoughts: ["t"] });
    expect(c.get("m", "what PROJECTS?!")).toEqual({ reply: "r", thoughts: ["t"] });
    expect(c.stats()).toMatchObject({ hits: 1, misses: 1, size: 1 });
  });
  it("keys on model (same question, different model = miss)", () => {
    const c = new AnswerCache();
    c.set("m1", "hi", { reply: "r", thoughts: [] });
    expect(c.get("m2", "hi")).toBeNull();
  });
  it("expires after TTL", () => {
    const c = new AnswerCache(1000, 10);
    c.set("m", "hi", { reply: "r", thoughts: [] }, 0);
    expect(c.get("m", "hi", 999)).not.toBeNull();
    expect(c.get("m", "hi", 1001)).toBeNull();
  });
  it("evicts oldest past the size cap", () => {
    const c = new AnswerCache(60_000, 2);
    c.set("m", "one", { reply: "1", thoughts: [] });
    c.set("m", "two", { reply: "2", thoughts: [] });
    c.set("m", "three", { reply: "3", thoughts: [] });
    expect(c.get("m", "one")).toBeNull();
    expect(c.get("m", "three")).not.toBeNull();
    expect(c.stats().size).toBe(2);
  });
});

describe("MemoCache", () => {
  it("round-trips bytes and expires", () => {
    const m = new MemoCache(1000, 5);
    const bytes = new Uint8Array([1, 2, 3]);
    expect(m.get("k")).toBeNull();
    m.set("k", bytes, 0);
    expect(m.get("k", 500)).toBe(bytes);
    expect(m.get("k", 1001)).toBeNull();
  });
  it("bounds memory via size cap", () => {
    const m = new MemoCache(60_000, 2);
    m.set("a", new Uint8Array([1]));
    m.set("b", new Uint8Array([2]));
    m.set("c", new Uint8Array([3]));
    expect(m.stats().size).toBe(2);
  });
});
