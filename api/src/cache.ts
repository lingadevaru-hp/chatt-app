// Exact-match answer cache — the biggest cost lever for a portfolio bot.
// The KB is fixed, so repeat questions are common; a hit returns with ZERO
// model calls. Keyed on model + normalised message only (exact match, no
// fuzzy logic to go stale). History is deliberately excluded from the key:
// portfolio answers don't depend on conversational context, and including
// it would crater the hit rate. Requests WITH files bypass the cache.
//
// Tradeoffs, stated plainly: per-isolate memory (same story as the limiter
// fallback — no shared state on Workers without an add-on). Short TTL +
// small cap bound both staleness and memory. At 6 visitors/month almost
// every repeat lands in the same isolate anyway.
export interface CachedAnswer {
  reply: string;
  thoughts: string[];
}

interface Entry extends CachedAnswer {
  exp: number;
}

export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

export class AnswerCache {
  private map = new Map<string, Entry>();
  hits = 0;
  misses = 0;

  constructor(
    private ttlMs = 6 * 3600 * 1000,
    private max = 200,
  ) {}

  key(model: string, message: string): string {
    return model + "|" + normalizeQuestion(message);
  }

  get(model: string, message: string, now = Date.now()): CachedAnswer | null {
    const e = this.map.get(this.key(model, message));
    if (!e || e.exp <= now) {
      if (e) this.map.delete(this.key(model, message));
      this.misses++;
      return null;
    }
    this.hits++;
    return { reply: e.reply, thoughts: e.thoughts };
  }

  set(model: string, message: string, answer: CachedAnswer, now = Date.now()): void {
    const k = this.key(model, message);
    if (!this.map.has(k) && this.map.size >= this.max) {
      // Evict the oldest-inserted key (Map preserves insertion order).
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(k, { ...answer, exp: now + this.ttlMs });
  }

  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.map.size };
  }
}

/** Byte memo for /tts. WHY server-side: POST responses are never
    CDN-cacheable (browsers/CDNs cache GETs), so the Cache-Control header
    alone does NOT prevent re-billing — this memo does. Same per-isolate
    tradeoff as AnswerCache. TTL matches the Cache-Control (24h). The cap
    is the memory bound, not the TTL: WAV runs ~44KB/s, so a 2500-char
    worst case is several MB; 30 entries bounds it. */
export class MemoCache {
  private map = new Map<string, { bytes: Uint8Array; exp: number }>();
  hits = 0;
  misses = 0;

  constructor(
    private ttlMs = 24 * 3600 * 1000,
    private max = 30,
  ) {}

  key(model: string, speaker: string, lang: string, text: string): string {
    return model + "|" + speaker + "|" + lang + "|" + normalizeQuestion(text);
  }

  get(key: string, now = Date.now()): Uint8Array | null {
    const e = this.map.get(key);
    if (!e || e.exp <= now) {
      if (e) this.map.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return e.bytes;
  }

  set(key: string, bytes: Uint8Array, now = Date.now()): void {
    if (!this.map.has(key) && this.map.size >= this.max) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    this.map.set(key, { bytes, exp: now + this.ttlMs });
  }

  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.map.size };
  }
}
