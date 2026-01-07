/* Streamly — Private Netflix-like UI (static)
   ✅ Profiles (separate likes/progress/mylist)
   ✅ Trailer hover preview (only for direct/asset video trailers)
   ✅ Series seasons/episodes (progress per episode)
   ✅ Watch Party (2 people) via WebRTC datachannel (no server; manual offer/answer)
   Sources supported: Direct file URL, YouTube, Vimeo
*/

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------------- storage keys ---------------------- */
const LS_CATALOG          = "streamly_catalog_v3";
const LS_PROFILES         = "streamly_profiles_v1";
const LS_ACTIVE_PROFILE   = "streamly_active_profile_v1";
const LS_PROFILE_DATA     = "streamly_profiles_data_v1"; // { [pid]: { myList, progress, reactions } }

/* ---------------------- IndexedDB assets ---------------------- */
const DB_NAME = "streamly-db";
const DB_VERSION = 1;
const STORE_ASSETS = "assets";

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readwrite");
    tx.objectStore(STORE_ASSETS).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function idbGet(key){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readonly");
    const req = tx.objectStore(STORE_ASSETS).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function idbDel(key){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readwrite");
    tx.objectStore(STORE_ASSETS).delete(key);
    tx.oncomplete = () => { db.close(); resolve(true); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function idbCount(){
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_ASSETS, "readonly");
    const req = tx.objectStore(STORE_ASSETS).count();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/* ---------------------- utils ---------------------- */
function uid(){
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function splitCSV(s){
  return String(s || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}
function normalizeSearch(s){ return String(s || "").trim().toLowerCase(); }
function clamp(n,a,b){ return Math.min(b, Math.max(a,n)); }
function cssUrl(u){ return String(u).replaceAll('"', "%22"); }
function toInt(v, fallback = 0){
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}
function fmtTime(seconds){
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  return `${m}:${String(ss).padStart(2,"0")}`;
}
function shuffle(arr){
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function posterFallbackStyle(seed){
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `radial-gradient(380px 240px at 30% 20%, rgba(255,255,255,.18), transparent 55%),
          linear-gradient(135deg, hsla(${hue}, 85%, 55%, .50), hsla(${(hue+60)%360}, 90%, 60%, .16)),
          linear-gradient(180deg, rgba(0,0,0,.0), rgba(0,0,0,.82))`;
}

/* ---------------------- source detection ---------------------- */
function detectSource(url){
  const u = String(url || "").trim();
  const yt = extractYouTubeId(u);
  if (yt) return { kind: "youtube", id: yt, url: u };
  const vm = extractVimeoId(u);
  if (vm) return { kind: "vimeo", id: vm, url: u };
  return { kind: "url", url: u };
}
function extractYouTubeId(url){
  try{
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be"){
      const id = u.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    if (host.endsWith("youtube.com")){
      if (u.pathname.startsWith("/watch")) return u.searchParams.get("v");
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/embed/")[1]?.split(/[?&]/)[0] || null;
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/shorts/")[1]?.split(/[?&/]/)[0] || null;
    }
    return null;
  }catch{ return null; }
}
function extractVimeoId(url){
  try{
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "vimeo.com"){
      const id = u.pathname.split("/").filter(Boolean)[0];
      return /^\d+$/.test(id) ? id : null;
    }
    if (host === "player.vimeo.com" && u.pathname.includes("/video/")){
      const id = u.pathname.split("/video/")[1]?.split(/[?&/]/)[0] || null;
      return /^\d+$/.test(id) ? id : null;
    }
    return null;
  }catch{ return null; }
}
function buildEmbedSrc(source){
  if (source.kind === "youtube"){
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(source.id)}?autoplay=1&rel=0&modestbranding=1`;
  }
  if (source.kind === "vimeo"){
    return `https://player.vimeo.com/video/${encodeURIComponent(source.id)}?autoplay=1`;
  }
  return "";
}

/* ---------------------- persistence ---------------------- */
function loadLS(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{ return fallback; }
}
function saveLS(key, value){
  localStorage.setItem(key, JSON.stringify(value));
}

/* ---------------------- profiles ---------------------- */
function defaultProfiles(){
  return [
    { id: uid(), name: "Streamly", avatar: "S", createdAt: Date.now() },
  ];
}
function ensureProfiles(){
  let profiles = loadLS(LS_PROFILES, null);
  if (!Array.isArray(profiles) || profiles.length === 0){
    profiles = defaultProfiles();
    saveLS(LS_PROFILES, profiles);
  }
  let active = loadLS(LS_ACTIVE_PROFILE, null);
  if (!active || !profiles.some(p => p.id === active)){
    active = profiles[0].id;
    saveLS(LS_ACTIVE_PROFILE, active);
  }
  let data = loadLS(LS_PROFILE_DATA, {});
  if (!data || typeof data !== "object") data = {};
  profiles.forEach(p => {
    if (!data[p.id]) data[p.id] = { myList: [], progress: {}, reactions: {} };
  });
  saveLS(LS_PROFILE_DATA, data);
  return { profiles, active, data };
}
function avatarFromName(name){
  const s = String(name || "").trim();
  return s ? s[0].toUpperCase() : "U";
}

/* ---------------------- app state ---------------------- */
const { profiles, active, data } = ensureProfiles();

const state = {
  view: "browse",
  catalog: loadLS(LS_CATALOG, []),

  profiles,
  activeProfileId: active,
  profilesData: data,

  query: "",
  activeId: null,

  // UI
  selectedEpisodeId: null,
  selectedSeason: "all",

  // asset URL cache
  assetUrlCache: new Map(),
  objectUrls: new Set(),

  // hover trailer cache
  hoverTimers: new Map(),

  // player
  playingItemId: null,
  playingEpisodeId: null,
  playingKind: null, // "video" | "trailer"
  saveTick: 0,

  // party
  party: {
    open: false,
    role: null, // "host" | "guest"
    pc: null,
    dc: null,
    connected: false,
    followHost: true,
    syncTimer: null,
  }
};

/* ---------------------- profile data getters ---------------------- */
function profData(){
  return state.profilesData[state.activeProfileId];
}
function saveProfiles(){
  saveLS(LS_PROFILES, state.profiles);
  saveLS(LS_ACTIVE_PROFILE, state.activeProfileId);
  saveLS(LS_PROFILE_DATA, state.profilesData);
}

/* ---------------------- progress keys ---------------------- */
function keyForItem(itemId){
  return `item:${itemId}`;
}
function keyForEpisode(itemId, epId){
  return `ep:${itemId}:${epId}`;
}

/* ---------------------- progress + reactions ---------------------- */
function getProgress(key){
  return profData().progress[key] || null;
}
function setProgress(key, t, d){
  const now = Date.now();
  profData().progress[key] = { t: Math.max(0, Number(t)||0), d: Math.max(0, Number(d)||0), updatedAt: now };
  saveLS(LS_PROFILE_DATA, state.profilesData);
}
function clearProgress(key){
  delete profData().progress[key];
  saveLS(LS_PROFILE_DATA, state.profilesData);
}
function progressRatio(key){
  const p = getProgress(key);
  if (!p || !p.d || p.d <= 0) return 0;
  return clamp(p.t / p.d, 0, 1);
}
function getReaction(itemId){
  return Number(profData().reactions[itemId] || 0);
}
function setReaction(itemId, val){
  profData().reactions[itemId] = val;
  saveLS(LS_PROFILE_DATA, state.profilesData);
}
function isInMyList(itemId){
  return profData().myList.includes(itemId);
}
function toggleMyList(itemId){
  const d = profData();
  if (d.myList.includes(itemId)) d.myList = d.myList.filter(x => x !== itemId);
  else d.myList.push(itemId);
  saveLS(LS_PROFILE_DATA, state.profilesData);
}

/* ---------------------- assets resolving ---------------------- */
async function resolveAssetUrl(key){
  if (!key) return null;
  if (state.assetUrlCache.has(key)) return state.assetUrlCache.get(key);
  try{
    const blob = await idbGet(key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    state.assetUrlCache.set(key, url);
    state.objectUrls.add(url);
    return url;
  }catch{ return null; }
}

/* ---------------------- elements ---------------------- */
const viewBrowse = $("#viewBrowse");
const viewTitle  = $("#viewTitle");
const viewStudio = $("#viewStudio");
const viewSettings = $("#viewSettings");

const tabs = $$(".tab");
const rowsRoot = $("#rowsRoot");

const heroTitle = $("#heroTitle");
const heroMeta  = $("#heroMeta");
const heroDesc  = $("#heroDesc");
const heroGoStudioBtn = $("#heroGoStudioBtn");
const heroLearnBtn = $("#heroLearnBtn");

const searchBtn = $("#searchBtn");
const searchWrap = $("#searchWrap");
const searchInput = $("#searchInput");

/* profile UI */
const profileBtn = $("#profileBtn");
const profileAvatar = $("#profileAvatar");
const profileName = $("#profileName");
const profilePopover = $("#profilePopover");
const profilesList = $("#profilesList");
const newProfileName = $("#newProfileName");
const addProfileBtn = $("#addProfileBtn");

const backBtn = $("#backBtn");
const editTitleBtn = $("#editTitleBtn");
const deleteTitleBtn = $("#deleteTitleBtn");

const titleName = $("#titleName");
const titleMeta = $("#titleMeta");
const titleDesc = $("#titleDesc");
const titleKicker = $("#titleKicker");
const titlePoster = $("#titlePoster");
const posterHint = $("#posterHint");
const posterBox = $("#posterBox");
const detailsKv = $("#detailsKv");
const tagsChips = $("#tagsChips");
const similarEl = $("#similar");
const playBtn = $("#playBtn");
const trailerBtn = $("#trailerBtn");
const myListBtn = $("#myListBtn");
const likeBtn = $("#likeBtn");
const dislikeBtn = $("#dislikeBtn");

const resumeRow = $("#resumeRow");
const resumeTime = $("#resumeTime");

/* episodes title */
const episodesPanel = $("#episodesPanel");
const seasonSelect = $("#seasonSelect");
const episodesList = $("#episodesList");
const episodesHint = $("#episodesHint");
const playSelectedEpisodeBtn = $("#playSelectedEpisodeBtn");

/* studio */
const form = $("#contentForm");
const formTitle = $("#formTitle");
const editId = $("#editId");

const titleInput = $("#titleInput");
const typeSelect = $("#typeSelect");
const yearInput = $("#yearInput");
const ageInput = $("#ageInput");
const durationInput = $("#durationInput");
const categoriesInput = $("#categoriesInput");
const descInput = $("#descInput");
const tagsInput = $("#tagsInput");

const videoSourceBlock = $("#videoSourceBlock");
const videoUrlInput = $("#videoUrlInput");

const episodesEditor = $("#episodesEditor");
const episodesEditorList = $("#episodesEditorList");
const addEpisodeBtn = $("#addEpisodeBtn");

const posterFile = $("#posterFile");
const posterUrlInput = $("#posterUrlInput");
const posterUploadWrap = $("#posterUploadWrap");
const posterUrlWrap = $("#posterUrlWrap");
const posterPreviewWrap = $("#posterPreviewWrap");
const posterPreview = $("#posterPreview");

const trailerFile = $("#trailerFile");
const trailerUrlInput = $("#trailerUrlInput");
const trailerUploadWrap = $("#trailerUploadWrap");
const trailerUrlWrap = $("#trailerUrlWrap");

const cancelEditBtn = $("#cancelEditBtn");

const libraryCount = $("#libraryCount");
const libraryEmpty = $("#libraryEmpty");
const libraryList = $("#libraryList");

const exportBtn = $("#exportBtn");
const importInput = $("#importInput");
const wipeBtn = $("#wipeBtn");

/* settings */
const kvCatalog = $("#kvCatalog");
const kvProfiles = $("#kvProfiles");
const kvProgress = $("#kvProgress");
const kvReactions = $("#kvReactions");
const kvMyList = $("#kvMyList");
const kvAssets = $("#kvAssets");

/* player modal */
const playerModal = $("#playerModal");
const playerPanel = $("#playerPanel");
const playerClose = $("#playerClose");
const partyBtn = $("#partyBtn");
const cinemaBtn = $("#cinemaBtn");
const pipBtn = $("#pipBtn");
const fsBtn = $("#fsBtn");

const player = $("#player");
const playerFrame = $("#playerFrame");
const playerTitle = $("#playerTitle");
const playerType = $("#playerType");
const playerHint = $("#playerHint");

/* party panel */
const partyPanel = $("#partyPanel");
const partyStatus = $("#partyStatus");
const hostCreateBtn = $("#hostCreateBtn");
const hostOffer = $("#hostOffer");
const copyOfferBtn = $("#copyOfferBtn");
const clearPartyBtn = $("#clearPartyBtn");
const hostAnswer = $("#hostAnswer");
const hostApplyAnswerBtn = $("#hostApplyAnswerBtn");

const guestOffer = $("#guestOffer");
const guestCreateAnswerBtn = $("#guestCreateAnswerBtn");
const guestAnswer = $("#guestAnswer");
const copyAnswerBtn = $("#copyAnswerBtn");
const followHostToggle = $("#followHostToggle");
const syncNowBtn = $("#syncNowBtn");

/* ---------------------- init ---------------------- */
wireUI();
route();
renderAll();

/* ---------------------- routing ---------------------- */
window.addEventListener("hashchange", route);

function route(){
  const h = (location.hash || "#browse").replace("#", "");
  if (h.startsWith("title=")){
    state.activeId = h.split("title=")[1] || "";
    setView("title");
    renderTitle();
    setActiveTab("browse");
    return;
  }
  if (h === "studio"){ setView("studio"); setActiveTab("studio"); renderStudio(); return; }
  if (h === "settings"){ setView("settings"); setActiveTab("settings"); renderSettings(); return; }
  setView("browse"); setActiveTab("browse"); renderBrowse();
}

function setView(v){
  state.view = v;
  viewBrowse.classList.toggle("is-active", v === "browse");
  viewTitle.classList.toggle("is-active", v === "title");
  viewStudio.classList.toggle("is-active", v === "studio");
  viewSettings.classList.toggle("is-active", v === "settings");
}

function setActiveTab(name){
  tabs.forEach(t => t.classList.toggle("is-active", t.dataset.tab === name));
}

/* ---------------------- catalog helpers ---------------------- */
function metaLine(item){
  const bits = [];
  if (item.year) bits.push(item.year);
  if (item.age) bits.push(item.age);
  if (item.duration) bits.push(item.duration);
  return bits.join(" • ") || "—";
}
function sortByNewest(list){
  return list.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function newestItem(list){
  return sortByNewest(list)[0];
}
function matchItem(item, q){
  const hay = `${item.title} ${(item.tags||[]).join(" ")} ${(item.categories||[]).join(" ")} ${item.year||""} ${item.age||""}`.toLowerCase();
  return hay.includes(q);
}

/* ---------------------- series: episodes helpers ---------------------- */
function isSeries(item){ return item?.type === "series"; }
function ensureEpisodes(item){
  const eps = Array.isArray(item.episodes) ? item.episodes : [];
  return eps.filter(e => e && e.id && e.video);
}
function episodeLabel(ep){
  const s = toInt(ep.season, 1);
  const e = toInt(ep.episode, 1);
  return `S${s}E${e}`;
}
function getSeasons(item){
  const eps = ensureEpisodes(item);
  const set = new Set(eps.map(e => toInt(e.season, 1)));
  return Array.from(set).sort((a,b)=>a-b);
}
function findEpisode(item, epId){
  return ensureEpisodes(item).find(e => e.id === epId) || null;
}
function episodeProgressKey(item, ep){
  return keyForEpisode(item.id, ep.id);
}
function bestResumeForItem(item){
  if (!isSeries(item)){
    const k = keyForItem(item.id);
    const p = getProgress(k);
    return { key: k, p, label: null };
  }
  const eps = ensureEpisodes(item);
  let best = null;
  for (const ep of eps){
    const k = episodeProgressKey(item, ep);
    const p = getProgress(k);
    if (!p) continue;
    if (!best || (p.updatedAt || 0) > (best.p.updatedAt || 0)){
      best = { key: k, p, label: `${episodeLabel(ep)}${ep.title ? " • " + ep.title : ""}`, epId: ep.id };
    }
  }
  return best || { key: null, p: null, label: null, epId: null };
}
function itemProgressRatio(item){
  const r = bestResumeForItem(item);
  if (!r.p) return 0;
  if (r.p.d <= 0) return 0;
  const ratio = clamp(r.p.t / r.p.d, 0, 1);
  // treat near-finish as finished
  if (ratio > 0.96) return 0;
  return ratio;
}
function itemContinueCandidate(item){
  const r = bestResumeForItem(item);
  if (!r.p) return null;
  const ratio = r.p.d > 0 ? clamp(r.p.t / r.p.d, 0, 1) : 0;
  if (ratio < 0.02 || ratio > 0.96) return null;
  return { item, ratio, updatedAt: r.p.updatedAt || 0, label: r.label, epId: r.epId };
}

/* ---------------------- rendering ---------------------- */
function renderAll(){
  renderProfileUI();
  renderBrowse();
  renderStudio();
  renderSettings();
}

function renderBrowse(){
  const hasAny = state.catalog.length > 0;

  if (!hasAny){
    heroTitle.textContent = "Aggiungi il tuo primo titolo";
    heroMeta.textContent = "Studio → Nuovo contenuto";
    heroDesc.textContent = "Incolla un link (file/YouTube/Vimeo), carica poster e trailer. Profili, episodi e watch party sono inclusi.";
  } else {
    const featured = newestItem(state.catalog);
    heroTitle.textContent = featured.title;
    heroMeta.textContent = metaLine(featured);
    heroDesc.textContent = featured.desc || "—";
  }

  rowsRoot.innerHTML = "";
  if (!hasAny){
    rowsRoot.appendChild(emptyBrowse());
    return;
  }

  const q = normalizeSearch(state.query);
  const base = q ? state.catalog.filter(it => matchItem(it, q)) : state.catalog.slice();

  // Continue watching
  const cont = base
    .map(itemContinueCandidate)
    .filter(Boolean)
    .sort((a,b) => (b.updatedAt - a.updatedAt))
    .slice(0, 16)
    .map(x => x.item);

  if (cont.length) rowsRoot.appendChild(rowSection("Continua a guardare", cont, { showProgress: true, showTrailerHover: true }));

  // My list
  const my = base.filter(x => isInMyList(x.id));
  if (my.length) rowsRoot.appendChild(rowSection("La mia lista", sortByNewest(my), { showProgress: true, showTrailerHover: true }));

  // Category rows
  buildBuckets(base).forEach(b => {
    if (!b.items.length) return;
    rowsRoot.appendChild(rowSection(b.title, b.items, { showProgress: true, showTrailerHover: true }));
  });
}

function emptyBrowse(){
  const el = document.createElement("div");
  el.className = "empty";
  el.innerHTML = `
    <p class="empty__title">Catalogo vuoto</p>
    <p class="empty__text">Apri <strong>Studio</strong> e crea il tuo primo titolo.</p>
  `;
  return el;
}

function buildBuckets(items){
  const byCat = new Map();
  items.forEach(it => {
    const cats = Array.isArray(it.categories) && it.categories.length ? it.categories : ["Tutti"];
    cats.forEach(c => {
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(it);
    });
  });

  const keys = Array.from(byCat.keys()).sort((a,b)=>a.localeCompare(b,"it"));
  const ordered = [];

  if (byCat.has("Tutti")) ordered.push({ title: "Tutti", items: sortByNewest(byCat.get("Tutti")) });
  keys.filter(k=>k!=="Tutti").forEach(k => ordered.push({ title: k, items: sortByNewest(byCat.get(k)) }));

  return ordered;
}

function rowSection(title, items, opts = {}){
  const section = document.createElement("section");
  section.className = "row";
  section.innerHTML = `
    <div class="row__head">
      <h2 class="row__title">${escapeHtml(title)}</h2>
      <span class="pill">${items.length} titoli</span>
    </div>
    <div class="scroller">
      <button class="arrow arrow--left" type="button" aria-label="Scorri a sinistra">‹</button>
      <div class="scroller__track" tabindex="0" aria-label="${escapeHtml(title)}"></div>
      <button class="arrow arrow--right" type="button" aria-label="Scorri a destra">›</button>
    </div>
  `;

  const track = $(".scroller__track", section);
  items.forEach(it => track.appendChild(cardEl(it, opts)));

  const left = $(".arrow--left", section);
  const right = $(".arrow--right", section);
  left.addEventListener("click", () => track.scrollBy({ left: -520, behavior: "smooth" }));
  right.addEventListener("click", () => track.scrollBy({ left: 520, behavior: "smooth" }));

  track.addEventListener("wheel", (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      track.scrollLeft += e.deltaY;
    }
  }, { passive:false });

  return section;
}

function cardEl(item, opts = {}){
  const el = document.createElement("article");
  el.className = "card";
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `Apri: ${item.title}`);

  let posterBg = posterFallbackStyle(item.id);
  if (item.poster?.kind === "url" && item.poster.url){
    posterBg = `url("${cssUrl(item.poster.url)}")`;
  }

  el.innerHTML = `
    <div class="card__poster" style="background-image:${posterBg};"></div>
    <div class="card__body">
      <h3 class="card__title">${escapeHtml(item.title)}</h3>
      <p class="card__meta">${escapeHtml(metaLine(item))}${item.type === "series" ? " • Serie" : ""}</p>
      <div class="card__progress" ${opts.showProgress ? "" : "hidden"} aria-label="Avanzamento">
        <span></span>
      </div>
    </div>
  `;

  // poster asset
  if (item.poster?.kind === "asset" && item.poster.key){
    resolveAssetUrl(item.poster.key).then(url => {
      if (!url) return;
      const poster = $(".card__poster", el);
      poster.style.backgroundImage = `url("${cssUrl(url)}")`;
    });
  }

  // progress
  const progressEl = $(".card__progress > span", el);
  const ratio = itemProgressRatio(item);
  if (opts.showProgress) progressEl.style.width = `${Math.round(ratio * 100)}%`;

  // trailer hover preview (only if hover device)
  const canHover = window.matchMedia && window.matchMedia("(hover: hover)").matches;
  if (opts.showTrailerHover && canHover){
    attachTrailerHover(el, item);
  }

  el.addEventListener("click", () => location.hash = `#title=${item.id}`);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") location.hash = `#title=${item.id}`;
  });

  return el;
}

/* Trailer hover preview: only direct/asset trailer with <video> */
function isPlayableTrailerSource(src){
  if (!src) return false;
  if (src.kind === "asset") return true;
  if (src.kind === "url"){
    const u = String(src.url || "").toLowerCase();
    return u.endsWith(".mp4") || u.endsWith(".webm") || u.includes(".mp4?") || u.includes(".webm?");
  }
  return false; // youtube/vimeo skip
}
function attachTrailerHover(cardEl, item){
  if (!isPlayableTrailerSource(item.trailer)) return;

  let previewWrap = null;
  let videoEl = null;

  const start = async () => {
    if (previewWrap) return;
    previewWrap = document.createElement("div");
    previewWrap.className = "card__preview";
    videoEl = document.createElement("video");
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.loop = true;
    videoEl.autoplay = true;
    videoEl.preload = "metadata";
    previewWrap.appendChild(videoEl);
    cardEl.appendChild(previewWrap);

    let srcUrl = null;
    if (item.trailer.kind === "asset"){
      srcUrl = await resolveAssetUrl(item.trailer.key);
    } else {
      srcUrl = item.trailer.url;
    }
    if (!srcUrl) return;

    videoEl.src = srcUrl;
    videoEl.play().catch(()=>{});
  };

  const stop = () => {
    if (!previewWrap) return;
    try{ videoEl.pause(); }catch{}
    try{ videoEl.removeAttribute("src"); videoEl.load(); }catch{}
    previewWrap.remove();
    previewWrap = null;
    videoEl = null;
  };

  cardEl.addEventListener("mouseenter", () => {
    const t = setTimeout(() => start(), 220);
    state.hoverTimers.set(item.id, t);
  });
  cardEl.addEventListener("mouseleave", () => {
    const t = state.hoverTimers.get(item.id);
    if (t) clearTimeout(t);
    state.hoverTimers.delete(item.id);
    stop();
  });
}

/* ---------------------- Title page ---------------------- */
function renderTitle(){
  const item = state.catalog.find(x => x.id === state.activeId);
  if (!item){ location.hash = "#browse"; return; }

  titleKicker.textContent = item.type === "series" ? "Serie" : item.type === "movie" ? "Film" : "Video";
  titleName.textContent = item.title;
  titleMeta.textContent = metaLine(item);
  titleDesc.textContent = item.desc || "—";

  // poster
  titlePoster.src = "";
  titlePoster.style.display = "block";
  posterBox.style.backgroundImage = "";
  posterHint.textContent = item.poster ? "—" : "Nessuna locandina: aggiungila dallo Studio.";

  if (item.poster?.kind === "url" && item.poster.url){
    titlePoster.src = item.poster.url;
    posterHint.textContent = "Locandina da URL.";
  } else if (item.poster?.kind === "asset" && item.poster.key){
    posterHint.textContent = "Locandina caricata (locale).";
    resolveAssetUrl(item.poster.key).then(url => { if (url) titlePoster.src = url; });
  } else {
    titlePoster.style.display = "none";
    posterBox.style.backgroundImage = posterFallbackStyle(item.id);
  }

  // details
  detailsKv.innerHTML = "";
  detailsKv.appendChild(kvRow("Anno", item.year || "—"));
  detailsKv.appendChild(kvRow("Rating", item.age || "—"));
  detailsKv.appendChild(kvRow("Durata", item.duration || "—"));
  detailsKv.appendChild(kvRow("Categorie", item.categories?.length ? item.categories.join(", ") : "Tutti"));

  if (!isSeries(item)){
    detailsKv.appendChild(kvRow("Sorgente", sourceLabel(item.video)));
  } else {
    detailsKv.appendChild(kvRow("Sorgente", "Episodi (per episodio)"));
  }

  // tags
  tagsChips.innerHTML = "";
  (item.tags || []).forEach(t => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = t;
    tagsChips.appendChild(chip);
  });

  // resume
  const res = bestResumeForItem(item);
  if (res.p){
    const ratio = res.p.d > 0 ? clamp(res.p.t / res.p.d, 0, 1) : 0;
    if (ratio > 0.02 && ratio < 0.96){
      resumeRow.hidden = false;
      resumeTime.textContent = `${res.label ? res.label + " — " : ""}${fmtTime(res.p.t)} / ${fmtTime(res.p.d || 0)}`;
    } else {
      resumeRow.hidden = true;
    }
  } else {
    resumeRow.hidden = true;
  }

  // actions
  playBtn.onclick = () => openPlayerForItem(item, "video");
  trailerBtn.disabled = !hasTrailer(item);
  trailerBtn.onclick = () => openPlayerForItem(item, "trailer");

  setMyListBtn(item.id);
  myListBtn.onclick = () => {
    toggleMyList(item.id);
    setMyListBtn(item.id);
    renderBrowse();
    toast(isInMyList(item.id) ? "Aggiunto alla lista" : "Rimosso dalla lista");
  };

  syncReactionButtons(item.id);
  likeBtn.onclick = () => toggleReaction(item.id, +1);
  dislikeBtn.onclick = () => toggleReaction(item.id, -1);

  editTitleBtn.onclick = () => { location.hash = "#studio"; startEdit(item.id); };
  deleteTitleBtn.onclick = async () => {
    const ok = confirm(`Eliminare "${item.title}"? (Poster/trailer locali verranno rimossi)`);
    if (!ok) return;
    await deleteItem(item.id);
    location.hash = "#browse";
    renderAll();
  };

  // Episodes panel
  renderEpisodesPanel(item);

  // similar
  const others = state.catalog.filter(x => x.id !== item.id);
  const sim = shuffle(others).slice(0, 6);
  similarEl.innerHTML = "";
  if (!sim.length){
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Aggiungi altri titoli per vedere “Simili”.";
    similarEl.appendChild(p);
  } else {
    sim.forEach(s => similarEl.appendChild(simEl(s)));
  }
}

function renderEpisodesPanel(item){
  if (!isSeries(item)){
    episodesPanel.hidden = true;
    return;
  }

  const eps = ensureEpisodes(item).sort((a,b)=>{
    const sa = toInt(a.season,1), sb = toInt(b.season,1);
    if (sa !== sb) return sa - sb;
    return toInt(a.episode,1) - toInt(b.episode,1);
  });

  episodesPanel.hidden = false;
  episodesList.innerHTML = "";

  const seasons = getSeasons(item);
  seasonSelect.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "all";
  optAll.textContent = "Tutte";
  seasonSelect.appendChild(optAll);
  seasons.forEach(s => {
    const o = document.createElement("option");
    o.value = String(s);
    o.textContent = `Stagione ${s}`;
    seasonSelect.appendChild(o);
  });

  // default selection: last watched episode if exists
  const res = bestResumeForItem(item);
  if (res.epId) state.selectedEpisodeId = res.epId;
  if (!state.selectedEpisodeId && eps[0]) state.selectedEpisodeId = eps[0].id;

  state.selectedSeason = "all";
  seasonSelect.value = "all";

  seasonSelect.onchange = () => {
    state.selectedSeason = seasonSelect.value;
    paintEpisodesList(item);
  };

  playSelectedEpisodeBtn.onclick = () => openPlayerForItem(item, "video", state.selectedEpisodeId);

  paintEpisodesList(item);

  episodesHint.textContent = eps.length ? "Clicca un episodio per selezionarlo. Play usa l’episodio selezionato." : "Aggiungi episodi dallo Studio.";
}

function paintEpisodesList(item){
  const eps = ensureEpisodes(item).sort((a,b)=>{
    const sa = toInt(a.season,1), sb = toInt(b.season,1);
    if (sa !== sb) return sa - sb;
    return toInt(a.episode,1) - toInt(b.episode,1);
  });

  const season = state.selectedSeason;
  const list = season === "all" ? eps : eps.filter(e => String(toInt(e.season,1)) === String(season));

  episodesList.innerHTML = "";
  list.forEach(ep => episodesList.appendChild(episodeEl(item, ep)));
}

function episodeEl(item, ep){
  const el = document.createElement("div");
  el.className = "ep";
  if (ep.id === state.selectedEpisodeId) el.classList.add("is-active");

  const label = episodeLabel(ep);
  const name = ep.title ? `${label} • ${ep.title}` : label;
  const meta = sourceLabel(ep.video);

  const k = episodeProgressKey(item, ep);
  const ratio = progressRatio(k);

  el.innerHTML = `
    <div class="ep__top">
      <div>
        <p class="ep__name">${escapeHtml(name)}</p>
        <p class="ep__meta">${escapeHtml(meta)}${ep.duration ? " • " + escapeHtml(ep.duration) : ""}</p>
      </div>
      <button class="btn btn--ghost mini-btn" type="button">▶︎</button>
    </div>
    <div class="ep__progress"><span style="width:${Math.round(ratio*100)}%"></span></div>
  `;

  const play = $("button", el);
  play.onclick = (e) => {
    e.stopPropagation();
    state.selectedEpisodeId = ep.id;
    paintEpisodesList(item);
    openPlayerForItem(item, "video", ep.id);
  };

  el.onclick = () => {
    state.selectedEpisodeId = ep.id;
    paintEpisodesList(item);
    toast(`Selezionato ${label}`);
  };

  return el;
}

function kvRow(k, v){
  const row = document.createElement("div");
  row.className = "kv__row";
  row.innerHTML = `<span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong>`;
  return row;
}

function simEl(item){
  const el = document.createElement("div");
  el.className = "sim";
  el.tabIndex = 0;
  el.setAttribute("role", "button");

  el.innerHTML = `
    <div class="sim__poster"></div>
    <div class="sim__body">
      <p class="sim__title">${escapeHtml(item.title)}</p>
      <p class="sim__meta">${escapeHtml(metaLine(item))}</p>
    </div>
  `;

  const posterDiv = $(".sim__poster", el);
  if (item.poster?.kind === "url" && item.poster.url){
    posterDiv.style.backgroundImage = `url("${cssUrl(item.poster.url)}")`;
  } else if (item.poster?.kind === "asset" && item.poster.key){
    resolveAssetUrl(item.poster.key).then(url => {
      if (!url) return;
      posterDiv.style.backgroundImage = `url("${cssUrl(url)}")`;
    });
  } else {
    posterDiv.style.backgroundImage = posterFallbackStyle(item.id);
  }

  el.addEventListener("click", () => location.hash = `#title=${item.id}`);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") location.hash = `#title=${item.id}`;
  });

  return el;
}

