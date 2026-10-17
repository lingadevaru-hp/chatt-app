# Thoshan · Portfolio Assistant — Web App

A voice-enabled chatbot for Thoshan's personal portfolio site. Visitors can type or talk, and replies can be read aloud. Built with vanilla HTML, CSS, and JavaScript (no frameworks).

**Version:** 1.3.0
**Last Updated:** October 17, 2026
**Status:** ✅ Speech-to-text fixed and ready for deployment

---

## 🚀 Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start development server (demo mode - no backend needed)
npm run dev

# Open in browser
# http://localhost:5173
```

The app runs in **demo mode** by default - all features work with no backend, using a local knowledge base.

---

## 🌐 Deployment

The web app consists of **two services** that must be deployed together:

1. **Backend (Python)**: STT (Vosk) + Chat/TTS proxy (Sarvam)
2. **Frontend (Static)**: Built with Vite, served as static files

### Recommended Hosting: Render (Free Tier)

Both services can be deployed on **Render** for free. See [render.yaml](render.yaml) for the complete configuration.

---

## 📦 Service 1: Backend (Python)

### What it does
- **Speech-to-Text (STT)**: Offline Vosk model (vosk-model-en-in-0.5) for Indian English
- **Chat**: Proxy to Sarvam AI API (requires `SARVAM_API_KEY`)
- **Text-to-Speech (TTS)**: Proxy to Sarvam AI TTS API
- **Health check**: `/health` endpoint

### Files
- `stt_service/main.py` - FastAPI application
- `stt_service/requirements.txt` - Python dependencies
- `render.yaml` - Render blueprint configuration

### Endpoints

| Method | Endpoint | Description | Authentication |
|--------|----------|-------------|----------------|
| POST | `/stt` | Speech-to-text (Vosk offline) | None |
| POST | `/chat` | Chat with Sarvam AI | `SARVAM_API_KEY` |
| POST | `/tts` | Text-to-speech (Sarvam) | `SARVAM_API_KEY` |
| GET | `/health` | Health check | None |

### Deployment Steps (Render)

1. **Create a new Web Service** in Render dashboard
2. **Connect GitHub repository**: `lingadevaru-hp/chatt-app`
3. **Configure Service:**
   - **Name:** `chatt-api` (or any name you prefer)
   - **Type:** Web Service
   - **Environment:** Python
   - **Region:** Choose closest to your users
   - **Plan:** Free
   - **Root Directory:** `stt_service`
   - **Build Command:** `pip install -r requirements.txt && apt-get update && apt-get install -y ffmpeg`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`

4. **Add Environment Variable:**
   - **Key:** `SARVAM_API_KEY`
   - **Value:** Your Sarvam AI API key (mark as **Secret**)
   - **Note:** This key is used for chat and TTS only. STT uses Vosk (offline, no API key).

5. **Deploy**
   - Click "Create Web Service"
   - Wait for build to complete (~5-10 minutes for first deploy, includes Vosk model download)
   - Note the service URL (e.g., `https://chatt-api.onrender.com`)

### Testing the Backend

```bash
# Test health endpoint
curl https://your-service-url.onrender.com/health

# Expected response:
# {"ok": true, "stt": "vosk-en-in", "key_set": true}
```

---

## 🎨 Service 2: Frontend (Static Site)

### What it does
- Voice-enabled chatbot UI
- Chat with Thoshan's portfolio knowledge base
- Speech-to-text via backend STT endpoint
- Text-to-speech via backend TTS endpoint
- Full-screen voice call mode
- Chat history, search, settings
- Mobile-first responsive design

### Files
- `index.html` - Main application (single-file for now)
- `js/` - JavaScript modules
- `styles/` - CSS files
- `vite.config.mjs` - Vite configuration

### Deployment Steps (Render)

1. **Create a new Static Site** in Render dashboard
2. **Connect GitHub repository**: `lingadevaru-hp/chatt-app`
3. **Configure Service:**
   - **Name:** `chatt-frontend` (or any name you prefer)
   - **Type:** Static Site
   - **Environment:** Static
   - **Region:** Same as backend
   - **Plan:** Free
   - **Root Directory:** `.` (root of repository)
   - **Build Command:** `npm install && VITE_MODE=api VITE_API_BASE=https://your-backend-url.onrender.com npm run build`
   - **Publish Directory:** `dist`

4. **Add Environment Variables:**
   - **Key:** `VITE_API_BASE`
     **Value:** Your backend service URL (e.g., `https://chatt-api.onrender.com`)
   
   - **Key:** `VITE_MODE`
     **Value:** `api`

