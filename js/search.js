/* ================================================================
     J9 · SEARCH CHATS  (its own full-screen page)
     Split → js/search.js
     Matches the query against the chat TITLE and the text of every
     message inside it. Empty query lists everything, newest first.
     ================================================================ */
import { state } from "./store.js";
import { $, esc, relTime } from "./utils.js";

  const searchScreen = $("#searchScreen"), searchInput = $("#searchInput"), searchResults = $("#searchResults");

  export function searchChats(query) {
    const needle = String(query || "").trim().toLowerCase();
    const hits = [];
    for (const c of state.chats) {
      if (!c.messages.length) continue;
      const inTitle = !needle || c.title.toLowerCase().includes(needle);
      let snippet = "";
      if (needle) {
        for (const m of c.messages) {
          const i = String(m.text || "").toLowerCase().indexOf(needle);
          if (i !== -1) {
            const start = Math.max(0, i - 24);
            snippet = (start > 0 ? "…" : "") + String(m.text).slice(start, i + 60).replace(/\s+/g, " ");
            break;
          }
        }
      }
      if (inTitle || snippet) hits.push({ chat: c, snippet: snippet });
    }
    return hits.sort((a, b) => new Date(b.chat.updated || b.chat.created) - new Date(a.chat.updated || a.chat.created));
  }

  function renderResults(query) {
    const hits = searchChats(query);
    searchResults.innerHTML = "";
    if (!hits.length) {
      searchResults.innerHTML = '<div class="result__empty">' +
        (query ? "No chats match \u201c" + esc(query) + "\u201d." : "No conversations yet.") + "</div>";
      return;
    }
    hits.forEach(({ chat, snippet }) => {
      const b = document.createElement("button");
      b.className = "result";
      b.innerHTML =
        '<span style="flex:1;min-width:0">' +
          '<span class="result__title">' + esc(chat.title) + "</span>" +
          (snippet ? '<span class="result__snippet">' + esc(snippet) + "</span>" : "") +
        "</span>" +
        '<span class="result__time">' + relTime(chat.updated || chat.created) + "</span>";
      b.addEventListener("click", () => {
        searchDeps.onSelectChat(chat); closeSearch();
      });
      searchResults.appendChild(b);
    });
  }

  export function openSearch() {
    searchDeps.onOpen();
    searchScreen.hidden = false;
    searchInput.value = "";
    renderResults("");
    setTimeout(() => searchInput.focus(), 60);
  }
  export function closeSearch() { searchScreen.hidden = true; }

  searchInput.addEventListener("input", () => renderResults(searchInput.value));
  $("#searchBtn").addEventListener("click", openSearch);

  
  /* Selection + drawer handling are injected by the orchestrator. */
  let searchDeps = { onSelectChat: () => {}, onOpen: () => {} };
  export function initSearch(d) { Object.assign(searchDeps, d); }
