/* ================================================================
     J8 · VOICE CALL
     Split → js/call.js
     Full-screen hands-free loop: listen → think → speak → listen …
     Speech-to-text is Sarvam (via our Worker), same path as the composer
     mic — not the browser Web Speech API. There is no Stop button in a
     call, so the recorder ends itself after a stretch of quiet.
     Reuses the same brain (J5) and records every turn into the active
     chat, so ending a call leaves a transcript behind.
     ================================================================ */
import { CONFIG } from "./config.js";
import { ensureChat, saveChats, touchChat, titleFrom, settings } from "./store.js";
import { askBrain } from "./brain.js";
import { $, plain, showToast, nowISO } from "./utils.js";
import { pickVoice, stopSpeaking, speechText, speakChunked, recordToBlob, transcribeBlob, canRecord, stopActiveRecording } from "./speech.js";

  const callEl = $("#call"), callStatus = $("#callStatus"), callTimer = $("#callTimer"),
    callLines = $("#callLines"), callLive = $("#callLive"), callWaveEl = $("#callWave");
  const call = { active: false, muted: false, speakerOff: false, state: "idle", tick: null, bars: null };

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

  /* Listen for one utterance, resolve with the transcript or null.
     No Stop button in a call, so the recorder ends itself after quiet.
     maxSeconds is the hard backstop and MUST stay under Sarvam's 30s REST
     ceiling — over that the request 422s. */
  function callListen() {
    return new Promise((resolve) => {
      if (!call.active) return resolve(null);
      if (call.muted) { setCallState("listening"); return setTimeout(() => resolve(null), 350); }
      if (!canRecord()) return callSimulateListen(resolve);

      setCallState("listening");
      recordToBlob({
        maxSeconds: 25,
        stopOnSilence: true,
        /* 1600ms of trailing quiet meant a full second and a half of dead air
           before the bot reacted — the opposite of a phone call. It is also
           billed audio. 1000ms still leaves room for a mid-sentence pause. */
        silenceMs: 1000,
        /* Batch STT gives no interim words, so show a small "…" whenever
           there is voice energy — it tells the visitor the mic is live. */
        onLevel: (l) => { if (call.active) callLive.textContent = l > 0.08 ? "…" : ""; },
      })
        .then((clip) => {
          if (!clip || !call.active) return resolve(null);
          /* Nothing was said. Do NOT upload: the loop cycles every couple of
             seconds, so billing silence meant paying over and over — and,
             worse, it kept ending its own recording before the visitor could
             finish a sentence, which is why the second turn felt dead. */
          if (!clip.spoke) return resolve(null);
          return transcribeBlob(clip.blob, clip.type).then(
            (t) => resolve(t || null),
            () => resolve(null),
          );
        })
        .catch(() => resolve(null));
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

  /* Speak one turn. Uses the SAME voice as the message speaker button —
     Sarvam Bulbul via our Worker — because the browser voice was the whole
     complaint: a call read aloud by Brave/Chrome is not the product.

     The browser voice survives only as a last resort if the API genuinely
     fails, and it says so in the console when that happens. */
  async function callSpeak(text) {
    const clean = speechText(text);
    setCallState("speaking");
    if (call.speakerOff || !clean) return;

    if (CONFIG.mode === "api") {
      try {
        /* Chunked: the first sentence starts playing while the rest are still
           being synthesised. This is the single biggest latency win in a call,
           because it removes the wait for the WHOLE reply before any sound. */
        await speakChunked(text);
        return;
      } catch (e) {
        console.warn("[call] Sarvam voice failed, falling back to browser voice:", e && e.message);
      }
    }

    await new Promise((resolve) => {
      if (!window.speechSynthesis) return setTimeout(resolve, Math.min(5000, 400 + clean.length * 32));
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
      /* Nothing heard: pause before reopening the mic. Without this the loop
         restarts instantly, hammering getUserMedia and re-recording over the
         visitor while they are still speaking. */
      if (!heard) { await new Promise((r) => setTimeout(r, 300)); continue; }

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
    stopActiveRecording();   /* otherwise the mic stays open until the cap */
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
    if (call.muted) stopActiveRecording();
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
