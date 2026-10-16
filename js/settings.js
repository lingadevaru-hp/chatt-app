/* ================================================================
     J10 · SETTINGS, THEME & BOOT
     Split → js/settings.js
     ================================================================ */
import { CONFIG } from "./config.js";
import { PROFILE } from "./knowledge.js";
import { settings, saveSettings, state } from "./store.js";
import { renderChatList, renderThread, autoGrow, updateSendState, closeSidebar, startNewChat, ask, stopResponse } from "./chat.js";
import { updateMicState, stopSpeaking, speak } from "./speech.js";
import { openCall, endCall } from "./call.js";
import { openSearch } from "./search.js";
import { $, $$, copyText } from "./utils.js";

  const settingsScreen = $("#settingsScreen"), themeSeg = $("#themeSeg");

  /* --- collapsible sidebar -------------------------------------------------
     On desktop the sidebar collapses to a narrow icon rail (.app.collapsed,
     styled in C11) and the toggle is the only way back, so it stays visible
     in BOTH states. On mobile the same button closes the off-canvas drawer,
     which is what that gesture should mean on a small screen.
     The choice is persisted, so a returning visitor gets their layout back. */
  const sidebarToggle = $("#sidebarToggle");

  function applySidebarCollapsed() {
    const collapsed = !!settings.sidebarCollapsed;
    document.querySelector(".app").classList.toggle("collapsed", collapsed);
    sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    sidebarToggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
  }

  sidebarToggle.addEventListener("click", () => {
    if (window.matchMedia("(min-width:1024px)").matches) {
      settings.sidebarCollapsed = !settings.sidebarCollapsed;
      saveSettings();
      applySidebarCollapsed();
    } else {
      closeSidebar();
    }
  });

  function syncSettingsUI() {
    $("#swAutospeak").classList.toggle("on", settings.autospeak);
    $("#swHandsfree").classList.toggle("on", settings.handsfree);
    $("#swThoughts").classList.toggle("on", settings.thoughts);
    $("#langSelect").value = settings.lang;
    $$(".seg__btn", themeSeg).forEach((b) => b.classList.toggle("is-on", b.dataset.themeVal === settings.theme));
  }

  $("#settingsBtn").addEventListener("click", () => { syncSettingsUI(); settingsScreen.hidden = false; closeSidebar(); });

  /* every screen's back button closes its own .screen */
  $$("[data-close-screen]").forEach((b) => b.addEventListener("click", () => {
    const s = b.closest(".screen"); if (s) s.hidden = true;
  }));
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    $$(".screen").forEach((s) => { if (!s.hidden) s.hidden = true; });
  });

  $("#swAutospeak").addEventListener("click", () => { settings.autospeak = !settings.autospeak; saveSettings(); syncSettingsUI(); });
  $("#swHandsfree").addEventListener("click", () => {
    settings.handsfree = !settings.handsfree; saveSettings(); syncSettingsUI();
    if (!settings.handsfree) stopSpeaking();
  });
  $("#swThoughts").addEventListener("click", () => { settings.thoughts = !settings.thoughts; saveSettings(); syncSettingsUI(); renderThread(); });
  $("#langSelect").addEventListener("change", (e) => { settings.lang = e.target.value; saveSettings(); });

  /* --- theme --- */
  function applyTheme() {
    const pref = settings.theme || "dark";
    const resolved = pref === "system"
      ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : pref;
    document.documentElement.dataset.theme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "light" ? "#f6f6f7" : "#0a0a0b");
    $$(".seg__btn", themeSeg).forEach((b) => b.classList.toggle("is-on", b.dataset.themeVal === pref));
  }
  themeSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg__btn");
    if (!btn) return;
    settings.theme = btn.dataset.themeVal;
    saveSettings();
    applyTheme();
  });
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: light)")
      .addEventListener("change", () => { if (settings.theme === "system") applyTheme(); });
  }

  $("#copyContact").addEventListener("click", () => copyText(PROFILE.email));

  /* --- boot --- */
  export function boot() {
  applyTheme();
  applySidebarCollapsed();
  syncSettingsUI();
  renderChatList();
  renderThread();     // also calls renderTopbar()
  autoGrow();
  updateSendState();
  updateMicState();
  /* Deliberately no autofocus: the keyboard stays closed on the new-chat
     screen until the visitor taps the composer. */

  console.info("[Portfolio Assistant] mode =", CONFIG.mode,
    CONFIG.mode === "demo" ? "— answers are local. Set CONFIG.mode='api' to go live." : "— calling " + CONFIG.apiBase);

  /* Public surface, handy for wiring from a portfolio page:
       ThoshanAssistant.ask("…")     send a message
       ThoshanAssistant.openCall()   start a voice call
       ThoshanAssistant.openSearch() open the search page
       ThoshanAssistant.newChat()    start a fresh chat          */
  window.ThoshanAssistant = {
    CONFIG, PROFILE, settings, store: state,
    newChat: startNewChat,
    ask: (t) => { input.value = t; submit(); },
    speak, stopResponse, openCall, endCall, openSearch, applyTheme
  };
  }
