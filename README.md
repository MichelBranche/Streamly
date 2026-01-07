# Streamly backend (v6)

Metti `package.json` **nella stessa cartella** di `server.js` (root del backend).

## Struttura consigliata
```
streamly/
  frontend/   (GitHub Pages: index.html, styles.css, script.js)
  backend/    (Node: server.js + package.json)
```

## Avvio in locale
Da `backend/`:
```
npm install
npm start
```
Backend: `http://localhost:8787`

## GitHub Pages (importante)
GitHub Pages è **solo statico**: non può gestire `POST /api/register`, upload o WebSocket.

Quindi:
1) Pubblica il backend su un host Node (Render/Fly/Railway/VPS).
2) Imposta `CORS_ORIGINS` con l’URL del tuo GitHub Pages (es: `https://<user>.github.io`).
3) In Streamly -> Settings -> **API Base** metti l’URL del backend (es: `https://streamly-backend.onrender.com`).

## Env opzionali
- `PORT` (default 8787)
- `CORS_ORIGINS` (default `*`, meglio restringere)
- `STREAMLY_DATA_DIR` (default `./data`)
- `STREAMLY_UPLOADS_DIR` (default `./uploads`)
