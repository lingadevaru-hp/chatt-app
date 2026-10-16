// Rate limiting + daily ceiling.
//
// WHY this shape: a Worker isolate has no shared memory, so an in-memory
// Map only works per-isolate (fine for local dev, wrong for production).
// Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN and every isolate
// shares one sliding-window counter. Return 429 when it trips; the prepaid
// balance (auto-recharge OFF) is the final backstop, not this code.

export interface LimiterEnv {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  RATE_LIMIT?: string;
  RATE_WINDOW_S?: string;
  DAILY_CEILING?: string;
}

const mem = new Map<string, number[]>();
const memDay = new Map<string, { n: number; day: string }>();

/** Test-only: clear the single-isolate fallback state for hermetic tests. */
export function resetLimits(): void {
  mem.clear();
  memDay.clear();
}

async function upstash(env: LimiterEnv, command: unknown[]): Promise<number> {
  const res = await fetch(`${env.UPSTASH_REDIS_REST_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command]),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  const [out] = (await res.json()) as Array<{ result: number }>;
  return out.result;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

/** Sliding-window per-IP check. Resolves true when the request may proceed. */
export async function allowRequest(
  env: LimiterEnv,
  key: string,
  now = Date.now(),
): Promise<{ ok: boolean; retryAfterS: number }> {
  const limit = Number(env.RATE_LIMIT || 20);
  const windowS = Number(env.RATE_WINDOW_S || 60);
  const windowMs = windowS * 1000;

  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    const member = `${now}:${Math.random().toString(36).slice(2)}`;
    const base = env.UPSTASH_REDIS_REST_URL;
    const headers = {
      Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    };
    const res = await fetch(`${base}/pipeline`, {
      method: "POST",
      headers,
      body: JSON.stringify([
        ["ZADD", key, now, member],
        ["ZREMRANGEBYSCORE", key, 0, now - windowMs],
        ["ZCARD", key],
        ["EXPIRE", key, windowS],
      ]),
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const out = (await res.json()) as Array<{ result: number }>;
    const count = out[2].result;
    return { ok: count <= limit, retryAfterS: windowS };
  }

  // Single-isolate fallback (wrangler dev). NOT shared across edge isolates.
  const hits = (mem.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  mem.set(key, hits);
  return { ok: hits.length <= limit, retryAfterS: windowS };
}

/** Hard daily ceiling across ALL callers. Resolves true while under budget. */
export async function underDailyCeiling(
  env: LimiterEnv,
  route: string,
  now = Date.now(),
): Promise<boolean> {
  /* Fallback matches api/wrangler.toml. It used to be 300, which meant a
     deploy with the var missing silently allowed ~₹131/day — 40x the
     owner's monthly budget. Keep the two in step. */
  const ceiling = Number(env.DAILY_CEILING || 50);
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `ceil:${route}:${day}`;

  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    const n = await upstash(env, ["INCR", key]);
    if (n === 1) {
      await upstash(env, ["EXPIRE", key, 86400]).catch(() => {});
    }
    return n <= ceiling;
  }

  const rec = memDay.get(key);
  if (!rec || rec.day !== day) {
    memDay.set(key, { n: 1, day });
    return true;
  }
  rec.n += 1;
  return rec.n <= ceiling;
}
