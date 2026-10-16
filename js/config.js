/* ================================================================
     J1 · CONFIG
     Split → js/config.js
     The single switch that takes this from demo to production.
     ================================================================ */
export const CONFIG = {
  /* "demo" = answer locally from J2. No network, no key, no cost.
     "api"  = POST to CONFIG.apiBase and let a real model answer.
     Source default is ALWAYS "demo" (hard rule: no key, no network, no
     cost for anyone opening this). The deployed Worker bundle bakes in
     "api" via `VITE_MODE=api npm run build` — nothing else changes,
     because J5 already has apiReply() and apiSpeak(). */
  mode: import.meta.env.VITE_MODE === "api" ? "api" : "demo",

    /* Base path of YOUR serverless proxy. The proxy holds the API key.
       Never put a key in this file — everything here is public. */
    apiBase: "/api",

    /* Model / voice names passed through to the proxy. The frontend does
       not care which provider sits behind it. */
    chatModel: "sarvam-105b-conversations",
    ttsModel: "bulbul:v3",
    ttsVoice: "anushka",

    maxRecordSeconds: 30,   // hard stop for one voice recording
    historyWindow: 6,       // previous messages sent as context. Six turns is
                            // plenty for a portfolio FAQ bot; every extra turn
                            // is billed on every request. Quality check: review
                            // the first week of live logs for mid-thread
                            // follow-ups that lose context.
    maxAttachments: 4,      // per message
    maxAttachmentMB: 4,     // per file

    /* One voice capture per turn. After a recording ends — stopped by the
       visitor or cut off at maxRecordSeconds — the mic is withdrawn, so a
       second spoken turn inside the same message is not possible. It comes
       back when the composer is cleared for the next prompt.
       Set false to allow repeated captures. */
    oneVoicePerTurn: true,

    /* NEVER auto-send a voice transcript. When a recording ends the text
       lands in the composer for review/editing; the visitor taps Send.
       true restores the old send-on-stop behaviour. */
    autoSendVoice: false,

    /* Attach menu. true = the + opens the Photos / Take photo / Files menu
       (each row sets accept/capture, then hands off to the native OS picker).
       false = the + skips the menu and opens the OS file manager directly. */
    attachMenu: true,
  };

  