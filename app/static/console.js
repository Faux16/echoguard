/* EchoGuard Console v3 — every number drawn here comes from the engine (/api/scan, /api/gate). */
"use strict";
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const VERDICT = {
  CLEAR:             { hex: "#34d399", label: "Clear" },
  SUSPICIOUS:        { hex: "#fbbf24", label: "Suspicious" },
  HIGH_RISK:         { hex: "#f87171", label: "High risk" },
  INSUFFICIENT_DATA: { hex: "#8b9ab3", label: "Insufficient data" },
};
const RANK = { CLEAR: 0, INSUFFICIENT_DATA: 1, SUSPICIOUS: 2, HIGH_RISK: 3 };
const isFlag = v => v === "SUSPICIOUS" || v === "HIGH_RISK";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const state = { blob: null, name: null, data: null, grid: null, scale: "lin", geom: null, id: null, tags: [], note: "", saved: false };
const engine = { ok: false, info: null };

/* ============================================================ icons */
const ICONS = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  analyze: '<path d="M3 12h2l2-5 3 10 2.5-7 2 4H21"/>',
  live: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  batch: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  compare: '<path d="M12 3v18M4 7h5M4 12h5M4 17h5M15 7h5M15 12h5M15 17h5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 8v4l3 2"/>',
  policies: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  coverage: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6 4"/>',
  api: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  upload: '<path d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download: '<path d="M12 4v12m0 0l-4-4m4 4l4-4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  check: '<path d="M5 12l4 4L19 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17h.01"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7" cy="8" r="1"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h6M9 16h6"/>',
  json: '<path d="M8 4c-2 0-3 1-3 3v2c0 1.5-1 2-2 2 1 0 2 .5 2 2v2c0 2 1 3 3 3M16 4c2 0 3 1 3 3v2c0 1.5 1 2 2 2-1 0-2 .5-2 2v2c0 2-1 3-3 3"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
};
const icon = (n, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ICONS.info}</svg>`;
function fillIcons(root = document) { root.querySelectorAll(".ico-slot[data-ico]").forEach(s => { s.outerHTML = icon(s.dataset.ico); }); }

/* ============================================================ preferences (localStorage) */
const PREF_DEFAULT = { theme: "system", rail: false, compact: false, window: "1.0", hop: "0.5", autosave: true, toasts: true, policy: null, policyName: "Default" };
const prefs = (() => { try { return { ...PREF_DEFAULT, ...JSON.parse(localStorage.getItem("eg.prefs") || "{}") }; } catch { return { ...PREF_DEFAULT }; } })();
function savePrefs() { try { localStorage.setItem("eg.prefs", JSON.stringify(prefs)); localStorage.setItem("eg.theme", prefs.theme); } catch { /* private mode */ } }

/* ============================================================ theme */
function effectiveTheme() { return prefs.theme === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : prefs.theme; }
function applyTheme() {
  document.documentElement.dataset.theme = effectiveTheme();
  $("#themeBtn").innerHTML = icon(effectiveTheme() === "dark" ? "sun" : "moon");
  $("#themeBtn").title = `Theme: ${prefs.theme} — click to switch`;
  document.body.classList.toggle("compact", !!prefs.compact);
  requestAnimationFrame(redraw);
}
function setTheme(t) { prefs.theme = t; savePrefs(); applyTheme(); renderSettings(); }
$("#themeBtn").onclick = () => setTheme(effectiveTheme() === "dark" ? "light" : "dark");
matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => prefs.theme === "system" && applyTheme());

/* ============================================================ toasts */
function toast(msg, kind = "info", ms = 2600) {
  if (!prefs.toasts && kind !== "bad") return;
  const t = document.createElement("div"); t.className = "toast " + kind;
  t.innerHTML = icon(kind === "ok" ? "check" : kind === "bad" ? "warn" : "info") + `<span>${esc(msg)}</span>`;
  $("#toasts").appendChild(t); setTimeout(() => { t.style.opacity = 0; t.style.transition = "opacity .25s"; setTimeout(() => t.remove(), 260); }, ms);
}

/* ============================================================ store (IndexedDB) — captures stay in this browser */
const store = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const rq = indexedDB.open("echoguard", 1);
      rq.onupgradeneeded = () => { const d = rq.result; const s = d.createObjectStore("captures", { keyPath: "id" }); s.createIndex("ts", "ts"); };
      rq.onsuccess = () => { this.db = rq.result; res(this.db); }; rq.onerror = () => rej(rq.error);
    });
  },
  tx(mode, fn) { return this.open().then(db => new Promise((res, rej) => { const t = db.transaction("captures", mode), s = t.objectStore("captures"); const r = fn(s); t.oncomplete = () => res(r && r.result !== undefined ? r.result : r); t.onerror = () => rej(t.error); })); },
  put(rec) { return this.tx("readwrite", s => s.put(rec)); },
  del(id) { return this.tx("readwrite", s => s.delete(id)); },
  clear() { return this.tx("readwrite", s => s.clear()); },
  all() { return this.open().then(db => new Promise((res, rej) => { const r = db.transaction("captures").objectStore("captures").getAll(); r.onsuccess = () => res(r.result.sort((a, b) => b.ts - a.ts)); r.onerror = () => rej(r.error); })); },
  get(id) { return this.open().then(db => new Promise((res, rej) => { const r = db.transaction("captures").objectStore("captures").get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); })); },
};
let history = [];                       // in-memory mirror, newest first
async function loadHistory() { try { history = await store.all(); } catch { history = []; } }
/* a stored capture keeps the scan result (minus the heavy grids) and the WAV bytes so it can be re-opened and re-gated */
function recordFrom(d, blob, name, extra = {}) {
  const { spectrogram, psd, waveform, ...light } = d;
  return { id: extra.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)), ts: extra.ts || Date.now(), name, verdict: d.verdict, risk: d.overall_risk,
    sr: d.sample_rate, dur: d.duration_sec, oob: d.annotations.oob_ratio, car: carrierFound(d) ? d.annotations.carrier_peak_hz : null,
    sb: d.annotations.carrier_sideband_db, tags: extra.tags || [], note: extra.note || "", source: extra.source || "upload", data: light, blob, bytes: blob ? blob.size : 0 };
}
async function saveCapture(rec) {
  try { await store.put(rec); history = history.filter(r => r.id !== rec.id); history.unshift(rec); } catch (e) { toast("Could not save to history: " + e.message, "bad"); return false; }
  renderOverview(); return true;
}

/* ============================================================ engine */
async function scanBlob(blob, name, win = prefs.window, hop = prefs.hop) {
  const fd = new FormData();
  fd.append("file", blob, name || "clip.wav"); fd.append("window", win); fd.append("hop", hop);
  const r = await fetch("/api/scan", { method: "POST", body: fd });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || r.statusText); }
  return r.json();
}
async function health() {
  try {
    const r = await fetch("/api/health"); const d = await r.json(); engine.ok = true; engine.info = d;
    $("#led").classList.remove("off"); $("#engState").textContent = "Engine online"; $("#engSub").textContent = "echoguard " + d.version + " · " + d.detectors.length + " detectors";
  } catch { engine.ok = false; $("#led").classList.add("off"); $("#engState").textContent = "Engine offline"; $("#engSub").textContent = "start the server"; }
  renderEngineCard();
}

/* ============================================================ navigation */
const NAV = [
  { g: "Workspace" }, { v: "overview", l: "Overview", k: "1" }, { v: "analyze", l: "Analyze", k: "2" }, { v: "live", l: "Live monitor", k: "3", badge: true }, { v: "batch", l: "Batch", k: "4" },
  { g: "Records" }, { v: "history", l: "History", k: "5" }, { v: "compare", l: "Compare", k: "6" },
  { g: "Configure" }, { v: "policies", l: "Gate policies", k: "7" }, { v: "coverage", l: "Coverage & limits", k: "8" }, { v: "api", l: "API", k: "9" }, { v: "settings", l: "Settings", k: "0" },
];
const VIEW_NAMES = Object.fromEntries(NAV.filter(n => n.v).map(n => [n.v, n.l]));
function mountNav() {
  let h = ""; let open = false;
  NAV.forEach(n => { if (n.g) { if (open) h += "</nav>"; h += `<div class="navgroup">${n.g}</div><nav class="nav">`; open = true; return; }
    h += `<a data-v="${n.v}" title="${n.l}">${icon(n.v)}<span>${n.l}</span>${n.badge ? `<em class="badge hidden" id="liveBadge">0</em>` : ""}<span class="kbd">${n.k}</span></a>`; });
  $("#navmount").innerHTML = h + "</nav>";
  $$(".nav a").forEach(a => a.onclick = () => go(a.dataset.v));
}
let currentView = "overview";
function go(v, opts = {}) {
  if (!VIEW_NAMES[v]) v = "overview";
  currentView = v;
  $$(".nav a").forEach(a => a.classList.toggle("on", a.dataset.v === v));
  $$(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  $("#crumbView").textContent = VIEW_NAMES[v];
  const f = v === "analyze" && state.data ? state.name : "";
  $("#crumbFile").textContent = f; $("#crumbSep").classList.toggle("hidden", !f);
  if (v === "live") { live.unseen = 0; updateBadge(); }
  if (v === "overview") renderOverview();
  if (v === "history") renderHistory();
  if (v === "compare") renderCompare();
  if (v === "policies") renderPolicies();
  if (v === "coverage") renderCovPolicy();
  if (v === "settings") renderSettings();
  if (!opts.silent) { try { window.history.replaceState(null, "", "#" + v); } catch { /* file: */ } }
  window.scrollTo({ top: 0 });
  requestAnimationFrame(redraw);
}
document.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); go(g.dataset.go); } });
function redraw() {
  if (currentView === "analyze" && state.data) drawAnalyze();
  if (currentView === "live") { drawWaterfall(); drawStrip(); }
  if (currentView === "coverage") drawCoverage();
  if (currentView === "overview") { drawTrend(); drawOvCov(); }
}
let rzT; window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(redraw, 60); });

/* rail collapse */
function applyRail() { $("#app").classList.toggle("rail-collapsed", !!prefs.rail); $("#railBtn").innerHTML = icon("panel"); requestAnimationFrame(redraw); }
function toggleRail() { prefs.rail = !prefs.rail; savePrefs(); applyRail(); }
$("#railBtn").onclick = toggleRail;

/* menus */
function menu(btn, box, items) {
  btn.onclick = e => { e.stopPropagation(); box.innerHTML = items().map(it => it === "-" ? "<hr>" : `<a data-k="${it.k}">${icon(it.i)}${esc(it.l)}</a>`).join("");
    box.classList.toggle("hidden"); box.querySelectorAll("a").forEach(a => a.onclick = () => { box.classList.add("hidden"); items().find(x => x.k === a.dataset.k).f(); }); };
}
document.addEventListener("click", () => $$(".menu").forEach(m => m.classList.add("hidden")));
menu($("#moreBtn"), $("#moreMenu"), () => [
  { k: "theme", i: effectiveTheme() === "dark" ? "sun" : "moon", l: effectiveTheme() === "dark" ? "Light theme" : "Dark theme", f: () => setTheme(effectiveTheme() === "dark" ? "light" : "dark") },
  { k: "compact", i: "batch", l: prefs.compact ? "Comfortable density" : "Compact density", f: () => { prefs.compact = !prefs.compact; savePrefs(); applyTheme(); } },
  { k: "rail", i: "panel", l: prefs.rail ? "Expand sidebar" : "Collapse sidebar", f: toggleRail }, "-",
  { k: "api", i: "api", l: "API reference", f: () => go("api") }, { k: "set", i: "settings", l: "Settings", f: () => go("settings") },
]);

/* ============================================================ command palette (⌘K) */
const palette = { open: false, sel: 0, items: [] };
function paletteItems(q) {
  const out = [];
  NAV.filter(n => n.v).forEach(n => out.push({ g: "Go to", i: n.v, l: n.l, r: n.k, f: () => go(n.v) }));
  out.push({ g: "Actions", i: "upload", l: "Upload a WAV", f: () => fileIn.click() }, { g: "Actions", i: "mic", l: "Record from microphone", f: () => { go("analyze"); toggleRecord(); } },
    { g: "Actions", i: "play", l: "Start simulated live stream", f: () => { go("live"); if (!live.sim) $("#simBtn").click(); } },
    { g: "Actions", i: effectiveTheme() === "dark" ? "sun" : "moon", l: "Toggle theme", r: "T", f: () => setTheme(effectiveTheme() === "dark" ? "light" : "dark") },
    { g: "Actions", i: "panel", l: "Toggle sidebar", r: "[", f: toggleRail });
  ["attack", "benign", "beacon", "phone"].forEach(k => out.push({ g: "Samples", i: "spark", l: "Open sample: " + DEMO_LABEL[k], f: () => openDemo(k) }));
  history.slice(0, 30).forEach(h => out.push({ g: "History", i: "file", l: h.name, r: VERDICT[h.verdict]?.label || h.verdict, f: () => openRecord(h.id) }));
  const s = q.trim().toLowerCase();
  return s ? out.filter(it => (it.l + " " + it.g).toLowerCase().includes(s)) : out;
}
function openPalette() {
  if (palette.open) return; palette.open = true; palette.sel = 0;
  $("#paletteMount").innerHTML = `<div class="overlay" id="palOv"><div class="palette" role="dialog"><div class="in">${icon("search")}<input id="palIn" placeholder="Search views, actions, history…" autocomplete="off"><span class="kbd">esc</span></div><div class="list" id="palList"></div></div></div>`;
  const inp = $("#palIn"); inp.focus(); inp.oninput = renderPalette; renderPalette();
  $("#palOv").onclick = e => { if (e.target.id === "palOv") closePalette(); };
}
function closePalette() { palette.open = false; $("#paletteMount").innerHTML = ""; }
function renderPalette() {
  palette.items = paletteItems($("#palIn").value); palette.sel = Math.min(palette.sel, Math.max(0, palette.items.length - 1));
  let g = "", h = "";
  palette.items.forEach((it, i) => { if (it.g !== g) { g = it.g; h += `<div class="grp">${g}</div>`; } h += `<div class="it${i === palette.sel ? " sel" : ""}" data-i="${i}">${icon(it.i)}<span>${esc(it.l)}</span>${it.r ? `<span class="r">${esc(it.r)}</span>` : ""}</div>`; });
  $("#palList").innerHTML = h || `<div class="empty">No matches</div>`;
  $$("#palList .it").forEach(el => el.onclick = () => runPalette(+el.dataset.i));
  const s = $("#palList .it.sel"); if (s) s.scrollIntoView({ block: "nearest" });
}
function runPalette(i) { const it = palette.items[i]; closePalette(); if (it) it.f(); }
$("#searchBtn").onclick = openPalette;
document.addEventListener("keydown", e => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette.open ? closePalette() : openPalette(); return; }
  if (palette.open) {
    if (e.key === "Escape") closePalette();
    else if (e.key === "ArrowDown") { e.preventDefault(); palette.sel = Math.min(palette.items.length - 1, palette.sel + 1); renderPalette(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palette.sel = Math.max(0, palette.sel - 1); renderPalette(); }
    else if (e.key === "Enter") runPalette(palette.sel);
    return;
  }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "[") toggleRail();
  else if (e.key.toLowerCase() === "t") setTheme(effectiveTheme() === "dark" ? "light" : "dark");
  else if (/^[0-9]$/.test(e.key)) { const n = NAV.find(x => x.k === e.key); if (n) go(n.v); }
  else if (e.key === "?") go("settings");
});

/* ============================================================ canvas helpers */
function fit(c) {
  const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext("2d"); ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, W: r.width, H: r.height };
}
const LUT = heatLUT();
function heatLUT() {
  const st = [[0, [4, 6, 12]], [.14, [10, 28, 58]], [.30, [17, 62, 130]], [.46, [30, 118, 200]], [.60, [60, 182, 226]],
              [.72, [240, 208, 104]], [.85, [255, 144, 70]], [1, [255, 244, 228]]];
  const lut = new Uint8ClampedArray(768);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let a = st[0], b = st[st.length - 1];
    for (let s = 0; s < st.length - 1; s++) if (t >= st[s][0] && t <= st[s + 1][0]) { a = st[s]; b = st[s + 1]; break; }
    const f = (t - a[0]) / ((b[0] - a[0]) || 1);
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = a[1][k] + (b[1][k] - a[1][k]) * f;
  }
  return lut;
}
function decodeGrid(spec) {
  const raw = atob(spec.data), g = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) g[i] = raw.charCodeAt(i);
  return g;
}
const FMIN_LOG = 60;
function freqAt(frac, fmax, scale) { return scale === "log" ? Math.exp(Math.log(fmax) - frac * (Math.log(fmax) - Math.log(FMIN_LOG))) : fmax * (1 - frac); }
function fracOf(f, fmax, scale) {
  if (scale === "log") return (Math.log(fmax) - Math.log(Math.max(f, FMIN_LOG))) / (Math.log(fmax) - Math.log(FMIN_LOG));
  return 1 - f / fmax;
}
function freqTicks(fmax, scale) {
  if (scale === "log") return [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 40000].filter(f => f <= fmax);
  const step = fmax > 30000 ? 8000 : fmax > 12000 ? 4000 : 2000, out = [];
  for (let f = 0; f <= fmax; f += step) out.push(f);
  return out;
}
const kHz = f => (f >= 1000 ? (f / 1000).toFixed(f % 1000 ? 1 : 0) + "k" : f + "");
function niceStep(span, target) {
  const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || raw;
}
function paintGrid(ctx, grid, F, T, x0, y0, pw, ph, fmax, scale) {
  const rows = Math.max(2, Math.min(Math.round(ph), 520));
  const off = document.createElement("canvas"); off.width = T; off.height = rows;
  const oc = off.getContext("2d"), img = oc.createImageData(T, rows), d = img.data;
  for (let r = 0; r < rows; r++) {
    const f = freqAt(r / (rows - 1), fmax, scale);
    const src = Math.min(F - 1, Math.max(0, Math.round((1 - f / fmax) * (F - 1))));
    for (let c = 0; c < T; c++) { const v = grid[src * T + c], o = (r * T + c) * 4; d[o] = LUT[v * 3]; d[o + 1] = LUT[v * 3 + 1]; d[o + 2] = LUT[v * 3 + 2]; d[o + 3] = 255; }
  }
  oc.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(off, x0, y0, pw, ph);
}
function pill(ctx, text, x, y, color, align = "right") {
  ctx.font = "600 11px Inter"; const w = ctx.measureText(text).width + 14, h = 19;
  const bx = align === "right" ? x - w : x;
  ctx.fillStyle = "rgba(6,10,18,.82)"; roundRect(ctx, bx, y - h / 2, w, h, 6); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 1; roundRect(ctx, bx + .5, y - h / 2 + .5, w - 1, h - 1, 6); ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, bx + 7, y + .5);
  ctx.textBaseline = "alphabetic";
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/* theme-aware plot chrome */
const AX = () => cssVar("--axis") || "rgba(169,180,200,.75)", GRID = () => cssVar("--grid") || "rgba(255,255,255,.055)", PLOT = () => cssVar("--plot") || "#04060c";
const TXT = () => cssVar("--text") || "#e8edf6", TXT3 = () => cssVar("--text-3") || "#718099";

/* ============================================================ analyze */
async function analyzeBlob(blob, name, cached, meta = {}) {
  $("#aErr").textContent = "";
  state.blob = blob; state.name = name; state.id = meta.id || null; state.tags = meta.tags || []; state.note = meta.note || ""; state.saved = !!meta.id;
  const dz = $("#dz"); dz.classList.add("busy");
  try {
    const d = cached || await scanBlob(blob, name);
    state.data = d; state.grid = decodeGrid(d.spectrogram);
    $("#a-empty").classList.add("hidden"); $("#a-main").classList.remove("hidden");
    $("#gateOut").innerHTML = "";
    go("analyze");
    fillAnalyze(d);
    if (!state.id && prefs.autosave && meta.source !== "demo") {
      const rec = recordFrom(d, blob, name, { source: meta.source || "upload" });
      if (await saveCapture(rec)) { state.id = rec.id; state.saved = true; }
    }
    renderSavedMark();
  } catch (e) { $("#aErr").textContent = "Could not analyse this file: " + e.message; toast(e.message, "bad"); }
  dz.classList.remove("busy");
}
function renderSavedMark() {
  const el = $("#mSaved");
  el.innerHTML = state.saved ? `<b style="color:var(--ok)">saved</b> to history` : `<a href="#" id="saveNow">save to history</a>`;
  const s = $("#saveNow"); if (s) s.onclick = async e => { e.preventDefault(); const rec = recordFrom(state.data, state.blob, state.name, { tags: state.tags, note: state.note }); if (await saveCapture(rec)) { state.id = rec.id; state.saved = true; renderSavedMark(); toast("Saved to history", "ok"); } };
}
function ev(d, name) { const f = d.findings.find(x => x.name === name); return f ? { ...f, e: f.evidence || {} } : null; }
function fillAnalyze(d) {
  const v = VERDICT[d.verdict], oob = ev(d, "out_of_band_energy"), car = ev(d, "carrier_peak");
  $("#fName").textContent = d.filename || state.name;
  $("#mRate").textContent = (d.sample_rate / 1000).toFixed(1) + " kHz";
  $("#mNyq").textContent = (d.sample_rate / 2000).toFixed(1) + " kHz";
  $("#mDur").textContent = d.duration_sec.toFixed(2) + " s";
  $("#mWin").textContent = d.windows.length || 1;
  $("#vTag").className = "tag t-" + d.verdict; $("#vTagT").textContent = v.label;
  const txt = narrative(d, oob, car);
  $("#vTitle").textContent = txt.title; $("#vReason").textContent = txt.reason;
  $("#vActionT").textContent = txt.action; $("#vAction").style.borderColor = v.hex + "66";
  $("#vRisk").textContent = d.overall_risk.toFixed(2); $("#vRisk").style.color = v.hex;
  const arc = $("#ringArc"); arc.setAttribute("stroke", v.hex); arc.style.filter = `drop-shadow(0 0 6px ${v.hex}88)`;
  requestAnimationFrame(() => arc.setAttribute("stroke-dasharray", `${(75 * d.overall_risk).toFixed(1)} 100`));
  $("#vStats").innerHTML = heroStats(d, oob, car).map(s =>
    `<div class="stat"><div class="k">${s.k}</div><div class="v">${s.v}<small>${s.u || ""}</small></div><div class="h">${s.h || ""}</div></div>`).join("");
  $("#specSub").textContent = `${d.spectrogram.vmin_db.toFixed(0)} to ${d.spectrogram.vmax_db.toFixed(0)} dB · ${d.analysis_ms} ms`;
  $("#breakdown").innerHTML = breakdown(d, oob, car);
  $("#gatePolicyName").textContent = "policy: " + (prefs.policy ? prefs.policyName : "Default");
  renderTags(); $("#noteIn").value = state.note;
  drawAnalyze();
}
function narrative(d, oob, car) {
  const t = d.thresholds, a = d.annotations, r = a.oob_ratio, fc = a.carrier_peak_hz, sb = a.carrier_sideband_db;
  const pct = r == null ? null : (r * 100).toFixed(r < .01 ? 2 : 1);
  switch (d.verdict) {
    case "INSUFFICIENT_DATA": return {
      title: "Cannot assess at this sample rate",
      reason: `This capture is ${(d.sample_rate / 1000).toFixed(1)} kHz, so nothing above ${(d.sample_rate / 2000).toFixed(1)} kHz was recorded. Injection carriers live above ${(t.oob_edge_hz / 1000).toFixed(0)} kHz — the screen could not look, which is not the same as clean.`,
      action: "Recapture at 44.1 kHz or higher. Until then, treat sensitive actions from this audio as unverified." };
    case "HIGH_RISK": return {
      title: "Ultrasonic injection signature",
      reason: `${pct}% of the energy sits above ${(t.oob_edge_hz / 1000).toFixed(0)} kHz, carried by a narrowband tone at ${(fc / 1000).toFixed(1)} kHz with speech-band modulation sidebands (${sb.toFixed(0)} dB). That is the structure of an amplitude-modulated command carrier.`,
      action: "Block sensitive and critical actions triggered by this capture." };
    case "SUSPICIOUS": return {
      title: "Possible injection signature",
      reason: `${pct ?? "Some"}% of the energy is above ${(t.oob_edge_hz / 1000).toFixed(0)} kHz${fc ? ` with a carrier-like peak at ${(fc / 1000).toFixed(1)} kHz` : ""}, but not enough to be conclusive.`,
      action: "Require explicit confirmation before sensitive actions." };
    default: {
      const bare = fc && sb != null && sb < t.sideband_full_db && car && car.e.prominence_db != null && car.e.prominence_db >= 20;
      let reason;
      if (bare) reason = `A steady tone at ${(fc / 1000).toFixed(1)} kHz carries ${pct}% of the energy, but it has ${sb <= t.sideband_floor_db ? "no" : "almost no"} modulation sidebands (${sb.toFixed(0)} dB) — the signature of a beacon or power-supply whine, not a command carrier.`;
      else if (a.oob_level_dbfs != null && a.oob_level_dbfs < t.oob_min_level_dbfs) reason = `Energy above ${(t.oob_edge_hz / 1000).toFixed(0)} kHz is at ${a.oob_level_dbfs.toFixed(0)} dBFS — below the ${t.oob_min_level_dbfs} dBFS floor, too little to be a carrier.`;
      else if (r != null && r * 100 >= 1.09) reason = `${pct}% of the energy is above ${(t.oob_edge_hz / 1000).toFixed(0)} kHz, but no modulated carrier was found. Broadband or tonal high-frequency content on its own is not an injection.`;
      else reason = `Only ${pct}% of the energy is above ${(t.oob_edge_hz / 1000).toFixed(0)} kHz and no modulated carrier was found.`;
      return { title: "No injection signature", reason, action: "Normal handling. Critical actions still ask for confirmation by policy." };
    }
  }
}
function heroStats(d, oob, car) {
  const a = d.annotations, t = d.thresholds;
  if (d.verdict === "INSUFFICIENT_DATA") return [
    { k: "Nyquist limit", v: (d.sample_rate / 2000).toFixed(1), u: "kHz", h: `needs > ${(t.oob_edge_hz / 1000).toFixed(0)} kHz` },
    { k: "Sample rate", v: (d.sample_rate / 1000).toFixed(1), u: "kHz", h: "recapture ≥ 44.1 kHz" },
    { k: "Duration", v: d.duration_sec.toFixed(2), u: "s", h: `${d.windows.length || 1} windows checked` }];
  const sb = a.carrier_sideband_db, isCarrier = carrierFound(d);
  return [
    { k: "Energy above 18 kHz", v: a.oob_ratio == null ? "—" : (a.oob_ratio * 100).toFixed(a.oob_ratio < .01 ? 2 : 1), u: "%", h: a.oob_level_dbfs == null ? "" : `${a.oob_level_dbfs.toFixed(0)} dBFS band level` },
    isCarrier ? { k: "Carrier", v: (a.carrier_peak_hz / 1000).toFixed(2), u: "kHz", h: `${a.carrier_prominence_db.toFixed(0)} dB above floor` }
      : { k: "Carrier", v: "none", u: "", h: a.carrier_peak_hz && sb != null && sb < t.sideband_full_db && car && car.e.prominence_db >= 20 ? `unmodulated tone at ${(a.carrier_peak_hz / 1000).toFixed(1)} kHz` : "no modulated carrier" },
    { k: "Modulation sidebands", v: sb == null ? "—" : sb.toFixed(0), u: sb == null ? "" : "dB", h: sb == null ? "" : sb >= t.sideband_full_db ? "modulated — command-like" : sb <= t.sideband_floor_db ? "bare tone — beacon-like" : "weakly modulated" }];
}
function carrierFound(d) { const c = ev(d, "carrier_peak"); return !!(c && c.assessable && d.annotations.carrier_peak_hz && c.risk >= d.thresholds.suspicious_risk); }

function meter({ label, value, display, min, max, log, ticks = [], zones = [], color = "var(--accent)" }) {
  const pos = x => { if (x == null || !isFinite(x)) return 0;
    const p = log ? (Math.log10(Math.max(x, min)) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) : (x - min) / (max - min);
    return Math.max(0, Math.min(1, p)) * 100; };
  const z = zones.map(([a, b, c]) => `<div class="zone" style="left:${pos(a)}%;width:${pos(b) - pos(a)}%;background:${c}"></div>`).join("");
  const tk = ticks.map(([x, l]) => `<div class="tick" style="left:${pos(x)}%"><em>${l}</em></div>`).join("");
  const has = value != null && isFinite(value);
  return `<div class="meter"><div class="lab"><span>${label}</span><b>${has ? display : "—"}</b></div>
    <div class="track">${z}${has ? `<div class="fill" style="width:${pos(value)}%;background:${color}"></div><div class="knob" style="left:${pos(value)}%"></div>` : ""}${tk}</div></div>`;
}
function breakdown(d, oob, car) {
  const t = d.thresholds, a = d.annotations, spec = ev(d, "spectral_profile");
  const rA = oob ? oob.risk : 0, rB = car ? car.risk : 0, ok = oob && oob.assessable;
  const sev = f => f && f.assessable ? `<span class="tag sm t-${f.risk >= t.high_risk ? "HIGH_RISK" : f.risk >= t.suspicious_risk ? "SUSPICIOUS" : "CLEAR"}">${f.severity}</span>` : `<span class="tag sm t-INSUFFICIENT_DATA">not assessable</span>`;
  let h = `<div class="det"><div class="det-h"><h4>Out-of-band energy</h4>${sev(oob)}<span class="rho">ρ<sub>A</sub> <b>${rA.toFixed(2)}</b></span></div><p>${oob ? oob.detail : ""}</p>`;
  if (ok) {
    h += meter({ label: "Share of energy above 18 kHz", value: a.oob_ratio * 100, display: (a.oob_ratio * 100).toFixed(2) + "%", min: .01, max: 100, log: true,
      zones: [[1.09, 4.36, "rgba(251,191,36,.18)"], [4.36, 100, "rgba(248,113,113,.16)"]], ticks: [[1.09, "1.1%"], [4.36, "4.4%"], [t.oob_saturation_ratio * 100, "10%"]] });
    h += meter({ label: "Band level (must clear the floor)", value: a.oob_level_dbfs, display: a.oob_level_dbfs.toFixed(0) + " dBFS", min: -120, max: 0,
      zones: [[-120, t.oob_min_level_dbfs, "rgba(139,154,179,.14)"]], ticks: [[t.oob_min_level_dbfs, t.oob_min_level_dbfs + " dBFS floor"]] });
  }
  h += `</div><div class="det"><div class="det-h"><h4>Modulated carrier</h4>${sev(car)}<span class="rho">ρ<sub>B</sub> <b>${rB.toFixed(2)}</b></span></div><p>${car ? car.detail : ""}</p>`;
  if (car && car.e.prominence_db != null) {
    const ex = car.e.prominence_db - car.e.noise_threshold_db;
    h += meter({ label: "Peak above CFAR noise floor", value: ex, display: ex.toFixed(0) + " dB", min: 0, max: 40, ticks: [[t.carrier_prominence_saturation_db, "saturates"]] });
    h += meter({ label: "Peak narrowness", value: car.e.narrowness, display: car.e.narrowness.toFixed(2), min: 0, max: 1,
      zones: [[t.narrow_floor, t.narrow_full, "rgba(76,195,255,.14)"], [t.narrow_full, 1, "rgba(76,195,255,.26)"]], ticks: [[t.narrow_floor, "broad"], [t.narrow_full, "narrow"]] });
    h += meter({ label: "Modulation sidebands", value: car.e.sideband_db, display: car.e.sideband_db.toFixed(0) + " dB", min: -120, max: 0,
      zones: [[-120, t.sideband_floor_db, "rgba(139,154,179,.14)"], [t.sideband_full_db, 0, "rgba(248,113,113,.14)"]], ticks: [[t.sideband_floor_db, "bare tone"], [t.sideband_full_db, "modulated"]] });
  }
  h += `</div>`;
  if (spec) h += `<div class="det"><div class="det-h"><h4>Spectral profile</h4><span class="tag sm t-INSUFFICIENT_DATA">context only</span></div><p>${spec.detail} Not part of the score — on its own it fires on bright music.</p></div>`;
  const V = VERDICT[d.verdict];
  h += `<div class="formula">R = √(ρ<sub>A</sub> × ρ<sub>B</sub>) = √(${rA.toFixed(2)} × ${rB.toFixed(2)}) = <b style="color:${V.hex}">${d.overall_risk.toFixed(2)}</b>
    <div class="faint" style="font-size:12px;margin-top:4px">Both signatures must be present. ≥ ${t.suspicious_risk} suspicious · ≥ ${t.high_risk} high risk.</div></div>`;
  return h;
}

/* ---- canvases ---- */
function drawAnalyze() { const d = state.data; if (!d) return; drawSpectrogram(d); drawOverview(d); drawPSD(d); drawTimeline(d); drawDecisionMap(d); }
function drawSpectrogram(d) {
  const c = $("#spec"), { ctx, W, H } = fit(c), sp = d.spectrogram, [F, T] = sp.shape, fmax = sp.fmax_hz, sc = state.scale;
  const L = 50, R = 64, Tm = 8, B = 26, x0 = L, y0 = Tm, pw = W - L - R, ph = H - Tm - B, ax = AX(), gr = GRID();
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = PLOT(); ctx.fillRect(x0, y0, pw, ph);
  paintGrid(ctx, state.grid, F, T, x0, y0, pw, ph, fmax, sc);
  const yOf = f => y0 + fracOf(f, fmax, sc) * ph, a = d.annotations, edge = d.thresholds.oob_edge_hz;
  if (edge < fmax) { ctx.fillStyle = "rgba(248,113,113,.07)"; ctx.fillRect(x0, y0, pw, yOf(edge) - y0); }
  ctx.font = "11px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  freqTicks(fmax, sc).forEach(f => { const y = yOf(f); if (y < y0 - 1 || y > y0 + ph + 1) return;
    ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + pw, y); ctx.stroke(); ctx.fillStyle = ax; ctx.fillText(kHz(f), x0 - 8, y); });
  ctx.save(); ctx.translate(12, y0 + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillStyle = TXT3(); ctx.fillText("frequency (Hz)", 0, 0); ctx.restore();
  const dur = sp.dur_s || d.duration_sec, st = niceStep(dur, 6);
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let t = 0; t <= dur + 1e-9; t += st) { const x = x0 + (t / dur) * pw; ctx.strokeStyle = gr; ctx.beginPath(); ctx.moveTo(x, y0 + ph); ctx.lineTo(x, y0 + ph + 4); ctx.stroke(); ctx.fillStyle = ax; ctx.fillText(t.toFixed(st < 1 ? 1 : 0) + " s", x, y0 + ph + 8); }
  let edgeY = null;
  if (edge < fmax) { edgeY = yOf(edge); ctx.strokeStyle = "#f87171"; ctx.lineWidth = 1.4; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(x0, edgeY); ctx.lineTo(x0 + pw, edgeY); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
  if (carrierFound(d) && a.carrier_peak_hz < fmax) {
    const y = yOf(a.carrier_peak_hz); ctx.strokeStyle = "rgba(251,191,36,.9)"; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + pw, y); ctx.stroke();
    let py = y; if (edgeY != null && Math.abs(py - edgeY) < 24) py = edgeY - 24;
    pill(ctx, `carrier ${(a.carrier_peak_hz / 1000).toFixed(2)} kHz`, x0 + pw - 8, Math.max(y0 + 12, py - 14), "#fbbf24");
  }
  if (edgeY != null) pill(ctx, "18 kHz edge", x0 + pw - 8, Math.min(y0 + ph - 12, edgeY + 14), "#f87171");
  const cbx = W - R + 16, cbw = 11, g = ctx.createLinearGradient(0, y0 + ph, 0, y0);
  for (let i = 0; i <= 10; i++) { const v = Math.round(i * 25.5); g.addColorStop(i / 10, `rgb(${LUT[v * 3]},${LUT[v * 3 + 1]},${LUT[v * 3 + 2]})`); }
  ctx.fillStyle = g; roundRect(ctx, cbx, y0, cbw, ph, 4); ctx.fill();
  ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = ax; ctx.font = "10.5px Inter";
  [[0, sp.vmax_db], [.5, (sp.vmax_db + sp.vmin_db) / 2], [1, sp.vmin_db]].forEach(([fr, db]) => ctx.fillText(db.toFixed(0), cbx + cbw + 6, y0 + fr * ph));
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("dB", cbx + cbw / 2 + 6, y0 + ph + 8);
  state.geom = { x0, y0, pw, ph, F, T, fmax, sc, dur };
  hoverLayer();
}
function hoverLayer() {
  const wrap = $(".spec-wrap"); let ov = $("#specx");
  if (!ov) { ov = document.createElement("canvas"); ov.id = "specx"; ov.className = "cv"; ov.style.pointerEvents = "none"; wrap.appendChild(ov); }
  const { ctx, W, H } = fit(ov); ctx.clearRect(0, 0, W, H);
}
$("#spec").addEventListener("mousemove", e => {
  const g = state.geom, d = state.data; if (!g || !d) return;
  const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const ov = $("#specx"); if (!ov) return; const { ctx, W, H } = fit(ov); ctx.clearRect(0, 0, W, H);
  if (x < g.x0 || x > g.x0 + g.pw || y < g.y0 || y > g.y0 + g.ph) { $("#readout").textContent = "hover for time · frequency · level"; return; }
  const col = Math.min(g.T - 1, Math.floor((x - g.x0) / g.pw * g.T)), f = freqAt((y - g.y0) / g.ph, g.fmax, g.sc);
  const row = Math.min(g.F - 1, Math.max(0, Math.round((1 - f / g.fmax) * (g.F - 1))));
  const sp = d.spectrogram, db = sp.vmin_db + state.grid[row * g.T + col] / 255 * (sp.vmax_db - sp.vmin_db);
  $("#readout").textContent = `${((col + .5) / g.T * g.dur).toFixed(2)} s   ${f >= 1000 ? (f / 1000).toFixed(2) + " kHz" : f.toFixed(0) + " Hz"}   ${db.toFixed(0)} dB`;
  ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(g.x0, y); ctx.lineTo(g.x0 + g.pw, y); ctx.moveTo(x, g.y0); ctx.lineTo(x, g.y0 + g.ph); ctx.stroke();
});
$("#spec").addEventListener("mouseleave", () => { const ov = $("#specx"); if (ov) fit(ov).ctx.clearRect(0, 0, 9999, 9999); $("#readout").textContent = "hover for time · frequency · level"; });
$$("#scaleSeg button").forEach(b => b.onclick = () => { $$("#scaleSeg button").forEach(x => x.classList.toggle("on", x === b)); state.scale = b.dataset.s; if (state.data) drawSpectrogram(state.data); });
function worstWindow(w) { let worst = w[0]; w.forEach(x => { if (RANK[x.verdict] > RANK[worst.verdict] || (x.verdict === worst.verdict && x.overall_risk > worst.overall_risk)) worst = x; }); return worst; }
function drawOverview(d) {
  const { ctx, W, H } = fit($("#ov")), env = d.waveform, L = 50, R = 64, pw = W - L - R, mid = H / 2, n = env.length, col = VERDICT[d.verdict].hex;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = cssVar("--sunk"); roundRect(ctx, L, 0, pw, H, 8); ctx.fill();
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, col + "cc"); g.addColorStop(.5, col + "55"); g.addColorStop(1, col + "cc");
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(L, mid);
  for (let i = 0; i < n; i++) ctx.lineTo(L + i / (n - 1) * pw, mid - env[i] * (H * .44));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(L + i / (n - 1) * pw, mid + env[i] * (H * .44));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = TXT3(); ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText("level", L - 8, mid);
  const w = d.windows; if (w && w.length > 1) { const worst = worstWindow(w), dur = d.duration_sec, x = L + worst.start_sec / dur * pw, ww = Math.min(1, dur) / dur * pw;
    ctx.strokeStyle = VERDICT[worst.verdict].hex; ctx.lineWidth = 1.5; roundRect(ctx, x + .75, 1, ww - 1.5, H - 2, 6); ctx.stroke(); ctx.lineWidth = 1; }
}
function drawPSD(d) {
  const { ctx, W, H } = fit($("#psd")), L = 40, R = 10, T = 8, B = 24, ps = d.psd, fs = ps.freqs_hz, db = ps.psd_db, fmax = fs[fs.length - 1], ax = AX(), gr = GRID();
  ctx.clearRect(0, 0, W, H); if (!fs.length) return;
  let lo = Math.min(...db), hi = Math.max(...db); lo = Math.floor(lo / 10) * 10; hi = Math.ceil(hi / 10) * 10;
  const X = f => L + f / fmax * (W - L - R), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B), edge = d.thresholds.oob_edge_hz;
  ctx.font = "10.5px Inter"; ctx.fillStyle = ax;
  const ys = niceStep(hi - lo, 4); ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let v = lo; v <= hi; v += ys) { ctx.strokeStyle = gr; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke(); ctx.fillText(v, L - 6, Y(v)); }
  ctx.textAlign = "center"; ctx.textBaseline = "top"; freqTicks(fmax, "lin").forEach(f => ctx.fillText(kHz(f), X(f), H - B + 7));
  if (edge < fmax) { ctx.fillStyle = "rgba(248,113,113,.07)"; ctx.fillRect(X(edge), T, X(fmax) - X(edge), H - T - B); }
  const g = ctx.createLinearGradient(0, T, 0, H - B); g.addColorStop(0, "rgba(76,195,255,.30)"); g.addColorStop(1, "rgba(76,195,255,0)");
  ctx.beginPath(); fs.forEach((f, i) => i ? ctx.lineTo(X(f), Y(db[i])) : ctx.moveTo(X(f), Y(db[i])));
  ctx.strokeStyle = cssVar("--accent"); ctx.lineWidth = 1.4; ctx.stroke();
  ctx.lineTo(X(fmax), H - B); ctx.lineTo(X(0), H - B); ctx.closePath(); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1;
  if (edge < fmax) { ctx.strokeStyle = "#f87171"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(edge), T); ctx.lineTo(X(edge), H - B); ctx.stroke(); ctx.setLineDash([]); }
  const fc = carrierFound(d) ? d.annotations.carrier_peak_hz : null;
  if (fc) { let i = 0; while (i < fs.length - 1 && fs[i] < fc) i++; ctx.fillStyle = "#fbbf24"; ctx.beginPath(); ctx.arc(X(fc), Y(db[i]), 4, 0, 7); ctx.fill(); }
}
function drawTimeline(d) {
  const { ctx, W, H } = fit($("#tl")), L = 30, R = 8, T = 8, B = 22, t = d.thresholds, ax = AX(), gr = GRID();
  ctx.clearRect(0, 0, W, H);
  const w = d.windows.length ? d.windows : [{ start_sec: 0, verdict: d.verdict, overall_risk: d.overall_risk }];
  const dur = Math.max(d.duration_sec, 1e-3), Y = v => T + (1 - v) * (H - T - B), X = s => L + s / dur * (W - L - R);
  ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  [[0, "0"], [t.suspicious_risk, ".33"], [t.high_risk, ".66"], [1, "1"]].forEach(([v, l]) => { ctx.strokeStyle = v === 0 || v === 1 ? gr : ax; ctx.setLineDash(v === 0 || v === 1 ? [] : [3, 4]); ctx.globalAlpha = v === 0 || v === 1 ? 1 : .35;
    ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = ax; ctx.fillText(l, L - 6, Y(v)); });
  ctx.setLineDash([]);
  const win = Math.min(1, dur), bw = Math.max(4, X(Math.min(.5, dur)) - X(0) - 3), worst = worstWindow(w);
  w.forEach(x => { const h = x.verdict === "INSUFFICIENT_DATA" ? .1 : Math.max(.03, x.overall_risk), cx = X(x.start_sec + win / 2);
    ctx.fillStyle = VERDICT[x.verdict].hex; ctx.globalAlpha = x === worst ? 1 : .55; roundRect(ctx, cx - bw / 2, Y(h), bw, Y(0) - Y(h), 3); ctx.fill(); ctx.globalAlpha = 1; });
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = ax;
  const st = niceStep(dur, 5); for (let s = 0; s <= dur + 1e-9; s += st) ctx.fillText(s.toFixed(st < 1 ? 1 : 0) + " s", X(s), H - B + 7);
  $("#tlNote").textContent = `${w.length} window${w.length > 1 ? "s" : ""} of ${prefs.window} s · worst at ${worst.start_sec.toFixed(1)} s (${VERDICT[worst.verdict].label.toLowerCase()}, risk ${worst.overall_risk.toFixed(2)})`;
}
function drawDecisionMap(d) {
  const c = $("#dmap"), { ctx, W, H } = fit(c), L = 40, R = 12, T = 10, B = 34, pw = W - L - R, ph = H - T - B, t = d.thresholds, ax = AX();
  ctx.clearRect(0, 0, W, H);
  const img = ctx.createImageData(Math.round(pw), Math.round(ph)), dd = img.data, iw = img.width, ih = img.height;
  for (let j = 0; j < ih; j++) for (let i = 0; i < iw; i++) {
    const R_ = Math.sqrt((i / iw) * (1 - j / ih)), o = (j * iw + i) * 4;
    const [r, g, b, a] = R_ >= t.high_risk ? [248, 113, 113, 46] : R_ >= t.suspicious_risk ? [251, 191, 36, 34] : [52, 211, 153, 16];
    dd[o] = r; dd[o + 1] = g; dd[o + 2] = b; dd[o + 3] = a;
  }
  const off = document.createElement("canvas"); off.width = iw; off.height = ih; off.getContext("2d").putImageData(img, 0, 0);
  ctx.drawImage(off, L, T, pw, ph);
  const X = v => L + v * pw, Y = v => T + (1 - v) * ph;
  [[t.suspicious_risk, "#fbbf24"], [t.high_risk, "#f87171"]].forEach(([Rv, col]) => {
    ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.beginPath(); let first = true;
    for (let k = 0; k <= 200; k++) { const x = Rv * Rv + (1 - Rv * Rv) * k / 200, y = Rv * Rv / x; if (first) { ctx.moveTo(X(x), Y(y)); first = false; } else ctx.lineTo(X(x), Y(y)); }
    ctx.stroke(); ctx.fillStyle = col; ctx.font = "600 10.5px Inter"; ctx.textAlign = "left"; ctx.fillText("R=" + Rv, X(1) - 34, Y(Rv * Rv) - 6); });
  ctx.lineWidth = 1; ctx.strokeStyle = GRID(); ctx.strokeRect(L + .5, T + .5, pw - 1, ph - 1);
  ctx.fillStyle = ax; ctx.font = "10.5px Inter"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  [0, .5, 1].forEach(v => ctx.fillText(v, X(v), T + ph + 6)); ctx.fillText("ρA  out-of-band energy", L + pw / 2, T + ph + 19);
  ctx.textAlign = "right"; ctx.textBaseline = "middle"; [0, .5, 1].forEach(v => ctx.fillText(v, L - 6, Y(v)));
  ctx.save(); ctx.translate(11, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("ρB  carrier", 0, 0); ctx.restore();
  const oob = ev(d, "out_of_band_energy"), car = ev(d, "carrier_peak");
  if (!oob || !oob.assessable) { ctx.fillStyle = effectiveTheme() === "dark" ? "rgba(6,10,18,.7)" : "rgba(243,245,249,.75)"; ctx.fillRect(L, T, pw, ph); ctx.fillStyle = TXT(); ctx.font = "12.5px Inter";
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Not assessable at this sample rate", L + pw / 2, T + ph / 2); return; }
  const px = X(oob.risk), py = Y(car ? car.risk : 0), col = VERDICT[d.verdict].hex;
  const rg = ctx.createRadialGradient(px, py, 0, px, py, 22); rg.addColorStop(0, col + "aa"); rg.addColorStop(1, col + "00");
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(px, py, 22, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
}

/* ---- gate (sends the active policy) ---- */
$$(".gopt").forEach(o => o.onclick = () => $$(".gopt").forEach(x => x.classList.toggle("on", x === o)));
async function gateCall(blob, name, action, policy) {
  const fd = new FormData(); fd.append("file", blob, name || "clip.wav"); fd.append("action", action); fd.append("window", prefs.window); fd.append("hop", prefs.hop);
  if (policy) fd.append("policy", JSON.stringify(policy));
  const r = await fetch("/api/gate", { method: "POST", body: fd }); const d = await r.json();
  if (!r.ok) throw new Error(d.detail || r.statusText); return d;
}
$("#gateBtn").onclick = async () => {
  if (!state.blob) return; $("#gateBtn").disabled = true;
  try { const d = await gateCall(state.blob, state.name, $(".gopt.on").dataset.a, prefs.policy);
    $("#gateOut").innerHTML = `<div class="gres"><span class="big g-${d.decision}">${d.decision.toUpperCase()}</span><div><p>${esc(d.reason)}</p><p class="faint" style="margin-top:4px;font-size:11.5px">${d.policy_source} policy${prefs.policy ? " · " + esc(prefs.policyName) : ""}</p></div></div>`; }
  catch (e) { $("#gateOut").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  $("#gateBtn").disabled = false;
};

/* ---- notes & tags (persisted with the capture) ---- */
function renderTags() {
  $("#tagsIn").innerHTML = state.tags.map((t, i) => `<span class="chip">${icon("tag")}${esc(t)}<span class="x" data-i="${i}">${icon("x")}</span></span>`).join("") + `<input id="tagNew" placeholder="+ tag">`;
  $$("#tagsIn .x").forEach(x => x.onclick = () => { state.tags.splice(+x.dataset.i, 1); renderTags(); persistNotes(); });
  const inp = $("#tagNew"); inp.onkeydown = e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); const v = inp.value.trim().replace(/,$/, ""); if (v && !state.tags.includes(v)) state.tags.push(v); renderTags(); persistNotes(); $("#tagNew").focus(); } };
}
let noteT; $("#noteIn").oninput = () => { state.note = $("#noteIn").value; clearTimeout(noteT); noteT = setTimeout(persistNotes, 500); };
async function persistNotes() {
  if (!state.id) return; const rec = history.find(r => r.id === state.id); if (!rec) return;
  rec.tags = [...state.tags]; rec.note = state.note; try { await store.put(rec); } catch { /* ignore */ }
}

/* ---- export ---- */
function download(name, blob) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
menu($("#exportBtn"), $("#exportMenu"), () => [
  { k: "json", i: "json", l: "Scan result (JSON)", f: () => { const { spectrogram, psd, waveform, ...d } = state.data; download(state.name.replace(/\.wav$/i, "") + ".echoguard.json", new Blob([JSON.stringify({ ...d, tags: state.tags, note: state.note }, null, 2)], { type: "application/json" })); } },
  { k: "report", i: "doc", l: "Report (HTML)", f: exportReport },
  { k: "png", i: "download", l: "Spectrogram (PNG)", f: () => $("#spec").toBlob(b => download(state.name.replace(/\.wav$/i, "") + "_spectrogram.png", b)) },
  { k: "wav", i: "file", l: "Audio (WAV)", f: () => download(state.name, state.blob) },
]);
function exportReport() {
  const d = state.data, v = VERDICT[d.verdict], txt = narrative(d, ev(d, "out_of_band_energy"), ev(d, "carrier_peak")), png = $("#spec").toDataURL("image/png");
  const rows = heroStats(d).map(s => `<tr><td>${s.k}</td><td><b>${s.v} ${s.u || ""}</b> <span style="color:#666">${s.h || ""}</span></td></tr>`).join("");
  const det = d.findings.map(f => `<tr><td>${f.name}</td><td>${f.assessable ? f.severity : "not assessable"}</td><td>${f.risk.toFixed(2)}</td><td>${esc(f.detail)}</td></tr>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><title>EchoGuard report — ${esc(state.name)}</title>
