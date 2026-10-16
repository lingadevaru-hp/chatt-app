// Split → vite.config.js
// Dev server + static build for the split frontend (Phase 1b).
// - `npm run dev`   serves index.html with ES modules (file:// no longer works — expected).
// - `npm run build` emits dist/ as a static site (split CSS/JS, hashed assets).
// - `npm run build:single` emits one self-contained dist/index.html via
//   vite-plugin-singlefile, so a portable one-file build stays producible.
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { writeFileSync } from "node:fs";

const single = process.env.SINGLEFILE === "1";

/* Stamps dist/ with the mode it was built in, so the DEPLOY step can refuse
   to ship a demo bundle to the live URL. `npm run build:prod` guards the
   build; nothing guarded the deploy, and `wrangler deploy` ships whatever is
   in dist/ at that moment — which is how a stale demo bundle went live once.
   build.emptyOutDir clears dist/ first, so this marker always describes the
   most recent build. See scripts/assert-dist-prod.js. */
const buildModeMarker = () => {
  const mode = process.env.VITE_MODE === "api" ? "api" : "demo";
  return {
    name: "build-mode-marker",
    closeBundle() {
      writeFileSync("dist/.build-mode", mode + "\n");
    },
  };
};

export default defineConfig({
  plugins: [single && viteSingleFile(), buildModeMarker()].filter(Boolean),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: !single,
    assetsInlineLimit: single ? 100000000 : 4096,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