5. **Deploy**
   - Click "Create Static Site"
   - Wait for build to complete (~2-5 minutes)
   - Your app will be live at the provided URL

### Important Notes

- **API Base URL**: Must match your backend service URL exactly
- **Mode**: Must be `api` (not `demo`) to use the backend
- **Demo Mode**: If `VITE_MODE` is not `api` or `VITE_API_BASE` is empty, the app runs in demo mode with no network calls

---

## 📋 Using render.yaml (Blueprint Deploy)

For easier deployment, use the provided `render.yaml` blueprint:

### Steps

1. **Push your code to GitHub** (already done)
2. **In Render dashboard:**
   - Click "New" → "Blueprint"
   - Select "From GitHub Repository"
   - Choose `lingadevaru-hp/chatt-app`
   - Select the `render.yaml` file
3. **Configure:**
   - Add `SARVAM_API_KEY` environment variable to the backend service
   - Update `VITE_API_BASE` to match your backend URL (or leave as `https://chatt-api.onrender.com` if using default)
4. **Deploy**

The blueprint will create both services automatically.

---

## 🔧 Configuration

### Environment Variables

#### Backend (stt_service)

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SARVAM_API_KEY` | ✅ Yes | Sarvam AI API key for chat/TTS | `sk-...` |
| `LOG_LEVEL` | ❌ No | Logging level | `INFO` (default) |

#### Frontend

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `VITE_API_BASE` | ✅ Yes | Backend service URL | `https://chatt-api.onrender.com` |
| `VITE_MODE` | ✅ Yes | Mode: `api` or `demo` | `api` |

### Configuration File

The frontend configuration is in `js/config.js`. Key settings:

```javascript
{
  mode: "api",              // or "demo"
  apiBase: "https://chatt-api.onrender.com",
  maxRecordSeconds: 30,
  historyWindow: 6,
  oneVoicePerTurn: true,
  autoSendVoice: false,
  attachMenu: true
}
```

---

## 🎯 Features

### ✅ Working Features

- **Chat**: Conversational interface with streaming replies
- **Voice Input**: Record speech, transcribe via backend STT
- **Voice Output**: Text-to-speech via backend TTS
- **Voice Call Mode**: Hands-free listen → think → speak loop
- **Search**: Search chat history by title and content
- **Settings**: Theme (dark/light/system), language, voice toggles
- **Attachments**: Photos, camera, files (preview in composer)
- **History**: Chat history with pin/rename/delete/share-as-PDF
- **Markdown**: Tables, code blocks with copy, links, lists, math
- **Mobile-First**: Responsive design, optimized for mobile

### 🌍 Language Support

- **Chat**: Multi-language (English, Kannada, Hindi, Tamil, Telugu, Malayalam, etc.)
- **STT**: Indian English (vosk-model-en-in-0.5)
- **TTS**: Multiple voices via Sarvam AI

---

## 💰 Cost & Budget

### Expected Costs (Per Month)

| Service | Cost | Notes |
|---------|------|-------|
| Render Backend | ~$0 | Free tier sufficient for low traffic |
| Render Frontend | ~$0 | Free tier (static site) |
| Sarvam Chat API | ~₹0-80 | Pay-per-use, depends on usage |
| Sarvam TTS API | ~₹0-40 | Pay-per-use, depends on usage |
| **Total** | **₹0-120** | For 5-30 minutes of conversation/month |

### Cost Optimization

- ✅ STT is **free** (Vosk offline, no API calls)
- ✅ System prompt is short (portfolio facts only)
- ✅ Context capped at 12 messages
- ✅ Output capped at ~400 tokens
- ✅ TTS responses can be cached (not yet implemented)

### Budget Protection

- ⚠️ **Disable auto-recharge** in Sarvam dashboard
- When credits hit zero, API returns error and stops
- No risk of unexpected charges

---

## 🧪 Testing Checklist

Run these tests at **360px, 390px, and 1280px** widths:

### ✅ Demo Mode (No Backend)
- [ ] App loads and works without network
- [ ] Chat with local knowledge base works
- [ ] All UI features functional
- [ ] No console errors

### ✅ API Mode (With Backend)
- [ ] Chat sends to backend, receives replies
- [ ] STT records audio, transcribes via backend
- [ ] TTS synthesizes speech via backend
- [ ] Voice call mode works end-to-end
- [ ] All settings persist
- [ ] No console errors
- [ ] No horizontal page overflow