/* ---------------------- reactions ---------------------- */
function toggleReaction(id, val){
  const cur = getReaction(id);
  const next = (cur === val) ? 0 : val;
  setReaction(id, next);
  syncReactionButtons(id);
  toast(next === 1 ? "👍 Like" : next === -1 ? "👎 Dislike" : "Reazione rimossa");
}
function syncReactionButtons(id){
  const r = getReaction(id);
  likeBtn.classList.toggle("is-on", r === 1);
  dislikeBtn.classList.toggle("is-on", r === -1);
}

/* ---------------------- My List ---------------------- */
function setMyListBtn(id){
  const on = isInMyList(id);
  myListBtn.textContent = on ? "✓" : "＋";
  myListBtn.title = on ? "Nella mia lista" : "Aggiungi alla mia lista";
}

/* ---------------------- Studio (episodes editor) ---------------------- */
let episodesDraft = [];

function renderStudio(){
  const n = state.catalog.length;
  libraryCount.textContent = `${n} contenuti`;
  libraryEmpty.hidden = n !== 0;

  libraryList.innerHTML = "";
  sortByNewest(state.catalog).forEach(it => libraryList.appendChild(libraryItemEl(it)));

  updatePosterPreview();
  syncTypeUI();
  renderEpisodesEditor();
}

