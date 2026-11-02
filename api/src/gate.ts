// src/gate.ts — the branded "Verify you are human" gate for the whole site.
//
// Replaces the zone-level WAF Interactive Challenge with a Thoshan-styled
// page served by THIS worker. Same payoff, better doorway: the visitor
// solves a Turnstile widget on our own card, gets the SAME signed
// chatt_session cookie the API guard already accepts, and continues — one
// verification covers the page load and all API calls for the hour.
//
// Dormancy rule: everything here is inert while TURNSTILE_SECRET is a Worker
// secret that has not been set — a deploy that flips run_worker_first must
// NOT change live behaviour on its own, so `gate()` passes everything
// through until protection is actually configured.
//
// The drawer is never gated: the portfolio side panel loads ?embed=1, which
// skips past this middleware. Cross-site iframes cannot reliably complete
// interactive challenges (cookies are partitioned), so gating it would
// permanently brick the drawer; the API keeps its own Turnstile guard.
import type { Context } from "hono";
import type { Env } from "./env";
import {
  verifyTurnstile,
  makeSession,
  checkSession,
  getSessionCookie,
  SESSION_COOKIE_NAME,
} from "./turnstile";
import { allowRequest, clientIp } from "./limits";

/* Paths never gated: peer endpoints get their own policies */
const SKIP_PATHS = new Set(["/health", "/turnstile-config", "/__turnstile-verify"]);

/* A "navigation" is the browser loading the site itself (address bar,
   reload, iframe src= assignment). Everything else — XHR, POSTs to the
   API, media — flows through the route handlers, not this gate. */
export function isNavigation(req: Request): boolean {
  const mode = req.headers.get("sec-fetch-mode");
  if (mode) return mode === "navigate";
  if (req.method !== "GET") return false;
  /* No Fetch Metadata (older clients, plain tools). A missing Accept header
     is how curl and privacy scrubbers load documents — treat it as a
     document load so these stay equivalent to the zone challenge that
     covered them before. An explicit non-HTML Accept (a wildcard, i.e.
     application-like) is programmatic, not navigation. */
  const accept = req.headers.get("accept");
  if (accept === null) return true;
  return accept.includes("text/html");
}

/* The middleware. Registered as app.use("*", gate()) FIRST, before the
   route handlers, so a gated visit never reaches the API surfaces. */
export function gate() {
  return async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    /* Dormant while the secret is unset — zero behaviour change. */
    if (!c.env.TURNSTILE_SECRET) return next();

    const url = new URL(c.req.url);
    if (SKIP_PATHS.has(url.pathname)) return next();
    /* The portfolio drawer embeds with ?embed=1. */
    if (url.searchParams.get("embed") === "1") return next();
    if (!isNavigation(c.req.raw)) return next();

    const ip = clientIp(c.req.raw);
    /* Successful cookie helpers reuse: the same signed session the API
       guard accepts, so solving once covers the hour everywhere. */
    if (await checkSession(getSessionCookie(c.req.raw), ip, c.env.TURNSTILE_SECRET)) {
      return next();
    }
    return gatePage(c);
  };
}

/* Serve the branded verify page. 403 + no-store: it is a per-request gate,
   never a cacheable page, and no bot-friendly index is served here. */
function gatePage(c: Context<{ Bindings: Env }>): Response {
  return new Response(gatePageHtml(c.env.TURNSTILE_SITE_KEY || ""), {
    status: 403,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      /* Tight CSP for a page whose only external world is Turnstile's
         widget. Inline bootstrap/style is deliberate — the page is
         self-contained by design; everything dynamic is behind
         connect-src 'self'. */
      "Content-Security-Policy": [
        "default-src 'none'",
        "script-src 'unsafe-inline' https://challenges.cloudflare.com",
        "style-src 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-src https://challenges.cloudflare.com",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
      ].join("; "),
    },
  });
}

export async function verify(c: Context<{ Bindings: Env }>) {
  /* Endpoint only meaningful when the gate is live — dormant deploys
     answer 404 so probes can tell the two apart. */
  if (!c.env.TURNSTILE_SECRET) return c.json({ error: "gate disabled" }, 404);

  const ip = clientIp(c.req.raw);
  /* Sliding-window cap on solve attempts: token data costs a siteverify
     round-trip each, so a bad actor cannot burn our hour on retries.
     Same limiter shape as the API routes (`rl:<route>:<ip>`). */
  const { ok } = await allowRequest(c.env, `rl:gate:${ip}`);
  if (!ok) return c.json({ error: "slow down" }, 429);

  const body = (await c.req.json().catch(() => null)) as { token?: string } | null;
  const verified = await verifyTurnstile(body?.token, ip, c.env.TURNSTILE_SECRET);
  if (!verified) return c.json({ error: "verification failed" }, 403);

  const session = await makeSession(ip, c.env.TURNSTILE_SECRET);
  return c.json({ ok: true }, 200, {
    /* Attribute-identical to the guard's cookie (see index.ts) — one
       session secret signs both surfaces, so a solve here already
       satisfies the API. HttpOnly so page JS cannot read it;
       SameSite=Lax so a plain top-level reload still carries it. */
    "Set-Cookie":
      `${SESSION_COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=60`,
  });
}

