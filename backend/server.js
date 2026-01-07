/**
 * Streamly backend (v6)
 * - Auth (register/login) + Bearer token
 * - Library per-user (JSON files in ./data)
 * - Poster upload -> ./uploads (served at /uploads/...)
 * - Watch Party WebSocket relay -> /ws
 *
 * Local:
 *   npm install
 *   npm start
 */

"use strict";

const http = require("http");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");
const Busboy = require("busboy");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = path.resolve(process.env.STREAMLY_DATA_DIR || "./data");
const UPLOADS_DIR = path.resolve(process.env.STREAMLY_UPLOADS_DIR || "./uploads");

const USERS_FILE = path.join(DATA_DIR, "users.json");
const SECRET_FILE = path.join(DATA_DIR, "secret.txt");

const MAX_JSON = 1 * 1024 * 1024;      // 1MB
const MAX_UPLOAD = 5 * 1024 * 1024;    // 5MB
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CORS_ORIGINS = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

let SECRET = null;

/* ------------------------------ utils ------------------------------ */

const now = () => Date.now();

const b64urlEncode = (buf) =>
  Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const b64urlDecode = (str) => {
  let s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
};

const safeName = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .slice(0, 64);

const libraryFileFor = (username) =>
  path.join(DATA_DIR, `library_${safeName(username)}.json`);

const pickCorsOrigin = (origin) => {
  if (!origin) return "*";
  if (CORS_ORIGINS.includes("*")) return "*";
  if (CORS_ORIGINS.includes(origin)) return origin;
  return CORS_ORIGINS[0] || "*";
};

const corsHeaders = (origin) => {
  const o = pickCorsOrigin(origin);
  return {
    "Access-Control-Allow-Origin": o,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "false",
  };
};

const sendJson = (res, status, obj, origin) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...corsHeaders(origin),
  });
  res.end(body);
};

const readJson = async (file, fallback) => {
  try {
    const raw = await fsp.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJsonAtomic = async (file, data) => {
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fsp.rename(tmp, file);
};

const readBodyJson = async (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_JSON) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const obj = raw ? JSON.parse(raw) : {};
        resolve(obj);
      } catch (e) {
        reject(Object.assign(new Error("Bad JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });

/* ------------------------------ auth ------------------------------ */

const loadOrCreateSecret = async () => {
  try {
    const s = (await fsp.readFile(SECRET_FILE, "utf8")).trim();
    if (s) return s;
  } catch {}
  const s = crypto.randomBytes(32).toString("hex");
  await fsp.writeFile(SECRET_FILE, s, "utf8");
  return s;
};

const hashPassword = (password, saltHex = null) => {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password), salt, 120_000, 32, "sha256");
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
};

const verifyPassword = (password, rec) => {
  if (!rec?.salt || !rec?.hash) return false;
  const { hash } = hashPassword(password, rec.salt);
  try {
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(rec.hash, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

const signToken = (username) => {
  const payload = { u: username, exp: now() + TOKEN_TTL_MS };
  const b = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64urlEncode(crypto.createHmac("sha256", SECRET).update(b).digest());
  return `${b}.${sig}`;
};

const verifyToken = (token) => {
  const t = String(token || "");
  const parts = t.split(".");
  if (parts.length !== 2) return null;
  const [b, sig] = parts;

  const expected = b64urlEncode(crypto.createHmac("sha256", SECRET).update(b).digest());
  try {
    const a = Buffer.from(sig);
    const c = Buffer.from(expected);
    if (a.length !== c.length) return null;
    if (!crypto.timingSafeEqual(a, c)) return null;
  } catch {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(b).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.u || !Number.isFinite(payload.exp)) return null;
  if (payload.exp < now()) return null;
  return payload;
};

const getAuthUser = (req) => {
  const h = String(req.headers.authorization || "");
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const p = verifyToken(m[1].trim());
  return p?.u || null;
};

/* ------------------------------ storage ------------------------------ */

const ensureUserFiles = async (username) => {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });

  const users = await readJson(USERS_FILE, { users: {} });
  if (!users.users) users.users = {};
  if (!(safeName(username) in users.users)) return;

  const libFile = libraryFileFor(username);
  const exists = await fsp
    .stat(libFile)
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    await writeJsonAtomic(libFile, { items: [] });
  }
};

const loadUsers = async () => {
  const u = await readJson(USERS_FILE, { users: {} });
  if (!u.users) u.users = {};
  return u;
};

const saveUsers = async (usersObj) => {
  await writeJsonAtomic(USERS_FILE, usersObj);
};

const loadLibrary = async (username) => {
  const file = libraryFileFor(username);
  const d = await readJson(file, { items: [] });
  if (!Array.isArray(d.items)) d.items = [];
  return d;
};

const saveLibrary = async (username, lib) => {
  const file = libraryFileFor(username);
  await writeJsonAtomic(file, lib);
};

/* ------------------------------ uploads ------------------------------ */

const extFromMime = (mime) => {
  const m = String(mime || "").toLowerCase();
  if (m === "image/jpeg") return ".jpg";
  if (m === "image/png") return ".png";
  if (m === "image/webp") return ".webp";
  return "";
};

const serveUpload = async (req, res, pathname, origin) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed" }, origin);
    return;
  }
  const name = decodeURIComponent(pathname.slice("/uploads/".length));
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    sendJson(res, 404, { error: "Not found" }, origin);
    return;
  }

  const filePath = path.resolve(path.join(UPLOADS_DIR, name));
  if (!filePath.startsWith(UPLOADS_DIR)) {
    sendJson(res, 404, { error: "Not found" }, origin);
    return;
  }

  try {
    const st = await fsp.stat(filePath);
    if (!st.isFile()) throw new Error("not file");
    const ext = path.extname(filePath).toLowerCase();
    const ct = MIME_BY_EXT[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct, "Content-Length": st.size, ...corsHeaders(origin) });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch {
    sendJson(res, 404, { error: "Not found" }, origin);
  }
};

