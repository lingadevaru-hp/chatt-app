#!/usr/bin/env node
/* ================================================================
   DEPLOY-TIME assert — checks what is ACTUALLY in dist/ right now.

   WHY THIS EXISTS
   `npm run build:prod` guards the BUILD: it refuses to build unless
   VITE_MODE=api. But nothing guarded the DEPLOY. `wrangler deploy` ships
   whatever happens to be sitting in dist/ at that moment, so:

       npm run build            -> dist/ is DEMO
       VITE_MODE=api npm run build:prod   (typo'd dir, fails)
       wrangler deploy          -> ships the stale DEMO bundle, live

   That is not hypothetical. It happened: a deploy shipped the demo bundle
   for a few minutes because a build had failed and the deploy ran anyway.
   The site looked completely fine and answered from the local KB instead
   of the model — the worst kind of failure, because nothing looks broken.

   vite.config.mjs writes dist/.build-mode at the end of every build, and
   build.emptyOutDir clears dist/ first, so that marker always describes
   the MOST RECENT build. This script reads it before deploying.

   Usage:  npm run deploy      (which runs this first)
   ================================================================ */
/* CommonJS on purpose. The root package.json has no "type": "module", so
   node parses this as CJS — an `import` statement here is a SyntaxError and
   the guard crashes instead of refusing. It shipped that way once and made
   `npm run deploy` impossible to run at all. scripts/assert-prod.js is CJS
   for the same reason; match it. */
const { readFileSync } = require("node:fs");

const MARKER = "dist/.build-mode";
let mode = "";
try {
  mode = readFileSync(MARKER, "utf8").trim();
} catch {
  /* no marker: dist/ was never built here, or was hand-assembled */
}

if (mode !== "api") {
  console.error(
    `\nREFUSING to deploy: dist/ is not a live bundle.\n` +
      `  ${MARKER} says: ${mode ? `"${mode}"` : "(missing — dist/ was not built here)"}\n\n` +
      `Deploying this would put a site that answers from the local demo KB on\n` +
      `the live URL. It looks fine and is not.\n\n` +
      `Build the live bundle first, then deploy:\n` +
      `  VITE_MODE=api npm run build:prod\n` +
      `  npm run deploy\n`
  );
  process.exit(1);
}

console.log("dist/ is an api bundle — safe to deploy.");