/* ── The page itself ───────────────────────────────────────────────────
   Zero-dependency, dark-theme, mobile-first single file: the tokens are
   the app's own palette (styles/tokens.css), the font stack drops the
   webfont (one fewer third-party thing to load before the widget), and
   the layout fits a 360px phone with the widget fully visible above the
   keyboard. Inline script/style because the CSP forbids everything else
   and there is nothing else on this page anyway. */

const GATE_PALETTE = {
  bg: "#0a0a0b",
  surface: "#141416",
  accent: "#e8703a",
  text: "#ededf0",
  dim: "#9a9aa2",
  faint: "#6b6b73",
  ok: "#3fb950",
};

export function gatePageHtml(siteKey: string): string {
  const { bg, surface, accent, text, dim, faint } = GATE_PALETTE;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${bg}">
<meta name="robots" content="noindex">
<title>Verify — Thoshan</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    min-height:100dvh;display:grid;place-items:center;
    padding:24px 16px;background:${bg};color:${text};
    font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  }
  .card{
    width:100%;max-width:380px;background:${surface};
    border:1px solid rgba(255,255,255,.06);border-radius:20px;
    padding:28px 22px;text-align:center;
  }
  .mark{display:block;margin:0 auto 14px}
  h1{font-size:1.185rem;font-weight:650;letter-spacing:.2px}
  .sub{margin-top:8px;color:${dim};font-size:.9rem}
  .sub-kn{margin-top:2px;color:${faint};font-size:.8rem}
  .widget{margin-top:18px;min-height:72px}
  .hint{margin-top:14px;color:${dim};font-size:.8rem;line-height:1.5}
  .hint.ok{color:${GATE_PALETTE.ok}}
  a{color:${accent}}
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<main class="card">
  <svg class="mark" width="56" height="56" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="42" fill="${accent}"/>
    <text x="50" y="68" text-anchor="middle" font-size="52" font-weight="700"
      font-family="system-ui,sans-serif" fill="${bg}">T</text>
  </svg>
  <h1>Verify you are human</h1>
  <p class="sub">Thoshan's site is protected — one quick check before it opens.</p>
  <p class="sub-kn" lang="kn">ಒಂದು ಕ್ಷಣ — ನೀವು ಮಾನವನೇ?</p>
  <div class="widget">
    <div class="cf-turnstile" data-sitekey="${siteKey}" data-theme="dark"
      data-action="gate" data-callback="onGateToken"
      data-error-callback="onGateError" data-expired-callback="onGateExpired"></div>
  </div>
  <p id="hint" class="hint" aria-live="polite"></p>
</main>
<script async defer src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>
<script>
  /* Keep protocol < HTTP limits; token silence deal: on success,
     POST token -> we get the session cookie -> reload re-enters the
     navigation with it and is let through. No token = no reload. */
  var fails = 0;
  var hint = document.getElementById("hint");
  function say(msg, ok) { hint.textContent = msg; hint.className = "hint" + (ok ? " ok" : ""); }
  window.onGateToken = function (token) {
    fetch("/__turnstile-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token }),
    }).then(function (res) {
      if (res.ok) { say("Verified — opening…", true); location.reload(); return; }
      if (res.status === 429) { say("Too many tries — wait a minute, then refresh."); return; }
      window.onGateError();
    }).catch(window.onGateError);
  };
  window.onGateError = function () {
    fails++; if (fails >= 2) say("Still blocked? Email contact@lingadevaru.in.");
    else say("Could not verify — try again in a moment.");
  };
  window.onGateExpired = window.onGateError;
  /* Watchdog: widget script blocked or unresponsive (common behind
     filtering networks). Say something responsive, never leave dead page. */
  setTimeout(function () {
    if (window.turnstile) return;
    say("Verification widget did not load — refresh, or email contact@lingadevaru.in.");
  }, 12000);
</script>
</body>
</html>`;
}
