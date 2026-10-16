/* ================================================================
   J2 · KNOWLEDGE BASE  (shim)
   Split → js/knowledge.js
   ────────────────────────────────────────────────────────────────
   The facts used to be written here. They now live in
   shared/knowledge.js so that this demo engine and the live system
   prompt (api/src/sarvam.ts) read from ONE source and cannot drift
   apart — which is exactly what had happened: the prompt named no
   projects while the demo named three that did not exist.

   EDIT FACTS IN shared/knowledge.js, NOT HERE.
   api/test/knowledge.test.ts fails the build if the two disagree,
   and refuses to let private data (phone, college, grades, years)
   into either one.
   ================================================================ */
export { KB, FALLBACK, PROFILE, FACTS } from "../shared/knowledge.js";
