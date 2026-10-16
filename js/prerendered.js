/* Pre-rendered answers — zero API calls, forever.
   WHY this file exists: the /tts server memo covers repeats inside one
   isolate, but a cold isolate still pays once per sentence. Committed audio
   files cost nothing on any isolate, ever.

   HOW to fill it (owner step, needs SARVAM_API_KEY + a week of live logs):
     1. pick the ~10 most common replies from the proxy logs
     2. run:  SARVAM_API_KEY=sk_... bash scripts/prerender.sh
        (writes audio/*.wav via /tts, one request per line in
        scripts/prerender-list.txt)
     3. add entries below: normalised reply text → committed file.
        Key on the EXACT model reply text (copy from logs), normalised the
        same way normalize() does here — trailing spaces and case are what
        break matches, so normalise, don't eyeball.

   Match is checked in apiSpeak() BEFORE any network. A miss costs nothing
   extra — it just falls through to /tts (and then the server memo). */
export const PRERENDERED = {
  // "hello! i'm thoshan's portfolio assistant...": "audio/greeting.wav",
};

function normalize(text) {
  return String(text || "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** Committed-file URL for this exact reply text, or null. */
export function prerenderedUrl(text) {
  return PRERENDERED[normalize(text)] || null;
}