function syncTypeUI(){
  const type = typeSelect.value;
  const isS = type === "series";
  videoSourceBlock.hidden = isS;
  videoUrlInput.required = !isS;

  episodesEditor.hidden = !isS;
}

function renderEpisodesEditor(){
  episodesEditorList.innerHTML = "";
  if (typeSelect.value !== "series") return;

  if (!Array.isArray(episodesDraft)) episodesDraft = [];
  episodesDraft.forEach(ep => episodesEditorList.appendChild(episodeEditorRow(ep)));
}

function episodeEditorRow(ep){
  const el = document.createElement("div");
  el.className = "ep-row";
  const label = `S${toInt(ep.season,1)}E${toInt(ep.episode,1)}`;

  el.innerHTML = `
    <div class="ep-row__top">
      <div class="ep-row__title">${escapeHtml(label)} — ${escapeHtml(ep.title || "Episodio")}</div>
      <button class="mini-x" type="button" aria-label="Rimuovi episodio">✕</button>
    </div>

    <div class="ep-grid">
      <div class="field">
        <label>Stagione</label>
        <input class="ep-season" type="number" min="1" value="${escapeHtml(ep.season ?? 1)}" />
      </div>
      <div class="field">
        <label>Episodio</label>
        <input class="ep-episode" type="number" min="1" value="${escapeHtml(ep.episode ?? 1)}" />
      </div>
      <div class="field">
        <label>Titolo</label>
        <input class="ep-title" type="text" placeholder="Titolo episodio" value="${escapeHtml(ep.title || "")}" />
      </div>
    </div>

    <div class="ep-grid2">
      <div class="field">
        <label>Link video *</label>
        <input class="ep-url" type="url" placeholder="https://...mp4  oppure YouTube/Vimeo" value="${escapeHtml(ep.url || "")}" />
      </div>
      <div class="field">
        <label>Durata (opzionale)</label>
        <input class="ep-duration" type="text" placeholder="Es. 42m" value="${escapeHtml(ep.duration || "")}" />
      </div>
    </div>
  `;

  const removeBtn = $(".mini-x", el);
  removeBtn.onclick = () => {
    episodesDraft = episodesDraft.filter(x => x.id !== ep.id);
    renderEpisodesEditor();
  };

  const seasonInp = $(".ep-season", el);
  const episodeInp = $(".ep-episode", el);
  const titleInp = $(".ep-title", el);
  const urlInp = $(".ep-url", el);
  const durInp = $(".ep-duration", el);

  const sync = () => {
    ep.season = toInt(seasonInp.value, 1);
    ep.episode = toInt(episodeInp.value, 1);
    ep.title = titleInp.value.trim();
    ep.url = urlInp.value.trim();
    ep.duration = durInp.value.trim();

    // update top label
    const top = $(".ep-row__title", el);
    const label2 = `S${toInt(ep.season,1)}E${toInt(ep.episode,1)}`;
    top.textContent = `${label2} — ${ep.title || "Episodio"}`;
  };

  [seasonInp, episodeInp, titleInp, urlInp, durInp].forEach(inp => inp.addEventListener("input", sync));
  return el;
}

