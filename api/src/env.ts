// src/env.ts — the Worker's environment/bindings, declared once.
//
// Hoisted out of index.ts when the gate needed the ASSETS binding: every
// module that touches env now imports this shared type instead of
// re-declaring half of it (cast drift between files was the risk).
import type { LimiterEnv } from "./limits";

export type Env = LimiterEnv & {
  SARVAM_API_KEY?: string;
  CHAT_MODEL?: string;
  TTS_MODEL?: string;
  TTS_VOICE?: string;
  STT_MODEL?: string;
  STT_LANG?: string;
  TURNSTILE_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;

  /* Served-assets binding. Effective ONLY together with
     run_worker_first = true in wrangler.toml: the Worker then receives
     every request first, and hands static paths over to ASSETS itself.
     That ordering is what keeps the branded gate ahead of any
     zone-level challenge and what lets ?embed=1 navigations skip it.
     Optional so tests can construct Env without it. */
  ASSETS?: { fetch(request: Request): Promise<Response> };
};