<style>body{font:14px/1.5 Inter,system-ui,sans-serif;color:#111;max-width:860px;margin:40px auto;padding:0 20px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:26px 0 8px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top}.tag{display:inline-block;padding:3px 9px;border-radius:6px;color:#fff;font-weight:600;background:${v.hex}}.k{color:#666;font-size:12px}img{width:100%;border-radius:8px;margin-top:8px}</style>
<div class="k">EchoGuard ${esc(engine.info?.version || "")} · ${new Date().toLocaleString()}</div><h1>${esc(state.name)}</h1>
<p><span class="tag">${v.label}</span> &nbsp; risk <b>${d.overall_risk.toFixed(2)}</b> · ${(d.sample_rate / 1000).toFixed(1)} kHz · ${d.duration_sec.toFixed(2)} s · ${d.windows.length || 1} windows</p>
<h2>${esc(txt.title)}</h2><p>${esc(txt.reason)}</p><p><b>Recommended:</b> ${esc(txt.action)}</p>
<h2>Measurements</h2><table>${rows}</table><h2>Detectors</h2><table><tr><th>Detector</th><th>Severity</th><th>ρ</th><th>Detail</th></tr>${det}</table>
<p class="k">R = √(ρA × ρB) = ${d.overall_risk.toFixed(2)} · suspicious ≥ ${d.thresholds.suspicious_risk} · high risk ≥ ${d.thresholds.high_risk}</p>
<h2>Spectrogram</h2><img src="${png}">${state.tags.length ? `<h2>Tags</h2><p>${state.tags.map(esc).join(", ")}</p>` : ""}${state.note ? `<h2>Note</h2><p>${esc(state.note)}</p>` : ""}
<p class="k">${esc(d.capture_note)}</p>`;
  download(state.name.replace(/\.wav$/i, "") + "_report.html", new Blob([html], { type: "text/html" }));
  toast("Report exported", "ok");
}

/* ============================================================ demo audio (synthetic, no command content) */
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2147483648 - 1; }; }
function speech(sr, secs, seed) {
  const n = Math.round(sr * secs), out = new Float32Array(n), rnd = rng(seed);
  const VOW = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480], [570, 840, 2410], [660, 1720, 2410], [440, 1020, 2240]];
  const BW = [80, 100, 140], GAIN = [1, .55, .3], segs = [];
  let t = .1;
  while (t < secs - .18) {
    const voiced = rnd() > -.5, d = voiced ? .14 + .14 * Math.abs(rnd()) : .06 + .06 * Math.abs(rnd());
    const v = VOW[Math.floor(Math.abs(rnd()) * VOW.length) % VOW.length];
    const co = v.map((f, k) => { const w = 2 * Math.PI * Math.min(f, sr * .45) / sr, al = Math.sin(w) / (2 * (f / BW[k]));
      return { b0: al / (1 + al), b2: -al / (1 + al), a1: -2 * Math.cos(w) / (1 + al), a2: (1 - al) / (1 + al), x1: 0, x2: 0, y1: 0, y2: 0 }; });
    segs.push({ t0: t, t1: t + d, voiced, co }); t += d + .03 + .07 * Math.abs(rnd());
  }
  // 4-pole low-pass at 4.5 kHz so the synthetic voice rolls off like real speech instead of flooding the ultrasonic band
  const aLP = Math.exp(-2 * Math.PI * 4500 / sr), lps = [0, 0, 0, 0];
  let ph = 0, prev = 0, lp = 0, si = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / sr; while (si < segs.length && tt > segs[si].t1) si++;
    const g = si < segs.length && tt >= segs[si].t0 ? segs[si] : null;
    let y = 0;
    if (g) {
      const u = (tt - g.t0) / (g.t1 - g.t0), env = Math.pow(Math.sin(Math.PI * u), .55);
      if (g.voiced) {
        const f0 = 112 + 26 * Math.sin(2 * Math.PI * 1.1 * tt) + 5 * Math.sin(2 * Math.PI * 4.7 * tt);
        ph += f0 / sr; let x = 0; if (ph >= 1) { ph -= 1; x = 4; }
        x += .02 * rnd();
        for (let k = 0; k < 3; k++) { const c = g.co[k]; const yk = c.b0 * x + c.b2 * c.x2 - c.a1 * c.y1 - c.a2 * c.y2; c.x2 = c.x1; c.x1 = x; c.y2 = c.y1; c.y1 = yk; y += GAIN[k] * yk; }
        y *= env;
      } else { const w = rnd(); y = (.7 * w + .3 * prev) * .22 * env; prev = w; }
    }
    for (let k = 0; k < 4; k++) { lps[k] += (1 - aLP) * (y - lps[k]); y = lps[k]; }
    lp = .985 * lp + .015 * rnd();
    out[i] = y + .012 * lp + .0002 * rnd();
  }
  return norm(out, .8);
}
function norm(x, peak) { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); const k = peak / (m || 1); for (let i = 0; i < x.length; i++) x[i] *= k; return x; }
function demoAudio(kind, secs = 2.4, seed = 7) {
  const sr = kind === "phone" ? 16000 : 48000;
  const room = speech(sr, secs, seed + 11);
  if (kind === "benign") return { sr, x: room };
  const n = room.length, x = new Float32Array(n);
  if (kind === "beacon") { for (let i = 0; i < n; i++) x[i] = .7 * room[i] + .16 * Math.sin(2 * Math.PI * 19000 * i / sr) * (1 + .003 * Math.sin(2 * Math.PI * .4 * i / sr)); return { sr, x: norm(x, .9) }; }
  const cmd = speech(sr, secs, seed + 101);                        // injected envelope — no words
  if (kind === "phone") { for (let i = 0; i < n; i++) x[i] = .7 * room[i] + .22 * cmd[i]; return { sr, x: norm(x, .9) }; }
  for (let i = 0; i < n; i++) x[i] = .55 * room[i] + .38 * (1 + .85 * cmd[i]) * Math.sin(2 * Math.PI * 20000 * i / sr) + .05 * cmd[i];
  return { sr, x: norm(x, .9) };
}
function encodeWAV(sm, rate) {
  const n = sm.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); wr(8, "WAVE"); wr(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  wr(36, "data"); v.setUint32(40, n * 2, true);
  let o = 44; for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, sm[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([buf], { type: "audio/wav" });
}
const DEMO_NAMES = { attack: "ultrasonic_injection_48k.wav", benign: "clean_speech_48k.wav", beacon: "retail_beacon_19k.wav", phone: "phone_capture_16k.wav" };
const DEMO_LABEL = { attack: "Ultrasonic injection", benign: "Clean speech", beacon: "Retail beacon", phone: "Phone capture" };
const demoCache = {};
async function loadDemo(kind) {
  if (!demoCache[kind]) { const { sr, x } = demoAudio(kind); const blob = encodeWAV(x, sr); demoCache[kind] = { blob, data: await scanBlob(blob, DEMO_NAMES[kind], "1.0", "0.5") }; }
  return demoCache[kind];
}
async function openDemo(kind) { try { const c = await loadDemo(kind); analyzeBlob(c.blob, DEMO_NAMES[kind], c.data, { source: "demo" }); } catch (e) { toast("Engine offline: " + e.message, "bad"); } }
async function initSamples() {
  for (const card of $$(".sample")) {
    const kind = card.dataset.demo;
    card.onclick = async () => { card.style.opacity = .6; await openDemo(kind); card.style.opacity = 1; };
    try { const c = await loadDemo(kind); const cv = card.querySelector("canvas"), { ctx, W, H } = fit(cv);
      const sp = c.data.spectrogram; paintGrid(ctx, decodeGrid(sp), sp.shape[0], sp.shape[1], 0, 0, W, H, sp.fmax_hz, "lin");
      if (sp.fmax_hz > 18000) { const y = (1 - 18000 / sp.fmax_hz) * H; ctx.strokeStyle = "#f87171"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    } catch { /* engine offline: card still clickable */ }
  }
}

/* ============================================================ inputs: upload, drag, record */
const fileIn = $("#fileIn");
fileIn.onchange = () => { const f = fileIn.files[0]; if (f) analyzeBlob(f, f.name, null, { source: "upload" }); fileIn.value = ""; };
function dropTarget(el, onFiles, pick) {
  ["dragenter", "dragover"].forEach(t => el.addEventListener(t, e => { e.preventDefault(); el.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => el.addEventListener(t, e => { e.preventDefault(); el.classList.remove("over"); }));
  el.addEventListener("drop", e => onFiles(e.dataTransfer.files));
  el.addEventListener("click", e => { if (!e.target.closest("button")) pick(); });
}
dropTarget($("#dz"), fs => fs[0] && analyzeBlob(fs[0], fs[0].name, null, { source: "upload" }), () => fileIn.click());
// whole-page drop: a WAV dropped anywhere opens in Analyze
document.addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); });
document.addEventListener("drop", e => { if (e.target.closest(".dropzone")) return; const f = e.dataTransfer?.files?.[0]; if (f && /\.wav$/i.test(f.name)) { e.preventDefault(); analyzeBlob(f, f.name, null, { source: "upload" }); } });
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "upload") fileIn.click();
  if (a === "record") toggleRecord();
  if (a === "new") { $("#a-main").classList.add("hidden"); $("#a-empty").classList.remove("hidden"); state.data = null; go("analyze"); }
  if (a === "compare") { if (state.id) { compare.a = state.id; go("compare"); } else toast("Save this capture to history first", "info"); }
});
async function openMic() {
  const ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const ac = new (window.AudioContext || window.webkitAudioContext)(), src = ac.createMediaStreamSource(ms), pn = ac.createScriptProcessor(4096, 1, 1);
  src.connect(pn); pn.connect(ac.destination); return { ms, ac, pn, sr: ac.sampleRate };
}
function closeMic(m) { if (!m) return; m.pn.onaudioprocess = null; m.pn.disconnect(); m.ms.getTracks().forEach(t => t.stop()); m.ac.close(); }
let rec = null;
async function toggleRecord() {
  const btns = $$('[data-act="record"]');
  if (rec) {
    const m = rec; rec = null; closeMic(m);
    btns.forEach(b => { b.classList.remove("on"); b.querySelector(".rl").textContent = b.closest("#dz") ? "Record from mic" : "Record"; });
    const tot = m.chunks.reduce((a, c) => a + c.length, 0), x = new Float32Array(tot); let o = 0; m.chunks.forEach(c => { x.set(c, o); o += c.length; });
    if (tot < m.sr * .3) { toast("Recording too short", "bad"); return; }
    return analyzeBlob(encodeWAV(x, m.sr), `recording_${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.wav`, null, { source: "mic" });
  }
  try { rec = await openMic(); } catch (e) { toast("Microphone unavailable: " + e.message, "bad"); return; }
  rec.chunks = []; rec.pn.onaudioprocess = e => rec && rec.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  btns.forEach(b => { b.classList.add("on"); b.querySelector(".rl").textContent = `Stop · ${(rec.sr / 1000).toFixed(1)} kHz`; });
  if (currentView !== "analyze") go("analyze");
}

/* ============================================================ live monitor */
const live = { mic: null, sim: null, hist: [], unseen: 0, busy: false, wf: null, wfF: 240, fmax: 24000, cols: 2400, per: 40, flags: [] };
function resetLive() {
  live.hist = []; live.unseen = 0; live.flags = []; $("#lLog").innerHTML = '<div class="faint ph">No events yet.</div>';
  live.wf = document.createElement("canvas"); live.wf.width = live.cols; live.wf.height = live.wfF;
  const c = live.wf.getContext("2d"); c.fillStyle = "#04060c"; c.fillRect(0, 0, live.cols, live.wfF);
  $("#lN").textContent = 0; $("#lF").textContent = 0; drawWaterfall(); drawStrip();
}
function setLiveState(on, label, rate) {
  $("#lDot").classList.toggle("on", on); $("#lState").textContent = label; $("#lRate").textContent = rate || "—";
  $("#liveBtn").innerHTML = live.mic ? icon("x") + "Stop microphone" : icon("mic") + "Start microphone";
  $("#simBtn").innerHTML = live.sim ? icon("x") + "Stop simulation" : icon("play") + "Simulated stream";
}
function stopLive() {
  if (live.mic) { closeMic(live.mic); live.mic = null; }
  if (live.sim) { clearInterval(live.sim); live.sim = null; }
  setLiveState(false, "Idle"); $("#lNote").textContent = "Stopped. Nothing was stored.";
}
$("#liveBtn").onclick = async () => {
  if (live.mic) return stopLive();
  stopLive(); resetLive();
  try { live.mic = await openMic(); } catch (e) { $("#lNote").textContent = "Microphone unavailable: " + e.message; return; }
  const m = live.mic; m.buf = []; m.len = 0;
  setLiveState(true, "Listening", (m.sr / 1000).toFixed(1) + " kHz");
  $("#lNote").textContent = m.sr < 36000 ? `The microphone runs at ${(m.sr / 1000).toFixed(1)} kHz — below the 36 kHz needed, so windows will be insufficient data.` : "Each second is scored by the engine. Nothing is stored.";
  m.pn.onaudioprocess = e => { if (live.mic !== m) return; const ch = new Float32Array(e.inputBuffer.getChannelData(0)); m.buf.push(ch); m.len += ch.length;
    if (m.len >= m.sr && !live.busy) { const x = new Float32Array(m.len); let o = 0; m.buf.forEach(c => { x.set(c, o); o += c.length; }); m.buf = []; m.len = 0; liveScore(x.subarray(0, m.sr), m.sr); } };
};
$("#simBtn").onclick = () => {
  if (live.sim) return stopLive();
  stopLive(); resetLive(); let k = 0;
  setLiveState(true, "Simulated stream", "48.0 kHz");
  $("#lNote").textContent = "Synthetic audio: speech, with an injected carrier around 12–15 s and a beacon at 22 s of every 30 s. Scored by the real engine.";
  const tick = () => { const p = k % 30, kind = p >= 12 && p <= 15 ? "attack" : p === 22 ? "beacon" : "benign"; const { sr, x } = demoAudio(kind, 1.0, 1000 + k); k++; if (!live.busy) liveScore(x, sr); };
  tick(); live.sim = setInterval(tick, 1000);
};
async function liveScore(x, sr) {
  live.busy = true;
  try { const blob = encodeWAV(x, sr), d = await scanBlob(blob, "live.wav", "0", "0.5"); if (live.mic || live.sim) liveAdd(d, blob); }
  catch (e) { $("#lNote").textContent = "Scan failed: " + e.message; }
  live.busy = false;
}
function liveAdd(d, blob) {
  const now = new Date().toLocaleTimeString([], { hour12: false }), v = VERDICT[d.verdict];
  live.hist.push({ v: d.verdict, r: d.overall_risk, t: now }); if (live.hist.length > 60) live.hist.shift();
  const sp = d.spectrogram, [F, T] = sp.shape, g = decodeGrid(sp); live.fmax = sp.fmax_hz;
  const wc = live.wf.getContext("2d"); wc.drawImage(live.wf, -live.per, 0);
  const img = wc.createImageData(live.per, live.wfF), dd = img.data;
  for (let r = 0; r < live.wfF; r++) { const sr_ = Math.min(F - 1, Math.round(r / (live.wfF - 1) * (F - 1)));
    for (let c = 0; c < live.per; c++) { const sc = Math.min(T - 1, Math.floor(c / live.per * T)), val = g[sr_ * T + sc], o = (r * live.per + c) * 4; dd[o] = LUT[val * 3]; dd[o + 1] = LUT[val * 3 + 1]; dd[o + 2] = LUT[val * 3 + 2]; dd[o + 3] = 255; } }
  wc.putImageData(img, live.cols - live.per, 0);
  const arc = $("#lArc"); arc.setAttribute("stroke", v.hex); arc.setAttribute("stroke-dasharray", `${(75 * d.overall_risk).toFixed(1)} 100`);
  $("#lRisk").textContent = d.overall_risk.toFixed(2); $("#lRisk").style.color = v.hex;
  $("#lTag").className = "tag t-" + d.verdict; $("#lTagT").textContent = v.label;
  const flags = live.hist.filter(x => isFlag(x.v)).length;
  $("#lN").textContent = live.hist.length; $("#lF").textContent = flags;
  if (isFlag(d.verdict)) {
    if ($("#lLog .ph")) $("#lLog").innerHTML = "";
    const fc = carrierFound(d) ? d.annotations.carrier_peak_hz : null;
    live.flags.push({ d, blob, t: now }); if (live.flags.length > 30) live.flags.shift();
    $("#lLog").insertAdjacentHTML("afterbegin", `<div class="e"><span class="t">${now}</span><div><span class="tag sm t-${d.verdict}"><span class="d"></span>${v.label}</span>
      <div class="faint" style="margin-top:4px">risk ${d.overall_risk.toFixed(2)}${fc ? ` · carrier ${(fc / 1000).toFixed(1)} kHz` : ""}${d.annotations.carrier_sideband_db != null ? ` · sidebands ${d.annotations.carrier_sideband_db.toFixed(0)} dB` : ""}</div></div></div>`);
    if (currentView !== "live") { live.unseen++; updateBadge(); }
  }
  drawWaterfall(); drawStrip();
}
$("#lSave").onclick = async () => {
  if (!live.flags.length) return toast("No flagged windows to save", "info");
  for (const f of live.flags) await saveCapture(recordFrom(f.d, f.blob, `live_${f.t.replace(/:/g, "")}.wav`, { source: "live", tags: ["live", "flagged"] }));
  toast(`${live.flags.length} flagged window${live.flags.length > 1 ? "s" : ""} saved to history`, "ok"); live.flags = [];
};
function updateBadge() { const b = $("#liveBadge"); if (!b) return; b.textContent = live.unseen; b.classList.toggle("hidden", !live.unseen); }
function drawWaterfall() {
  const c = $("#wf"); if (!c.offsetParent) return; const { ctx, W, H } = fit(c), L = 46, R = 8, T = 6, B = 22, pw = W - L - R, ph = H - T - B, ax = AX();
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = PLOT(); ctx.fillRect(L, T, pw, ph);
  if (live.wf) { ctx.imageSmoothingEnabled = true; ctx.drawImage(live.wf, L, T, pw, ph); }
  const fmax = live.fmax, yOf = f => T + (1 - f / fmax) * ph;
  ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  freqTicks(fmax, "lin").forEach(f => { const y = yOf(f); ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillStyle = ax; ctx.fillText(kHz(f), L - 7, y); });
  if (fmax > 18000) { const y = yOf(18000); ctx.strokeStyle = "#f87171"; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]); }
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = ax;
  [60, 45, 30, 15, 0].forEach(s => ctx.fillText(s ? `−${s} s` : "now", L + (1 - s / 60) * pw, T + ph + 6));
  if (!live.hist.length) { ctx.fillStyle = "rgba(169,180,200,.6)"; ctx.font = "13px Inter"; ctx.textBaseline = "middle"; ctx.fillText("Waiting for audio", L + pw / 2, T + ph / 2); }
}
function drawStrip() {
  const c = $("#ls"); if (!c.offsetParent) return; const { ctx, W, H } = fit(c), L = 46, R = 8, T = 6, B = 6, pw = W - L - R, ph = H - T - B, ax = AX(), gr = GRID();
  ctx.clearRect(0, 0, W, H); const Y = v => T + (1 - v) * ph;
  ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  [[0, "0"], [.33, ".33"], [.66, ".66"], [1, "1"]].forEach(([v, l]) => { ctx.strokeStyle = v % 1 ? ax : gr; ctx.globalAlpha = v % 1 ? .35 : 1; ctx.setLineDash(v % 1 ? [3, 4] : []);
    ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(L + pw, Y(v)); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = ax; ctx.fillText(l, L - 7, Y(v)); });
  ctx.setLineDash([]); const bw = pw / 60;
  live.hist.forEach((x, i) => { const j = 60 - live.hist.length + i, h = x.v === "INSUFFICIENT_DATA" ? .08 : Math.max(.03, x.r);
    ctx.fillStyle = VERDICT[x.v].hex; ctx.globalAlpha = .85; roundRect(ctx, L + j * bw + 1, Y(h), Math.max(1, bw - 2), Y(0) - Y(h), 2); ctx.fill(); ctx.globalAlpha = 1; });
}

/* ============================================================ shared table bits */
const fmtPct = r => r == null ? "—" : (r * 100).toFixed(r < .01 ? 2 : 1) + "%";
const fmtWhen = ts => { const d = new Date(ts), diff = (Date.now() - ts) / 1000; if (diff < 60) return "just now"; if (diff < 3600) return Math.floor(diff / 60) + " min ago"; if (diff < 86400) return Math.floor(diff / 3600) + " h ago"; return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const vtag = v => VERDICT[v] ? `<span class="tag t-${v}"><span class="d"></span>${VERDICT[v].label}</span>` : `<span class="err" style="margin:0">${esc(v || "error")}</span>`;
const rbar = (r, v) => r == null || r < 0 ? "—" : `<div class="rbar"><i><u style="width:${r * 100}%;background:${VERDICT[v]?.hex || "#888"}"></u></i>${r.toFixed(2)}</div>`;
function sortRows(rows, k, dir) { const key = r => k === "verdict" ? (RANK[r.verdict] ?? -1) : k === "name" ? (r.name || "").toLowerCase() : (r[k] ?? -1); return rows.sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; }); }
function sortHeads(sel, st, render) { $$(sel + " th.sortable").forEach(th => th.onclick = () => { const k = th.dataset.k; st.dir = st.sortK === k ? -st.dir : -1; st.sortK = k; render(); }); }
function markHeads(sel, st) { $$(sel + " th.sortable").forEach(th => { th.querySelector(".arrow")?.remove(); if (th.dataset.k === st.sortK) th.insertAdjacentHTML("beforeend", `<span class="arrow">${st.dir < 0 ? "▼" : "▲"}</span>`); }); }
function kpiCards(el, items) { el.innerHTML = items.map(([k, v, c, h]) => `<div class="kpi"><div class="k">${k}</div><div class="v" style="color:${c}">${v}</div>${h ? `<div class="h">${h}</div>` : ""}</div>`).join(""); }
function csvOf(rows) { const lines = ["file,verdict,risk,sample_rate_hz,duration_s,oob_ratio,carrier_hz,sideband_db,tags,note"]; rows.forEach(r => lines.push([`"${(r.name || "").replace(/"/g, '""')}"`, r.verdict || "", r.risk >= 0 ? r.risk : "", r.sr || "", r.dur ?? "", r.oob ?? "", r.car ?? "", r.sb ?? "", `"${(r.tags || []).join(" ")}"`, `"${(r.note || "").replace(/"/g, '""')}"`].join(","))); return new Blob([lines.join("\n")], { type: "text/csv" }); }

