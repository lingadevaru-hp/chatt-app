// src/turnstile.ts
// Cloudflare Turnstile bot protection + session management for the chatt chatbot.
// 
// This module adds a "verify you are human" layer to protect your Sarvam AI API credits.
// Users verify once via Turnstile, then get a signed session cookie valid for 1 hour.

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SESSION_COOKIE_NAME = "chatt_session";
const SESSION_TTL_MS = 3600 * 1000; // 1 hour

/**
 * Validate a Turnstile token via Cloudflare's siteverify API.
 * Returns true if the token is valid (user is human).
 * Returns true if no secret is configured (backward compatible — protection disabled).
 */
export async function verifyTurnstile(
  token: string | undefined | null,
  ip: string,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return true; // backward compatible: skip if not configured
  if (!token || typeof token !== "string" || token.length > 2048) return false;
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret,
        response: token,
        remoteip: ip || "",
      }),
    });
    const data = (await res.json()) as { success: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}

/** HMAC-SHA256 sign a message with a key, returns hex string. */
async function hmacSign(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/** Create a signed session token for the given IP. */
export async function makeSession(ip: string, secret: string): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  const sig = await hmacSign(secret, `${ip}:${exp}`);
  return `${exp}.${sig}`;
}

/** Validate a session token for the given IP. */
export async function checkSession(
  cookie: string | null,
  ip: string,
  secret: string | undefined,
): Promise<boolean> {
  if (!cookie || !secret) return false;
  const parts = cookie.split(".");
  if (parts.length !== 2) return false;
  const exp = Number(parts[0]);
  if (!exp || exp <= Date.now()) return false;
  const expected = await hmacSign(secret, `${ip}:${exp}`);
  return parts[1] === expected;
}

/** Extract the session cookie from request headers. */
export function getSessionCookie(req: Request): string | null {
  const cookies = req.headers.get("cookie") || "";
  const match = cookies.match(/chatt_session=([^;]+)/);
  return match ? match[1] : null;
}

export { SESSION_COOKIE_NAME, SESSION_TTL_MS };
