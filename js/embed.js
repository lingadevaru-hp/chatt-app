/* ================================================================
   J13 · EMBED  (portfolio drawer integration)
   Split → js/embed.js
   ────────────────────────────────────────────────────────────────
   The portfolio (lingadevaru.in) embeds this whole app in a slide-over
   drawer via an <iframe src="https://ai.lingadevaru.in?embed=1">.

   This module is the chat side of that contract. It does NOT change
   behaviour for direct visitors — everything here is inert unless a
   trusted *.lingadevaru.in parent actually talks to us.

   Contract (one-way, panel → full site):
   · parent → { type: "thoshan-theme", id: "dark" | "light" | "system" }
     → we re-resolve the theme WITHOUT saving (the parent re-posts on
       every iframe load, so a reload re-syncs and our own stored
       preference is never clobbered).
   · parent → { type: "thoshan-history-request" }
     → we reply { type: "thoshan-history-result", payload: { v: 2, chats } }
       so "Open full site" can carry the conversation over in a
       #thoshan-import= hash (see store.importChats).
   · #thoshan-import=<json> on OUR location → import on first boot,
       then the hash is stripped so a refresh never replays it.

   WHY export/import instead of shared storage: browsers partition a
   cross-site iframe's storage by parent site (Chrome 115+/Safari/FF),
   so the panel and a top-level tab on the same origin keep DIFFERENT
   localStorage jars. Data moved between them must be explicitly
   handed over — this is that hand-over.

   note: the drawer also appends &page=<wiki-slug>. Nothing consumes
   it yet; it is reserved so the panel can greet with page context.
   ================================================================ */

/* Parent origins allowed to drive us. lingadevaru.in + locale
   subdomains (kn./hi./ja./ml./ta./te./gu.) + www — nothing else. */
const TRUSTED_ORIGIN = /^https:\/\/(?:[a-z]{2,3}\.)?lingadevaru\.in$/;

const THEME_IDS = ["dark", "light", "system"];
const IMPORT_ANCHOR = "thoshan-import=";

/* Guard for every incoming message: a wild origin can frame the app on
   any page and try to push a theme or export histories. */
function trusted(event) {
  return event.origin ? TRUSTED_ORIGIN.test(event.origin) : false;
}

/* Drawer → full site: merge history passed in the URL hash. Safe to
   run when the hash is absent — returns immediately then. */
async function importFromHash() {
  const start = location.hash.indexOf(IMPORT_ANCHOR);
  if (start === -1) return;
  try {
    const raw = decodeURIComponent(location.hash.slice(start + IMPORT_ANCHOR.length));
    const clip = JSON.parse(raw);
    const { importChats } = await import("./store.js");
    const n = importChats(clip);
    if (n > 0) console.info(`[Portfolio Assistant] imported ${n} conversation(s) from the portfolio panel`);
  } catch {
    /* malformed hash — ignore silently, the app just starts fresh */
  } finally {
    /* Strip the hash either way: it is one-shot hand-over data, never
       a permalink, and refresh must not replay it. */
    const { pathname, search } = location;
    history.replaceState(null, "", pathname + search);
  }
}

function onMessage(event) {
  if (!trusted(event)) return;
  const data = event.data;

  /* Theme push from the drawer (parent re-posts on every iframe load). */
  if (data && data.type === "thoshan-theme" && THEME_IDS.includes(data.id)) {
    import("./settings.js").then(({ applyTheme, settings }) => {
      settings.theme = data.id;
      /* applied, not saved — see module header */
      applyTheme();
    }).catch(() => { /* module not available — skip */ });
    return;
  }

  /* History dump requested by "Open full site". Replies exactly to the
     window that asked (source), to the caller's own origin. */
  if (data && data.type === "thoshan-history-request" && event.source) {
    import("./store.js").then(({ exportChats }) => {
      event.source.postMessage(
        { type: "thoshan-history-result", payload: { v: 2, chats: exportChats() } },
        { targetOrigin: event.origin },
      );
    }).catch(() => {
      event.source.postMessage(
        { type: "thoshan-history-result", payload: { v: 2, chats: [] } },
        { targetOrigin: event.origin },
      );
    });
  }
}

/* Called once from main.js BEFORE boot() so a #thoshan-import merge
   lands in state before the first history render. */
export async function installEmbed() {
  /* detect the drawer context early (CSS hooks can key off
     html[data-embed="1"] later without re-parsing the query string) */
  if (new URLSearchParams(location.search).get("embed") === "1") {
    document.documentElement.dataset.embed = "1";
  }
  await importFromHash();
  window.addEventListener("message", onMessage);
}