/* ============================================================ batch */
const batch = { rows: [], sortK: "risk", dir: -1, filter: "all" };
const batchIn = $("#batchIn");
batchIn.onchange = () => { batchAdd(batchIn.files); batchIn.value = ""; };
dropTarget($("#bdz"), batchAdd, () => batchIn.click()); $("#batchPick").onclick = () => batchIn.click();
async function batchAdd(files) {
  const list = [...files].filter(f => /\.wav$/i.test(f.name)); if (!list.length) return;
  const rows = list.map(f => ({ name: f.name, file: f, verdict: null, risk: -1 }));
  batch.rows.push(...rows); renderBatch(); go("batch");
  for (const r of rows) {
    try { const d = await scanBlob(r.file, r.name); const rec = recordFrom(d, r.file, r.name, { source: "batch", tags: ["batch"] });
      Object.assign(r, { verdict: d.verdict, risk: d.overall_risk, sr: d.sample_rate, dur: d.duration_sec, oob: d.annotations.oob_ratio, car: rec.car, sb: rec.sb, data: d, id: rec.id });
      if (prefs.autosave) await saveCapture(rec); }
    catch (e) { r.verdict = "ERROR"; r.err = e.message; }
    renderBatch();
  }
  toast(`Batch done: ${rows.length} file${rows.length > 1 ? "s" : ""} scored`, "ok");
}
sortHeads("#v-batch", batch, renderBatch);
$$("#bFilter button").forEach(b => b.onclick = () => { $$("#bFilter button").forEach(x => x.classList.toggle("on", x === b)); batch.filter = b.dataset.f; renderBatch(); });
$("#clearBtn").onclick = () => { batch.rows = []; renderBatch(); };
$("#csvBtn").onclick = () => batch.rows.length && download("echoguard_batch.csv", csvOf(batch.rows));
function renderBatch() {
  const R = batch.rows, done = R.filter(r => r.verdict && r.verdict in VERDICT), cnt = v => done.filter(r => r.verdict === v).length;
  $("#bCount").textContent = `${R.length} file${R.length === 1 ? "" : "s"}${R.length > done.length ? ` · ${R.length - done.length} pending` : ""}`;
  kpiCards($("#bkpis"), [["Scored", done.length, "var(--text)"], ["Clear", cnt("CLEAR"), "var(--ok)"], ["Flagged", cnt("SUSPICIOUS") + cnt("HIGH_RISK"), "var(--bad)", `${cnt("SUSPICIOUS")} suspicious · ${cnt("HIGH_RISK")} high risk`], ["Insufficient data", cnt("INSUFFICIENT_DATA"), "var(--na)"]]);
  const f = batch.filter, keep = r => f === "all" || (f === "flag" ? isFlag(r.verdict) : r.verdict === f);
  const rows = sortRows(R.filter(keep), batch.sortK, batch.dir); markHeads("#v-batch", batch);
  if (!R.length) { $("#bBody").innerHTML = `<tr><td colspan="7"><div class="empty"><b>No files yet</b>Drop WAV files above, or add them with the button.</div></td></tr>`; return; }
  $("#bBody").innerHTML = rows.map(r => `<tr class="click" data-i="${R.indexOf(r)}"><td><div class="row" style="gap:8px">${icon("file")}${esc(r.name)}</div></td><td>${!r.verdict ? `<span class="spin"></span>` : vtag(r.verdict)}</td><td class="n">${rbar(r.risk, r.verdict)}</td>
      <td class="n">${r.sr ? (r.sr / 1000).toFixed(1) + " kHz" : "—"}</td><td class="n">${r.dur != null ? r.dur.toFixed(2) + " s" : "—"}</td><td class="n">${fmtPct(r.oob)}</td><td class="n">${r.car ? (r.car / 1000).toFixed(2) + " kHz" : "—"}</td></tr>`).join("");
  $$("#bBody tr[data-i]").forEach(tr => tr.onclick = () => { const r = R[+tr.dataset.i]; if (r.data) analyzeBlob(r.file, r.name, r.data, { id: r.id, source: "batch" }); });
}

