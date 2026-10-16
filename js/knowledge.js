/* ================================================================
     J2 · KNOWLEDGE BASE
     Split → js/knowledge.js
     ────────────────────────────────────────────────────────────────
     EDIT THIS BLOCK for your own portfolio — it is the only change
     needed to make the assistant yours.

     keys       words that route a question here. Word-boundary aware,
                so "you" never matches inside "your".
     exactOnly  true = must equal the whole message (used for greetings).
     thoughts   the steps shown in the "Thoughts" panel.
     reply      markdown-lite. Supported by the renderer in J3:
                  **bold**   *italic*   `code`
                  ```lang … ```   fenced code block (gets a copy button)
                  - bullets     1. numbered
                  | a | b |      tables
                  [text](https://url)   bare https://url
                  $inline math$   $$block math$$
     ================================================================ */
  export const PROFILE = {
    name: "Thoshan",
    role: "College student & developer",
    location: "India",
    email: "detu.glowworm706@aleeas.com"
  };

  export const KB = [
    {
      keys: ["hi", "hello", "hey", "hii", "namaste", "good morning", "good evening", "good afternoon"],
      exactOnly: true,
      thoughts: ["Greeting detected — opening with a short, warm intro."],
      reply: "Hi! I'm **Thoshan's assistant**. I can tell you about his projects, skills, experience and how to reach him — by typing or by voice. What would you like to know?"
    },
    {
      keys: ["project", "projects", "built", "portfolio", "made", "apps", "application"],
      thoughts: [
        "Question is about work / projects.",
        "Pulling the featured project list from the profile.",
        "Summarising each into one line so it reads well aloud."
      ],
      reply: "Here are the projects I'd highlight:\n\n- **Voice Portfolio Assistant** — this chatbot. Speech-to-text, text-to-speech and a hands-free voice call mode.\n- **Realtime Chat App** — websocket messaging with presence and typing states.\n- **Task Manager API** — a REST service with auth, roles and pagination.\n\nWant the tech stack, or a deeper dive on any one of them?"
    },
    {
      keys: ["skill", "skills", "tech", "stack", "technology", "technologies", "framework", "frameworks", "tools"],
      thoughts: ["Question maps to skills.", "Grouping into languages, frontend, backend and tooling for readability."],
      reply: "Thoshan works across the stack:\n\n- **Languages:** JavaScript / TypeScript, Python, Java, SQL\n- **Frontend:** React, HTML/CSS, responsive & mobile-first UI\n- **Backend:** Node.js, Express, REST APIs, WebSockets\n- **Tools:** Git, Docker, Linux, Vercel / Cloudflare\n- **AI:** speech-to-text, text-to-speech and LLM integration\n\nHe's most comfortable in JavaScript and Python."
    },
    {
      /* Demonstrates TABLE rendering (J3). Ask "show me a table". */
      keys: ["table", "compare", "comparison", "matrix", "grid"],
      thoughts: [
        "The visitor asked for a comparison.",
        "Building a real <table> rather than prose — it scans faster.",
        "Wide tables scroll horizontally on small screens."
      ],
      reply: "Here's a quick comparison:\n\n| Area | What he uses | Comfort |\n| --- | --- | --- |\n| Languages | JavaScript, Python | High |\n| Frontend | React, CSS | High |\n| Backend | Node, Express | Medium |\n| AI | STT, TTS, LLMs | Medium |\n\nAsk about any row and I'll go deeper."
    },
    {
      /* Demonstrates CODE BLOCK rendering + copy button (J3). */
      keys: ["code", "snippet", "example", "sample", "function"],
      thoughts: ["They want to see code.", "Returning a fenced block so it renders with a copy button."],
      reply: "Here's a small snippet from this project:\n\n```js\n// Score the visitor's question against the knowledge base\nfunction demoBrain(text) {\n  const q = text.toLowerCase();\n  const hit = KB.find(entry => entry.keys.some(k => q.includes(k)));\n  return hit || FALLBACK;\n}\n```\n\nWant the full file? Ask about the projects."
    },
    {
      /* Demonstrates LINK rendering (J3). REPLACE these with real URLs. */
      keys: ["link", "links", "url", "github", "repo", "website", "profile"],
      thoughts: ["They want links.", "Returning markdown links so they render as tappable anchors."],
      reply: "Here's where to find him:\n\n- Portfolio — [thoshan.example](https://thoshan.example)\n- GitHub — [github.com/thoshan](https://github.com/thoshan)\n- LinkedIn — [linkedin.com/in/thoshan](https://linkedin.com/in/thoshan)\n\nTap any of them to open."
    },
    {
      /* Demonstrates MATH rendering (J3). */
      keys: ["formula", "math", "equation", "complexity", "algorithm"],
      thoughts: ["A formula came up.", "Rendering it in a styled block so it stays readable."],
      reply: "A couple of formulas worth knowing:\n\nInline: $E = mc^2$\n\nBlock:\n\n$$\nT(n) = 2T(n/2) + O(n) = O(n \\log n)\n$$\n\nAsk if you want either explained."
    },
    {
      keys: ["experience", "intern", "internship", "job", "worked", "company", "background"],
      thoughts: ["Question is about experience.", "Listing roles in reverse-chronological order."],
      reply: "Thoshan's experience so far:\n\n- **Freelance Developer** — small web apps and landing pages for local clients.\n- **Open-source contributor** — bug fixes and documentation in projects he uses.\n- **College projects lead** — coordinated a four-person team on a full-stack build.\n\nHe's early in his career and learning fast."
    },
    {
      keys: ["education", "college", "study", "studying", "degree", "university", "school", "course", "branch"],
      thoughts: ["Question is about education.", "Keeping it to one line."],
      reply: "Thoshan is currently a **college student in India**, pursuing an engineering degree with a focus on computing. He balances coursework with hands-on building — this chatbot is one of those side projects."
    },
    {
      keys: ["contact", "email", "reach", "phone", "linkedin", "connect", "get in touch"],
      thoughts: ["Contact intent detected.", "Surfacing the professional channels only."],
      reply: "Best ways to reach Thoshan:\n\n- **Email** — the address in Settings → About\n- **LinkedIn** — linked in the site header\n- **GitHub** — all his public code lives there\n\nHe usually replies within a day."
    },
    {
      keys: ["hire", "hiring", "available", "freelance", "opportunity", "recruit", "work with you", "open to work", "collaborate"],
      thoughts: ["Availability intent.", "Answering honestly — student, open to part-time work."],
      reply: "Yes — Thoshan is **open to freelance work, internships and collaborations**. As a student he takes on projects that fit around his coursework, so smaller, well-scoped work is the best fit."
    },
    {
      keys: ["resume", "cv"],
      thoughts: ["Resume request.", "Pointing to the download link."],
      reply: "You can grab his resume from the **download button on the portfolio page**. If you'd like a short summary instead, just ask about his skills or projects."
    },
    {
      keys: ["about", "who are you", "yourself", "introduce", "tell me about you", "who is thoshan"],
      thoughts: ["Self-introduction request.", "Short bio, then an offer to go deeper."],
      reply: "I'm Thoshan's portfolio assistant — a voice-enabled chatbot you can talk to or type with. Thoshan is a **college student and developer in India** who likes building practical, useful software."
    },
    {
      keys: ["location", "where", "city", "based", "live"],
      thoughts: ["Asking about location.", "Giving the country-level answer he shares publicly."],
      reply: "Thoshan is based in **India** and works remotely. He's comfortable with Indian and international time zones."
    },
    {
      keys: ["voice", "speech", "tts", "stt", "chatbot", "this bot", "how do you work", "how does this work", "voice mode"],
      thoughts: ["Question is about how this bot works.", "Explaining the pipeline: listen → think → speak."],
      reply: "This assistant is a full voice loop:\n\n- **Listen** — your speech becomes text (speech-to-text)\n- **Think** — the text goes to a model for an answer\n- **Speak** — the answer is read aloud (text-to-speech)\n\nTap the **mic** to talk, the **speaker icon** on any reply to hear it again, or the **headset** in the header for a hands-free voice call."
    },
    {
      keys: ["attached", "file", "image", "screenshot", "upload", "picture", "photo"],
      thoughts: ["A file came in with the message.", "Being clear about what demo mode can and cannot do."],
      reply: "Got it — thanks for the file. In **demo mode** I can't read its contents, but once the API is connected the file is sent to the model along with your question, so it can describe or analyse it."
    },
    {
      keys: ["help", "what can you do", "capabilities", "commands", "options"],
      thoughts: ["Help request.", "Listing the main things this assistant can answer."],
      reply: "I can help with:\n\n- **Projects** — what Thoshan has built\n- **Skills & tech stack**\n- **Experience & education**\n- **Contact & availability**\n\nTry asking for a **table**, some **code**, or a **link** to see how replies are formatted."
    },
    {
      keys: ["thank", "thanks", "thx", "great", "awesome", "nice", "cool", "perfect"],
      thoughts: ["Gratitude — replying briefly and warmly."],
      reply: "You're welcome! Anything else you'd like to know about Thoshan?"
    },
    {
      keys: ["bye", "goodbye", "see you", "ok bye", "later"],
      thoughts: ["Sign-off detected.", "Short, friendly close."],
      reply: "Thanks for stopping by — feel free to reach out to Thoshan any time. Bye!"
    }
  ];

  export const FALLBACK = {
    thoughts: ["No direct match in the knowledge base.", "Being honest rather than inventing an answer."],
    reply: "I don't have a specific answer for that one yet. Try asking about Thoshan's **projects**, **skills**, **experience**, **education** or **contact details** — or ask for a **table** or some **code** to see the formatting."
  };

  