function libraryItemEl(item){
  const el = document.createElement("div");
  el.className = "item";

  el.innerHTML = `
    <div class="thumb"><img alt="Poster" /></div>
    <div>
      <p class="item__title">${escapeHtml(item.title)}</p>
      <p class="item__meta">${escapeHtml(metaLine(item))} • ${escapeHtml((item.categories?.[0] || "Tutti"))}${item.type==="series"?" • Serie":""}</p>
    </div>
    <div class="item__actions">
      <button class="small" type="button">Apri</button>
      <button class="small" type="button">Modifica</button>
    </div>
  `;

  const img = $("img", el);
  const box = $(".thumb", el);

  if (item.poster?.kind === "url" && item.poster.url){
    img.src = item.poster.url;
  } else if (item.poster?.kind === "asset" && item.poster.key){
    resolveAssetUrl(item.poster.key).then(url => { if (url) img.src = url; });
  } else {
    img.removeAttribute("src");
    box.style.backgroundImage = posterFallbackStyle(item.id);
  }

  const [openBtn, editBtn] = $$(".small", el);
  openBtn.onclick = () => location.hash = `#title=${item.id}`;
  editBtn.onclick = () => startEdit(item.id);

  return el;
}

function startEdit(id){
  const item = state.catalog.find(x => x.id === id);
  if (!item) return;

  if (state.view !== "studio") location.hash = "#studio";

  formTitle.textContent = "Modifica contenuto";
  cancelEditBtn.hidden = false;
  editId.value = item.id;

  titleInput.value = item.title || "";
  typeSelect.value = item.type || "movie";
  yearInput.value = item.year || "";
  ageInput.value = item.age || "";
  durationInput.value = item.duration || "";
  categoriesInput.value = (item.categories || []).join(", ");
  descInput.value = item.desc || "";
  tagsInput.value = (item.tags || []).join(", ");

  // source
  videoUrlInput.value = item.video?.url || "";

  // episodes
  episodesDraft = ensureEpisodes(item).map(ep => ({
    id: ep.id,
    season: toInt(ep.season, 1),
    episode: toInt(ep.episode, 1),
    title: ep.title || "",
    url: ep.video?.url || ep.url || "",
    duration: ep.duration || "",
  }));

  setRadio("posterMode", item.poster?.kind === "url" ? "url" : "upload");
  posterUrlInput.value = item.poster?.kind === "url" ? (item.poster.url || "") : "";
  posterFile.value = "";
  togglePosterMode();

  const tMode = !item.trailer ? "none" : (item.trailer.kind === "url" || item.trailer.kind === "youtube" || item.trailer.kind === "vimeo") ? "url" : "upload";
  setRadio("trailerMode", tMode);
  trailerUrlInput.value = (item.trailer && (item.trailer.kind === "url" || item.trailer.kind === "youtube" || item.trailer.kind === "vimeo")) ? (item.trailer.url || "") : "";
  trailerFile.value = "";
  toggleTrailerMode();

  updatePosterPreview();
  syncTypeUI();
  renderEpisodesEditor();
  scrollToTopStudio();
}