/* ------------------------------ routing ------------------------------ */

const handler = async (req, res) => {
  const origin = req.headers.origin || "";
  const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = u.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  // uploads
  if (pathname.startsWith("/uploads/")) {
    return serveUpload(req, res, pathname, origin);
  }

  // health
  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, ts: now() }, origin);
  }

  // register
  if (req.method === "POST" && pathname === "/api/register") {
    try {
      const body = await readBodyJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");

      if (!username || username.length < 3) return sendJson(res, 400, { error: "Username troppo corto" }, origin);
      if (!password || password.length < 6) return sendJson(res, 400, { error: "Password troppo corta (min 6)" }, origin);

      const users = await loadUsers();
      const key = safeName(username);
      if (users.users[key]) return sendJson(res, 409, { error: "Utente già esistente" }, origin);

      const pass = hashPassword(password);
      users.users[key] = { username, ...pass, createdAt: now() };

      await fsp.mkdir(DATA_DIR, { recursive: true });
      await saveUsers(users);
      await saveLibrary(username, { items: [] });

      const token = signToken(username);
      return sendJson(res, 200, { token }, origin);
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message || "Errore" }, origin);
    }
  }

  // login
  if (req.method === "POST" && pathname === "/api/login") {
    try {
      const body = await readBodyJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");

      const users = await loadUsers();
      const rec = users.users[safeName(username)];
      if (!rec) return sendJson(res, 401, { error: "Credenziali non valide" }, origin);
      if (!verifyPassword(password, rec)) return sendJson(res, 401, { error: "Credenziali non valide" }, origin);

      await ensureUserFiles(username);
      const token = signToken(username);
      return sendJson(res, 200, { token }, origin);
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message || "Errore" }, origin);
    }
  }

  // auth required below
  const username = getAuthUser(req);
  const requireAuth = () => {
    sendJson(res, 401, { error: "Unauthorized" }, origin);
  };

  if (pathname === "/api/me") {
    if (!username) return requireAuth();
    return sendJson(res, 200, { username }, origin);
  }

  // upload poster
  if (pathname === "/api/upload/poster") {
    if (!username) return requireAuth();
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" }, origin);

    await fsp.mkdir(UPLOADS_DIR, { recursive: true });

    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_UPLOAD, files: 1, fields: 10 },
    });

    let savedName = null;
    let aborted = false;

    const done = (status, obj) => {
      if (aborted) return;
      aborted = true;
      sendJson(res, status, obj, origin);
    };

    bb.on("file", (field, file, info) => {
      if (field !== "poster") {
        file.resume();
        return;
      }
      const ext = extFromMime(info.mimeType);
      if (!ext) {
        file.resume();
        done(400, { error: "Formato poster non supportato (jpg/png/webp)" });
        return;
      }
      const filename = `${crypto.randomUUID()}${ext}`;
      const target = path.join(UPLOADS_DIR, filename);
      const ws = fs.createWriteStream(target);

      file.on("limit", () => {
        try { ws.destroy(); } catch {}
        try { fs.unlinkSync(target); } catch {}
        done(413, { error: "Poster troppo grande (max 5MB)" });
      });

      file.pipe(ws);
      ws.on("finish", () => {
        if (aborted) return;
        savedName = filename;
      });
      ws.on("error", () => {
        try { fs.unlinkSync(target); } catch {}
        done(500, { error: "Upload fallito" });
      });
    });

    bb.on("finish", () => {
      if (aborted) return;
      if (!savedName) return done(400, { error: "Nessun file caricato" });
      return done(200, { posterUrl: `/uploads/${savedName}` });
    });

    bb.on("error", () => done(400, { error: "Multipart non valido" }));

    req.pipe(bb);
    return;
  }

  // library
  if (pathname === "/api/library") {
    if (!username) return requireAuth();

    if (req.method === "GET") {
      const lib = await loadLibrary(username);
      return sendJson(res, 200, { items: lib.items }, origin);
    }

    if (req.method === "POST") {
      try {
        const body = await readBodyJson(req);
        const title = String(body.title || "").trim();
        const kind = String(body.kind || "movie");
        const posterUrl = String(body.posterUrl || "").trim();
        const videoUrl = String(body.videoUrl || "").trim();
        const trailerUrl = String(body.trailerUrl || "").trim();

        if (!title) return sendJson(res, 400, { error: "Titolo mancante" }, origin);
        if (!videoUrl) return sendJson(res, 400, { error: "Video URL mancante" }, origin);
        if (!posterUrl) return sendJson(res, 400, { error: "Poster mancante" }, origin);

        const lib = await loadLibrary(username);
        const item = {
          id: crypto.randomUUID(),
          title,
          kind,
          posterUrl,
          videoUrl,
          trailerUrl,
          watchlist: false,
          rating: null,
          addedAt: now(),
        };
        lib.items.unshift(item);
        await saveLibrary(username, lib);
        return sendJson(res, 200, { item }, origin);
      } catch (e) {
        return sendJson(res, e.status || 500, { error: e.message || "Errore" }, origin);
      }
    }

    return sendJson(res, 405, { error: "Method not allowed" }, origin);
  }

  // library item routes
  const m = pathname.match(/^\/api\/library\/([^/]+)$/);
  if (m) {
    if (!username) return requireAuth();
    const id = decodeURIComponent(m[1]);

    if (req.method === "PATCH") {
      try {
        const patch = await readBodyJson(req);
        const lib = await loadLibrary(username);
        const idx = lib.items.findIndex((x) => x.id === id);
        if (idx < 0) return sendJson(res, 404, { error: "Not found" }, origin);

        const allowed = new Set(["title", "kind", "posterUrl", "videoUrl", "trailerUrl", "watchlist", "rating"]);
        for (const k of Object.keys(patch || {})) {
          if (!allowed.has(k)) continue;
          lib.items[idx][k] = patch[k];
        }

        await saveLibrary(username, lib);
        return sendJson(res, 200, { item: lib.items[idx] }, origin);
      } catch (e) {
        return sendJson(res, e.status || 500, { error: e.message || "Errore" }, origin);
      }
    }

    if (req.method === "DELETE") {
      const lib = await loadLibrary(username);
      const idx = lib.items.findIndex((x) => x.id === id);
      if (idx < 0) return sendJson(res, 404, { error: "Not found" }, origin);

      const [removed] = lib.items.splice(idx, 1);
      await saveLibrary(username, lib);

      // best-effort delete poster file if local upload
      const p = String(removed?.posterUrl || "");
      if (p.startsWith("/uploads/")) {
        const name = p.slice("/uploads/".length);
        const fp = path.resolve(path.join(UPLOADS_DIR, name));
        if (fp.startsWith(UPLOADS_DIR)) {
          fsp.unlink(fp).catch(() => {});
        }
      }

      return sendJson(res, 200, { ok: true }, origin);
    }

    return sendJson(res, 405, { error: "Method not allowed" }, origin);
  }

  // fallback
  sendJson(res, 404, { error: "Not found" }, origin);
};

