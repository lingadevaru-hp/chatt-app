/* ================================================================
   MAIN · module entry (Phase 1b)
   Split → js/main.js  (new file — the single-file build had no equivalent;
   the IIFE ran inline. Keeping it tiny on purpose: all boot logic stays
   in J10 so the section map in the file header keeps working.)
   index.html loads this as <script type="module" src="/js/main.js">.
   NOTE: ES modules do not load over file:// — use `npm run dev`.
   ================================================================ */
import { boot } from "./settings.js";
import { installEmbed } from "./embed.js";

/* The panel hand-off must land BEFORE boot(): a #thoshan-import merge
   has to be in state when the first history render happens. For regular
   visitors installEmbed() is inert — an unseen microtask at worst. */
installEmbed().finally(boot);