function resetForm(){
  formTitle.textContent = "Nuovo contenuto";
  cancelEditBtn.hidden = true;
  editId.value = "";

  form.reset();
  typeSelect.value = "movie";
  setRadio("posterMode", "upload");
  setRadio("trailerMode", "none");

  posterUrlInput.value = "";
  trailerUrlInput.value = "";
  posterPreviewWrap.hidden = true;
  posterPreview.src = "";
  episodesDraft = [];

  togglePosterMode();
  toggleTrailerMode();
  syncTypeUI();
  renderEpisodesEditor();
}

function scrollToTopStudio(){
  const studio = $(".studio");
  if (studio) studio.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setRadio(name, value){
  const group = $$(`input[name="${name}"]`);
  group.forEach(r => r.checked = (r.value === value));
}
function getRadio(name){
  const r = $(`input[name="${name}"]:checked`);
  return r ? r.value : null;
}

/* ---------------------- create/update/delete items ---------------------- */
async function upsertFromForm(){
  const id = editId.value || uid();

  const title = titleInput.value.trim();
  const type = typeSelect.value;
  const year = yearInput.value ? Number(yearInput.value) : "";
  const age = ageInput.value.trim();
  const duration = durationInput.value.trim();
  const categories = splitCSV(categoriesInput.value);
  const desc = descInput.value.trim();
  const tags = splitCSV(tagsInput.value);

  if (!title) throw new Error("Titolo obbligatorio.");

  let video = null;
  let episodes = [];

  if (type === "series"){
    // episodes required
    const cleaned = (episodesDraft || []).map(ep => ({
      id: ep.id || uid(),
      season: toInt(ep.season, 1),
      episode: toInt(ep.episode, 1),
      title: (ep.title || "").trim(),
      duration: (ep.duration || "").trim(),
      video: detectSource((ep.url || "").trim()),
    }));

    // validate
    const bad = cleaned.find(e => !e.video?.url);
    if (bad) throw new Error("Ogni episodio deve avere un link video valido.");

    episodes = cleaned;
  } else {
    const url = videoUrlInput.value.trim();
    if (!url) throw new Error("Link video obbligatorio.");
    video = detectSource(url);
  }

  // poster
  let poster = null;
  const pMode = getRadio("posterMode");
  if (pMode === "url"){
    const pUrl = posterUrlInput.value.trim();
    if (pUrl) poster = { kind: "url", url: pUrl };
  } else {
    const file = posterFile.files?.[0];
    if (file){
      const key = `poster:${id}:${uid()}`;
      await idbSet(key, file);
      poster = { kind: "asset", key, name: file.name, type: file.type, size: file.size };
      state.assetUrlCache.delete(key);
    } else {
      const existing = state.catalog.find(x => x.id === id);
      if (existing?.poster) poster = existing.poster;
    }
  }

  // trailer
  let trailer = null;
  const tMode = getRadio("trailerMode");
  if (tMode === "url"){
    const tUrl = trailerUrlInput.value.trim();
    if (tUrl) trailer = detectSource(tUrl);
  } else if (tMode === "upload"){
    const file = trailerFile.files?.[0];
    if (file){
      const key = `trailer:${id}:${uid()}`;
      await idbSet(key, file);
      trailer = { kind: "asset", key, name: file.name, type: file.type, size: file.size };
      state.assetUrlCache.delete(key);
    } else {
      const existing = state.catalog.find(x => x.id === id);
      if (existing?.trailer) trailer = existing.trailer;
    }
  } else {
    trailer = null;
  }

  const now = Date.now();
  const existingIndex = state.catalog.findIndex(x => x.id === id);

  const item = {
    id,
    title,
    type,
    year,
    age,
    duration,
    categories: categories.length ? categories : [],
    tags,
    desc,
    video,      // for non-series
    episodes,   // for series
    trailer,
    poster,
    createdAt: existingIndex >= 0 ? (state.catalog[existingIndex].createdAt || now) : now,
    updatedAt: now,
  };

  if (existingIndex >= 0){
    const prev = state.catalog[existingIndex];
    await maybeCleanupReplacedAsset(prev.poster, item.poster);
    await maybeCleanupReplacedAsset(prev.trailer, item.trailer);
    state.catalog[existingIndex] = item;
  } else {
    state.catalog.push(item);
  }

  saveLS(LS_CATALOG, state.catalog);
  return item;
}

async function maybeCleanupReplacedAsset(prev, next){
  if (prev?.kind === "asset" && prev.key){
    const replaced = !next || next.kind !== "asset" || next.key !== prev.key;
    if (replaced) {
      try{ await idbDel(prev.key); }catch{}
      const cached = state.assetUrlCache.get(prev.key);
      if (cached){ try{ URL.revokeObjectURL(cached); }catch{} }
      state.assetUrlCache.delete(prev.key);
    }
  }
}

async function deleteItem(id){
  const idx = state.catalog.findIndex(x => x.id === id);
  if (idx < 0) return;

  const item = state.catalog[idx];

  if (item.poster?.kind === "asset" && item.poster.key) { try{ await idbDel(item.poster.key); }catch{} }
  if (item.trailer?.kind === "asset" && item.trailer.key) { try{ await idbDel(item.trailer.key); }catch{} }

  // clean profile data entries
  Object.values(state.profilesData).forEach(d => {
    d.myList = (d.myList || []).filter(x => x !== id);
    delete d.reactions?.[id];

    // remove progress keys related to item
    const p = d.progress || {};
    Object.keys(p).forEach(k => {
      if (k === keyForItem(id) || k.startsWith(`ep:${id}:`)) delete p[k];
    });
  });

  state.catalog.splice(idx, 1);
  saveLS(LS_CATALOG, state.catalog);
  saveLS(LS_PROFILE_DATA, state.profilesData);
}

/* ---------------------- player ---------------------- */
function hasTrailer(item){
  const t = item.trailer;
  if (!t) return false;
  if (t.kind === "asset") return !!t.key;
  if (t.kind === "youtube" || t.kind === "vimeo") return !!t.id;
  if (t.kind === "url") return !!t.url;
  return false;
}
function sourceLabel(src){
  if (!src) return "—";
  if (src.kind === "youtube") return "YouTube";
  if (src.kind === "vimeo") return "Vimeo";
  if (src.kind === "url") return "File URL";
  if (src.kind === "asset") return "File locale";
  return "—";
}

async function openPlayerForItem(item, kind, episodeId = null){
  stopPlayback();
  resetPartyUI(); // close party state per session

  state.playingItemId = item.id;
  state.playingKind = kind;
  state.playingEpisodeId = null;

  playerTitle.textContent = item.title;
  playerType.textContent = kind === "trailer" ? "Trailer" : (item.type === "series" ? "Episodio" : "Video");
  playerHint.textContent = "";
  setCinema(false);

  const srcObj = (kind === "trailer") ? item.trailer : (item.type === "series" ? null : item.video);

  // choose episode if series & playing video
  let episode = null;
  if (kind === "video" && item.type === "series"){
    const eps = ensureEpisodes(item);
    if (!eps.length){
      toast("Serie senza episodi.");
      return;
    }
    const chosenId = episodeId || state.selectedEpisodeId || bestResumeForItem(item).epId || eps[0].id;
    episode = findEpisode(item, chosenId) || eps[0];
    state.playingEpisodeId = episode.id;
  }

  // show correct player type
  player.classList.remove("is-on");
  playerFrame.classList.remove("is-on");

  // iframe embeds
  const playEmbed = (obj) => {
    const embed = buildEmbedSrc(obj);
    if (!embed){ toast("Embed non disponibile."); return false; }
    playerFrame.src = embed;
    playerFrame.classList.add("is-on");
    openModal();
    // Watch party doesn't work with embed
    return true;
  };

  // direct/asset <video>
  const playVideo = async (obj, resumeKey) => {
    let url = null;
    if (obj.kind === "asset"){
      url = await resolveAssetUrl(obj.key);
      if (!url){ toast("Asset locale non trovato."); return false; }
    } else {
      url = obj.url;
    }
    if (!url){ toast("Link mancante."); return false; }

    player.src = url;
    player.classList.add("is-on");
    openModal();

    if (obj.kind === "url"){
      playerHint.textContent = "Se non parte: spesso è un blocco del provider (hotlink/range) o non è un file diretto.";
    }

    await maybeResume(resumeKey);
    safePlay();
    return true;
  };

  if (kind === "trailer"){
    if (!srcObj){ toast("Trailer non disponibile."); return; }
    if (srcObj.kind === "youtube" || srcObj.kind === "vimeo"){
      playEmbed(srcObj);
      return;
    }
    if (srcObj.kind === "asset" || srcObj.kind === "url"){
      // trailer resume not saved (use key anyway but won't matter)
      await playVideo(srcObj.kind === "url" ? srcObj : srcObj, null);
      return;
    }
  }

  // series: episode video
  if (item.type === "series"){
    const v = episode.video;
    const resumeKey = keyForEpisode(item.id, episode.id);

    // update title type label
    playerType.textContent = `${episodeLabel(episode)}${episode.title ? " • " + episode.title : ""}`;

    if (v.kind === "youtube" || v.kind === "vimeo"){
      playEmbed(v);
      return;
    }
    if (v.kind === "url"){
      await playVideo(v, resumeKey);
      return;
    }
    // shouldn't happen; episodes store detectSource => url/youtube/vimeo
    toast("Tipo sorgente episodio non supportato.");
    return;
  }

  // movie/video: item.video
  if (!srcObj){ toast("Sorgente non disponibile."); return; }
  if (srcObj.kind === "youtube" || srcObj.kind === "vimeo"){
    playEmbed(srcObj);
    return;
  }
  if (srcObj.kind === "url"){
    await playVideo(srcObj, keyForItem(item.id));
    return;
  }

  toast("Sorgente non supportata.");
}

async function maybeResume(resumeKey){
  if (!resumeKey) return;
  if (!player.classList.contains("is-on")) return;

  const p = getProgress(resumeKey);
  if (!p || !p.t || !p.d) return;

  await waitForEvent(player, "loadedmetadata", 1500).catch(()=>{});
  const dur = Number(player.duration || 0);
  if (dur > 0 && p.t < dur - 6){
    try{ player.currentTime = p.t; }catch{}
  }
}

function safePlay(){
  player.play().catch(()=>{});
}

function stopPlayback(){
  try{ player.pause(); }catch{}
  player.removeAttribute("src");
  player.load();

  playerFrame.removeAttribute("src");

  state.playingItemId = null;
  state.playingEpisodeId = null;
  state.playingKind = null;
  state.saveTick = 0;

  stopParty();
}

function openModal(){
  playerModal.classList.add("is-open");
  playerModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  playerClose.focus();
}

function closeModal(){
  playerModal.classList.remove("is-open");
  playerModal.classList.remove("is-cinema");
  playerModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  stopPlayback();
}

function setCinema(on){
  playerModal.classList.toggle("is-cinema", !!on);
  cinemaBtn.setAttribute("aria-pressed", String(!!on));
}

function requestFullscreen(el){
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (fn) return fn.call(el);
}
function exitFullscreen(){
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if (fn) return fn.call(document);
}
function isFullscreen(){
  return !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
}

/* Save progress (throttled) */
function bindProgressSaving(){
  player.addEventListener("timeupdate", () => {
    if (!state.playingItemId) return;
    if (!player.duration || !isFinite(player.duration)) return;

    const now = Date.now();
    if (now - state.saveTick < 2500) return;
    state.saveTick = now;

    const key = state.playingEpisodeId
      ? keyForEpisode(state.playingItemId, state.playingEpisodeId)
      : keyForItem(state.playingItemId);

    setProgress(key, player.currentTime, player.duration);

    // if party host, broadcast position sometimes
    if (state.party.connected && state.party.role === "host"){
      partySendState(false);
    }
  });

  player.addEventListener("pause", () => {
    if (!state.playingItemId) return;
    if (!player.duration || !isFinite(player.duration)) return;

    const key = state.playingEpisodeId
      ? keyForEpisode(state.playingItemId, state.playingEpisodeId)
      : keyForItem(state.playingItemId);

    setProgress(key, player.currentTime, player.duration);
    renderBrowse();
    if (state.view === "title") renderTitle();
  });

  player.addEventListener("ended", () => {
    if (!state.playingItemId) return;

    const key = state.playingEpisodeId
      ? keyForEpisode(state.playingItemId, state.playingEpisodeId)
      : keyForItem(state.playingItemId);

    clearProgress(key);
    renderBrowse();
    if (state.view === "title") renderTitle();
  });

  player.addEventListener("error", () => {
    playerHint.textContent = "Errore playback. Spesso: link non diretto, server che blocca hotlink o non supporta range requests.";
  });

  // watch party control events (host only)
  const hostOnly = () => state.party.connected && state.party.role === "host" && player.classList.contains("is-on");

  player.addEventListener("play", () => {
    if (!hostOnly()) return;
    partySend({ type: "play", t: player.currentTime });
  });
  player.addEventListener("pause", () => {
    if (!hostOnly()) return;
    partySend({ type: "pause", t: player.currentTime });
  });
  player.addEventListener("seeking", () => {
    if (!hostOnly()) return;
    partySend({ type: "seek", t: player.currentTime });
  });
}
bindProgressSaving();

/* helper: wait for event with timeout */
function waitForEvent(el, event, ms){
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      el.removeEventListener(event, on);
      reject(new Error("timeout"));
    }, ms);

    function on(){
      if (done) return;
      done = true;
      clearTimeout(t);
      el.removeEventListener(event, on);
      resolve(true);
    }

    el.addEventListener(event, on, { once: true });
  });
}