/* ============================================================ history */
const hist = { sortK: "ts", dir: -1, filter: "all", q: "" };
$("#hQ").oninput = () => { hist.q = $("#hQ").value.toLowerCase(); renderHistory(); };
$$("#hFilter button").forEach(b => b.onclick = () => { $$("#hFilter button").forEach(x => x.classList.toggle("on", x === b)); hist.filter = b.dataset.f; renderHistory(); });
sortHeads("#v-history", hist, renderHistory);
$("#hCsv").onclick = () => history.length && download("echoguard_history.csv", csvOf(history));
$("#hExport").onclick = () => history.length && download("echoguard_history.json", new Blob([JSON.stringify(history.map(({ blob, ...r }) => r), null, 2)], { type: "application/json" }));
$("#hClear").onclick = async () => { if (!history.length || !confirm(`Delete all ${history.length} stored captures from this browser?`)) return; await store.clear(); history = []; renderHistory(); renderOverview(); toast("History cleared", "ok"); };
function filteredHistory() {
  const f = hist.filter, q = hist.q;
  return history.filter(r => (f === "all" || (f === "flag" ? isFlag(r.verdict) : r.verdict === f)) && (!q || (r.name + " " + (r.tags || []).join(" ") + " " + (r.note || "")).toLowerCase().includes(q)));
}
function renderHistory() {
  const rows = sortRows(filteredHistory().slice(), hist.sortK, hist.dir); markHeads("#v-history", hist);
  const bytes = history.reduce((a, r) => a + (r.bytes || 0), 0);
  const cnt = v => history.filter(r => r.verdict === v).length;
  kpiCards($("#hkpis"), [["Stored", history.length, "var(--text)", `${(bytes / 1048576).toFixed(1)} MB of audio`], ["Clear", cnt("CLEAR"), "var(--ok)"], ["Flagged", cnt("SUSPICIOUS") + cnt("HIGH_RISK"), "var(--bad)", `${cnt("SUSPICIOUS")} suspicious · ${cnt("HIGH_RISK")} high risk`], ["Insufficient data", cnt("INSUFFICIENT_DATA"), "var(--na)", "below 36 kHz"]]);
  $("#hCount").textContent = `${rows.length} of ${history.length}`; $("#hSub").textContent = `${history.length} capture${history.length === 1 ? "" : "s"} · ${(bytes / 1048576).toFixed(1)} MB · stored locally in this browser`;
  if (!history.length) { $("#hBody").innerHTML = `<tr><td colspan="7"><div class="empty"><b>No captures yet</b>Analyses are saved here automatically (Settings → Data).</div></td></tr>`; return; }
  if (!rows.length) { $("#hBody").innerHTML = `<tr><td colspan="7"><div class="empty">Nothing matches.</div></td></tr>`; return; }
  $("#hBody").innerHTML = rows.map(r => `<tr class="click" data-id="${r.id}"><td class="faint" style="white-space:nowrap">${fmtWhen(r.ts)}</td><td><div class="row" style="gap:8px">${icon("file")}<span>${esc(r.name)}${r.note ? `<div class="faint" style="font-size:11.5px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.note)}</div>` : ""}</span></div></td><td>${vtag(r.verdict)}</td><td class="n">${rbar(r.risk, r.verdict)}</td>
    <td class="n">${(r.sr / 1000).toFixed(1)} kHz</td><td>${(r.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join(" ")}</td>
    <td class="n" style="white-space:nowrap"><button class="btn sm ghost" data-cmp="${r.id}" title="Compare">${icon("compare")}</button> <button class="btn sm ghost" data-del="${r.id}" title="Delete">${icon("trash")}</button></td></tr>`).join("");
  $$("#hBody tr[data-id]").forEach(tr => tr.onclick = e => { if (e.target.closest("button")) return; openRecord(tr.dataset.id); });
  $$("#hBody [data-del]").forEach(b => b.onclick = async () => { await store.del(b.dataset.del); history = history.filter(r => r.id !== b.dataset.del); renderHistory(); renderOverview(); });
  $$("#hBody [data-cmp]").forEach(b => b.onclick = () => { if (compare.a && compare.a !== b.dataset.cmp) compare.b = b.dataset.cmp; else compare.a = b.dataset.cmp; go("compare"); });
}
async function openRecord(id) {
  const r = history.find(x => x.id === id) || await store.get(id); if (!r) return toast("Capture not found", "bad");
  if (!r.blob) return toast("Audio for this capture was not stored", "bad");
  analyzeBlob(r.blob, r.name, null, { id: r.id, tags: r.tags, note: r.note, source: r.source });
}

/* ============================================================ compare */
const compare = { a: null, b: null };
function renderCompare() {
  const opts = sel => `<option value="">— choose a capture —</option>` + history.map(r => `<option value="${r.id}"${r.id === sel ? " selected" : ""}>${esc(r.name)} · ${VERDICT[r.verdict]?.label || r.verdict} · ${fmtWhen(r.ts)}</option>`).join("");
  const side = (k, id) => { const r = history.find(x => x.id === id);
    return `<div class="card"><div class="card-h"><h3>${k === "a" ? "A" : "B"}</h3><div class="right" style="flex:1"><select class="inp" data-side="${k}" style="width:100%">${opts(id)}</select></div></div><div class="card-b">${r ? cmpBody(r) : `<div class="empty"><b>Nothing selected</b>Pick a capture from History.</div>`}</div></div>`; };
  $("#cmpGrid").innerHTML = side("a", compare.a) + side("b", compare.b);
  $$("#cmpGrid select").forEach(s => s.onchange = () => { compare[s.dataset.side] = s.value || null; renderCompare(); });
  const A = history.find(x => x.id === compare.a), B = history.find(x => x.id === compare.b);
  if (!A || !B) { $("#cmpDiff").innerHTML = `<div class="empty">Select two captures to see the differences.</div>`; return; }
  const n = (x, f) => x == null ? "—" : f(x), delta = (a, b, f, lowerBetter = true) => { if (a == null || b == null) return "—"; const d = b - a; const cls = d === 0 ? "" : (d < 0) === lowerBetter ? "better" : "worse"; return `<span class="${cls}">${d > 0 ? "+" : ""}${f(d)}</span>`; };
  const rows = [
    ["Verdict", VERDICT[A.verdict]?.label, VERDICT[B.verdict]?.label, A.verdict === B.verdict ? "same" : `<span class="${RANK[B.verdict] > RANK[A.verdict] ? "worse" : "better"}">${RANK[B.verdict] > RANK[A.verdict] ? "escalated" : "de-escalated"}</span>`],
    ["Risk score", A.risk.toFixed(2), B.risk.toFixed(2), delta(A.risk, B.risk, x => x.toFixed(2))],
    ["Energy above 18 kHz", fmtPct(A.oob), fmtPct(B.oob), delta(A.oob, B.oob, x => (x * 100).toFixed(2) + " pt")],
    ["Carrier", n(A.car, x => (x / 1000).toFixed(2) + " kHz"), n(B.car, x => (x / 1000).toFixed(2) + " kHz"), A.car && B.car ? delta(A.car, B.car, x => (x / 1000).toFixed(2) + " kHz", true).replace(/class="[^"]*"/, 'class=""') : "—"],
    ["Sidebands", n(A.sb, x => x.toFixed(0) + " dB"), n(B.sb, x => x.toFixed(0) + " dB"), delta(A.sb, B.sb, x => x.toFixed(0) + " dB")],
    ["Sample rate", (A.sr / 1000).toFixed(1) + " kHz", (B.sr / 1000).toFixed(1) + " kHz", A.sr === B.sr ? "same" : ""],
    ["Duration", A.dur.toFixed(2) + " s", B.dur.toFixed(2) + " s", delta(A.dur, B.dur, x => x.toFixed(2) + " s", false).replace(/class="[^"]*"/, 'class=""')],
    ...["out_of_band_energy", "carrier_peak"].map(k => { const fa = A.data.findings.find(f => f.name === k), fb = B.data.findings.find(f => f.name === k); return [k === "carrier_peak" ? "ρB carrier" : "ρA out-of-band", fa ? fa.risk.toFixed(2) : "—", fb ? fb.risk.toFixed(2) : "—", fa && fb ? delta(fa.risk, fb.risk, x => x.toFixed(2)) : "—"]; }),
  ];
  $("#cmpDiff").innerHTML = `<table class="diff"><thead><tr><th>Measure</th><th>A · ${esc(A.name)}</th><th>B · ${esc(B.name)}</th><th>B − A</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r[0]}</td><td class="d">${r[1]}</td><td class="d">${r[2]}</td><td class="d">${r[3]}</td></tr>`).join("")}</tbody></table>`;
}
function cmpBody(r) {
  const d = r.data, v = VERDICT[r.verdict], tx = narrative(d, ev(d, "out_of_band_energy"), ev(d, "carrier_peak"));
  return `<div class="row" style="gap:12px;align-items:flex-start"><div class="ring" style="width:84px;height:84px;flex:none"><svg viewBox="0 0 132 132" style="width:84px;height:84px"><circle cx="66" cy="66" r="54" fill="none" stroke="var(--track)" stroke-width="11" pathLength="100" stroke-dasharray="75 100" stroke-linecap="round"/><circle cx="66" cy="66" r="54" fill="none" stroke="${v.hex}" stroke-width="11" pathLength="100" stroke-dasharray="${(75 * r.risk).toFixed(1)} 100" stroke-linecap="round"/></svg><div class="val"><b style="font-size:20px;color:${v.hex}">${r.risk.toFixed(2)}</b></div></div>
    <div style="min-width:0">${vtag(r.verdict)}<div style="font-weight:600;margin-top:8px">${esc(tx.title)}</div><div class="faint" style="font-size:12.5px;margin-top:3px">${esc(tx.reason)}</div></div></div>
    <div style="margin-top:12px">${[["Captured", fmtWhen(r.ts)], ["Rate", (r.sr / 1000).toFixed(1) + " kHz"], ["Duration", r.dur.toFixed(2) + " s"], ["Above 18 kHz", fmtPct(r.oob)], ["Carrier", r.car ? (r.car / 1000).toFixed(2) + " kHz" : "none"], ["Tags", (r.tags || []).join(", ") || "—"]].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}</div>
    <button class="btn sm ghost" style="margin-top:12px" data-open="${r.id}">Open in Analyze</button>`;
}
document.addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) openRecord(b.dataset.open); });

