/* ================================================================
     J11 · ATTACHMENTS
     Split → js/attachments.js
     Files are read locally into data URLs, previewed above the composer,
     and stored on the message. Nothing is uploaded until you go live.
     ================================================================ */
import { CONFIG } from "./config.js";
import { $, $$, icon, esc, readAsDataURL, humanSize, showToast } from "./utils.js";

  const fileInput = $("#fileInput"), attachPreview = $("#attachPreview"),
    attachBtn = $("#attachBtn"), attachPop = $("#attachPop");
  let pending = [];

  /* Which picker each menu row opens. "camera" adds capture="environment"
     so phones open the rear camera straight away. */
  const ATTACH_ACCEPT = {
    image: "image/*",
    camera: "image/*",
    file: ".pdf,.txt,.md,.csv,.json,.doc,.docx,.zip"
  };

  function renderAttachPreview() {
    attachPreview.innerHTML = "";
    attachPreview.hidden = pending.length === 0;
    pending.forEach((f, idx) => {
      const chip = document.createElement("div");
      chip.className = "attach-chip";
      chip.innerHTML = (f.dataUrl ? '<img src="' + f.dataUrl + '" alt="' + esc(f.name) + '">'
                                  : '<span class="attach-chip__ext">' + esc((f.name.split(".").pop() || "file").slice(0, 4)) + "</span>") +
        '<button class="attach-chip__x" aria-label="Remove ' + esc(f.name) + '">' + icon("i-x", 11) + "</button>";
      chip.querySelector(".attach-chip__x").addEventListener("click", () => {
        pending.splice(idx, 1); renderAttachPreview(); attachDeps.onChange();
      });
      attachPreview.appendChild(chip);
    });
  }

  export function takeAttachments() {
    const files = pending.slice();
    pending = [];
    renderAttachPreview();
    return files;
  }

  function closeAttachMenu() {
    attachPop.hidden = true;
    attachBtn.setAttribute("aria-expanded", "false");
  }

  function openOsPicker(kind) {
    /* Every attach path ends here: the OS file picker does the choosing.
       That is the native behaviour on mobile and desktop alike. */
    fileInput.value = "";
    fileInput.accept = ATTACH_ACCEPT[kind] || "";
    fileInput.multiple = kind !== "camera";
    if (kind === "camera") fileInput.setAttribute("capture", "environment");
    else fileInput.removeAttribute("capture");
    fileInput.click();
  }

  attachBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    /* Single-tap mode: no menu, straight to the OS file manager. */
    if (!CONFIG.attachMenu) { openOsPicker("all"); return; }
    const open = attachPop.hidden;
    attachPop.hidden = !open;
    attachBtn.setAttribute("aria-expanded", String(open));
  });

  $$("[data-attach]", attachPop).forEach((btn) => btn.addEventListener("click", () => {
    const kind = btn.dataset.attach;
    closeAttachMenu();
    openOsPicker(kind);
  }));

  document.addEventListener("click", (e) => {
    if (!attachPop.hidden && !attachPop.contains(e.target) && !attachBtn.contains(e.target)) closeAttachMenu();
  });
  fileInput.addEventListener("change", async () => {
    const chosen = Array.from(fileInput.files || []);
    for (const f of chosen) {
      if (pending.length >= CONFIG.maxAttachments) { showToast("Up to " + CONFIG.maxAttachments + " files"); break; }
      if (f.size > CONFIG.maxAttachmentMB * 1048576) { showToast(f.name + " is over " + CONFIG.maxAttachmentMB + " MB"); continue; }
      let dataUrl = "";
      if (f.type.startsWith("image/")) {
        try { dataUrl = await readAsDataURL(f); } catch (e) { dataUrl = ""; }
      }
      pending.push({ name: f.name, type: f.type, size: humanSize(f.size), dataUrl: dataUrl });
    }
    fileInput.value = "";
    renderAttachPreview();
    attachDeps.onChange();
  });

  
  /* Callback out to the orchestrator (chat.js) — this module never imports it. */
  let attachDeps = { onChange: () => {} };
  export function initAttachments(d) { Object.assign(attachDeps, d); }
  export const getPendingCount = () => pending.length;
