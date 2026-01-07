/* 
  STREAMLY NOTE (LOCAL NETWORK BLOCK)
  If your frontend is on HTTPS (GitHub Pages), Chrome will block API calls to http://localhost or private IPs.
  This build auto-ignores saved localhost/private apiBase and prefers meta streamly-api-base (Render HTTPS).
  If you still see blocks, clear LocalStorage keys: streamly_settings_v2, streamly_token_v1 and refresh.
*/

/* Streamly — vanilla HTML/CSS/JS (v5)
   - Profiles (username + password) via API server (server.js)
   - Library persisted server-side (JSON + /uploads for posters)
   - Like/Dislike, Watchlist
   - Player: direct mp4/webm + YouTube/Vimeo embed
   - Watch Party: Local (BroadcastChannel) + Remote (WebSocket relay) for 2+ computers
   Notes:
   - For perfect sync use direct <video>. YouTube/Vimeo: best-effort (reload with start).
*/

(() => {
  "use strict";

  /* ------------------------------ storage keys ------------------------------ */
  const SETTINGS_KEY = "streamly:v5:settings";
  const TOKEN_KEY = "streamly:v5:token";

  /* ------------------------------ helpers ------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const uid = () => {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  };

  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

  const safeJsonParse = (s, fallback) => {
    try { return JSON.parse(s); } catch { return fallback; }
  };

  const safeGet = (key, fallback) => {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return safeJsonParse(raw, fallback);
  };

  const safeSet = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  };

  const normalizeBase = (url) => {
    const u = String(url || "").trim();
    if (!u) return "";
    try {
      const p = new URL(u, location.origin);
      return p.origin; // no path
    } catch {
      // allow users to paste origin-like strings without protocol? (best effort)
      return u.replace(/\/+$/, "");
    }
  };

  const isPrivateHostname = (host) => {
    const h = String(host || "").toLowerCase();
    if (!h) return false;
    if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") return true;
    if (h.endsWith(".local")) return true;

    const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!ip) return false;
    const a = Number(ip[1]), b = Number(ip[2]), c = Number(ip[3]), d = Number(ip[4]);
    if (![a,b,c,d].every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) return false;

    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  };

  const isBlockedLocalNetworkUrl = (base) => {
    try {
      const u = new URL(normalizeBase(base), location.origin);
      return u.protocol === "http:" && isPrivateHostname(u.hostname);
    } catch {
      return false;
    }
  };


  const toWsUrl = (apiBase) => {
    try {
      const u = new URL(apiBase);
      u.protocol = (u.protocol === "https:" ? "wss:" : "ws:");
      u.pathname = "/ws";
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch {
      return "";
    }
  };

  const resolveUrl = (apiBase, maybeRelative) => {
    const u = String(maybeRelative || "").trim();
    if (!u) return "";
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith("//")) return location.protocol + u;
    if (u.startsWith("/")) return `${apiBase}${u}`;
    // relative path
    return `${apiBase}/${u}`;
  };

  const kindLabel = (kind) => {
    if (kind === "movie") return "Film";
    if (kind === "series") return "Serie";
    return "Altro";
  };

  const isDirectVideo = (url) => /\.(mp4|webm)(\?.*)?$/i.test(url.trim());
  const isYouTube = (url) => /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/i.test(url);
  const isVimeo = (url) => /vimeo\.com\/(\d+)/i.test(url) || /player\.vimeo\.com\/video\/(\d+)/i.test(url);

  const parseYouTubeId = (url) => {
    const m1 = url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
    if (m1) return m1[1];
    const u = new URL(url, location.origin);
    const v = u.searchParams.get("v");
    if (v) return v;
    const m2 = url.match(/\/embed\/([A-Za-z0-9_-]{6,})/i);
    return m2 ? m2[1] : null;
  };

  const parseVimeoId = (url) => {
    const m1 = url.match(/vimeo\.com\/(\d+)/i);
    if (m1) return m1[1];
    const m2 = url.match(/player\.vimeo\.com\/video\/(\d+)/i);
    return m2 ? m2[1] : null;
  };

  const parseMedia = (url) => {
    const clean = String(url || "").trim();
    if (!clean) return { type: "unknown", url: clean };

    if (isYouTube(clean)) {
      const id = parseYouTubeId(clean);
      if (!id) return { type: "unknown", url: clean };
      const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&rel=0`;
      return { type: "youtube", url: clean, embedUrl, id };
    }

    if (isVimeo(clean)) {
      const id = parseVimeoId(clean);
      if (!id) return { type: "unknown", url: clean };
      const embedUrl = `https://player.vimeo.com/video/${encodeURIComponent(id)}?dnt=1`;
      return { type: "vimeo", url: clean, embedUrl, id };
    }

    if (isDirectVideo(clean)) return { type: "direct", url: clean };

    return { type: "direct", url: clean };
  };

  const formatAdded = (ts) => {
    const d = new Date(ts);
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  /* ------------------------------ state ------------------------------ */
  let settings = safeGet(SETTINGS_KEY, {
    apiBase: "",
    partyDefaultMode: "off",
    wsUrl: "",
  });

  let token = safeGet(TOKEN_KEY, "");
  let me = null; // { username }

  let library = [];
  let activeFilter = "all";
  let searchQuery = "";
  let sortMode = "recent";
  let selectedId = null;

  const party = {
    mode: "off", // off | local | remote
    room: "",
    clientId: uid(),

    // role
    hostId: null,
    isHost: false,

    // channels
    bc: null,
    ws: null,
    connected: false,

    // sync
    isApplying: false,
    syncTimer: null,
    lastTickSent: 0,

    boundVideo: null,
    unbindVideo: null,
  };

  const player = {
    open: false,
    itemId: null,        // library id if known
    transient: null,     // { title, kind, videoUrl, trailerUrl, posterUrl }
    source: "main",      // main | trailer
    mediaType: "unknown",
    mediaEl: null,
    startAt: null,
  };

  /* ------------------------------ elements ------------------------------ */
  const els = {
    app: $("#app"),
    authScreen: $("#authScreen"),
    authNotice: $("#authNotice"),
    apiBaseInput: $("#apiBaseInput"),
    apiBaseInput2: $("#apiBaseInput2"),
    registerForm: $("#registerForm"),
    loginForm: $("#loginForm"),

    userName: $("#userName"),
    btnLogout: $("#btnLogout"),

    grid: $("#grid"),
    empty: $("#emptyState"),

    btnAdd: $("#btnAdd"),
    btnAddEmpty: $("#btnAddEmpty"),
    btnSettings: $("#btnSettings"),

    searchInput: $("#searchInput"),
    sortSelect: $("#sortSelect"),

    addModal: $("#addModal"),
    addForm: $("#addForm"),

    detailsModal: $("#detailsModal"),
    detailsPoster: $("#detailsPoster"),
    detailsName: $("#detailsName"),
    detailsChips: $("#detailsChips"),
    detailsVideo: $("#detailsVideo"),
    detailsTrailer: $("#detailsTrailer"),
    embedHint: $("#embedHint"),
    btnPlay: $("#btnPlay"),
    btnTrailer: $("#btnTrailer"),
    btnWatchlist: $("#btnWatchlist"),
    btnLike: $("#btnLike"),
    btnDislike: $("#btnDislike"),
    btnDelete: $("#btnDelete"),

    playerModal: $("#playerModal"),
    playerTitle: $("#playerTitle"),
    playerSub: $("#playerSub"),
    playerStage: $("#playerStage"),
    btnParty: $("#btnParty"),
    btnCinema: $("#btnCinema"),
    btnFs: $("#btnFs"),
    btnBackDetails: $("#btnBackDetails"),
    partyStatus: $("#partyStatus"),

    settingsModal: $("#settingsModal"),
    apiBase: $("#apiBase"),
    partyDefaultMode: $("#partyDefaultMode"),
    wsUrl: $("#wsUrl"),
    btnSaveSettings: $("#btnSaveSettings"),

    partyModal: $("#partyModal"),
    partyMode: $("#partyMode"),
    partyRoom: $("#partyRoom"),
    wsRow: $("#wsRow"),
    partyWsUrl: $("#partyWsUrl"),
    btnPartyJoin: $("#btnPartyJoin"),
    btnPartyLeave: $("#btnPartyLeave"),
    btnPartyCopy: $("#btnPartyCopy"),
    partyFineprint: $("#partyFineprint"),
    partyBox: $("#partyBox"),
    partyBoxState: $("#partyBoxState"),
    partyBoxRoom: $("#partyBoxRoom"),
    partyBoxMode: $("#partyBoxMode"),
    partyBoxRole: $("#partyBoxRole"),

    tplCard: $("#tplCard"),
  };

  /* ------------------------------ auth/ui ------------------------------ */
  const showNotice = (text, kind = "info") => {
    if (!els.authNotice) return;
    els.authNotice.textContent = text || "";
    els.authNotice.hidden = !text;
    els.authNotice.classList.toggle("is-error", kind === "error");
  };

  const setBusy = (formEl, busy, label = "") => {
    if (!formEl) return () => {};
    const btn = formEl.querySelector('button[type="submit"]');
    if (!btn) return () => {};
    const prevDisabled = btn.disabled;
    const prevText = btn.textContent;
    btn.disabled = !!busy;
    if (label) btn.textContent = label;
    return () => {
      btn.disabled = prevDisabled;
      btn.textContent = prevText;
    };
  };


  const showAuth = () => {
    // stop sync + close player/modals
    try { partyStop(); } catch {}
    try { closePlayer(); } catch {}
    hideAllModals();

    els.app.hidden = true;
    els.authScreen.hidden = false;
    showNotice("", "info");
  };

  const showApp = () => {
    els.authScreen.hidden = true;
    els.app.hidden = false;
    els.userName.textContent = me?.username || "—";
  };

  const setAuthTab = (tab) => {
    const buttons = $$("[data-auth-tab]");
    buttons.forEach((b) => {
      const on = b.getAttribute("data-auth-tab") === tab;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });

    els.registerForm.hidden = tab !== "register";
    els.loginForm.hidden = tab !== "login";

    // keep api base in sync
    const a = normalizeBase(els.apiBaseInput.value || els.apiBaseInput2.value || settings.apiBase || location.origin);
    els.apiBaseInput.value = a;
    els.apiBaseInput2.value = a;

    if (tab === "register") els.registerForm.querySelector("input[name='username']")?.focus?.();
    else els.loginForm.querySelector("input[name='username']")?.focus?.();
  };

  /* ------------------------------ API ------------------------------ */
  const apiFetch = async (path, opts = {}) => {
    const apiBase = normalizeBase(settings.apiBase || "");
    if (!apiBase) {
      const e = new Error("API Base URL mancante. Incolla l’URL HTTPS del backend (Render).");
      e.status = 0;
      throw e;
    }

    const url = resolveUrl(apiBase, path.startsWith("/") ? path : `/${path}`);

    const headers = new Headers(opts.headers || {});
    headers.set("Accept", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    // timeout support (Render Free può essere lento al primo colpo)
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 65000;
    const controller = opts.signal ? null : new AbortController();
    const signal = opts.signal || controller?.signal;

    const init = {
      ...opts,
      headers,
      signal,
    };

    // fetch non conosce timeoutMs: rimuoviamolo
    try { delete init.timeoutMs; } catch {}

    let t = null;
    if (controller && timeoutMs > 0) {
      t = setTimeout(() => {
        try { controller.abort(); } catch {}
      }, timeoutMs);
    }

    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      const isAbort = err?.name === "AbortError";
      const e = new Error(
        isAbort
          ? "Timeout: il backend non ha risposto (Render Free può impiegare ~50s se era in sleep). Riprova."
          : "Errore di rete: impossibile contattare il backend. Controlla API Base URL (deve essere HTTPS) e riprova."
      );
      e.status = 0;
      e.cause = err;
      e.url = url;
      throw e;
    } finally {
      if (t) clearTimeout(t);
    }

    const isJson = (res.headers.get("content-type") || "").includes("application/json");
    const data = isJson ? await res.json().catch(() => null) : await res.text().catch(() => "");

    if (!res.ok) {
      const msg =
        (data && typeof data === "object" && data.error) ||
        (typeof data === "string" && data) ||
        `HTTP ${res.status}`;

      const e = new Error(
        res.status === 405
          ? "HTTP 405: stai chiamando un host che non è il backend. Imposta API Base URL al dominio Render."
          : res.status === 409
          ? "Utente già esistente: usa Accedi."
          : msg
      );
      e.status = res.status;
      e.payload = data;
      e.url = url;
      throw e;
    }

    return data;
  };

  const authLogin = async (username, password) => {
    const data = await apiFetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      timeoutMs: 65000,
    });

    if (!data?.token) throw new Error("Login fallito");
    token = data.token;
    safeSet(TOKEN_KEY, token);
  };

  const authRegister = async (username, password) => {
    const data = await apiFetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      timeoutMs: 65000,
    });

    if (!data?.token) throw new Error("Registrazione fallita");
    token = data.token;
    safeSet(TOKEN_KEY, token);
  };

  const fetchMe = async () => {
    const data = await apiFetch("/api/me");
    me = data;
    return me;
  };

  const fetchLibrary = async () => {
    const data = await apiFetch("/api/library");
    library = Array.isArray(data?.items) ? data.items : [];
  };

  const uploadPoster = async (file) => {
    const fd = new FormData();
    fd.append("poster", file);

    const data = await apiFetch("/api/upload/poster", { method: "POST", body: fd });
    if (!data?.posterUrl) throw new Error("Upload poster fallito");
    return data.posterUrl;
  };

  /* ------------------------------ modal utils ------------------------------ */
  const openStack = [];

  const refreshBodyScrollLock = () => {
    document.body.style.overflow = openStack.length ? "hidden" : "";
  };

  const showModal = (id) => {
    const m = document.getElementById(id);
    if (!m || !m.hasAttribute("hidden")) return;
    m.removeAttribute("hidden");
    openStack.push(id);
    refreshBodyScrollLock();

    requestAnimationFrame(() => {
      const focusable = m.querySelector("input,select,textarea,button");
      focusable?.focus?.();
    });
  };

  const hideModal = (id) => {
    const m = document.getElementById(id);
    if (!m || m.hasAttribute("hidden")) return;
    m.setAttribute("hidden", "");
    const idx = openStack.lastIndexOf(id);
    if (idx >= 0) openStack.splice(idx, 1);
    refreshBodyScrollLock();
  };

  const hideAllModals = () => {
    while (openStack.length) {
      const id = openStack.pop();
      const m = document.getElementById(id);
      if (m && !m.hasAttribute("hidden")) m.setAttribute("hidden", "");
    }
    refreshBodyScrollLock();
  };

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const closeId = t.getAttribute("data-close");
    if (closeId) {
      if (closeId === "playerModal") closePlayer();
      else hideModal(closeId);
      return;
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const top = openStack[openStack.length - 1];
      if (!top) return;
      if (top === "playerModal") closePlayer();
      else hideModal(top);
    }
  });

  /* ------------------------------ library ops (server) ------------------------------ */
  const getById = (id) => library.find((x) => x.id === id) || null;

  const render = () => {
    const q = searchQuery.trim().toLowerCase();
    let items = library.slice();

    if (activeFilter === "watchlist") items = items.filter((x) => !!x.watchlist);
    if (activeFilter === "liked") items = items.filter((x) => x.rating === "like");

    if (q) items = items.filter((x) => (x.title || "").toLowerCase().includes(q));

    if (sortMode === "title") {
      items.sort((a, b) => (a.title || "").localeCompare(b.title || "", "it", { sensitivity: "base" }));
    } else if (sortMode === "likes") {
      items.sort((a, b) => (b.rating === "like") - (a.rating === "like") || (b.addedAt - a.addedAt));
    } else {
      items.sort((a, b) => (b.addedAt - a.addedAt));
    }

    els.grid.innerHTML = "";
    els.empty.hidden = items.length !== 0;

    if (!items.length) return;

    const frag = document.createDocumentFragment();
    for (const item of items) frag.appendChild(renderCard(item));
    els.grid.appendChild(frag);
  };

  const renderCard = (item) => {
    const node = els.tplCard.content.firstElementChild.cloneNode(true);
    const img = node.querySelector("img");
    const badge = node.querySelector("[data-badge='kind']");
    const titleEl = node.querySelector("[data-title]");
    const metaEl = node.querySelector("[data-meta]");
    const chipWatch = node.querySelector("[data-chip='watchlist']");
    const chipLike = node.querySelector("[data-chip='liked']");

    img.src = resolveUrl(settings.apiBase, item.posterUrl || "");
    img.alt = item.title || "Poster";
    badge.textContent = kindLabel(item.kind);
    titleEl.textContent = item.title || "Senza titolo";
    metaEl.textContent = formatAdded(item.addedAt);

    chipWatch.hidden = !item.watchlist;
    chipLike.hidden = item.rating !== "like";

    node.dataset.id = item.id;
    return node;
  };

  /* ------------------------------ add content ------------------------------ */
  const resetAddForm = () => els.addForm.reset();

  const openAdd = () => {
    resetAddForm();
    showModal("addModal");
  };

  const onAddSubmit = async (e) => {
    e.preventDefault();

    const fd = new FormData(els.addForm);
    const title = String(fd.get("title") || "").trim();
    const kind = String(fd.get("kind") || "movie");
    const videoUrl = String(fd.get("videoUrl") || "").trim();
    const trailerUrl = String(fd.get("trailerUrl") || "").trim();
    const posterFile = fd.get("posterFile");

    if (!title || !videoUrl || !(posterFile instanceof File) || posterFile.size === 0) return;

    try {
      const posterUrl = await uploadPoster(posterFile);

      const created = await apiFetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          kind,
          posterUrl,
          videoUrl,
          trailerUrl: trailerUrl || "",
        }),
      });

      if (created?.item) {
        library.unshift(created.item);
        render();
      } else {
        await fetchLibrary();
        render();
      }

      hideModal("addModal");
    } catch (err) {
      alert(String(err?.message || err || "Errore"));
    }
  };

  /* ------------------------------ details ------------------------------ */
  const openDetails = (id) => {
    const item = getById(id);
    if (!item) return;

    selectedId = id;

    els.detailsPoster.src = resolveUrl(settings.apiBase, item.posterUrl || "");
    els.detailsPoster.alt = item.title || "Poster";
    els.detailsName.textContent = item.title || "Senza titolo";

    els.detailsChips.innerHTML = "";
    const chips = [
      { text: kindLabel(item.kind), className: "badge" },
      ...(item.watchlist ? [{ text: "Watchlist", className: "chip" }] : []),
      ...(item.rating === "like" ? [{ text: "Like", className: "chip chip--like" }] : []),
      ...(item.rating === "dislike" ? [{ text: "Dislike", className: "chip" }] : []),
    ];
    for (const c of chips) {
      const span = document.createElement("span");
      span.className = c.className;
      span.textContent = c.text;
      els.detailsChips.appendChild(span);
    }

    els.detailsVideo.textContent = item.videoUrl || "—";
    els.detailsTrailer.textContent = item.trailerUrl || "—";

    els.btnTrailer.hidden = !item.trailerUrl;
    els.btnWatchlist.textContent = item.watchlist ? "Rimuovi watchlist" : "Watchlist";

    els.btnLike.setAttribute("aria-pressed", String(item.rating === "like"));
    els.btnDislike.setAttribute("aria-pressed", String(item.rating === "dislike"));

    const parsed = parseMedia(item.videoUrl);
    els.embedHint.hidden = parsed.type === "direct";

    showModal("detailsModal");
  };

  const patchSelected = async (patch) => {
    if (!selectedId) return null;
    const id = selectedId;
    const idx = library.findIndex((x) => x.id === id);
    if (idx < 0) return null;

    // optimistic
    const prev = library[idx];
    library[idx] = { ...prev, ...patch };
    render();

    try {
      const data = await apiFetch(`/api/library/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (data?.item) {
        library[idx] = data.item;
        render();
      }

      return library[idx];
    } catch (err) {
      // rollback
      library[idx] = prev;
      render();
      throw err;
    }
  };

  const toggleWatchlist = async () => {
    const item = getById(selectedId);
    if (!item) return;
    try {
      await patchSelected({ watchlist: !item.watchlist });
      openDetails(selectedId);
    } catch (err) {
      alert(String(err?.message || err || "Errore"));
      openDetails(selectedId);
    }
  };

  const setRating = async (rating) => {
    const item = getById(selectedId);
    if (!item) return;
    const next = item.rating === rating ? null : rating;

    try {
      await patchSelected({ rating: next });
      openDetails(selectedId);
    } catch (err) {
      alert(String(err?.message || err || "Errore"));
      openDetails(selectedId);
    }
  };

  const deleteSelected = async () => {
    if (!selectedId) return;
    const id = selectedId;

    // optimistic close
    selectedId = null;
    hideModal("detailsModal");
    if (player.open && player.itemId === id) closePlayer();

    const prev = library.slice();
    library = library.filter((x) => x.id !== id);
    render();

    try {
      await apiFetch(`/api/library/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (err) {
      library = prev;
      render();
      alert(String(err?.message || err || "Errore"));
    }
  };

  /* ------------------------------ player ------------------------------ */
  const cleanupStage = () => {
    if (party.unbindVideo) {
      party.unbindVideo();
      party.unbindVideo = null;
    }
    if (player.mediaEl) {
      player.mediaEl.remove();
      player.mediaEl = null;
    }
    els.playerStage.innerHTML = "";
    player.mediaType = "unknown";
    player.startAt = null;
  };

  const mountVideo = (url, { autoplay = true, startAt = null } = {}) => {
    const v = document.createElement("video");
    v.controls = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.src = url;

    const applyStart = () => {
      if (startAt != null && Number.isFinite(startAt)) {
        try { v.currentTime = Math.max(0, startAt); } catch {}
      }
      if (autoplay) v.play().catch(() => {});
    };

    v.addEventListener("loadedmetadata", applyStart, { once: true });

    els.playerStage.appendChild(v);
    player.mediaEl = v;
    player.mediaType = "direct";

    bindPartyToVideo(v);

    return v;
  };

  const mountIframe = (embedUrl) => {
    const f = document.createElement("iframe");
    f.src = embedUrl;
    f.allow = "autoplay; fullscreen; picture-in-picture";
    f.referrerPolicy = "strict-origin-when-cross-origin";
    f.loading = "eager";
    els.playerStage.appendChild(f);
    player.mediaEl = f;
    return f;
  };

  const loadMedia = (itemLike, source, opts = {}) => {
    cleanupStage();

    player.source = source;
    player.itemId = itemLike?.id || null;
    player.transient = (itemLike && !itemLike.id) ? itemLike : null;

    const isTrailer = source === "trailer";
    const url = isTrailer ? (itemLike.trailerUrl || "") : (itemLike.videoUrl || "");
    const parsed = parseMedia(url);

    const title = itemLike.title || "Senza titolo";
    const sub = isTrailer ? "Trailer" : kindLabel(itemLike.kind);

    els.playerTitle.textContent = title;
    els.playerSub.textContent = sub;

    if (parsed.type === "youtube" && opts.startAt != null && Number.isFinite(opts.startAt)) {
      const s = Math.max(0, Math.floor(opts.startAt));
      parsed.embedUrl = `${parsed.embedUrl}&start=${s}`;
    }

    if (parsed.type === "direct") {
      mountVideo(parsed.url, { autoplay: opts.autoplay !== false, startAt: opts.startAt ?? null });
    } else if (parsed.type === "youtube" || parsed.type === "vimeo") {
      player.mediaType = parsed.type;
      mountIframe(parsed.embedUrl);
    } else {
      mountVideo(parsed.url, { autoplay: opts.autoplay !== false, startAt: opts.startAt ?? null });
    }

    updatePartyPill();
  };

  const openPlayer = (id, source = "main", opts = {}) => {
    const item = getById(id);
    if (!item) return;

    player.open = true;
    showModal("playerModal");
    loadMedia(item, source, opts);

    if (party.connected) broadcastLoadFromCurrent();
  };

  const closePlayer = () => {
    player.open = false;
    cleanupStage();
    hideModal("playerModal");
    els.playerStage.classList.remove("is-cinema");
    els.btnCinema.setAttribute("aria-pressed", "false");
  };

  const getPlayableVideo = () => (player.mediaType === "direct" ? player.mediaEl : null);

  const getPlayableTime = () => {
    const v = getPlayableVideo();
    if (!v) return 0;
    return Number.isFinite(v.currentTime) ? v.currentTime : 0;
  };

  const isPaused = () => {
    const v = getPlayableVideo();
    if (!v) return true;
    return v.paused;
  };

  const toggleCinema = () => {
    const on = els.playerStage.classList.toggle("is-cinema");
    els.btnCinema.setAttribute("aria-pressed", String(on));
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await els.playerStage.requestFullscreen();
    } catch {}
  };

  /* ------------------------------ watch party ------------------------------ */
  const updatePartyPill = () => {
    const on = party.connected && party.mode !== "off";
    els.partyStatus.hidden = !on;
    if (!on) return;

    const role = party.isHost ? "host" : "viewer";
    els.partyStatus.textContent = `Party: ${party.mode} • ${party.room} • ${role}`;
  };

  const partySetUI = () => {
    const on = party.connected && party.mode !== "off";
    els.btnPartyLeave.hidden = !on;
    els.btnPartyCopy.hidden = !on;
    els.btnPartyJoin.textContent = on ? "Riconnetti" : "Avvia / Entra";

    els.partyBox.hidden = !on;
    if (on) {
      els.partyBoxState.textContent = "Connesso";
      els.partyBoxRoom.textContent = party.room;
      els.partyBoxMode.textContent = party.mode;
      els.partyBoxRole.textContent = party.isHost ? "Host" : "Viewer";
    }

    updatePartyPill();
  };

  const partyStop = () => {
    if (party.syncTimer) {
      clearInterval(party.syncTimer);
      party.syncTimer = null;
    }
    if (party.unbindVideo) {
      party.unbindVideo();
      party.unbindVideo = null;
    }
    party.boundVideo = null;

    if (party.bc) {
      try { party.bc.close(); } catch {}
      party.bc = null;
    }
    if (party.ws) {
      try { party.ws.close(); } catch {}
      party.ws = null;
    }

    party.connected = false;
    party.mode = "off";
    party.room = "";
    party.hostId = null;
    party.isHost = false;

    partySetUI();
  };

  const sendWS = (obj) => {
    if (!party.ws || party.ws.readyState !== WebSocket.OPEN) return;
    try { party.ws.send(JSON.stringify(obj)); } catch {}
  };

  const sendParty = (obj) => {
    const msg = { ...obj, room: party.room, from: party.clientId };
    if (party.mode === "local" && party.bc) {
      try { party.bc.postMessage(msg); } catch {}
    } else if (party.mode === "remote") {
      sendWS(msg);
    }
  };

  const onPartyMessage = (raw) => {
    let msg = raw;
    if (typeof raw === "string") msg = safeJsonParse(raw, null);
    if (!msg || typeof msg !== "object") return;
    if (msg.room !== party.room) return;
    if (msg.from === party.clientId) return;

    // host election / keep alive
    if (msg.type === "state" && msg.payload?.hostId) {
      // accept first host we see
      if (!party.hostId) {
        party.hostId = msg.payload.hostId;
        party.isHost = (party.hostId === party.clientId);
        partySetUI();
      } else if (party.hostId !== msg.payload.hostId) {
        // if someone else claims host, and we're not that host, demote
        if (party.hostId !== party.clientId) {
          party.hostId = msg.payload.hostId;
          party.isHost = false;
          partySetUI();
        }
      }
    }

    if (msg.type === "req_state") {
      if (!party.connected) return;
      // only host replies
      if (!party.isHost) return;
      sendParty({ type: "state", payload: currentStatePayload() });
      return;
    }

    if (msg.type === "state" || msg.type === "sync") {
      applySync(msg.payload || {});
    }
  };

  const currentMediaForParty = () => {
    // Prefer library item if present; otherwise transient
    const item = player.itemId ? getById(player.itemId) : null;
    const t = player.transient;

    const src = player.source || "main";
    const base = item || t;
    if (!base) return null;

    return {
      itemId: item?.id || null,
      title: base.title || "Senza titolo",
      kind: base.kind || "movie",
      videoUrl: base.videoUrl || "",
      trailerUrl: base.trailerUrl || "",
      posterUrl: base.posterUrl || "",
      source: src,
    };
  };

  const currentStatePayload = () => {
    const media = currentMediaForParty();
    return {
      action: "state",
      media,
      time: getPlayableTime(),
      paused: isPaused(),
      sentAt: Date.now(),
      hostId: party.isHost ? party.clientId : (party.hostId || null),
    };
  };

  const broadcastLoadFromCurrent = () => {
    if (!party.connected) return;
    if (!party.isHost && party.hostId && party.hostId !== party.clientId) return;

    const media = currentMediaForParty();
    if (!media) return;

    sendParty({
      type: "sync",
      payload: {
        action: "load",
        media,
        time: getPlayableTime(),
        paused: isPaused(),
        sentAt: Date.now(),
        hostId: party.clientId,
      },
    });
  };

  const broadcastAction = (action, time, paused) => {
    if (!party.connected) return;
    if (!party.isHost && party.hostId && party.hostId !== party.clientId) return;

    sendParty({
      type: "sync",
      payload: {
        action,
        time: Number.isFinite(time) ? time : 0,
        paused: !!paused,
        sentAt: Date.now(),
        hostId: party.clientId,
      },
    });
  };

  const broadcastStateTick = (time, paused) => {
    if (!party.connected) return;
    if (!party.isHost && party.hostId && party.hostId !== party.clientId) return;

    const now = Date.now();
    if (now - party.lastTickSent < 900) return;
    party.lastTickSent = now;

    sendParty({
      type: "sync",
      payload: { action: "state", time: time ?? 0, paused: !!paused, sentAt: now, hostId: party.clientId },
    });
  };

  const estimateRemoteTime = (p) => {
    const base = Number.isFinite(p.time) ? p.time : 0;
    const sentAt = Number.isFinite(p.sentAt) ? p.sentAt : Date.now();
    const paused = !!p.paused;
    if (paused) return base;
    const dt = (Date.now() - sentAt) / 1000;
    return Math.max(0, base + dt);
  };

  const applySync = (p) => {
    const action = p.action;
    const paused = !!p.paused;
    const t = estimateRemoteTime(p);

    // handle hostId
    if (p.hostId && !party.hostId) {
      party.hostId = p.hostId;
      party.isHost = (party.hostId === party.clientId);
      partySetUI();
    }
    if (p.hostId && party.hostId && party.hostId !== p.hostId && !party.isHost) {
      party.hostId = p.hostId;
      party.isHost = false;
      partySetUI();
    }

    if (action === "load" && p.media) {
      const media = p.media;

      // find item in our library, else use transient from message
      const item = media.itemId ? getById(media.itemId) : null;
      const temp = item || {
        title: media.title || "Senza titolo",
        kind: media.kind || "movie",
        videoUrl: media.videoUrl || "",
        trailerUrl: media.trailerUrl || "",
        posterUrl: media.posterUrl || "",
      };

      if (!player.open) showModal("playerModal");
      player.open = true;

      party.isApplying = true;
      try {
        loadMedia(temp, media.source || "main", { startAt: t, autoplay: !paused });
      } finally {
        party.isApplying = false;
      }
      return;
    }

    const v = getPlayableVideo();
    if (!v) {
      // embed: best-effort (reload with start)
      if ((action === "seek" || action === "state" || action === "play" || action === "pause") && player.open) {
        const base = player.itemId ? getById(player.itemId) : player.transient;
        if (!base) return;
        party.isApplying = true;
        try {
          loadMedia(base, player.source, { startAt: t, autoplay: !paused });
        } finally {
          party.isApplying = false;
        }
      }
      return;
    }

    party.isApplying = true;
    try {
      if (action === "play") {
        if (Math.abs(v.currentTime - t) > 0.75) {
          try { v.currentTime = t; } catch {}
        }
        v.play().catch(() => {});
      } else if (action === "pause") {
        if (Math.abs(v.currentTime - t) > 0.75) {
          try { v.currentTime = t; } catch {}
        }
        v.pause();
      } else if (action === "seek") {
        try { v.currentTime = t; } catch {}
      } else if (action === "state") {
        const drift = Math.abs(v.currentTime - t);
        if (drift > 1.1) {
          try { v.currentTime = t; } catch {}
        }
        if (!paused && v.paused) v.play().catch(() => {});
        if (paused && !v.paused) v.pause();
      }
    } finally {
      party.isApplying = false;
    }
  };

  const bindPartyToVideo = (video) => {
    if (!party.connected) return;
    if (!video) return;
    if (party.boundVideo === video) return;

    if (party.unbindVideo) {
      party.unbindVideo();
      party.unbindVideo = null;
    }

    party.boundVideo = video;
    party.lastTickSent = 0;

    const onPlay = () => {
      if (!party.connected || party.isApplying) return;
      broadcastAction("play", video.currentTime || 0, false);
      startTick();
    };

    const onPause = () => {
      if (!party.connected || party.isApplying) return;
      broadcastAction("pause", video.currentTime || 0, true);
      stopTick();
    };

    const onSeeked = () => {
      if (!party.connected || party.isApplying) return;
      broadcastAction("seek", video.currentTime || 0, video.paused);
    };

    const onEnded = () => stopTick();

    const startTick = () => {
      if (party.syncTimer) return;
      party.syncTimer = setInterval(() => {
        if (!party.connected || !party.boundVideo) return;
        const v = party.boundVideo;
        broadcastStateTick(v.currentTime || 0, v.paused);
      }, 900);
    };

    const stopTick = () => {
      if (!party.syncTimer) return;
      clearInterval(party.syncTimer);
      party.syncTimer = null;
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("ended", onEnded);

    if (!video.paused) startTick();

    party.unbindVideo = () => {
      stopTick();
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("ended", onEnded);
      party.boundVideo = null;
    };
  };

  const partyStartLocal = (room, { asHost }) => {
    partyStop();
    party.mode = "local";
    party.room = room;
    party.connected = true;

    party.isHost = !!asHost;
    party.hostId = asHost ? party.clientId : null;

    party.bc = new BroadcastChannel("streamly_party");
    party.bc.onmessage = (ev) => onPartyMessage(ev?.data);

    const v = getPlayableVideo();
    if (v) bindPartyToVideo(v);

    partySetUI();

    if (party.isHost) {
      sendParty({ type: "state", payload: currentStatePayload() });
      broadcastLoadFromCurrent();
    } else {
      sendParty({ type: "req_state" });
    }
  };

  const partyStartRemote = (wsUrl, room, { asHost }) => {
    partyStop();
    party.mode = "remote";
    party.room = room;

    party.isHost = !!asHost;
    party.hostId = asHost ? party.clientId : null;

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.warn("WS init failed", e);
      partyStop();
      return;
    }

    party.ws = ws;

    const onOpen = () => {
      party.connected = true;
      sendWS({ type: "join", room, from: party.clientId });
      partySetUI();

      const v = getPlayableVideo();
      if (v) bindPartyToVideo(v);

      // handshake
      if (party.isHost) {
        // announce
        sendParty({ type: "state", payload: currentStatePayload() });
        broadcastLoadFromCurrent();
      } else {
        sendParty({ type: "req_state" });
      }
    };

    const onClose = () => {
      partyStop();
    };

    const onMessage = (ev) => onPartyMessage(ev?.data);

    ws.addEventListener("open", onOpen, { once: true });
    ws.addEventListener("close", onClose);
    ws.addEventListener("message", onMessage);

    const prevStop = partyStop;
    partyStop = () => {
      if (ws) {
        ws.removeEventListener("close", onClose);
        ws.removeEventListener("message", onMessage);
      }
      partyStop = prevStop;
      prevStop();
    };
  };

  /* ------------------------------ settings ------------------------------ */
  const openSettings = () => {
    els.apiBase.value = normalizeBase(settings.apiBase || els.apiBaseInput.value || location.origin);
    els.partyDefaultMode.value = settings.partyDefaultMode || "off";

    const ws = settings.wsUrl || toWsUrl(els.apiBase.value) || "";
    els.wsUrl.value = ws;

    showModal("settingsModal");
  };

  const saveSettings = () => {
    settings = {
      apiBase: normalizeBase(els.apiBase.value || settings.apiBase || location.origin),
      partyDefaultMode: els.partyDefaultMode.value,
      wsUrl: els.wsUrl.value.trim() || toWsUrl(els.apiBase.value) || "",
    };
    safeSet(SETTINGS_KEY, settings);
    hideModal("settingsModal");
  };

  /* ------------------------------ party modal ------------------------------ */
  const syncPartyModeUI = () => {
    const mode = els.partyMode.value;
    els.wsRow.style.display = mode === "remote" ? "" : "none";
  };

  const openPartyModal = () => {
    const def = settings.partyDefaultMode || "off";
    els.partyMode.value = (def === "off" ? "remote" : def);
    els.partyRoom.value = party.room || "";
    els.partyWsUrl.value = (settings.wsUrl || toWsUrl(settings.apiBase) || "").trim();
    syncPartyModeUI();
    partySetUI();
    showModal("partyModal");
  };

  const partyJoin = () => {
    const mode = els.partyMode.value;
    const room = els.partyRoom.value.trim();
    if (!room) return;

    const wsUrl = (els.partyWsUrl.value.trim() || settings.wsUrl || toWsUrl(settings.apiBase) || "").trim();
    const asHost = !party.connected; // first start from this tab -> host

    if (mode === "local") partyStartLocal(room, { asHost });
    else partyStartRemote(wsUrl, room, { asHost });
  };

  const partyLeave = () => partyStop();

  const partyCopyInvite = async () => {
    if (!party.connected) return;

    const wsUrl = (party.mode === "remote" ? (els.partyWsUrl.value.trim() || settings.wsUrl || "") : "");
    const text = party.mode === "remote"
      ? `Streamly Watch Party (remote)\nRoom: ${party.room}\nWS: ${wsUrl}`
      : `Streamly Watch Party (local)\nRoom: ${party.room}\n(Stessa origine/browser)`;

    try {
      await navigator.clipboard.writeText(text);
      els.partyFineprint.textContent = "Invito copiato ✅";
      setTimeout(() => (els.partyFineprint.textContent = "Consiglio: per sync perfetto usa video direct mp4/webm."), 1400);
    } catch {}
  };

  /* ------------------------------ wiring ------------------------------ */
  // auth tabs
  $$("[data-auth-tab]").forEach((b) => {
    b.addEventListener("click", () => setAuthTab(b.getAttribute("data-auth-tab")));
  });

  els.registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showNotice("", "info");

    const apiBase = normalizeBase(els.apiBaseInput.value || "");
    const fd = new FormData(els.registerForm);
    const username = String(fd.get("username") || "").trim();
    const password = String(fd.get("password") || "");

    if (!apiBase) return showNotice("Inserisci API Base URL", "error");
    if (location.protocol === "https:" && isBlockedLocalNetworkUrl(apiBase)) {
      return showNotice("Da GitHub Pages (HTTPS) non puoi usare http://localhost. Usa l’URL HTTPS del backend (Render).", "error");
    }
    if (!username || username.length < 3) return showNotice("Username troppo corto (min 3)", "error");
    if (!password || password.length < 6) return showNotice("Password troppo corta (min 6)", "error");

    settings.apiBase = apiBase;
    if (!settings.wsUrl) settings.wsUrl = toWsUrl(apiBase);
    safeSet(SETTINGS_KEY, settings);

    const restore = setBusy(els.registerForm, true, "Creazione...");
    showNotice("Creo profilo... (Render Free può impiegare fino a ~50s se era in sleep)", "info");

    try {
      await authRegister(username, password);
      await fetchMe();
      await fetchLibrary();
      render();
      showApp();
    } catch (err) {
      showNotice(String(err?.message || err || "Errore"), "error");
    } finally {
      restore();
    }
  });

  els.loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    showNotice("", "info");

    const apiBase = normalizeBase(els.apiBaseInput2.value || "");
    const fd = new FormData(els.loginForm);
    const username = String(fd.get("username") || "").trim();
    const password = String(fd.get("password") || "");

    if (!apiBase) return showNotice("Inserisci API Base URL", "error");
    if (location.protocol === "https:" && isBlockedLocalNetworkUrl(apiBase)) {
      return showNotice("Da GitHub Pages (HTTPS) non puoi usare http://localhost. Usa l’URL HTTPS del backend (Render).", "error");
    }
    if (!username) return showNotice("Inserisci username", "error");
    if (!password) return showNotice("Inserisci password", "error");

    settings.apiBase = apiBase;
    if (!settings.wsUrl) settings.wsUrl = toWsUrl(apiBase);
    safeSet(SETTINGS_KEY, settings);

    const restore = setBusy(els.loginForm, true, "Accesso...");
    showNotice("Accesso... (Render Free può impiegare fino a ~50s se era in sleep)", "info");

    try {
      await authLogin(username, password);
      await fetchMe();
      await fetchLibrary();
      render();
      showApp();
    } catch (err) {
      showNotice(String(err?.message || err || "Errore"), "error");
    } finally {
      restore();
    }
  });

  els.btnLogout.addEventListener("click", () => {
    token = "";
    me = null;
    safeSet(TOKEN_KEY, "");
    showAuth();
  });

  els.btnAdd.addEventListener("click", openAdd);
  els.btnAddEmpty.addEventListener("click", openAdd);
  els.addForm.addEventListener("submit", onAddSubmit);

  els.btnSettings.addEventListener("click", openSettings);
  els.btnSaveSettings.addEventListener("click", saveSettings);

  els.searchInput.addEventListener("input", (e) => {
    searchQuery = e.target.value || "";
    render();
  });
  els.sortSelect.addEventListener("change", (e) => {
    sortMode = e.target.value;
    render();
  });

  $$(".seg__btn").forEach((btn) => {
    if (btn.hasAttribute("data-auth-tab")) return;
    btn.addEventListener("click", () => {
      $$(".seg__btn").filter(b => !b.hasAttribute("data-auth-tab")).forEach((b) => {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-selected", String(b === btn));
      });
      activeFilter = btn.dataset.filter || "all";
      render();
    });
  });

  els.grid.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const card = t.closest(".card");
    if (!card) return;
    const id = card.dataset.id;
    if (!id) return;
    openDetails(id);
  });

  els.btnWatchlist.addEventListener("click", toggleWatchlist);
  els.btnLike.addEventListener("click", () => setRating("like"));
  els.btnDislike.addEventListener("click", () => setRating("dislike"));
  els.btnDelete.addEventListener("click", deleteSelected);

  els.btnPlay.addEventListener("click", () => {
    if (!selectedId) return;
    hideModal("detailsModal");
    openPlayer(selectedId, "main", { autoplay: true, startAt: 0 });
  });

  els.btnTrailer.addEventListener("click", () => {
    if (!selectedId) return;
    const item = getById(selectedId);
    if (!item?.trailerUrl) return;
    hideModal("detailsModal");
    openPlayer(selectedId, "trailer", { autoplay: true, startAt: 0 });
  });

  els.btnBackDetails.addEventListener("click", () => {
    if (!player.itemId) return;
    closePlayer();
    openDetails(player.itemId);
  });

  els.btnCinema.addEventListener("click", toggleCinema);
  els.btnFs.addEventListener("click", toggleFullscreen);

  els.btnParty.addEventListener("click", openPartyModal);
  els.partyMode.addEventListener("change", syncPartyModeUI);
  els.btnPartyJoin.addEventListener("click", partyJoin);
  els.btnPartyLeave.addEventListener("click", partyLeave);
  els.btnPartyCopy.addEventListener("click", partyCopyInvite);

  $$(".modal__backdrop").forEach((b) => {
    b.addEventListener("click", () => {
      const id = b.getAttribute("data-close");
      if (!id) return;
      if (id === "playerModal") closePlayer();
      else hideModal(id);
    });
  });

  window.addEventListener("beforeunload", () => {
    try { partyStop(); } catch {}
  });

  /* ------------------------------ init ------------------------------ */
  const init = async () => {
    // smarter default API base:
    // - if user already saved it -> keep
    // - else try meta[name="streamly-api-base"]
    // - else if running locally -> use location.origin
    // - else keep empty (user must paste backend URL, e.g. Render), avoids 405 on static hosts
    const metaBase = document.querySelector('meta[name="streamly-api-base"]')?.getAttribute("content")?.trim() || "";
    const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
    const isStaticHost = /(github\.io|pages\.dev|netlify\.app|vercel\.app)$/i.test(location.hostname);

    if (!settings.apiBase) {
      const fromMeta = normalizeBase(metaBase);
      settings.apiBase = fromMeta || (isLocalHost ? location.origin : "");
    } else {
      settings.apiBase = normalizeBase(settings.apiBase);
    }

    // If frontend is HTTPS, Chrome may block requests to http://localhost/private IPs.
    // If saved apiBase is local-network HTTP, ignore it and prefer metaBase (Render HTTPS).
    if (location.protocol === "https:" && isBlockedLocalNetworkUrl(settings.apiBase)) {
      const fromMeta = normalizeBase(metaBase);
      settings.apiBase = fromMeta && fromMeta.startsWith("https://") ? fromMeta : "";
    }

    safeSet(SETTINGS_KEY, settings);

    // prefill API base inputs (empty allowed; forms require it)
    const prefill = settings.apiBase || normalizeBase(metaBase) || "";
    els.apiBaseInput.value = prefill;
    els.apiBaseInput2.value = prefill;

    // default ws (only if apiBase present)
    if (!settings.wsUrl && settings.apiBase) {
      settings.wsUrl = toWsUrl(settings.apiBase);
      safeSet(SETTINGS_KEY, settings);
    }

    // keep wsUrl consistent with apiBase
    if (settings.apiBase) {
      const desired = toWsUrl(settings.apiBase);
      if (!settings.wsUrl || settings.wsUrl !== desired) {
        settings.wsUrl = desired;
        safeSet(SETTINGS_KEY, settings);
      }
    } else {
      settings.wsUrl = "";
      safeSet(SETTINGS_KEY, settings);
    }

    // Try restore session only if we have an API base
    if (token && settings.apiBase) {
      try {
        await fetchMe();
        await fetchLibrary();
        render();
        showApp();
        return;
      } catch {
        // falls back to auth
      }
    }

    // Static host + no API base => force paste backend URL
    if (isStaticHost && !settings.apiBase) {
      showAuth();
      setAuthTab("login");
      showNotice("Incolla l’URL HTTPS del backend (Render) in “API Base URL”.", "error");
      return;
    }

    showAuth();
    setAuthTab("register");
  };

  init();})();
