/* ================================================================
     J4 · STORE  (single source of truth + persistence)
     Split → js/store.js
     ────────────────────────────────────────────────────────────────
     IMPORTANT RULE: state.chats holds ONLY real conversations — a chat
     earns its place the moment its first message is sent. An empty
     "New Chat" is never stored and never listed, so opening a new chat
     five times leaves the history untouched.

     activeId may be null, which is the "fresh chat" state (welcome
     screen, bare topbar, no history row).

     Shape:
       settings = { autospeak, handsfree, thoughts, lang, theme }
       state    = { chats:[ { id, title, pinned, created, updated,
                              messages:[ { role, text, files?, thoughts?, ts } ] } ],
                    activeId }
     ================================================================ */
import { nowISO, uid } from "./utils.js";

  const LS_CHATS = "thoshan.chats.v1";
  const LS_SETTINGS = "thoshan.settings.v1";
  const DEFAULTS = { autospeak: false, handsfree: false, thoughts: true, lang: "en-IN",
    theme: "dark", sidebarCollapsed: false };   // dark is the shipped default

  export const settings = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS_SETTINGS) || "{}"));
  export const saveSettings = () => { try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch (e) {} };

  export let state = { chats: [], activeId: null };
  try {
    const raw = JSON.parse(localStorage.getItem(LS_CHATS) || "null");
    if (raw && Array.isArray(raw.chats)) {
      state.chats = raw.chats.filter((c) => c && Array.isArray(c.messages) && c.messages.length);
      state.activeId = raw.activeId && state.chats.some((c) => c.id === raw.activeId) ? raw.activeId : null;
    }
  } catch (e) { /* corrupt storage — start clean */ }

  export function saveChats() {
    /* never persist an empty conversation */
    state.chats = state.chats.filter((c) => c.messages.length > 0);
    if (state.activeId && !state.chats.some((c) => c.id === state.activeId)) state.activeId = null;
    try { localStorage.setItem(LS_CHATS, JSON.stringify(state)); } catch (e) {}
  }

  export const activeChat = () => state.chats.find((c) => c.id === state.activeId) || null;
  export const touchChat = (chat) => { chat.updated = nowISO(); };


  /* Called when we actually have something to say. Creates the chat on
     first use, reuses it after that. */
  export function ensureChat() {
    let chat = activeChat();
    if (!chat) {
      chat = { id: uid(), title: "New Chat", pinned: false, created: nowISO(), updated: nowISO(), messages: [] };
      state.chats.unshift(chat);
      state.activeId = chat.id;
    }
    return chat;
  }

  export const titleFrom = (text) => {
    const t = String(text || "").trim().replace(/\s+/g, " ");
    if (!t) return "Attachment";
    return t.length > 34 ? t.slice(0, 34).trim() + "…" : t;
  };

  /* ================================================================
      PANEL HAND-OFF  (driven by js/embed.js + the portfolio drawer)
      ────────────────────────────────────────────────────────────────
      Browsers PARTITION a cross-site iframe's localStorage by parent
      site (Chrome 115+, Safari, Firefox). Conversations typed in the
      portfolio drawer are therefore in a different storage jar than a
      top-level visit to ai.lingadevaru.in — localStorage cannot bridge
      them. "Open full site" instead carries the history over in a
      #thoshan-import= URL hash; these are the two sides of that pipe.

      Caps are tight because the payload travels inside a URL: no files
      (data-URIs are megabytes), no thoughts (disposable reasoning
      previews), hard message/text/byte caps on BOTH sides — import
      re-applies them because the hash is untrusted input.
      ================================================================ */
  const HANDOFF_MAX_CHATS = 10;
  const HANDOFF_MAX_MSGS = 80;
  const HANDOFF_MAX_TEXT = 8000;        // chars per message
  const HANDOFF_MAX_BYTES = 60 * 1024;  // whole payload budget

  const updatedKey = (c) => String(c.updated || "");

  /* Panel → full site: newest conversations first, each cleaned down to
     {role, text, ts}, capped. Returns an array of chat objects. */
  export function exportChats() {
    const chats = state.chats
      .slice()                                    // never mutate live state
      .sort((a, b) => updatedKey(b).localeCompare(updatedKey(a)))
      .slice(0, HANDOFF_MAX_CHATS)
      .map((c) => ({
        id: c.id, title: c.title, pinned: !!c.pinned,
        created: c.created, updated: c.updated,
        messages: c.messages.slice(-HANDOFF_MAX_MSGS).map((m) => ({
          role: m.role, ts: m.ts || "", text: String(m.text || "").slice(0, HANDOFF_MAX_TEXT),
        })),    // files + thoughts intentionally dropped — see header note
      }));

    /* Budget: 10 × 80 × 8k chars could theoretically still blow the URL
       hash. Shed weight until it fits — messages are halved first, then
       the oldest conversations are dropped whole. Loop terminates: msgs
       floor at 8, chats at 0, and an empty array is always tiny. */
    let cap = HANDOFF_MAX_MSGS;
    let out = chats;
    while (JSON.stringify(out).length > HANDOFF_MAX_BYTES && out.length) {
      if (cap <= 8) { out = out.slice(0, -1); continue; }   // shed the oldest chat
      cap = Math.floor(cap / 2);
      out = out.map((c) => ({ ...c, messages: c.messages.slice(-cap) }));
    }
    return out;
  }

  /* Full site ← panel: union-merge by chat id; inside a chat, messages
     dedupe by ts|role|text so a re-import never duplicates lines. The
     most recently updated imported chat becomes active, matching "you
     land where the panel left off". Returns how many chats changed. */
  export function importChats(payload) {
    const chats = Array.isArray(payload && payload.chats) ? payload.chats : [];
    const clip = chats
      .filter((c) => c && Array.isArray(c.messages) && c.messages.length)
      .slice(0, HANDOFF_MAX_CHATS)
      .map((c) => {
        const created = String(c.created || "").slice(0, 30) || nowISO();
        const updated = String(c.updated || "").slice(0, 30) || created;
        const messages = c.messages.slice(-HANDOFF_MAX_MSGS).map((m) => ({
          role: m && m.role === "user" ? "user" : "assistant",
          ts: String(m && m.ts || ""),
          text: String(m && m.text || "").slice(0, HANDOFF_MAX_TEXT),
        })).filter((m) => m.text);
        return {
          id: String(c.id || "").slice(0, 64) || uid(),
          title: String(c.title || "New Chat").slice(0, 200),
          pinned: !!c.pinned, created, updated, messages,
        };
      })
      .filter((c) => c.messages.length);

    let changed = 0;
    for (const inc of clip) {
      const existing = state.chats.find((c) => c.id === inc.id);
      if (!existing) { state.chats.push(inc); changed++; continue; }
      /* union messages, then adopt the newer side's title/updated */
      const seen = new Set(existing.messages.map((m) => `${m.ts}|${m.role}|${m.text}`));
      for (const m of inc.messages) {
        const key = `${m.ts}|${m.role}|${m.text}`;
        if (seen.has(key)) continue;
        seen.add(key); existing.messages.push(m); changed++;
      }
      if (updatedKey(inc).localeCompare(updatedKey(existing)) > 0) {
        existing.title = inc.title; existing.pinned = inc.pinned;
        existing.updated = inc.updated; changed++;
      }
    }
    if (!changed) return 0;

    /* history rows render newest-first everywhere else, so keep the
       imported chats consistent with that ordering */
    state.chats.sort((a, b) => updatedKey(b).localeCompare(updatedKey(a)));
    const newest = clip.reduce((a, c) => (!a || updatedKey(c).localeCompare(updatedKey(a)) > 0 ? c : a), null);
    if (newest && state.chats.some((c) => c.id === newest.id)) state.activeId = newest.id;
    saveChats();
    return changed;
  }

  