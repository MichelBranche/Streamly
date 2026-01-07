// Streamly Watch Party Relay (WebSocket)
// Usage:
//   npm i ws
//   node server.js
// Env:
//   PORT=3001 (default)

const http = require("http");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3001);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Streamly WS relay is running.\n");
});

const wss = new WebSocket.Server({ server });

/** room -> Set<ws> */
const rooms = new Map();

function joinRoom(ws, room) {
  leaveRoom(ws);

  ws._room = room;
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
}

function leaveRoom(ws) {
  const room = ws._room;
  if (!room) return;

  const set = rooms.get(room);
  if (set) {
    set.delete(ws);
    if (set.size === 0) rooms.delete(room);
  }
  ws._room = null;
}

function broadcast(room, data, exceptWs) {
  const set = rooms.get(room);
  if (!set) return;

  for (const client of set) {
    if (client === exceptWs) continue;
    if (client.readyState !== WebSocket.OPEN) continue;
    try { client.send(data); } catch {}
  }
}

// heartbeat
function heartbeat() { this.isAlive = true; }

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", heartbeat);

  ws.on("message", (data) => {
    // Accept either JSON object or already-stringified payload.
    // Expected from client:
    //   { type: "join", room, from }
    //   { type: "sync", room, from, payload }
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }

    if (!msg || typeof msg !== "object") return;

    if (msg.type === "join" && typeof msg.room === "string") {
      const room = msg.room.trim();
      if (!room) return;
      joinRoom(ws, room);
      // Acknowledge
      const ack = JSON.stringify({ type: "joined", room });
      try { ws.send(ack); } catch {}
      return;
    }

    // Relay: must be in a room, and must include room
    const room = typeof msg.room === "string" ? msg.room.trim() : "";
    if (!room) return;
    if (!ws._room || ws._room !== room) return;

    // Re-broadcast exact bytes for minimal overhead
    broadcast(room, data, ws);
  });

  ws.on("close", () => {
    leaveRoom(ws);
  });

  ws.on("error", () => {
    leaveRoom(ws);
  });
});

const interval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, 30000);

wss.on("close", () => clearInterval(interval));

server.listen(PORT, () => {
  console.log(`Streamly WS relay listening on ws://localhost:${PORT}`);
});