### 📱 Mobile-Specific Tests
- [ ] Keyboard stays open after send
- [ ] Mic visible at start, hidden after capture
- [ ] 30-second recording cap works
- [ ] Attach menu aligned with composer
- [ ] Attachment thumbnails appear correctly
- [ ] Tables scroll horizontally on narrow screens
- [ ] Code blocks have working copy button
- [ ] Links are tappable

---

## 🐛 Troubleshooting

### STT Not Working

**Symptoms:** Mic button doesn't respond, no transcription

**Check:**
1. ✅ Backend service is running
2. ✅ `VITE_MODE=api` is set
3. ✅ `VITE_API_BASE` points to correct backend URL
4. ✅ Backend `/health` endpoint returns `{"ok": true}`
5. ✅ Browser console shows no errors
6. ✅ Microphone permission granted

**Fix:**
- Check browser console for errors
- Test backend STT endpoint directly:
  ```bash
  # Record audio and test
  curl -X POST -F "audio=@test.webm" https://your-backend-url.onrender.com/stt
  ```

### TTS Not Working

**Symptoms:** Speaker button doesn't play audio

**Check:**
1. ✅ `SARVAM_API_KEY` is set in backend
2. ✅ Backend `/chat` and `/tts` endpoints work
3. ✅ No 401/403 errors in browser console

**Fix:**
- Verify `SARVAM_API_KEY` is correct
- Test backend TTS endpoint:
  ```bash
  curl -X POST -H "Content-Type: application/json" \
    -d '{"text":"Hello","lang":"en-IN"}' \
    https://your-backend-url.onrender.com/tts
  ```

### App Stuck in Demo Mode

**Symptoms:** All features work but no backend calls

**Check:**
1. ✅ `VITE_MODE=api` (not `demo`)
2. ✅ `VITE_API_BASE` is set and not empty
3. ✅ Frontend was rebuilt after setting environment variables

**Fix:**
- Rebuild frontend: `VITE_MODE=api VITE_API_BASE=https://your-backend-url npm run build`
- Clear browser cache

---

## 📚 Project Structure

```
chatt-app/
├── index.html                 # Main HTML (single-file for now)
├── js/                        # JavaScript modules
│   ├── config.js              # Configuration
│   ├── brain.js              # Demo brain + API calls
│   ├── chat.js               # Chat logic
│   ├── speech.js             # STT/TTS logic
│   ├── call.js               # Voice call mode
│   ├── store.js              # State management
│   ├── utils.js              # Utilities
│   ├── settings.js           # Settings
│   ├── attachments.js        # Attachment handling
│   └── turnstile.js          # Turnstile (now plain fetch)
├── styles/                    # CSS files
│   └── ...                    # Style modules
├── stt_service/               # Backend service
│   ├── main.py               # FastAPI application
│   ├── requirements.txt      # Python dependencies
│   └── .env.example          # Environment template
├── render.yaml               # Render blueprint
├── vite.config.mjs           # Vite configuration
└── package.json              # Node.js dependencies
```

---

## 📖 Documentation

- **Main README:** This file
- **Android App:** [androidapp/README.md](../Chatting%20Android%20application./README.md)
- **Backend Docs:** See `stt_service/main.py` header comments
- **Frontend Docs:** See comments in `index.html` and `js/*.js` files

---

## 🔒 Privacy & Security

### Data Handling
- ✅ **No API keys in frontend** - All keys stored server-side
- ✅ **Chat history local** - Stored in browser localStorage
- ✅ **STT offline** - Vosk model runs on Render, no external API
- ✅ **Minimal data collection** - No analytics, no tracking

### User Data
- Chat messages: Stored locally in browser
- No server-side history
- No user accounts
- No personal data collected

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly (see Testing Checklist)
5. Submit a pull request

---

## 📄 License

This project is proprietary. All rights reserved.

---

## 🆘 Support

- **Issues:** Create a GitHub issue in the respective repository
- **Questions:** contact@lingadevaru.in
- **Bug Reports:** Include browser, OS, steps to reproduce

---

## 📊 Analytics

No analytics or tracking is implemented. The app is completely private and offline-capable.

---

## 🎨 Design System

- **Background:** `#0a0a0b` (dark theme default)
- **Accent Color:** `#e8703a` (orange)
- **Typography:** System fonts
- **Theme:** Dark by default, with light/system options

---

## Repository

- **Source:** `github.com/lingadevaru-hp/chatt-app`
- **Backend:** Python FastAPI + Vosk STT
- **Frontend:** Vanilla HTML/CSS/JS + Vite
- **Deployment:** Render (free tier)
