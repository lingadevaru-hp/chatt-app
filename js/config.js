/* ================================================================
     J1 · CONFIG
     Split → js/config.js
     The single switch that takes this from demo to production.
     ================================================================ */
  export const CONFIG = {
    /* "demo" = answer locally from J2. No network, no key, no cost.
       "api"  = POST to CONFIG.apiBase and let a real model answer. */
    mode: "demo",

    /* Base path of YOUR serverless proxy. The proxy holds the API key.
       Never put a key in this file — everything here is public. */
    apiBase: "/api",

    /* Model / voice names passed through to the proxy. The frontend does
       not care which provider sits behind it. */
    chatModel: "sarvam-105b-conversations",
    ttsModel: "bulbul:v3",
    ttsVoice: "anushka",

    maxRecordSeconds: 30,   // hard stop for one voice recording
    historyWindow: 12,      // previous messages sent as context
    maxAttachments: 4,      // per message
    maxAttachmentMB: 4,     // per file

    /* One voice capture per turn. After a recording ends — stopped by the
       visitor or cut off at maxRecordSeconds — the mic is withdrawn, so a
       second spoken turn inside the same message is not possible. It comes
       back when the composer is cleared for the next prompt.
       Set false to allow repeated captures. */
    oneVoicePerTurn: true
  };

  