/* ---------------------- Watch Party (WebRTC, manual offer/answer) ---------------------- */
function resetPartyUI(){
  state.party.open = false;
  partyPanel.hidden = true;
  partyBtn.setAttribute("aria-pressed", "false");
  partyStatus.textContent = "Non connesso";

  hostOffer.value = "";
  hostAnswer.value = "";
  guestOffer.value = "";
  guestAnswer.value = "";
  followHostToggle.checked = true;
  state.party.followHost = true;

  stopParty();
}

function partyToggle(){
  const on = !state.party.open;
  state.party.open = on;
  partyPanel.hidden = !on;
  partyBtn.setAttribute("aria-pressed", String(on));
  if (on) {
    // warn if not native video
    if (!player.classList.contains("is-on")){
      toast("Watch Party: funziona solo su player nativo (<video>).");
    }
  }
}

function makePC(){
  // STUN only (no TURN) -> may fail on restrictive NATs [Non verificato]
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  return pc;
}

function partySetStatus(txt){
  partyStatus.textContent = txt;
}

function partyWireDataChannel(dc){
  state.party.dc = dc;

  dc.onopen = () => {
    state.party.connected = true;
    partySetStatus(`Connesso (${state.party.role})`);
    toast("Watch Party connessa");
    if (state.party.role === "host"){
      partySendState(true);
      startHostSyncLoop();
    }
  };

  dc.onclose = () => {
    state.party.connected = false;
    partySetStatus("Disconnesso");
    stopHostSyncLoop();
  };

  dc.onmessage = (ev) => {
    try{
      const msg = JSON.parse(ev.data);
      handlePartyMessage(msg);
    }catch{
      // ignore
    }
  };
}

