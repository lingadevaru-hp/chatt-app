/* ================================================================
     J3 · UTILITIES  (dom helpers, rich text renderer, misc)
     Split → js/utils.js
     ================================================================ */
  export const $ = (sel, root) => (root || document).querySelector(sel);
  export const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* Escape untrusted text before it goes anywhere near innerHTML. */
  export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  export const icon = (id, size) => '<svg width="' + (size || 20) + '" height="' + (size || 20) + '"><use href="#' + id + '"/></svg>';
  export const uid = () => "sess_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  export const nowISO = () => new Date().toISOString();

  /* ---------- rich text renderer ----------
     Markdown-lite → safe HTML. Order matters: we escape everything FIRST,
     then insert only our own tags. Inline code is pulled out into
     placeholders so later rules cannot touch it.

     Supported:
       ```lang … ```      fenced code (rendered with a copy button)
       | a | b |          tables (wrapped so they scroll on mobile)
       - item / 1. item   lists
       **bold** *italic*  emphasis
       [text](url)        links
       https://url        bare links
       $x$  $$x$$         inline and block math (monospace styling)
     To upgrade math to real typesetting, drop KaTeX in and replace
     .math / .math-block with rendered nodes — nothing else changes. */
  export function richInline(text) {
    let s = esc(text);
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (m, p1) => { codes.push(p1); return "\u0000" + (codes.length - 1) + "\u0000"; });
    s = s.replace(/\$\$([^$]+)\$\$/g, (m, p1) => '<span class="math">' + p1.trim() + "</span>");
    s = s.replace(/\$([^$]+)\$/g, (m, p1) => '<span class="math">' + p1.trim() + "</span>");
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    /* bare URLs — the leading class excludes quotes, so href="…" is safe */
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g,
      '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => "<code>" + codes[+i] + "</code>");
    return s;
  }

  export function richCodeBlock(lang, code) {
    return '<div class="code-block">' +
      '<div class="code-block__bar"><span>' + esc(lang || "code") + "</span>" +
      '<button class="act code-copy" type="button" aria-label="Copy code">' + icon("i-copy", 16) + "</button></div>" +
      "<pre><code>" + esc(code) + "</code></pre></div>";
  }

  export const richTableRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  export function richTable(head, rows) {
    return '<div class="table-wrap"><table><thead><tr>' +
      head.map((c) => "<th>" + richInline(c) + "</th>").join("") +
      "</tr></thead><tbody>" +
      rows.map((r) => "<tr>" + r.map((c) => "<td>" + richInline(c) + "</td>").join("") + "</tr>").join("") +
      "</tbody></table></div>";
  }

  export function formatReply(src) {
    /* Repair malformed link constructs on the RAW text, BEFORE splitting into
       lines. Models sometimes let a list break slide inside a link:
         [https://x\n-](https://x\n-)
       The href pattern in richInline() needs a whitespace-free URL, so that
       fails to match and the reply shows literal brackets and a dead link.
       It has to be fixed here because richInline() runs PER LINE — split
       first and the construct spans two lines, so neither half is
       recognisable. The stray "-" is the next bullet, so restore the break as
       a real newline rather than collapsing the whitespace, which would glue
       the bullet onto the URL and corrupt the address. */
    const raw = String(src == null ? "" : src)
      .replace(/\r/g, "")
      .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (m, text, url) => {
        if (!/\s/.test(url)) return m;
        return text.replace(/[ \t]*\n[ \t]*/g, "\n");
      });
    const lines = raw.split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      /* fenced code */
      if (/^\s*```/.test(line)) {
        const lang = line.trim().slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;                                        // closing fence
        out.push(richCodeBlock(lang, buf.join("\n")));
        continue;
      }

      /* table: a pipe row followed by a |---| separator row */
      if (line.includes("|") && i + 1 < lines.length &&
          /^\s*\|?[\s:|-]*-[\s:|-]*\|/.test(lines[i + 1])) {
        const head = richTableRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) { rows.push(richTableRow(lines[i])); i++; }
        out.push(richTable(head, rows));
        continue;
      }

      /* block math */
      if (/^\s*\$\$/.test(line)) {
        const buf = [];
        let first = line.trim().replace(/^\$\$/, "");
        if (/\$\$\s*$/.test(first) && first.length > 2) {
          out.push('<div class="math-block">' + esc(first.replace(/\$\$\s*$/, "").trim()) + "</div>");
          i++; continue;
        }
        if (first) buf.push(first);
        i++;
        while (i < lines.length && !/\$\$\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        if (i < lines.length) { buf.push(lines[i].replace(/\$\$\s*$/, "")); i++; }
        out.push('<div class="math-block">' + esc(buf.join("\n").trim()) + "</div>");
        continue;
      }

      /* lists */
      if (/^\s*-\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*-\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*-\s+/, "")); i++; }
        out.push("<ul>" + items.map((t) => "<li>" + richInline(t) + "</li>").join("") + "</ul>");
        continue;
      }
      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
        out.push("<ol>" + items.map((t) => "<li>" + richInline(t) + "</li>").join("") + "</ol>");
        continue;
      }

      /* blank line */
      if (!line.trim()) { i++; continue; }

      /* paragraph — swallow consecutive plain lines */
      const para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^\s*```/.test(lines[i]) && !/^\s*-\s+/.test(lines[i]) &&
             !/^\s*\d+\.\s+/.test(lines[i]) && !/^\s*\$\$/.test(lines[i])) {
        para.push(lines[i]); i++;
      }
      out.push("<p>" + para.map(richInline).join("<br>") + "</p>");
    }
    return out.join("");
  }

  /* Attach behaviour to rendered rich content (copy buttons on code blocks). */
  export function wireRich(root) {
    $$(".code-copy", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.closest(".code-block").querySelector("code");
        copyText(code ? code.textContent : "");
      });
    });
  }

  /* Plain text version — used for speech, captions and the PDF export. */
  export const plain = (md) => String(md == null ? "" : md)
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/[*`|]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\$\$/g, "")
    .replace(/\n+/g, " ")
    .trim();

  /* "just now" / "5 min ago" / "4 hr ago" / "1 day ago" */
  export function relTime(iso) {
    const mins = Math.floor((Date.now() - new Date(iso || 0).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + " hr ago";
    const days = Math.floor(hrs / 24);
    return days === 1 ? "1 day ago" : days + " days ago";
  }

  export const readAsDataURL = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  export const humanSize = (bytes) => bytes < 1024 ? bytes + " B"
    : bytes < 1048576 ? Math.round(bytes / 1024) + " KB"
    : (bytes / 1048576).toFixed(1) + " MB";

  
  /* --- toast + clipboard (moved here from J6 so every module shares one) ---
     DOM is queried lazily: modules evaluate before first paint, but these
     only run on user actions, long after parsing finished. */
  const toastEl = () => document.querySelector("#toast");
  const toastMsgEl = () => document.querySelector("#toastMsg");
  let toastTimer = null;
  export function showToast(msg) {
    const toast = toastEl(), toastMsg = toastMsgEl();
    if (!toast || !toastMsg) return;
    toastMsg.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2400);
  }
  export function hideToast() {
    const toast = toastEl();
    if (toast) toast.classList.remove("show");
  }
  export async function copyText(t) {
    try { await navigator.clipboard.writeText(t); showToast("Copied to clipboard"); }
    catch (e) { showToast("Copy failed — long-press to select"); }
  }
