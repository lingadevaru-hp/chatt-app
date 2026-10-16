/* ================================================================
     J6 · CHAT VIEW  (thread, history list, topbar, menus, send flow)
     Split → js/chat.js
     ================================================================ */
import { settings, state, saveChats, activeChat, touchChat, ensureChat, titleFrom } from "./store.js";
import { askBrain } from "./brain.js";
import { stopSpeaking, speak, speakToggle, updateMicState, isRecording, resetVoiceTurn, initSpeech } from "./speech.js";
import { takeAttachments, getPendingCount, initAttachments } from "./attachments.js";
import { openSearch, initSearch } from "./search.js";
import { initCall } from "./call.js";
import { $, $$, esc, icon, nowISO, sleep, formatReply, wireRich, plain, showToast, hideToast, copyText } from "./utils.js";

  const topbar = $("#topbar"), chatTitle = $("#chatTitle"), pinLabel = $("#pinLabel"),
    thread = $("#thread"), threadInner = $("#threadInner"), chatList = $("#chatList"),
    composer = $("#composer"), input = $("#input"), micBtn = $("#micBtn"), stopBtn = $("#stopBtn"),
    sendBtn = $("#sendBtn"), recorder = $("#recorder"), wave = $("#wave"), timerEl = $("#timer"),
    kebabBtn = $("#kebabBtn"), kebabMenu = $("#kebabMenu"), sidebar = $("#sidebar"), scrim = $("#scrim");



  function scrollToEnd(smooth) {
    requestAnimationFrame(() => thread.scrollTo({ top: thread.scrollHeight, behavior: smooth === false ? "auto" : "smooth" }));
  }


  /* --- history list: only chats that actually have messages --- */
  export function renderChatList() {
    const visible = state.chats.filter((c) => c.messages.length > 0);
    chatList.innerHTML = "";
    if (!visible.length) {
      chatList.innerHTML = '<div class="sidebar__empty">No conversations yet. Start one and it will appear here.</div>';
      return;
    }
    visible.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).forEach((c) => {
      const row = document.createElement("div");
      row.className = "chat-item" + (c.id === state.activeId ? " active" : "");
      row.innerHTML =
        '<span class="chat-item__title">' + esc(c.title) + "</span>" +
        (c.pinned ? '<span class="chat-item__pin">' + icon("i-pin", 15) + "</span>" : "") +
        '<button class="chat-item__del" aria-label="Delete chat">' + icon("i-trash", 15) + "</button>";
      row.addEventListener("click", (e) => {
        if (e.target.closest(".chat-item__del")) return;
        state.activeId = c.id; saveChats(); renderChatList(); renderThread(); closeSidebar();
      });
      row.querySelector(".chat-item__del").addEventListener("click", (e) => {
        e.stopPropagation();
        state.chats = state.chats.filter((x) => x.id !== c.id);
        if (state.activeId === c.id) state.activeId = null;
        saveChats(); renderChatList(); renderThread();
      });
      chatList.appendChild(row);
    });
  }

  /* --- topbar: normal vs "bare" on a fresh chat --- */
  function renderTopbar() {
    const chat = activeChat();
    const bare = !chat || chat.messages.length === 0;
    topbar.classList.toggle("topbar--bare", bare);
    chatTitle.textContent = chat ? chat.title : "New Chat";
    pinLabel.textContent = chat && chat.pinned ? "Unpin chat" : "Pin chat";
    if (bare) { kebabMenu.hidden = true; kebabBtn.setAttribute("aria-expanded", "false"); }
  }

  /* --- thread --- */
  export function renderThread() {
    const chat = activeChat();
    threadInner.innerHTML = "";
    if (!chat || !chat.messages.length) { renderWelcome(); renderTopbar(); return; }
    chat.messages.forEach((m) => threadInner.appendChild(buildMessage(m)));
    renderTopbar();
    scrollToEnd(false);
  }

  /* New-chat screen: exactly two elements — the mark and one line.
     No subtitle, no suggestion chips, no rule. Everything else competes
     with the composer, and the composer is the only thing to do here. */
  function renderWelcome() {
    const w = document.createElement("div");
    w.className = "welcome";
    w.innerHTML =
      '<svg class="welcome__logo" viewBox="0 0 100 100"><use href="#i-lotus"/></svg>' +
      '<h2 class="welcome__title">Let\'s get to work.</h2>';
    threadInner.appendChild(w);
  }

  /* Files attached to a message render as thumbnails / file pills. */
  function filesMarkup(files) {
    if (!files || !files.length) return "";
    return '<div class="bubble__files">' + files.map((f) =>
      f.dataUrl
        ? '<img src="' + f.dataUrl + '" alt="' + esc(f.name) + '">'
        : '<span class="file-pill">' + icon("i-file", 14) + esc(f.name) + "</span>"
    ).join("") + "</div>";
  }

  function buildMessage(m) {
    if (m.role === "user") {
      const d = document.createElement("div");
      d.className = "msg msg--user";
      d.innerHTML = '<div class="bubble">' + filesMarkup(m.files) +
        (m.text ? esc(m.text) : "") + "</div>" +
        '<div class="mini-actions"><button class="act" data-act="copy" aria-label="Copy">' + icon("i-copy", 16) + "</button></div>";
      d.querySelector('[data-act="copy"]').addEventListener("click", () => copyText(m.text || ""));
      return d;
    }

    const d = document.createElement("div");
    d.className = "msg msg--bot";
    const showThoughts = settings.thoughts && m.thoughts && m.thoughts.length;
    d.innerHTML =
      (showThoughts
        ? '<button class="thoughts" aria-expanded="false">Thoughts ' + icon("i-chev", 14) + "</button>" +
          '<div class="thoughts__body"><div class="thoughts__inner"><div class="thoughts__card">' +
          m.thoughts.map((t, i) =>
            '<div class="thought-step"><span class="thought-step__dot"></span><span>' + esc(t) +
            '<span class="thought-step__t">' + (0.3 + i * 0.2).toFixed(1) + "s</span></span></div>").join("") +
          "</div></div></div>"
        : "") +
      '<div class="reply">' + formatReply(m.text) + "</div>" +
      '<div class="actions">' +
        '<button class="act" data-act="speak" aria-label="Read aloud">' + icon("i-speaker", 18) + "</button>" +
        '<button class="act" data-act="up" aria-label="Good response">' + icon("i-up", 18) + "</button>" +
        '<button class="act" data-act="down" aria-label="Bad response">' + icon("i-down", 18) + "</button>" +
        '<button class="act" data-act="copy" aria-label="Copy">' + icon("i-copy", 18) + "</button>" +
      "</div>";

    const tBtn = d.querySelector(".thoughts");
    if (tBtn) tBtn.addEventListener("click", () => {
      const body = d.querySelector(".thoughts__body");
      const open = body.classList.toggle("open");
      tBtn.setAttribute("aria-expanded", String(open));
    });
    d.querySelector('[data-act="speak"]').addEventListener("click", function () { speakToggle(m.text, this); });
    d.querySelector('[data-act="up"]').addEventListener("click", function () { rate(this, "up"); });
    d.querySelector('[data-act="down"]').addEventListener("click", function () { rate(this, "down"); });
    d.querySelector('[data-act="copy"]').addEventListener("click", () => copyText(plain(m.text)));
    wireRich(d);
    return d;
  }

  function rate(btn, kind) {
    const row = btn.closest(".actions");
    row.querySelectorAll(".act").forEach((b) => b.classList.remove("on", "on--down"));
    btn.classList.add(kind === "up" ? "on" : "on--down");
    showToast(kind === "up" ? "Thanks for the feedback" : "Noted — I'll improve");
  }

  /* --- send flow --- */
  let busy = false;
  /* Set by stopResponse(); streamText() checks it on every word, so a
     reply halts within a frame or two of the tap. */
  let stopped = false;

  export async function submit() {
    const text = input.value.trim();
    const files = takeAttachments();                 // J11
    if ((!text && !files.length) || busy) return;

    /* KEYBOARD POLICY
       If the visitor was typing, the keyboard must stay open through the
       whole reply. We record that intent here and restore focus at the
       end. If they sent by voice or with a file, it stays closed. */
    const keepKeyboard = document.activeElement === input;

    busy = true;
    stopSpeaking();
    hideToast();

    const chat = ensureChat();
    chat.messages.push({ role: "user", text: text, files: files, ts: nowISO() });
    if (chat.title === "New Chat") chat.title = titleFrom(text || (files[0] && files[0].name));
    touchChat(chat);
    saveChats();                                     // chat now earns its history row

    input.value = "";
    resetVoiceTurn();              // a fresh prompt: the mic may be used again
    updateMicState();
    autoGrow();
    updateSendState();
    renderChatList();

    if (chat.messages.length === 1) threadInner.innerHTML = "";
    threadInner.appendChild(buildMessage({ role: "user", text: text, files: files }));
    renderTopbar();
    scrollToEnd();

    const typing = document.createElement("div");
    typing.className = "msg msg--bot";
    typing.innerHTML = '<div class="typing"><svg class="typing__spinner" viewBox="0 0 100 100"><use href="#i-lotus"/></svg>' +
      '<span>Thinking</span><span class="dots"><i></i><i></i><i></i></span></div>';
    threadInner.appendChild(typing);
    scrollToEnd();

    let result;
    try {
      result = await askBrain(text || "I attached a file", chat, files);
    } catch (err) {
      result = { thoughts: ["The API call failed."], reply: "Sorry — I couldn't reach the assistant service just now. Please try again in a moment." };
    }

    typing.remove();

    /* The visitor may have pressed Stop while we were still thinking.
       Honour it: leave the question standing and add no answer. */
    if (stopped) {
      stopped = false;
      busy = false;
      updateSendState();
      if (keepKeyboard) input.focus({ preventScroll: true });
      return;
    }

    const botMsg = { role: "bot", text: result.reply, thoughts: result.thoughts, ts: nowISO() };
    chat.messages.push(botMsg);
    touchChat(chat);
    saveChats();

    const node = buildMessage({ role: "bot", text: "", thoughts: result.thoughts });
    threadInner.appendChild(node);
    const replyEl = node.querySelector(".reply");
    const speakBtn = node.querySelector('[data-act="speak"]');

    let shown = "";
    try {
      shown = await streamText(replyEl, result.reply);
    } catch (err) {
      /* streaming interrupted — fall through and settle up */
    } finally {
      /* If the visitor pressed Stop we keep exactly what was on screen
         and SAVE that, so the stored transcript matches what they saw. */
      const wasStopped = stopped;
      const finalText = wasStopped ? shown : result.reply;
      stopped = false;

      if (!finalText) {
        /* stopped before a single word appeared — don't leave an empty
           bubble in the thread or an empty message in history */
        node.remove();
        chat.messages.pop();
      } else {
        botMsg.text = finalText;
        touchChat(chat);
        replyEl.innerHTML = formatReply(finalText);
        wireRich(node);
        /* never read a half-finished answer aloud */
        if (!wasStopped && (settings.autospeak || settings.handsfree)) speak(finalText, speakBtn);
      }

      saveChats();
      busy = false;                       // never leave the composer locked
      updateSendState();
      scrollToEnd();
      if (keepKeyboard) input.focus({ preventScroll: true });   // keyboard stays
    }
  }

  /* Reveal the answer word by word so it feels alive. Returns whatever
     was rendered, which may be a prefix if the visitor stopped it. */
  async function streamText(el, md) {
    const words = plain(md).split(" ");
    const caret = document.createElement("span");
    caret.className = "caret";
    el.appendChild(caret);
    let shown = "";
    for (let i = 0; i < words.length; i++) {
      if (stopped) break;
      shown += (i ? " " : "") + words[i];
      caret.before(document.createTextNode((i ? " " : "") + words[i]));
      if (i % 3 === 0) scrollToEnd();
      await sleep(18 + Math.random() * 22);
    }
    caret.remove();
    return shown;
  }

  /* Stop an in-flight reply. The send button doubles as the stop button
     while busy, so this is reachable with one tap. */
  export function stopResponse() {
    if (!busy) return;
    stopped = true;
    stopSpeaking();
    showToast("Response stopped");
  }

  /* --- composer plumbing --- */
  export function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }
  /* One button, two jobs: Send when idle, Stop while a reply streams. */
  export function updateSendState() {
    const use = sendBtn.querySelector("use");
    if (busy) {
      sendBtn.hidden = false;
      sendBtn.classList.add("is-stop");
      sendBtn.setAttribute("aria-label", "Stop response");
      if (use) use.setAttribute("href", "#i-stop");
      return;
    }
    sendBtn.classList.remove("is-stop");
    sendBtn.setAttribute("aria-label", "Send");
    if (use) use.setAttribute("href", "#i-send");
    sendBtn.hidden = !(input.value.trim().length > 0 || getPendingCount() > 0) || isRecording();
  }

  input.addEventListener("input", () => { autoGrow(); updateSendState(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  composer.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) stopResponse(); else submit();
  });

  /* Tapping Send must not blur the textarea, or mobile keyboards close.
     NOTE: only pointerdown is cancelled. Cancelling touchstart would also
     suppress the click event itself, which is why Send stopped working. */
  sendBtn.addEventListener("pointerdown", (e) => e.preventDefault());

  /* --- sidebar --- */
  export function openSidebar() { sidebar.classList.add("open"); scrim.classList.add("show"); }
  export function closeSidebar() { sidebar.classList.remove("open"); scrim.classList.remove("show"); }
  $("#menuBtn").addEventListener("click", openSidebar);
  scrim.addEventListener("click", closeSidebar);
  $$("[data-new-chat]").forEach((b) => b.addEventListener("click", startNewChat));

  /* --- kebab menu --- */
  kebabBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = kebabMenu.hidden;
    kebabMenu.hidden = !open;
    kebabBtn.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (!kebabMenu.hidden && !kebabMenu.contains(e.target) && !kebabBtn.contains(e.target)) {
      kebabMenu.hidden = true;
      kebabBtn.setAttribute("aria-expanded", "false");
    }
  });

  $("#menuSearch").addEventListener("click", () => { kebabMenu.hidden = true; openSearch(); });
  $("#pinChat").addEventListener("click", () => {
    const c = activeChat(); if (!c) return showToast("Start a chat first");
    c.pinned = !c.pinned; saveChats(); renderChatList(); renderTopbar();
    showToast(c.pinned ? "Chat pinned" : "Chat unpinned");
    kebabMenu.hidden = true;
  });
  $("#renameChat").addEventListener("click", () => {
    const c = activeChat(); if (!c) return showToast("Start a chat first");
    kebabMenu.hidden = true;
    $("#renameInput").value = c.title;
    $("#renameModal").hidden = false;
    setTimeout(() => $("#renameInput").focus(), 40);
  });
  $("#sharePdf").addEventListener("click", () => { kebabMenu.hidden = true; shareAsPdf(); });
  $("#copySession").addEventListener("click", () => {
    kebabMenu.hidden = true;
    copyText(activeChat() ? activeChat().id : "no-session");
  });

  $("#renameSave").addEventListener("click", () => {
    const c = activeChat(); if (!c) return;
    const v = $("#renameInput").value.trim();
    if (v) { c.title = v; saveChats(); renderChatList(); renderTopbar(); }
    $("#renameModal").hidden = true;
  });
  $("#renameInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#renameSave").click(); });
  $$("[data-close-modal]").forEach((b) => b.addEventListener("click", () => { $("#renameModal").hidden = true; }));

  function shareAsPdf() {
    const c = activeChat();
    if (!c || !c.messages.length) return showToast("Nothing to share yet");
    const win = window.open("", "_blank");
    if (!win) return showToast("Allow pop-ups to export the PDF");
    const rows = c.messages.map((m) =>
      '<div class="b ' + (m.role === "user" ? "u" : "a") + '"><div class="r">' +
      (m.role === "user" ? "You" : "Assistant") + '</div><div class="t">' + esc(plain(m.text)) + "</div></div>").join("");
    win.document.write(
      "<!doctype html><html><head><meta charset='utf-8'><title>" + esc(c.title) + "</title><style>" +
      "body{font-family:Georgia,serif;color:#111;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.6}" +
      "h1{font-size:22px;margin:0 0 4px}.meta{color:#777;font-size:12px;margin-bottom:28px}" +
      ".b{margin:0 0 18px}.r{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:4px}" +
      ".t{font-size:15px}.u .t{color:#333}" +
      "</style></head><body><h1>" + esc(c.title) + "</h1><div class='meta'>Thoshan · Portfolio Assistant · Session " +
      esc(c.id) + " · " + new Date().toLocaleString() + "</div>" + rows + "</body></html>"
    );
    win.document.close();
    setTimeout(() => win.print(), 350);
  }

  
  /* Start a fresh chat WITHOUT creating anything.
     Call it as often as you like — the history stays clean. */
  export function startNewChat() {
    state.activeId = null;
    saveChats();
    renderChatList();
    renderThread();
    closeSidebar();
  }
  /* NOTE: voiceUsed is reset in submit(), not here — a new chat still needs
     the mic for its first prompt. See updateMicState(). */


  /* --- module wiring (cycle-free: leaves never import this orchestrator) ---
     speech/attachments/search/call receive callbacks instead of importing
     submit(), updateSendState() or closeSidebar(). ES modules tolerate
     cycles, but this one-way direction keeps evaluation order trivial. */
  export function ask(t) { input.value = t; submit(); }
  initSpeech({
    getBusy: () => busy,
    onSubmit: () => submit(),
    onUiUpdate: () => { autoGrow(); updateSendState(); }
  });
  initAttachments({ onChange: () => updateSendState() });
  initSearch({
    onSelectChat: (c) => { state.activeId = c.id; saveChats(); renderChatList(); renderThread(); },
    onOpen: () => closeSidebar()
  });
  initCall({ onEnded: () => { renderChatList(); renderThread(); } });
