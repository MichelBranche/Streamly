# Streamly (frontend)

## Serve quello che hai fatto su Render?
Sì: se il frontend è su GitHub Pages (HTTPS) non puoi dipendere da `http://localhost` per profili/libreria/watch-party remoto.
Il backend deve stare online in HTTPS (es. Render) per:
- registrazione/login
- salvataggio libreria (non solo locale)
- upload poster
- watch party remoto (WebSocket)

## Cosa mettere in “API Base URL”
Inserisci l’URL del tuo backend Render (quello che finisce con `.onrender.com`), per esempio:
`https://streamly-ugmo.onrender.com`

Nota: la WebSocket usa automaticamente lo stesso dominio su `/ws` (quindi `wss://.../ws`).

## 409 (Conflict) su /api/register
Vuol dire che **l’utente esiste già**: vai su **Accedi** invece di **Crea profilo**.

## Config veloce senza riscrivere JS
In `index.html` c’è:
`<meta name="streamly-api-base" content="...">`
Puoi metterci lì il tuo URL backend, e l’app lo precompila.
