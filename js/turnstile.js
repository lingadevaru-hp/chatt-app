/* ================================================================
   TURNSTILE — human-verification token for the Worker guard
   Split → js/turnstile.js
   The Worker (api mode) 403s without a session cookie or a fresh
   Turnstile token. This module renders the widget explicitly (only in
   api mode — demo stays dependency-free), attaches the token to every
   API fetch, and retries once after re-verifying on a 403.
   The site key is public; it is fetched from /turnstile-config so it
   is never hard-coded here.
   ================================================================ */
import { CONFIG } from "./config.js";

let token = null;
let widgetId = null;
let scriptLoading = null;

function loadScript() {
  if (window.turnstile) return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error("turnstile script failed"));
    document.head.appendChild(s);
  });
  return scriptLoading;
}

async function renderWidget() {
  /* Fetch the public site key the Worker advertises. Empty = protection
     off server-side; nothing to render. */
  let siteKey = "";
  try {
    const r = await fetch(CONFIG.apiBase + "/turnstile-config");
    siteKey = ((await r.json()) || {}).siteKey || "";
  } catch (e) { /* offline/demo — no widget */ }
  if (!siteKey) return;
  await loadScript();
  if (widgetId !== null) {
    try { window.turnstile.reset(widgetId); } catch (e) {}
    return;
  }
  const box = document.createElement("div");
  box.id = "turnstile-box";
  box.style.cssText = "position:fixed;bottom:0;right:0;z-index:1;opacity:.01;pointer-events:none;";
  document.body.appendChild(box);
  widgetId = window.turnstile.render(box, {
    sitekey: siteKey,
    callback: (t) => { token = t; },
    "error-callback": () => { token = null; },
    "expired-callback": () => {
      token = null;
      try { window.turnstile.reset(widgetId); } catch (e) {}
    },
  });
}

/* Ensure a fresh token is available, waiting up to ~12s for the widget. */
async function freshToken() {
  if (token) return token;
  try { await renderWidget(); } catch (e) { return null; }
  for (let i = 0; i < 24 && !token; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return token;
}

/* Drop-in fetch for /chat, /tts, /stt. Attaches the token when present;
   on a 403 with needTurnstile, re-verifies and retries exactly once. */
export async function apiFetch(url, options) {
  const opts = Object.assign({}, options || {});
  const send = (t) => {
    const headers = Object.assign({}, opts.headers || {});
    if (t) headers["cf-turnstile-response"] = t;
    return fetch(url, Object.assign({}, opts, { headers }));
  };
  let res = await send(token);
  if (res.status === 403) {
    const data = await res.clone().json().catch(() => ({}));
    if (data && data.needTurnstile) {
      token = null;
      const t = await freshToken();
      if (t) res = await send(t);
    }
  }
  return res;
}