/* ------------------------------ WS relay ------------------------------ */

const rooms = new Map(); // room -> Set<ws>

const joinRoom = (ws, room) => {
  const r = String(room || "").trim();
  if (!r) return;
  if (ws._room) leaveRoom(ws);

  ws._room = r;
  if (!rooms.has(r)) rooms.set(r, new Set());
  rooms.get(r).add(ws);
};

const leaveRoom = (ws) => {
  const r = ws._room;
  if (!r) return;
  const set = rooms.get(r);
  if (set) {
    set.delete(ws);
    if (set.size === 0) rooms.delete(r);
  }
  ws._room = null;
};

const broadcastToRoom = (room, fromWs, msg) => {
  const set = rooms.get(room);
  if (!set) return;
  const data = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const client of set) {
    if (client === fromWs) continue;
    if (client.readyState !== 1) continue;
    try { client.send(data); } catch {}
  }
};

/* ------------------------------ boot ------------------------------ */

(async () => {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  await fsp.mkdir(UPLOADS_DIR, { recursive: true });
  SECRET = await loadOrCreateSecret();

  // Ensure users.json exists
  const u = await readJson(USERS_FILE, null);
  if (!u) await writeJsonAtomic(USERS_FILE, { users: {} });

  const server = http.createServer((req, res) => {
    handler(req, res).catch((e) => {
      const origin = req.headers.origin || "";
      sendJson(res, 500, { error: e?.message || "Errore" }, origin);
    });
  });

  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    ws.isAlive = true;

    ws.on("pong", () => (ws.isAlive = true));

    ws.on("message", (data) => {
      try {
        if (data && data.length && data.length > 64 * 1024) return; // 64KB
        const str = Buffer.isBuffer(data) ? data.toString("utf8") : String(data || "");
        const msg = JSON.parse(str);

        if (msg?.type === "join") {
          joinRoom(ws, msg.room);
          return;
        }

        const room = String(msg?.room || ws._room || "").trim();
        if (!room) return;

        if (!ws._room) joinRoom(ws, room);
        broadcastToRoom(room, ws, msg);
      } catch {}
    });

    ws.on("close", () => leaveRoom(ws));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 30000);

  server.on("close", () => clearInterval(heartbeat));

  server.listen(PORT, () => {
    console.log(`Streamly backend on http://localhost:${PORT}`);
  });
})();