function handlePartyMessage(msg){
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "request_state" && state.party.role === "host"){
    partySendState(true);
    return;
  }

  // guest applies host commands only if followHost
  if (state.party.role === "guest" && state.party.followHost){
    if (!player.classList.contains("is-on")) return;

    if (msg.type === "play"){
      try{
        if (Number.isFinite(msg.t)) player.currentTime = msg.t;
      }catch{}
      player.play().catch(()=>{});
      return;
    }
    if (msg.type === "pause"){
      try{
        if (Number.isFinite(msg.t)) player.currentTime = msg.t;
      }catch{}
      try{ player.pause(); }catch{}
      return;
    }
    if (msg.type === "seek"){
      try{
        if (Number.isFinite(msg.t)) player.currentTime = msg.t;
      }catch{}
      return;
    }
    if (msg.type === "state"){
      const { t, paused } = msg;
      if (!Number.isFinite(t)) return;

      const drift = Math.abs((player.currentTime || 0) - t);
      if (drift > 0.8){
        try{ player.currentTime = t; }catch{}
      }
      if (paused === true){
        try{ player.pause(); }catch{}
      } else if (paused === false){
        player.play().catch(()=>{});
      }
      return;
    }
  }
}

function partySend(obj){
  if (!state.party.dc || state.party.dc.readyState !== "open") return;
  try{
    state.party.dc.send(JSON.stringify(obj));
  }catch{}
}

function partySendState(force){
  if (!player.classList.contains("is-on")) return;
  if (!state.party.connected) return;

  const payload = {
    type: "state",
    t: player.currentTime || 0,
    d: player.duration || 0,
    paused: !!player.paused,
    ts: Date.now()
  };
  partySend(payload);
}

function startHostSyncLoop(){
  stopHostSyncLoop();
  // keep guests aligned
  state.party.syncTimer = setInterval(() => {
    if (state.party.role !== "host" || !state.party.connected) return;
    if (!player.classList.contains("is-on")) return;
    partySendState(false);
  }, 4500);
}
function stopHostSyncLoop(){
  if (state.party.syncTimer){
    clearInterval(state.party.syncTimer);
    state.party.syncTimer = null;
  }
}

function stopParty(){
  stopHostSyncLoop();

  try{ state.party.dc?.close(); }catch{}
  try{ state.party.pc?.close(); }catch{}
  state.party.dc = null;
  state.party.pc = null;
  state.party.connected = false;
  state.party.role = null;
}

async function waitIceComplete(pc, timeoutMs = 2500){
  if (pc.iceGatheringState === "complete") return true;
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timeoutMs);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete"){
        clearTimeout(t);
        resolve(true);
      }
    });
  });
}

async function hostCreate(){
  if (!player.classList.contains("is-on")){
    toast("Apri un video nativo prima (non embed).");
    return;
  }

  stopParty();
  state.party.role = "host";

  const pc = makePC();
  state.party.pc = pc;

  const dc = pc.createDataChannel("sync");
  partyWireDataChannel(dc);

  pc.onconnectionstatechange = () => {
    partySetStatus(pc.connectionState || "…");
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected"){
      stopHostSyncLoop();
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc, 3000);

  hostOffer.value = JSON.stringify(pc.localDescription);
  partySetStatus("Offerta pronta");
  toast("Offerta creata. Copiala e inviala.");
}

async function hostApplyAnswer(){
  if (!state.party.pc || state.party.role !== "host"){
    toast("Crea prima una stanza (Host).");
    return;
  }
  let ans;
  try{
    ans = JSON.parse(hostAnswer.value.trim());
  }catch{
    toast("Answer non valida.");
    return;
  }
  try{
    await state.party.pc.setRemoteDescription(ans);
    partySetStatus("Connesso (in attesa)");
    // host will become connected on dc open
  }catch{
    toast("Impossibile applicare Answer.");
  }
}

async function guestCreateAnswer(){
  if (!player.classList.contains("is-on")){
    toast("Apri lo stesso video nativo prima (stesso contenuto).");
    return;
  }

  stopParty();
  state.party.role = "guest";

  let off;
  try{
    off = JSON.parse(guestOffer.value.trim());
  }catch{
    toast("Offer non valida.");
    return;
  }

  const pc = makePC();
  state.party.pc = pc;

  pc.ondatachannel = (ev) => {
    partyWireDataChannel(ev.channel);
  };

  pc.onconnectionstatechange = () => {
    partySetStatus(pc.connectionState || "…");
  };

  try{
    await pc.setRemoteDescription(off);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceComplete(pc, 3000);

    guestAnswer.value = JSON.stringify(pc.localDescription);
    partySetStatus("Risposta pronta");
    toast("Risposta generata. Mandala all’host.");
  }catch{
    toast("Errore nel generare Answer.");
  }
}

function partyRequestState(){
  if (!state.party.connected) return;
  partySend({ type: "request_state" });
}

/* ---------------------- Settings ---------------------- */
async function renderSettings(){
  kvCatalog.textContent = `${state.catalog.length} contenuti`;
  kvProfiles.textContent = `${state.profiles.length} profili`;

  const d = profData();
  kvProgress.textContent = `${Object.keys(d.progress || {}).length} voci`;
  kvReactions.textContent = `${Object.keys(d.reactions || {}).length} titoli`;
  kvMyList.textContent = `${(d.myList || []).length} titoli`;

  try{
    const c = await idbCount();
    kvAssets.textContent = `${c} asset`;
  }catch{
    kvAssets.textContent = "—";
  }
}

