# Streamly — v21 (Netflix-like mockup) 🎬

Mockup **Netflix-like** in **HTML/CSS/JS vanilla** + backend **Node.js** per:
- profili (username + password)
- libreria contenuti (vuota di default, la riempi tu)
- poster upload
- player (MP4/WEBM + embed YouTube/Vimeo se consentito)
- Watch Party **locale** (BroadcastChannel) + **remoto** (WebSocket)

> Nota: la libreria è **intenzionalmente vuota** finché non aggiungi tu i contenuti.

---

## Stack
- Frontend: HTML + CSS + JS (no framework)
- Backend: Node.js (HTTP API + WebSocket `/ws`)
- Storage: file system (`data/` + `uploads/`)  
  ⚠️ Su hosting “ephemeral” (Render Free senza disco persistente) i dati possono sparire a restart/deploy.

---

## Avvio rapido (locale)
### 1) Frontend
Apri `index.html` con:
- VSCode **Live Server** (tipico: `http://127.0.0.1:5500`)
- oppure qualunque server statico

### 2) Backend
Da `backend/`:
```bash
npm install
node server.js