/* ============================================================ gate policies */
const SENS = ["routine", "sensitive", "critical"], VERDS = ["CLEAR", "SUSPICIOUS", "HIGH_RISK", "INSUFFICIENT_DATA"], DECS = ["allow", "confirm", "block"];
const PRESETS = {
  Default: null,
  Strict: { routine: { CLEAR: "allow", SUSPICIOUS: "confirm", HIGH_RISK: "block", INSUFFICIENT_DATA: "confirm" }, sensitive: { CLEAR: "confirm", SUSPICIOUS: "block", HIGH_RISK: "block", INSUFFICIENT_DATA: "block" }, critical: { CLEAR: "confirm", SUSPICIOUS: "block", HIGH_RISK: "block", INSUFFICIENT_DATA: "block" } },
  Permissive: { routine: { CLEAR: "allow", SUSPICIOUS: "allow", HIGH_RISK: "confirm", INSUFFICIENT_DATA: "allow" }, sensitive: { CLEAR: "allow", SUSPICIOUS: "confirm", HIGH_RISK: "block", INSUFFICIENT_DATA: "allow" }, critical: { CLEAR: "confirm", SUSPICIOUS: "confirm", HIGH_RISK: "block", INSUFFICIENT_DATA: "confirm" } },
  "Audit only": { routine: { CLEAR: "allow", SUSPICIOUS: "allow", HIGH_RISK: "allow", INSUFFICIENT_DATA: "allow" }, sensitive: { CLEAR: "allow", SUSPICIOUS: "allow", HIGH_RISK: "allow", INSUFFICIENT_DATA: "allow" }, critical: { CLEAR: "allow", SUSPICIOUS: "allow", HIGH_RISK: "allow", INSUFFICIENT_DATA: "allow" } },
};
let polDraft = null, polDraftName = "Default";
function defaultPolicy() { return engine.info?.default_policy || PRESETS.Strict; }
function activePolicy() { return prefs.policy || defaultPolicy(); }
function policyTable(p, editable) {
  return `<table class="pol"><thead><tr><th>Action class</th>${VERDS.map(v => `<th>${VERDICT[v].label}</th>`).join("")}</tr></thead><tbody>${SENS.map(s => `<tr><td><b style="text-transform:capitalize">${s}</b><div class="faint" style="font-size:11.5px">${{ routine: "weather, timers", sensitive: "messages, settings", critical: "unlock, payments" }[s]}</div></td>${VERDS.map(v => { const d = p[s][v];
    return `<td>${editable ? `<select class="${d}" data-s="${s}" data-v="${v}">${DECS.map(x => `<option${x === d ? " selected" : ""}>${x}</option>`).join("")}</select>` : `<span class="cell c-${d}">${d}</span>`}</td>`; }).join("")}</tr>`).join("")}</tbody></table>`;
}
function renderPolicies() {
  if (!polDraft) { polDraft = JSON.parse(JSON.stringify(activePolicy())); polDraftName = prefs.policy ? prefs.policyName : "Default"; }
  $("#polMatrix").innerHTML = policyTable(polDraft, true);
  $$("#polMatrix select").forEach(s => s.onchange = () => { polDraft[s.dataset.s][s.dataset.v] = s.value; s.className = s.value; polDraftName = "Custom"; renderPolState(); });
  $("#polPresets").innerHTML = Object.keys(PRESETS).map(k => `<button class="btn sm${polDraftName === k ? " primary" : ""}" data-preset="${k}">${k}</button>`).join("");
  $$("#polPresets [data-preset]").forEach(b => b.onclick = () => { const k = b.dataset.preset; polDraft = JSON.parse(JSON.stringify(PRESETS[k] || defaultPolicy())); polDraftName = k; renderPolicies(); });
  renderPolState(); renderDryPick();
}
function renderDryPick() {
  const sel = $("#dryPick"), cur = sel.value;
  sel.innerHTML = history.length ? history.map(r => `<option value="${r.id}"${r.id === cur ? " selected" : ""}>${esc(r.name)} · ${VERDICT[r.verdict]?.label || r.verdict}</option>`).join("") : `<option value="">no stored captures yet</option>`;
}
$("#dryBtn").onclick = async () => {
  const r = history.find(x => x.id === $("#dryPick").value); if (!r || !r.blob) return toast("Pick a stored capture first", "info");
  $("#dryBtn").disabled = true; $("#dryOut").innerHTML = `<div class="faint" style="margin-top:10px"><span class="spin"></span> gating ${esc(r.name)} three times…</div>`;
  try {
    const res = await Promise.all(SENS.map(s => gateCall(r.blob, r.name, s, polDraft)));
    $("#dryOut").innerHTML = `<div style="margin-top:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${res.map((d, i) => `<div class="gopt" style="cursor:default"><span class="cell c-${d.decision}" style="min-width:0;padding:3px 8px">${d.decision}</span><b style="margin-top:6px;text-transform:capitalize">${SENS[i]}</b><span>${VERDICT[d.verdict]?.label || d.verdict} · risk ${d.risk.toFixed(2)}</span></div>`).join("")}</div>
      <div class="faint" style="font-size:12px;margin-top:8px">${esc(res[2].reason)}</div>`;
  } catch (e) { $("#dryOut").innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  $("#dryBtn").disabled = false;
};
function renderPolState() {
  const same = JSON.stringify(polDraft) === JSON.stringify(activePolicy());
  $("#polState").innerHTML = same ? `active: <b class="muted">${esc(prefs.policy ? prefs.policyName : "Default")}</b>` : `editing <b class="muted">${esc(polDraftName)}</b> · unsaved`;
  $("#polSave").disabled = same;
}
$("#polSave").onclick = () => { const isDefault = JSON.stringify(polDraft) === JSON.stringify(defaultPolicy()); prefs.policy = isDefault ? null : polDraft; prefs.policyName = isDefault ? "Default" : polDraftName; savePrefs(); renderPolicies(); toast(`Policy "${prefs.policyName}" is now active`, "ok"); if (state.data) $("#gatePolicyName").textContent = "policy: " + prefs.policyName; };
$("#polReset").onclick = () => { polDraft = JSON.parse(JSON.stringify(defaultPolicy())); polDraftName = "Default"; renderPolicies(); };
function renderCovPolicy() { $("#covPolicy").innerHTML = policyTable(activePolicy(), false) + `<div class="faint" style="font-size:12px;margin-top:8px">Active: ${esc(prefs.policy ? prefs.policyName : "Default (engine)")}</div>`; }

/* ============================================================ coverage */
const CLASSES = [
  ["Ultrasonic AM injection", "DolphinAttack family · 25–40 kHz carrier", "Demodulated residue in-band; the carrier is removed by a phone's converter.", [["carrier at ≥ 96 kHz", "warn"], ["real data: 16 kHz only", "ok"]]],
  ["Near-ultrasound in media", "NUIT · 16–22 kHz from ordinary speakers", "Visible at 48 kHz on devices that keep the band.", [["partial (≥ 18 kHz)", "warn"], ["no public data", "bad"]]],
  ["Solid-surface guided wave", "SurfingAttack, SUAD", "Same residue as ultrasonic AM.", [["high-rate only", "warn"], ["no public data", "bad"]]],
  ["Hearable / metamaterial", "ultrasound into earbuds; long-range emitters", "Same residue as ultrasonic AM.", [["high-rate only", "warn"], ["no public data", "bad"]]],
  ["Laser and EM injection", "LightCommands, GhostTalk", "No acoustic trace — bypasses the microphone's air path.", [["out of scope", "bad"], ["no public data", "bad"]]],
  ["Hidden / adversarial audio", "CommanderSong, agent prompt injection", "Fully in-band; a different detection problem.", [["separate problem", ""], ["partial data", ""]]],
  ["Replay and voice clone", "ASVspoof scope", "Fully in-band speech.", [["anti-spoofing module", ""], ["ASVspoof 2019/2021/5", "ok"]]],
];
$("#classes").innerHTML = CLASSES.map(([t, s, p, chips]) => `<div class="cls"><h4>${t}</h4><div class="faint" style="font-size:12px;margin-bottom:6px">${s}</div><p>${p}</p><div class="row">${chips.map(([c, k]) => `<span class="chip ${k}">${c}</span>`).join("")}</div></div>`).join("");
const COV = [["No ADC · raw 192 kHz", 100, "#4cc3ff"], ["ADC → 48 kHz", 33, "#fbbf24"], ["ADC → 44.1 kHz", 8, "#fbbf24"], ["ADC → 16 kHz", 0, "#8b9ab3"]];
function barChart(c, data, { T = 22, B = 40, L = 36, R = 10, labels = true } = {}) {
  if (!c.offsetParent) return; const { ctx, W, H } = fit(c), pw = W - L - R, ph = H - T - B, ax = AX(), gr = GRID();
  ctx.clearRect(0, 0, W, H); ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  [0, 50, 100].forEach(v => { const y = T + (1 - v / 100) * ph; ctx.strokeStyle = gr; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke(); ctx.fillStyle = ax; ctx.fillText(v + "%", L - 6, y); });
  const bw = pw / data.length;
  data.forEach(([l, v, col], i) => { const x = L + i * bw + bw * .2, w = bw * .6, h = Math.max(2, ph * v / 100), y = T + ph - h;
    const g = ctx.createLinearGradient(0, y, 0, T + ph); g.addColorStop(0, col); g.addColorStop(1, col + "44"); ctx.fillStyle = g; roundRect(ctx, x, y, w, h, 5); ctx.fill();
    ctx.fillStyle = TXT(); ctx.font = "600 12px Inter"; ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillText(v ? v + "%" : "no verdict", x + w / 2, y - 5);
    if (labels) { ctx.fillStyle = ax; ctx.font = "10.5px Inter"; ctx.textBaseline = "top"; ctx.fillText(l, x + w / 2, T + ph + 9); } });
}
function drawCoverage() { barChart($("#cbar"), COV); }
function drawOvCov() { barChart($("#ovCov"), COV.map(([l, v, c]) => [l.replace("ADC → ", "").replace("No ADC · raw ", ""), v, c]), { T: 18, B: 24, L: 34 }); }

/* ============================================================ overview */
function renderOverview() {
  const n = history.length, flagged = history.filter(r => isFlag(r.verdict)).length, insuf = history.filter(r => r.verdict === "INSUFFICIENT_DATA").length;
  const day = history.filter(r => Date.now() - r.ts < 86400e3).length, last = history[0];
  kpiCards($("#kpis"), [
    ["Captures analysed", n, "var(--text)", day ? `${day} in the last 24 h` : "stored in this browser"],
    ["Flagged", flagged, flagged ? "var(--bad)" : "var(--text)", n ? `${(flagged / n * 100).toFixed(0)}% of captures` : "suspicious or high risk"],
    ["Could not assess", insuf, insuf ? "var(--na)" : "var(--text)", "captures below 36 kHz"],
    ["Last verdict", last ? VERDICT[last.verdict]?.label || "—" : "—", last ? VERDICT[last.verdict]?.hex : "var(--text)", last ? `${esc(last.name)} · ${fmtWhen(last.ts)}` : "no captures yet"]]);
  $("#ovSub").textContent = `${n} capture${n === 1 ? "" : "s"} · engine ${engine.ok ? "online" : "offline"} · policy ${prefs.policy ? prefs.policyName : "Default"}`;
  $("#recentSub").textContent = n ? `${Math.min(n, 6)} most recent` : "";
  $("#recent").innerHTML = history.length ? history.slice(0, 6).map(r => `<div class="r" data-open="${r.id}"><div class="n"><b>${esc(r.name)}</b><span>${fmtWhen(r.ts)} · ${(r.sr / 1000).toFixed(1)} kHz · ${r.source || "upload"}</span></div>${rbar(r.risk, r.verdict)}${vtag(r.verdict)}</div>`).join("")
    : `<div class="empty"><b>No captures yet</b>Analyse a file, record from the mic, or try a sample — results land here.</div>`;
  $("#quick").innerHTML = [["upload", "Upload a WAV", "drop or choose", () => fileIn.click()], ["mic", "Record", "from the microphone", () => { go("analyze"); toggleRecord(); }], ["spark", "Try the injection sample", "synthetic 20 kHz carrier", () => openDemo("attack")], ["batch", "Batch screen", "many files at once", () => go("batch")]]
    .map(([i, b, s], k) => `<a data-q="${k}">${icon(i)}<div><b>${b}</b><span>${s}</span></div></a>`).join("");
  const QF = [() => fileIn.click(), () => { go("analyze"); toggleRecord(); }, () => openDemo("attack"), () => go("batch")];
  $$("#quick a").forEach(a => a.onclick = () => QF[+a.dataset.q]());
  renderEngineCard(); drawTrend(); drawOvCov();
}
function renderEngineCard() {
  const i = engine.info; $("#engVerSub").textContent = i ? "v" + i.version : "";
  $("#engineKv").innerHTML = i ? [["Status", `<span style="color:var(--ok)">online</span>`], ["Uptime", fmtUptime(i.uptime_s)], ["Detectors", i.detectors.join(", ")], ["Out-of-band edge", (i.thresholds.oob_edge_hz / 1000) + " kHz"], ["Verdict thresholds", `≥ ${i.thresholds.suspicious_risk} · ≥ ${i.thresholds.high_risk}`], ["Sideband range", `${i.thresholds.sideband_floor_db} to ${i.thresholds.sideband_full_db} dB`]].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join("")
    : `<div class="kv"><span>Status</span><b style="color:var(--bad)">offline</b></div><div class="faint" style="font-size:12.5px;margin-top:8px">Start the server: <code class="mono">uvicorn app.server:app</code></div>`;
}
const fmtUptime = s => s < 60 ? Math.round(s) + " s" : s < 3600 ? Math.round(s / 60) + " min" : s < 86400 ? (s / 3600).toFixed(1) + " h" : (s / 86400).toFixed(1) + " d";
function drawTrend() {
  const c = $("#ovTrend"); if (!c.offsetParent) return; const { ctx, W, H } = fit(c), L = 28, R = 8, T = 8, B = 8, pw = W - L - R, ph = H - T - B, ax = AX(), gr = GRID();
  ctx.clearRect(0, 0, W, H); const Y = v => T + (1 - v) * ph;
  ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  [[0, "0"], [.33, ".33"], [.66, ".66"], [1, "1"]].forEach(([v, l]) => { ctx.strokeStyle = v % 1 ? ax : gr; ctx.globalAlpha = v % 1 ? .35 : 1; ctx.setLineDash(v % 1 ? [3, 4] : []); ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(L + pw, Y(v)); ctx.stroke(); ctx.globalAlpha = 1; ctx.fillStyle = ax; ctx.fillText(l, L - 6, Y(v)); });
  ctx.setLineDash([]);
  const rows = history.slice(0, 40).reverse(); if (!rows.length) { ctx.fillStyle = TXT3(); ctx.textAlign = "center"; ctx.font = "12.5px Inter"; ctx.fillText("No captures yet", L + pw / 2, T + ph / 2); return; }
  const bw = pw / 40;
  rows.forEach((r, i) => { const j = 40 - rows.length + i, h = r.verdict === "INSUFFICIENT_DATA" ? .08 : Math.max(.03, r.risk); ctx.fillStyle = VERDICT[r.verdict]?.hex || "#888"; ctx.globalAlpha = .85; roundRect(ctx, L + j * bw + 1.5, Y(h), Math.max(2, bw - 3), Y(0) - Y(h), 2); ctx.fill(); ctx.globalAlpha = 1; });
}

/* ============================================================ settings */
function settingRow(b, s, ctrl) { return `<div class="setting"><div class="d"><b>${b}</b><span>${s}</span></div><div class="c">${ctrl}</div></div>`; }
function renderSettings() {
  const segT = `<div class="seg" id="setTheme">${["system", "dark", "light"].map(t => `<button data-t="${t}"${prefs.theme === t ? ' class="on"' : ""}>${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>`;
  $("#setAppearance").innerHTML = settingRow("Theme", "Follows the system, or fixed", segT) + settingRow("Compact density", "Tighter spacing in tables and cards", `<div class="toggle${prefs.compact ? " on" : ""}" data-pref="compact"></div>`) + settingRow("Collapsed sidebar", "Icons only; press [ to toggle", `<div class="toggle${prefs.rail ? " on" : ""}" data-pref="rail"></div>`);
  $("#setAnalysis").innerHTML = settingRow("Window length", "Seconds per scored window; the worst window decides", `<select class="inp" data-pref="window">${["0.5", "1.0", "2.0"].map(v => `<option${prefs.window === v ? " selected" : ""}>${v}</option>`).join("")}</select>`) + settingRow("Hop", "Seconds between window starts", `<select class="inp" data-pref="hop">${["0.25", "0.5", "1.0"].map(v => `<option${prefs.hop === v ? " selected" : ""}>${v}</option>`).join("")}</select>`) + settingRow("Active gate policy", prefs.policy ? prefs.policyName : "Default (engine)", `<button class="btn sm" data-go="policies">Edit</button>`);
  const bytes = history.reduce((a, r) => a + (r.bytes || 0), 0);
  $("#setData").innerHTML = settingRow("Save analyses to history", "Uploads, recordings and batch results are kept in this browser (IndexedDB); samples are not", `<div class="toggle${prefs.autosave ? " on" : ""}" data-pref="autosave"></div>`) + settingRow("Toast notifications", "Short confirmations in the corner", `<div class="toggle${prefs.toasts ? " on" : ""}" data-pref="toasts"></div>`)
    + `<div class="setting"><div class="d"><b>Local storage</b><span>${history.length} captures · ${(bytes / 1048576).toFixed(1)} MB of audio${navigator.storage?.estimate ? ' · <span id="quota"></span>' : ""}</span><div class="storage"><u id="quotaBar" style="width:0"></u></div></div><div class="c"><button class="btn sm danger" id="setClear">Clear</button></div></div>`
    + `<div class="setting"><div class="d"><b>Server</b><span>Stateless — uploads are scored in memory and discarded. Nothing you analyse leaves this machine unless you deploy the API elsewhere.</span></div></div>`;
  $("#setKeys").innerHTML = [["⌘ K", "Command palette"], ["[", "Toggle sidebar"], ["T", "Toggle theme"], ["1 – 0", "Jump to a view"], ["Esc", "Close palette"]].map(([k, v]) => `<div class="kv"><span>${v}</span><b><span class="kbd">${k}</span></b></div>`).join("");
  const i = engine.info;
  $("#setAbout").innerHTML = [["Console", "v3"], ["Engine", i ? "echoguard " + i.version : "offline"], ["Detectors", i ? i.detectors.length : "—"], ["Verdicts", i ? i.verdicts.join(" · ") : "—"], ["Source", `<a href="https://github.com/swarnali2k17/echoguard" target="_blank" rel="noopener">github.com/swarnali2k17/echoguard</a>`]].map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join("");
  $$("#setTheme button").forEach(b => b.onclick = () => setTheme(b.dataset.t));
  $$("#v-settings .toggle[data-pref]").forEach(t => t.onclick = () => { prefs[t.dataset.pref] = !prefs[t.dataset.pref]; savePrefs(); applyTheme(); applyRail(); renderSettings(); });
  $$("#v-settings select[data-pref]").forEach(s => s.onchange = () => { prefs[s.dataset.pref] = s.value; savePrefs(); toast("Analysis defaults updated — applies to the next scan", "ok"); });
  $("#setClear").onclick = () => $("#hClear").click();
  navigator.storage?.estimate?.().then(e => { const q = $("#quota"), b = $("#quotaBar"); if (q && e.quota) { q.textContent = `${(e.usage / 1048576).toFixed(1)} of ${(e.quota / 1073741824).toFixed(1)} GB used`; b.style.width = Math.max(1, e.usage / e.quota * 100) + "%"; } });
}

/* ============================================================ misc & boot */
$$(".copy").forEach(b => b.onclick = e => { e.stopPropagation(); const txt = b.parentElement.childNodes[0].textContent.trim(); navigator.clipboard?.writeText(txt).then(() => { b.textContent = "Copied"; setTimeout(() => b.textContent = "Copy", 1200); toast("Copied to clipboard", "ok", 1200); }); });
$("#searchBtn").innerHTML = icon("search") + "<span>Search or jump to…</span><span class=\"kbd\">⌘K</span>";
$("#moreBtn").innerHTML = icon("more");
(async function boot() {
  mountNav(); fillIcons(); applyTheme(); applyRail();
  await Promise.all([health(), loadHistory()]);
  resetLive(); renderBatch();
  const want = location.hash.replace("#", "") || "overview";
  go(VIEW_NAMES[want] ? want : "overview", { silent: true });
  initSamples();
  setInterval(health, 30000);
  window.addEventListener("hashchange", () => { const v = location.hash.replace("#", ""); if (VIEW_NAMES[v] && v !== currentView) go(v, { silent: true }); });
})();
