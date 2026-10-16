/* ================================================================
     J7 · SPEECH  (text-to-speech + speech-to-text)
     Split → js/speech.js
     TTS = Sarvam Bulbul via our Worker. STT = Sarvam Saaras via our Worker
     too — the browser's own Web Speech API is deliberately NOT used: it only
     really works in Chrome, it hands the audio to Google, and it is not the
     API key the owner pays for. recordToBlob() below is the single audio
     path, shared with call mode.
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

  /* The <audio> currently playing a Sarvam clip. Module scope because
     stopSpeaking() has to be able to kill it: before this existed,
     stopSpeaking() only cancelled speechSynthesis, so the Sarvam audio kept
     playing. Tapping the button twice therefore started a SECOND clip on top
     of the first, and switching chats left the old one running. */
  let currentAudio = null;
  let speakPhase = "idle";   // idle | loading | speaking | paused

  const loadVoices = () => { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; };
  if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }

  export function pickVoice(lang) {
    if (!voices.length) loadVoices();
    const base = String(lang || "en-IN").split("-")[0];
    return voices.find((v) => v.lang && v.lang.toLowerCase() === String(lang).toLowerCase())
      || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(base))
      || voices.find((v) => /en/i.test(v.lang)) || null;
  }

  /* One button, four states. `loading` is the one that was missing: fetching
     the Sarvam clip is a network round trip, and with no visible state the
     button looked dead for a second or two — which is exactly when people
     tap it again and end up with two clips queued. */
  function setSpeakState(btn, phase) {
    if (speakBtnActive && speakBtnActive !== btn) setSpeakState(speakBtnActive, "idle");
    speakBtnActive = phase === "idle" ? (speakBtnActive === btn ? null : speakBtnActive) : btn;
    speakPhase = phase;
    if (!btn) return;
    btn.classList.toggle("speaking", phase === "speaking" || phase === "paused");
    btn.classList.toggle("loading", phase === "loading");
    const u = btn.querySelector("use");
    if (u) {
      u.setAttribute("href",
        phase === "loading" ? "#i-lotus"
          : phase === "speaking" ? "#i-pause"
            : phase === "paused" ? "#i-play"
              : "#i-speaker");
    }
  }

  export function stopSpeaking() {
    if (currentAudio) {
      const src = currentAudio.src;
      currentAudio.onended = currentAudio.onerror = null;
      try { currentAudio.pause(); } catch (e) {}
      currentAudio = null;
      /* Free the blob — these are per-reply and would otherwise pile up. */
      if (src && src.indexOf("blob:") === 0) { try { URL.revokeObjectURL(src); } catch (e) {} }
    }
    if (window.speechSynthesis) speechSynthesis.cancel();
    speakPhase = "idle";
    if (speakBtnActive) setSpeakState(speakBtnActive, "idle");
  }

  /* While a clip is playing the button is a PAUSE control, not a stop. */
  function pauseSpeaking(btn) {
    if (currentAudio) { try { currentAudio.pause(); } catch (e) {} }
    else if (window.speechSynthesis) { try { speechSynthesis.pause(); } catch (e) {} }
    setSpeakState(btn, "paused");
  }

  function resumeSpeaking(btn) {
    if (currentAudio) { currentAudio.play().catch(() => {}); }
    else if (window.speechSynthesis) { try { speechSynthesis.resume(); } catch (e) {} }
    setSpeakState(btn, "speaking");
  }

  export function speakToggle(text, btn) {
    /* Playing or paused -> pause / resume. Loading -> a second tap cancels. */
    if (btn && btn.classList.contains("speaking")) {
      if (speakPhase === "paused") resumeSpeaking(btn); else pauseSpeaking(btn);
      return;
    }
    if (btn && btn.classList.contains("loading")) { stopSpeaking(); return; }
    speak(text, btn);
  }

  /* Text prepared for the TTS engine, which is NOT the same as text for the
     eye. Two things must go before it is spoken:
       - URLs. Read aloud they become "h-t-t-p-s-colon-slash-slash…", which
         is worse than silence.
       - Emoji. The engine either names them ("rocket") or trips on them.
     plain() deliberately keeps both (captions and the PDF export want them),
     so the stripping lives here instead. */
  export function speechText(md) {
    return plain(md)
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/[\u2190-\u21FF\u2600-\u27BF\uFE0F]/g, "")
      /* Removing the URL leaves its label stranded — "Repo: · Wiki: · Model:".
         Only the known link labels are dropped, so ordinary text like
         "Note: something" survives untouched. */
      .replace(/\b(?:repo|wiki|on-?chain|model|site|live|portfolio|demo|links?)\s*:\s*/gi, "")
      .replace(/[\u00b7\u2022]/g, " ")          /* the · and • separators */
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s,;:.-]+/, "")
      .trim();
  }

  export async function speak(text, btn) {
    stopSpeaking();
    const clean = speechText(text);
    if (!clean) return;
    if (CONFIG.mode === "api") {
      setSpeakState(btn, "loading");
      try {
        const url = await apiSpeak(clean);
        /* The visitor may have switched chats or hit stop while we were
           fetching. Do not start playback into a UI that has moved on —
           that is how a clip used to "come back" seconds later. */
        if (speakBtnActive !== btn) { try { URL.revokeObjectURL(url); } catch (e) {} return; }

        const audio = new Audio(url);
        currentAudio = audio;
        const release = () => {
          if (currentAudio === audio) currentAudio = null;
          try { URL.revokeObjectURL(url); } catch (e) {}
        };
        audio.onended = () => { release(); setSpeakState(btn, "idle"); afterSpeak(); };
        audio.onerror = () => { release(); setSpeakState(btn, "idle"); };

        setSpeakState(btn, "speaking");
        /* play() rejects under the autoplay policy and on a bad blob. It used
           to be fired and forgotten, so a blocked play looked identical to a
           working one with the volume down. */
        await audio.play().catch((err) => {
          release();
          setSpeakState(btn, "idle");
          console.warn("[tts] playback blocked:", err && err.message);
          showToast("Tap once more — the browser blocked playback");
        });
        return;
      } catch (e) {
        /* The real voice failed. Falling back to the browser voice is a
           reasonable last resort, but doing it SILENTLY is what made this so
           hard to diagnose — it looked like the feature worked. Say so. */
        setSpeakState(btn, "idle");
        console.warn("[tts] Sarvam voice failed, falling back to browser voice:", e && e.message);
      }
    }
    if (!window.speechSynthesis) { showToast("Speech not supported in this browser"); return; }
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoice(settings.lang);
    if (v) u.voice = v;
    u.lang = settings.lang;
    setSpeakState(btn, "speaking");
    u.onend = () => { setSpeakState(btn, "idle"); afterSpeak(); };
    u.onerror = () => setSpeakState(btn, "idle");
    speechSynthesis.speak(u);
  }

  function afterSpeak() {
    if (settings.handsfree && !speechDeps.getBusy()) setTimeout(() => startRecording(), 350);
  }

  /* --- speech-to-text --- */
  /* ----------------------------------------------------------------
     AUDIO — the one place this app touches the microphone.

     Records with MediaRecorder (every browser) and returns a Blob. Shared
     by the composer mic and by call mode, so the audio path exists once.

     THE 30-SECOND CAP IS NOT ARBITRARY. Sarvam's REST speech-to-text
     endpoint rejects audio longer than 30s with a 422, so maxSeconds must
     stay at or under CONFIG.maxRecordSeconds (30). Do not raise one
     without the other.

     stopOnSilence: call mode has no Stop button, so it ends itself after
     `silenceMs` of quiet. Energy-based, not a real VAD — deliberately
     forgiving so a pause mid-sentence does not cut the visitor off.

     NOTE the honest tradeoff: the browser API used to return text WHILE
     you spoke. This path is batch — one round trip after recording stops.
     Live-as-you-speak needs Sarvam's Realtime WebSocket API.
     ---------------------------------------------------------------- */
  let activeRecorder = null;

  export function canRecord() {
    return CONFIG.mode === "api"
      && !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia
      && typeof MediaRecorder !== "undefined";
  }

  export function recordToBlob({ maxSeconds, stopOnSilence = false, silenceMs = 1400, onLevel = null }) {
    return new Promise((resolve, reject) => {
      /* Register the stop hook BEFORE asking for the mic. getUserMedia is
         async, so without this a Stop tapped while the permission prompt is
         still open would find nothing to stop — and the recorder would then
         start anyway and run the full cap. Resolves null in that case. */
      let cancelled = false;
      activeRecorder = { stop: () => { cancelled = true; } };

      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          activeRecorder = null;
          resolve(null);
          return;
        }
        const mr = new MediaRecorder(stream);
        const parts = [];
        let ctx = null, analyser = null, buf = null, raf = 0, done = false;
        let lastLoud = Date.now();
        let tick = null;

        const finish = () => {
          if (done) return;
          done = true;
          activeRecorder = null;
          if (tick) clearInterval(tick);
          if (raf) cancelAnimationFrame(raf);
          if (ctx) { try { ctx.close(); } catch (e) {} }
          try { mr.stop(); } catch (e) {}
        };

        mr.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
        mr.onstop = () => {
          /* Release the mic the moment recording ends — the OS indicator
             must not stay lit while we wait on the network. */
          stream.getTracks().forEach((t) => t.stop());
          const type = mr.mimeType || "audio/webm";
          resolve({ blob: new Blob(parts, { type }), type });
        };

        tick = setInterval(() => {
          if (Date.now() - lastLoud >= maxSeconds * 1000) finish();
        }, 200);

        if (stopOnSilence) {
          try {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            analyser = ctx.createAnalyser();
            analyser.fftSize = 512;
            ctx.createMediaStreamSource(stream).connect(analyser);
            buf = new Uint8Array(analyser.fftSize);
            const listen = () => {
              if (done) return;
              analyser.getByteTimeDomainData(buf);
              let peak = 0;
              for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
              if (onLevel) onLevel(peak / 128);
              if (peak > 8) lastLoud = Date.now();
              else if (Date.now() - lastLoud > silenceMs) { finish(); return; }
              raf = requestAnimationFrame(listen);
            };
            listen();
          } catch (e) {
            /* No AnalyserNode: fall back to the hard time stop above. */
          }
        }

        mr.start();
        activeRecorder = { stop: finish };   /* now a real stop, not a cancel */
      }).catch(reject);
    });
  }

  /* End an in-flight recording early (call mode's End and Mute). The
     promise from recordToBlob still resolves with whatever was captured;
     callers check whether they still care. Without this, ending a call
     leaves the mic open until the hard cap fires. */
  export function stopActiveRecording() {
    if (activeRecorder) activeRecorder.stop();
  }

  /* Post a clip and return the transcript. Throws on failure so callers can
     tell "nothing heard" (empty string) apart from "the call failed". */
  export async function transcribeBlob(blob, type) {
    if (!blob || !blob.size) throw new Error("empty audio");
    const res = await fetch(CONFIG.apiBase + "/stt", {
      method: "POST",
      headers: { "Content-Type": type },
      body: blob,
    });
    if (!res.ok) {
      const err = new Error("stt " + res.status);
      err.status = res.status;
      throw err;
    }
    const data = await res.json().catch(() => ({}));
    return (data.transcript || "").trim();
  }

  let recording = false, transcribing = false, recTimer = null, recStart = 0, waveTimer = null;

  /* --- one voice capture per turn (see CONFIG.oneVoicePerTurn) ---
     `voiceUsed` is set once a capture actually produced text, and cleared
     when the composer is emptied for the next prompt. While it is set the
     mic is hidden — the visitor has already spoken for this turn. */
  let voiceUsed = false;

  export function updateMicState() {
    /* Hidden while recording, while a transcript is in flight, and once
       this turn's single capture has produced something. */
    micBtn.hidden = recording || transcribing || (CONFIG.oneVoicePerTurn && voiceUsed);
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
    if (recording || transcribing) return;
    /* guard: one capture per turn unless the config allows more */
    if (CONFIG.oneVoicePerTurn && voiceUsed) return;

    /* Demo mode has no server, so there is nothing to transcribe with.
       Say so rather than opening the recorder and failing later. */
    if (!canRecord()) {
      showToast(CONFIG.mode === "api"
        ? "This browser can't record audio"
        : "Voice input needs the live API — demo mode has no server");
      return;
    }

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

    recordToBlob({ maxSeconds: CONFIG.maxRecordSeconds })
      .then((clip) => {
        /* null = Stop was tapped before the mic permission resolved, so
           nothing was ever recorded. Reset quietly, no error toast. */
        if (!clip) {
          recording = false;
          composer.classList.remove("rec");
          recorder.hidden = true;
          input.hidden = false;
          stopBtn.hidden = true;
          updateMicState();
          speechDeps.onUiUpdate();
          return;
        }
        /* The recorder stopped (Stop tapped, or the cap fired). Hand the
           clip over; the mic stays withdrawn while transcribing. */
        recording = false;
        transcribing = true;
        updateMicState();
        return transcribe(clip.blob, clip.type);
      })
      .catch(() => {
        recording = false;
        transcribing = false;
        composer.classList.remove("rec");
        recorder.hidden = true;
        input.hidden = false;
        stopBtn.hidden = true;
        updateMicState();
        speechDeps.onUiUpdate();
        showToast("Microphone permission denied");
      });
  }

  export function stopRecording(auto) {
    if (!recording) return;
    if (auto) showToast("Stopped at " + CONFIG.maxRecordSeconds + " seconds");

    clearInterval(recTimer); clearInterval(waveTimer);
    composer.classList.remove("rec");
    recorder.hidden = true;
    input.hidden = false;
    stopBtn.hidden = true;
    Array.from(wave.children).forEach((b) => { b.style.height = "14%"; b.style.opacity = ".85"; });
    speechDeps.onUiUpdate();

    /* finish() triggers mr.onstop, which resolves recordToBlob above. */
    if (activeRecorder) activeRecorder.stop();
    else recording = false;
  }

  /* Put the transcript in the composer. Never sends — the visitor reviews
     and edits first (see CONFIG.autoSendVoice). */
  async function transcribe(blob, type) {
    let captured = "";
    try {
      captured = await transcribeBlob(blob, type);
      if (captured) {
        /* Assign, never append: the mic is only offered when nothing has
           been captured this turn, and appending would double the text if
           a retry raced the first response. */
        input.value = captured;
      } else {
        showToast("Didn't catch that — try again");
      }
    } catch (e) {
      /* 422 from the Worker means Sarvam could not use the audio — almost
         always because it ran past 30s or was silent. */
      showToast(e && e.status === 422
        ? "Too long or unclear — try a shorter clip"
        : "Couldn't transcribe — try again");
    } finally {
      transcribing = false;
      /* Withdraw the mic ONLY when something was actually captured. If
         nothing was heard there is no turn to protect — and the toast
         invites a retry, which would be impossible with the mic gone. */
      voiceUsed = !!captured;
      updateMicState();
      speechDeps.onUiUpdate();
      if (captured) {
        /* Focus so they can edit straight away. Send/Enter is their call. */
        input.focus({ preventScroll: true });
        if (CONFIG.autoSendVoice) {
          setTimeout(() => { if (!speechDeps.getBusy()) speechDeps.onSubmit(); }, 120);
        }
      }
    }
  }

  micBtn.addEventListener("click", startRecording);
  stopBtn.addEventListener("click", () => stopRecording(false));

  
  /* One-way wiring: the orchestrator injects submit/busy/UI-refresh so this
     module never imports chat.js (the J6↔J7 cycle in the single-file build). */
  let speechDeps = { getBusy: () => false, onSubmit: () => {}, onUiUpdate: () => {} };
  export function initSpeech(d) { Object.assign(speechDeps, d); }
  export function isRecording() { return recording; }
  export function resetVoiceTurn() { voiceUsed = false; }
