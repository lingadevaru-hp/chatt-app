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

  