/* ================================================================
     J7 · SPEECH  (text-to-speech + speech-to-text)
     Split → js/speech.js
     Browser-native Web Speech API: free, no round trip, nothing leaves
     the device. Where unsupported we degrade to a simulated input so the
     demo still shows the flow instead of dead-ending.
     ================================================================ */
import { CONFIG } from "./config.js";
import { settings } from "./store.js";
import { $, plain, showToast } from "./utils.js";
/* Composer-side nodes this module drives. chat.js queries the same ids for
   its own handlers — same nodes, no shared imports, no cycle. */
const composer = $("#composer"), input = $("#input"), micBtn = $("#micBtn"),
  stopBtn = $("#stopBtn"), sendBtn = $("#sendBtn"), recorder = $("#recorder"),
  wave = $("#wave"), timerEl = $("#timer");
import { apiSpeak } from "./brain.js";

  let voices = [], speakBtnActive = null;

  const loadVoices = () => { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; };
  if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

  export function pickVoice(lang) {
    if (!voices.length) loadVoices();
    const base = String(lang || "en-IN").split("-")[0];
    return voices.find((v) => v.lang && v.lang.toLowerCase() === String(lang).toLowerCase())
      || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(base))
      || voices.find((v) => /en/i.test(v.lang)) || null;
  }

  function setSpeakState(btn, on) {
    if (speakBtnActive && speakBtnActive !== btn) {
      speakBtnActive.classList.remove("speaking");
      const u = speakBtnActive.querySelector("use"); if (u) u.setAttribute("href", "#i-speaker");
    }
    speakBtnActive = on ? btn : (speakBtnActive === btn ? null : speakBtnActive);
    if (btn) {
      btn.classList.toggle("speaking", on);
      const u = btn.querySelector("use"); if (u) u.setAttribute("href", on ? "#i-mute" : "#i-speaker");
    }
  }

  export function stopSpeaking() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (speakBtnActive) setSpeakState(speakBtnActive, false);
  }

  export function speakToggle(text, btn) {
    if (btn && btn.classList.contains("speaking")) { stopSpeaking(); return; }
    speak(text, btn);
  }

  export async function speak(text, btn) {
    stopSpeaking();
    const clean = plain(text);
    if (CONFIG.mode === "api") {
      try {
        setSpeakState(btn, true);
        const url = await apiSpeak(clean);
        const audio = new Audio(url);
        audio.onended = () => { setSpeakState(btn, false); URL.revokeObjectURL(url); afterSpeak(); };
        audio.onerror = () => setSpeakState(btn, false);
        audio.play();
        return;
      } catch (e) { setSpeakState(btn, false); }
    }
    if (!window.speechSynthesis) { showToast("Speech not supported in this browser"); return; }
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice(settings.lang);
    if (v) u.voice = v;
    u.lang = settings.lang;
    setSpeakState(btn, true);
    u.onend = () => { setSpeakState(btn, false); afterSpeak(); };
    u.onerror = () => setSpeakState(btn, false);
    speechSynthesis.speak(u);
  }

  function afterSpeak() {
    if (settings.handsfree && !speechDeps.getBusy()) setTimeout(() => startRecording(), 350);
  }

  /* --- speech-to-text --- */
  export const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, recording = false, recTimer = null, recStart = 0, waveTimer = null;

  /* --- one voice capture per turn (see CONFIG.oneVoicePerTurn) ---
     `voiceUsed` is set the moment a recording ends and cleared when the
     composer is emptied for the next prompt. While it is set, the mic is
     hidden — the visitor has already spoken for this turn. */
  let voiceUsed = false;

  export function updateMicState() {
    micBtn.hidden = recording || (CONFIG.oneVoicePerTurn && voiceUsed);
  }

  function buildWave() {
    wave.innerHTML = "";
    const n = window.innerWidth < 380 ? 24 : 34;
    for (let i = 0; i < n; i++) wave.appendChild(document.createElement("i"));
  }
  buildWave();
  window.addEventListener("resize", () => { if (!recording) buildWave(); });

  function animateWave() {
    Array.from(wave.children).forEach((b) => {
      b.style.height = (12 + Math.random() * 78) + "%";
      b.style.opacity = String(0.5 + Math.random() * 0.5);
    });
  }

  export function startRecording() {
    if (recording) return;
    /* guard: one capture per turn unless the config allows more */
    if (CONFIG.oneVoicePerTurn && voiceUsed) return;
    stopSpeaking();
    recording = true;

    composer.classList.add("rec");
    recorder.hidden = false;
    input.hidden = true;
    updateMicState();
    stopBtn.hidden = false;
    sendBtn.hidden = true;
    timerEl.textContent = "0:00/" + CONFIG.maxRecordSeconds;
    timerEl.classList.remove("warn");

    recStart = Date.now();
    animateWave();
    waveTimer = setInterval(animateWave, 130);
    recTimer = setInterval(() => {
      const s = Math.floor((Date.now() - recStart) / 1000);
      timerEl.textContent = "0:" + String(s).padStart(2, "0") + "/" + CONFIG.maxRecordSeconds;
      if (s >= CONFIG.maxRecordSeconds) stopRecording(true);
      else if (s >= CONFIG.maxRecordSeconds - 5) timerEl.classList.add("warn");
    }, 200);

    if (!SR) { startSimulated(); return; }
    try {
      recognition = new SR();
      recognition.lang = settings.lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      let finalText = "";
      recognition.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t; else interim += t;
        }
        const parts = [finalText.trim(), interim.trim()].filter(Boolean);
        input.value = parts.join(" ").replace(/\s{2,}/g, " ");
        speechDeps.onUiUpdate();
      };
      recognition.onerror = (e) => {
        if (e.error === "no-speech") return;
        if (!recording) return;
        showToast("Microphone unavailable — using demo voice input");
        switchToSimulated();
      };
      recognition.start();
    } catch (err) { startSimulated(); }
  }

  function startSimulated() {
    const samples = ["What projects have you built?", "Tell me about your skills",
      "Are you available for hire?", "How can I contact you?"];
    const phrase = samples[Math.floor(Math.random() * samples.length)];
    let i = 0;
    const t = setInterval(() => {
      input.value = phrase.slice(0, i);
      i += 2;
      if (i > phrase.length) { input.value = phrase; clearInterval(t); }
    }, 55);
  }
  function switchToSimulated() {
    if (recognition) { try { recognition.abort(); } catch (e) {} }
    startSimulated();
  }

  export function stopRecording(auto) {
    if (!recording) return;
    recording = false;
    clearInterval(recTimer); clearInterval(waveTimer);

    composer.classList.remove("rec");
    recorder.hidden = true;
    input.hidden = false;
    stopBtn.hidden = true;
    Array.from(wave.children).forEach((b) => { b.style.height = "14%"; b.style.opacity = ".85"; });

    /* the capture is over — withdraw the mic until the next prompt */
    voiceUsed = true;
    updateMicState();

    if (recognition) { try { recognition.stop(); } catch (e) {} recognition = null; }

    if (auto) showToast("Stopped at " + CONFIG.maxRecordSeconds + " seconds");
    speechDeps.onUiUpdate();
    /* The transcript stays in the composer for review/editing — never send
       on the visitor's behalf (see CONFIG.autoSendVoice). Focus so they can
       edit straight away; Send/Enter is their call. */
    input.focus({ preventScroll: true });
    if (!CONFIG.autoSendVoice) {
      if (!input.value.trim()) showToast("Didn't catch that — try again");
      return;
    }
    const text = input.value.trim();
    if (text) setTimeout(() => { if (!speechDeps.getBusy()) speechDeps.onSubmit(); }, auto ? 250 : 120);
    else showToast("Didn't catch that — try again");
  }

  micBtn.addEventListener("click", startRecording);
  stopBtn.addEventListener("click", () => stopRecording(false));

  
  /* One-way wiring: the orchestrator injects submit/busy/UI-refresh so this
     module never imports chat.js (the J6↔J7 cycle in the single-file build). */
  let speechDeps = { getBusy: () => false, onSubmit: () => {}, onUiUpdate: () => {} };
  export function initSpeech(d) { Object.assign(speechDeps, d); }
  export function isRecording() { return recording; }
  export function resetVoiceTurn() { voiceUsed = false; }