/* ---------------------- JSON import/export ---------------------- */
function exportJSON(){
  const data = {
    exportedAt: new Date().toISOString(),
    catalog: state.catalog,
    profiles: state.profiles,
    activeProfileId: state.activeProfileId,
    profilesData: state.profilesData,
    note: "Gli asset caricati (poster/trailer upload) NON sono inclusi nel JSON: stanno in IndexedDB nel browser.",
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `streamly-export-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importJSON(data){
  if (!data || !Array.isArray(data.catalog)) throw new Error("Formato non valido.");

  // catalog merge by id
  const incoming = data.catalog.filter(x => x && x.id && x.title);
  const map = new Map(state.catalog.map(x => [x.id, x]));
  incoming.forEach(x => map.set(x.id, x));
  state.catalog = Array.from(map.values());
  saveLS(LS_CATALOG, state.catalog);

  // profiles optional
  if (Array.isArray(data.profiles) && data.profiles.length){
    state.profiles = data.profiles;
    saveLS(LS_PROFILES, state.profiles);
  }
  if (data.activeProfileId && state.profiles.some(p => p.id === data.activeProfileId)){
    state.activeProfileId = data.activeProfileId;
    saveLS(LS_ACTIVE_PROFILE, state.activeProfileId);
  }
  if (data.profilesData && typeof data.profilesData === "object"){
    state.profilesData = data.profilesData;
    // ensure all profiles exist in data
    state.profiles.forEach(p => {
      if (!state.profilesData[p.id]) state.profilesData[p.id] = { myList: [], progress: {}, reactions: {} };
    });
    saveLS(LS_PROFILE_DATA, state.profilesData);
  }
}

/* ---------------------- profile UI ---------------------- */
function renderProfileUI(){
  const p = state.profiles.find(x => x.id === state.activeProfileId) || state.profiles[0];
  if (!p) return;

  profileAvatar.textContent = p.avatar || avatarFromName(p.name);
  profileName.textContent = p.name || "Profile";

  profilesList.innerHTML = "";
  state.profiles.forEach(pr => profilesList.appendChild(profileRow(pr)));
}

function profileRow(p){
  const el = document.createElement("div");
  el.className = "profile-item";

  const isActive = p.id === state.activeProfileId;

  el.innerHTML = `
    <div class="profile-item__left">
      <div class="profile-item__ava">${escapeHtml(p.avatar || avatarFromName(p.name))}</div>
      <div>
        <div class="profile-item__name">${escapeHtml(p.name || "Profile")}${isActive ? " • attivo" : ""}</div>
        <div class="profile-item__meta">Progressi e reazioni separati</div>
      </div>
    </div>
    <div class="profile-item__btns">
      <button class="small" type="button">${isActive ? "✓" : "Usa"}</button>
      <button class="mini-x" type="button" aria-label="Elimina profilo">🗑</button>
    </div>
  `;

  const [useBtn, delBtn] = $$(".small, .mini-x", el);

  useBtn.onclick = () => {
    state.activeProfileId = p.id;
    saveLS(LS_ACTIVE_PROFILE, state.activeProfileId);
    renderAll();
    toast(`Profilo: ${p.name}`);
  };

  delBtn.onclick = () => {
    if (state.profiles.length <= 1){
      toast("Deve restare almeno 1 profilo.");
      return;
    }
    const ok = confirm(`Eliminare profilo "${p.name}"? (Perderai lista/progressi/reazioni di quel profilo)`);
    if (!ok) return;

    state.profiles = state.profiles.filter(x => x.id !== p.id);
    delete state.profilesData[p.id];

    if (state.activeProfileId === p.id){
      state.activeProfileId = state.profiles[0].id;
      saveLS(LS_ACTIVE_PROFILE, state.activeProfileId);
    }
    saveProfiles();
    renderAll();
  };

  return el;
}

function toggleProfilePopover(force = null){
  const isOpen = !profilePopover.hidden;
  const next = force === null ? !isOpen : !!force;
  profilePopover.hidden = !next;
  profileBtn.setAttribute("aria-expanded", String(next));
  if (next) newProfileName.focus();
}

/* ---------------------- UI wiring ---------------------- */
function wireUI(){
  // search
  searchBtn.addEventListener("click", () => {
    searchWrap.classList.toggle("is-open");
    if (searchWrap.classList.contains("is-open")) searchInput.focus();
    else {
      searchInput.value = "";
      state.query = "";
      renderBrowse();
    }
  });
  searchInput.addEventListener("input", (e) => {
    state.query = normalizeSearch(e.target.value);
    renderBrowse();
  });

  // hero
  heroGoStudioBtn.addEventListener("click", () => location.hash = "#studio");
  heroLearnBtn.addEventListener("click", () => alert(
    "Suggerimenti link:\n\n• File diretto: https://.../video.mp4 (più affidabile)\n• YouTube unlisted: incolla il link, Streamly usa embed\n• Vimeo: idem\n\nSe un URL non parte, spesso è un blocco del provider (hotlink/range)."
  ));

  // profile popover
  profileBtn.addEventListener("click", () => toggleProfilePopover());
  document.addEventListener("click", (e) => {
    const wrap = $("#profileWrap");
    if (!wrap.contains(e.target)) toggleProfilePopover(false);
  });

  addProfileBtn.addEventListener("click", () => {
    const name = newProfileName.value.trim();
    if (!name){ toast("Inserisci un nome."); return; }
    const p = { id: uid(), name, avatar: avatarFromName(name), createdAt: Date.now() };
    state.profiles.push(p);
    state.profilesData[p.id] = { myList: [], progress: {}, reactions: {} };
    state.activeProfileId = p.id;
    newProfileName.value = "";
    saveProfiles();
    renderAll();
    toast(`Creato profilo: ${name}`);
  });

  // back
  backBtn.addEventListener("click", () => location.hash = "#browse");

  // poster/trailer mode toggles
  $$('input[name="posterMode"]').forEach(r => r.addEventListener("change", togglePosterMode));
  $$('input[name="trailerMode"]').forEach(r => r.addEventListener("change", toggleTrailerMode));

  posterFile.addEventListener("change", updatePosterPreview);
  posterUrlInput.addEventListener("input", updatePosterPreview);

  // type change
  typeSelect.addEventListener("change", () => {
    syncTypeUI();
    renderEpisodesEditor();
  });

  addEpisodeBtn.addEventListener("click", () => {
    episodesDraft.push({
      id: uid(),
      season: 1,
      episode: episodesDraft.length + 1,
      title: "",
      url: "",
      duration: ""
    });
    renderEpisodesEditor();
  });

  // form submit
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try{
      const item = await upsertFromForm();
      toast(editId.value ? "Contenuto aggiornato" : "Contenuto creato");
      resetForm();
      renderAll();
      location.hash = `#title=${item.id}`;
    }catch(err){
      alert(err?.message || "Errore nel salvataggio.");
    }
  });

  cancelEditBtn.addEventListener("click", () => resetForm());

  // export/import/reset
  exportBtn.addEventListener("click", () => exportJSON());
  importInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try{
      const text = await file.text();
      const data = JSON.parse(text);
      await importJSON(data);
      toast("Import completato");
      renderAll();
      location.hash = "#studio";
    }catch{
      alert("File JSON non valido.");
    }finally{
      importInput.value = "";
    }
  });

  wipeBtn.addEventListener("click", async () => {
    const ok = confirm("Reset totale? (Cancella catalogo e profili-data locali. Gli asset in IndexedDB restano nel browser.)");
    if (!ok) return;

    state.catalog = [];
    saveLS(LS_CATALOG, state.catalog);

    // reset profiles data only
    Object.keys(state.profilesData).forEach(pid => {
      state.profilesData[pid] = { myList: [], progress: {}, reactions: {} };
    });
    saveLS(LS_PROFILE_DATA, state.profilesData);

    resetForm();
    renderAll();
    location.hash = "#browse";
  });

  // player modal close
  playerClose.addEventListener("click", closeModal);
  playerModal.addEventListener("click", (e) => {
    if (e.target?.dataset?.close === "true") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && playerModal.classList.contains("is-open")) closeModal();
  });

  // cinema toggle
  cinemaBtn.addEventListener("click", () => {
    const on = playerModal.classList.contains("is-cinema");
    setCinema(!on);
  });

  // fullscreen
  fsBtn.addEventListener("click", async () => {
    if (isFullscreen()) { await exitFullscreen(); return; }
    requestFullscreen(playerPanel);
  });

  // PiP (only for <video>)
  pipBtn.addEventListener("click", async () => {
    if (!player.classList.contains("is-on")) {
      toast("PiP disponibile solo per video file.");
      return;
    }
    if (!document.pictureInPictureEnabled) {
      toast("PiP non supportato dal browser.");
      return;
    }
    try{
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await player.requestPictureInPicture();
    }catch{
      toast("Impossibile avviare PiP.");
    }
  });

  // Watch Party UI
  partyBtn.addEventListener("click", partyToggle);

  hostCreateBtn.addEventListener("click", hostCreate);
  hostApplyAnswerBtn.addEventListener("click", hostApplyAnswer);
  guestCreateAnswerBtn.addEventListener("click", guestCreateAnswer);

  followHostToggle.addEventListener("change", () => {
    state.party.followHost = !!followHostToggle.checked;
    if (state.party.role === "guest" && state.party.connected && state.party.followHost){
      partyRequestState();
      toast("Segui host: ON");
    }
  });

  syncNowBtn.addEventListener("click", () => {
    if (state.party.role === "guest"){
      partyRequestState();
      toast("Richiesta sync inviata");
    } else if (state.party.role === "host"){
      partySendState(true);
      toast("Sync inviato");
    } else {
      toast("Non sei connesso");
    }
  });

  clearPartyBtn.addEventListener("click", () => {
    resetPartyUI();
    toast("Watch Party resettata");
  });

  copyOfferBtn.addEventListener("click", () => copyToClipboard(hostOffer.value, "Offerta copiata"));
  copyAnswerBtn.addEventListener("click", () => copyToClipboard(guestAnswer.value, "Risposta copiata"));

  // cleanup object urls
  window.addEventListener("beforeunload", cleanupObjectUrls);
}

function togglePosterMode(){
  const mode = getRadio("posterMode");
  posterUploadWrap.hidden = mode !== "upload";
  posterUrlWrap.hidden = mode !== "url";
  updatePosterPreview();
}
function toggleTrailerMode(){
  const mode = getRadio("trailerMode");
  trailerUploadWrap.hidden = mode !== "upload";
  trailerUrlWrap.hidden = mode !== "url";
}

function updatePosterPreview(){
  const mode = getRadio("posterMode");
  posterPreviewWrap.hidden = true;
  posterPreview.src = "";

  if (mode === "upload"){
    const f = posterFile.files?.[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    posterPreviewWrap.hidden = false;
    posterPreview.src = url;
    posterPreview.onload = () => URL.revokeObjectURL(url);
  } else {
    const u = posterUrlInput.value.trim();
    if (!u) return;
    posterPreviewWrap.hidden = false;
    posterPreview.src = u;
  }
}

/* ---------------------- clipboard ---------------------- */
async function copyToClipboard(text, okMsg){
  if (!text){ toast("Niente da copiare."); return; }
  try{
    await navigator.clipboard.writeText(text);
    toast(okMsg || "Copiato");
  }catch{
    // fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand("copy"); toast(okMsg || "Copiato"); }catch{ toast("Copia fallita"); }
    ta.remove();
  }
}

/* ---------------------- toast ---------------------- */
let toastTimer = null;
function toast(msg){
  let el = $("#toast");
  if (!el){
    el = document.createElement("div");
    el.id = "toast";
    el.style.position = "fixed";
    el.style.left = "50%";
    el.style.bottom = "18px";
    el.style.transform = "translateX(-50%)";
    el.style.padding = "10px 14px";
    el.style.borderRadius = "14px";
    el.style.border = "1px solid rgba(255,255,255,.14)";
    el.style.background = "rgba(0,0,0,.55)";
    el.style.backdropFilter = "blur(10px)";
    el.style.color = "rgba(255,255,255,.92)";
    el.style.zIndex = "60";
    el.style.boxShadow = "0 18px 50px rgba(0,0,0,.35)";
    el.style.transition = "opacity 220ms ease, transform 220ms ease";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "0";
  el.style.transform = "translateX(-50%) translateY(6px)";
  el.style.display = "block";
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateX(-50%) translateY(0)";
  });

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(-50%) translateY(6px)";
    setTimeout(() => (el.style.display = "none"), 220);
  }, 1200);
}

/* ---------------------- cleanup ---------------------- */
function cleanupObjectUrls(){
  for (const u of state.objectUrls) {
    try{ URL.revokeObjectURL(u); }catch{}
  }
  state.objectUrls.clear();
  state.assetUrlCache.clear();
}

/* ---------------------- initial render ---------------------- */
renderSettings();
renderProfileUI();

/* ---------------------- NOTE USAGE (important) ----------------------
  Se ti si rompe IndexedDB o i link non partono aprendo index.html via file://
  usa un mini server locale (es. VS Code Live Server).
  [Inferenza] Alcuni browser limitano storage su file://.
*/
