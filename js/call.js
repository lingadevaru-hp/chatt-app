/* ================================================================
     J8 · VOICE CALL
     Split → js/call.js
     Full-screen hands-free loop: listen → think → speak → listen …
     Reuses the same brain (J5) and records every turn into the active
     chat, so ending a call leaves a transcript behind.
     ================================================================ */
import { ensureChat, saveChats, touchChat, titleFrom, settings } from "./store.js";
import { askBrain } from "./brain.js";
import { $, plain, showToast, nowISO } from "./utils.js";
import { pickVoice, stopSpeaking, SR } from "./speech.js";

  const callEl = $("#call"), callStatus = $("#callStatus"), callTimer = $("#callTimer"),
    callLines = $("#callLines"), callLive = $("#callLive"), callWaveEl = $("#callWave");
  const call = { active: false, muted: false, speakerOff: false, state: "idle", tick: null, bars: null, rec: null };

  function buildCallWave() {
    callWaveEl.innerHTML = "";
    const n = window.innerWidth < 380 ? 26 : 40;
    for (let i = 0; i < n; i++) callWaveEl.appendChild(document.createElement("i"));
  }
  function animateCallWave() {
    Array.from(callWaveEl.children).forEach((b) => {
      b.style.height = (10 + Math.random() * 80) + "%";
      b.style.opacity = String(0.45 + Math.random() * 0.55);
    });
  }
  function callWaveIdle() {
    Array.from(callWaveEl.children).forEach((b) => { b.style.height = "10%"; b.style.opacity = ".4"; });
  }

  function setCallState(s) {
    call.state = s;
    callEl.dataset.state = s;
    callStatus.textContent = ({
      connecting: "Connecting…",
      listening: call.muted ? "Microphone muted" : "Listening…",
      thinking: "Thinking…",
      speaking: call.speakerOff ? "Reply muted" : "Speaking…",
      idle: ""
    })[s] || "";
    clearInterval(call.bars); call.bars = null;
    if (s === "listening" && !call.muted) call.bars = setInterval(animateCallWave, 130);
    else callWaveIdle();
  }

  function callLine(role, text) {
    const d = document.createElement("div");
    d.className = "call__line call__line--" + (role === "user" ? "user" : "bot");
    d.textContent = text;
    callLines.appendChild(d);
    while (callLines.children.length > 3) callLines.removeChild(callLines.firstChild);
  }

  function callTimerStart() {
    const t0 = Date.now();
    callTimer.textContent = "00:00";
    clearInterval(call.tick);
    call.tick = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      callTimer.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    }, 500);
  }

  function callListen() {
    return new Promise((resolve) => {
      if (!call.active) return resolve(null);
      if (call.muted) { setCallState("listening"); return setTimeout(() => resolve(null), 350); }
      if (!SR) return callSimulateListen(resolve);

      let finalText = "", settled = false;
      const rec = new SR();
      call.rec = rec;
      rec.lang = settings.lang;
      rec.continuous = false;
      rec.interimResults = true;

      const settle = (val) => {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        try { rec.abort(); } catch (e) {}
        call.rec = null;
        resolve(val);
      };
      const guard = setTimeout(() => settle(finalText.trim() || null), 12000);

      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t; else interim += t;
        }
        const parts = [finalText.trim(), interim.trim()].filter(Boolean);
        callLive.textContent = parts.join(" ").replace(/\s{2,}/g, " ");
      };
      rec.onerror = (ev) => {
        if (ev.error === "no-speech") return settle(null);
        if (ev.error === "aborted" || settled) return;
        settled = true; clearTimeout(guard);
        try { rec.abort(); } catch (e) {}
        call.rec = null;
        showToast("Microphone unavailable — using demo voice");
        callSimulateListen(resolve);
      };
      rec.onend = () => settle(finalText.trim() || null);

      try { rec.start(); setCallState("listening"); }
      catch (e) { settle(null); }
    });
  }

  function callSimulateListen(resolve) {
    const samples = ["What projects have you built?", "Tell me about your skills",
      "Are you available for hire?", "How can I contact you?"];
    const phrase = samples[Math.floor(Math.random() * samples.length)];
    setCallState("listening");
    let i = 0;
    const t = setInterval(() => {
      i += 3;
      callLive.textContent = phrase.slice(0, i);
      if (i >= phrase.length) {
        clearInterval(t);
        callLive.textContent = phrase;
        setTimeout(() => resolve(phrase), 420);
      }
    }, 55);
  }

  function callSpeak(text) {
    return new Promise((resolve) => {
      const clean = plain(text);
      if (call.speakerOff || !window.speechSynthesis) {
        setCallState("speaking");
        return setTimeout(resolve, Math.min(5000, 400 + clean.length * 32));
      }
      stopSpeaking();
      const u = new SpeechSynthesisUtterance(clean);
      const v = pickVoice(settings.lang);
      if (v) u.voice = v;
      u.lang = settings.lang;
      u.onend = resolve;
      u.onerror = resolve;
      speechSynthesis.speak(u);
    });
  }

  async function callReply(text) {
    const chat = ensureChat();
    chat.messages.push({ role: "user", text: text, ts: nowISO() });
    if (chat.title === "New Chat") chat.title = titleFrom(text);
    let reply;
    try { reply = (await askBrain(text, chat, [])).reply; }
    catch (e) { reply = "Sorry — I couldn't reach the assistant just now."; }
    chat.messages.push({ role: "bot", text: reply, thoughts: ["Spoken in voice call."], ts: nowISO() });
    touchChat(chat);
    saveChats();
    return reply;
  }

  async function callLoop() {
    while (call.active) {
      const heard = await callListen();
      callLive.textContent = "";
      if (!call.active) break;
      if (!heard) continue;

      callLine("user", heard);
      setCallState("thinking");
      const reply = await callReply(heard);
      if (!call.active) break;

      callLine("bot", plain(reply));
      setCallState("speaking");
      await callSpeak(reply);
      if (!call.active) break;
      setCallState("listening");
    }
  }

  export function openCall() {
    if (call.active) return;
    call.active = true; call.muted = false; call.speakerOff = false;
    callLines.innerHTML = ""; callLive.textContent = "";
    callEl.classList.add("show");
    callEl.setAttribute("aria-hidden", "false");
    buildCallWave(); callWaveIdle();
    stopSpeaking();
    setCallState("connecting");
    callTimerStart();
    /* iOS needs synthesis primed by a user gesture; this call is one. */
    try { if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(" ")); } catch (e) {}
    setTimeout(() => { if (call.active) callLoop(); }, 520);
  }

  export function endCall() {
    if (!call.active) return;
    call.active = false;
    clearInterval(call.tick); clearInterval(call.bars); call.bars = null;
    if (call.rec) { try { call.rec.abort(); } catch (e) {} call.rec = null; }
    stopSpeaking();
    callLive.textContent = "";
    callEl.classList.remove("show");
    callEl.setAttribute("aria-hidden", "true");
    setCallState("idle");
    callDeps.onEnded();
    if (callLines.children.length) showToast("Call ended — transcript saved to this chat");
  }

  $("#callBtn").addEventListener("click", openCall);
  $("#ctlEnd").addEventListener("click", endCall);
  $("#ctlMute").addEventListener("click", function () {
    call.muted = !call.muted;
    this.classList.toggle("off", call.muted);
    this.setAttribute("aria-pressed", String(call.muted));
    this.querySelector("use").setAttribute("href", call.muted ? "#i-micoff" : "#i-mic");
    if (call.muted && call.rec) { try { call.rec.abort(); } catch (e) {} }
    if (call.active) setCallState(call.state);
  });
  $("#ctlSpeaker").addEventListener("click", function () {
    call.speakerOff = !call.speakerOff;
    this.classList.toggle("off", call.speakerOff);
    this.setAttribute("aria-pressed", String(call.speakerOff));
    this.querySelector("use").setAttribute("href", call.speakerOff ? "#i-voloff" : "#i-speaker");
    if (call.speakerOff) stopSpeaking();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && call.active) endCall(); });

  
  /* Transcript refresh goes out via callback — call.js never imports chat.js. */
  let callDeps = { onEnded: () => {} };
  export function initCall(d) { Object.assign(callDeps, d); }
