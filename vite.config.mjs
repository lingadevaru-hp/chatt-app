// Split → vite.config.js
// Dev server + static build for the split frontend (Phase 1b).
// - `npm run dev`   serves index.html with ES modules (file:// no longer works — expected).
// - `npm run build` emits dist/ as a static site (split CSS/JS, hashed assets).
// - `npm run build:single` emits one self-contained dist/index.html via
//   vite-plugin-singlefile, so a portable one-file build stays producible.
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const single = process.env.SINGLEFILE === "1";

export default defineConfig({
  plugins: [single && viteSingleFile()].filter(Boolean),
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
