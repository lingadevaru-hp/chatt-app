/* ================================================================
   TURNSTILE — replaced by plain fetch after moving off Cloudflare.
   Split → js/turnstile.js
   Kept the file name + `apiFetch` export so brain.js / speech.js imports
   never change. The Worker (Cloudflare) used Turnstile for bot
   protection; Render has none, so this is now a straight pass-through.
   ================================================================ */
export async function apiFetch(url, options) {
  return fetch(url, options);
}
