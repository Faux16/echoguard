/* EchoGuard Console — every number drawn here comes from the engine (/api/scan). */
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
const LUT = heatLUT();
const state = { blob: null, name: null, data: null, grid: null, scale: "lin", geom: null };

/* ============================================================ engine */
async function scanBlob(blob, name, win = "1.0") {
  const fd = new FormData();
  fd.append("file", blob, name || "clip.wav"); fd.append("window", win); fd.append("hop", "0.5");
  const r = await fetch("/api/scan", { method: "POST", body: fd });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || r.statusText); }
  const d = await r.json();
  $("#engMs").textContent = d.analysis_ms + " ms";
  return d;
}
async function health() {
  try {
    const r = await fetch("/api/health"); const d = await r.json();
    $("#led").classList.remove("off"); $("#engState").textContent = "Engine online"; $("#engVer").textContent = "echoguard " + d.version;
  } catch { $("#led").classList.add("off"); $("#engState").textContent = "Engine offline"; }
}

/* ============================================================ navigation */
const VIEW_NAMES = { analyze: "Analyze", live: "Live monitor", batch: "Batch", coverage: "Coverage", api: "API" };
function show(v) {
  $$(".nav a").forEach(a => a.classList.toggle("on", a.dataset.v === v));
  $$(".view").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  $("#crumbView").textContent = VIEW_NAMES[v];
  const f = v === "analyze" && state.data ? state.name : "";
  $("#crumbFile").textContent = f; $("#crumbSep").classList.toggle("hidden", !f);
  if (v === "live") { live.unseen = 0; updateBadge(); }
  requestAnimationFrame(() => { redraw(); });
}
$$(".nav a").forEach(a => a.onclick = () => show(a.dataset.v));
function redraw() {
  if ($("#v-analyze").classList.contains("on") && state.data) drawAnalyze();
  if ($("#v-live").classList.contains("on")) { drawWaterfall(); drawStrip(); }
  if ($("#v-coverage").classList.contains("on")) drawCoverage();
}
let rzT; window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(redraw, 60); });

/* ============================================================ canvas helpers */
function fit(c) {
  const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext("2d"); ctx.setTransform(d, 0, 0, d, 0, 0);
  return { ctx, W: r.width, H: r.height };
}
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
function freqAt(frac, fmax, scale) {           // frac 0 = top of plot
  return scale === "log" ? Math.exp(Math.log(fmax) - frac * (Math.log(fmax) - Math.log(FMIN_LOG))) : fmax * (1 - frac);
}
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
/* paint a spectrogram grid into a plot rect (shared by analyze, thumbnails, waterfall) */
function paintGrid(ctx, grid, F, T, x0, y0, pw, ph, fmax, scale) {
  const rows = Math.max(2, Math.min(Math.round(ph), 520));
  const off = document.createElement("canvas"); off.width = T; off.height = rows;
  const oc = off.getContext("2d"), img = oc.createImageData(T, rows), d = img.data;
  for (let r = 0; r < rows; r++) {
    const f = freqAt(r / (rows - 1), fmax, scale);
    const src = Math.min(F - 1, Math.max(0, Math.round((1 - f / fmax) * (F - 1))));
    for (let c = 0; c < T; c++) {
      const v = grid[src * T + c], o = (r * T + c) * 4;
      d[o] = LUT[v * 3]; d[o + 1] = LUT[v * 3 + 1]; d[o + 2] = LUT[v * 3 + 2]; d[o + 3] = 255;
    }
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
const AX = "rgba(169,180,200,.75)", GRID = "rgba(255,255,255,.055)";

/* ============================================================ analyze */
async function analyzeBlob(blob, name, cached) {
  $("#aErr").textContent = "";
  state.blob = blob; state.name = name;
  try {
    const d = cached || await scanBlob(blob, name);
    state.data = d; state.grid = decodeGrid(d.spectrogram);
    $("#a-empty").classList.add("hidden"); $("#a-main").classList.remove("hidden");
    $("#gateOut").innerHTML = "";
    show("analyze");
    fillAnalyze(d);
  } catch (e) { $("#aErr").textContent = "Could not analyse this file: " + e.message; }
}
function ev(d, name) { const f = d.findings.find(x => x.name === name); return f ? { ...f, e: f.evidence || {} } : null; }
function fillAnalyze(d) {
  const v = VERDICT[d.verdict], oob = ev(d, "out_of_band_energy"), car = ev(d, "carrier_peak");
  $("#fName").textContent = d.filename || state.name;
  $("#mRate").textContent = (d.sample_rate / 1000).toFixed(1) + " kHz";
  $("#mNyq").textContent = (d.sample_rate / 2000).toFixed(1) + " kHz";
  $("#mDur").textContent = d.duration_sec.toFixed(2) + " s";
  $("#mWin").textContent = d.windows.length || 1;
  // hero
  $("#vTag").className = "tag t-" + d.verdict; $("#vTagT").textContent = v.label;
  const txt = narrative(d, oob, car);
  $("#vTitle").textContent = txt.title; $("#vReason").textContent = txt.reason;
  $("#vActionT").textContent = txt.action; $("#vAction").style.color = v.hex;
  $("#vAction span").style.color = "var(--text)";
  $("#vRisk").textContent = d.overall_risk.toFixed(2); $("#vRisk").style.color = v.hex;
  const arc = $("#ringArc"); arc.setAttribute("stroke", v.hex); arc.style.filter = `drop-shadow(0 0 6px ${v.hex}88)`;
  requestAnimationFrame(() => arc.setAttribute("stroke-dasharray", `${(75 * d.overall_risk).toFixed(1)} 100`));
  $("#vStats").innerHTML = heroStats(d, oob, car).map(s =>
    `<div class="stat"><div class="k">${s.k}</div><div class="v">${s.v}<small>${s.u || ""}</small></div><div class="h">${s.h || ""}</div></div>`).join("");
  $("#specSub").textContent = `${d.spectrogram.vmin_db.toFixed(0)} to ${d.spectrogram.vmax_db.toFixed(0)} dB`;
  $("#breakdown").innerHTML = breakdown(d, oob, car);
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
      // a prominent high-band tone that the engine refused to score as a carrier = beacon / whine
      const bare = fc && sb != null && sb < t.sideband_full_db && car && car.e.prominence_db != null && car.e.prominence_db >= 20;
      let reason;
      if (bare)
        reason = `A steady tone at ${(fc / 1000).toFixed(1)} kHz carries ${pct}% of the energy, but it has ${sb <= t.sideband_floor_db ? "no" : "almost no"} modulation sidebands (${sb.toFixed(0)} dB) — the signature of a beacon or power-supply whine, not a command carrier.`;
      else if (a.oob_level_dbfs != null && a.oob_level_dbfs < t.oob_min_level_dbfs)
        reason = `Energy above ${(t.oob_edge_hz / 1000).toFixed(0)} kHz is at ${a.oob_level_dbfs.toFixed(0)} dBFS — below the ${t.oob_min_level_dbfs} dBFS floor, too little to be a carrier.`;
      else if (r != null && r * 100 >= 1.09)
        reason = `${pct}% of the energy is above ${(t.oob_edge_hz / 1000).toFixed(0)} kHz, but no modulated carrier was found. Broadband or tonal high-frequency content on its own is not an injection.`;
      else
        reason = `Only ${pct}% of the energy is above ${(t.oob_edge_hz / 1000).toFixed(0)} kHz and no modulated carrier was found.`;
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
    { k: "Energy above 18 kHz", v: a.oob_ratio == null ? "—" : (a.oob_ratio * 100).toFixed(a.oob_ratio < .01 ? 2 : 1), u: "%",
      h: a.oob_level_dbfs == null ? "" : `${a.oob_level_dbfs.toFixed(0)} dBFS band level` },
    isCarrier
      ? { k: "Carrier", v: (a.carrier_peak_hz / 1000).toFixed(2), u: "kHz", h: `${a.carrier_prominence_db.toFixed(0)} dB above floor` }
      : { k: "Carrier", v: "none", u: "", h: a.carrier_peak_hz && sb != null && sb < t.sideband_full_db && car && car.e.prominence_db >= 20 ? `unmodulated tone at ${(a.carrier_peak_hz / 1000).toFixed(1)} kHz` : "no modulated carrier" },
    { k: "Modulation sidebands", v: sb == null ? "—" : sb.toFixed(0), u: sb == null ? "" : "dB",
      h: sb == null ? "" : sb >= t.sideband_full_db ? "modulated — command-like" : sb <= t.sideband_floor_db ? "bare tone — beacon-like" : "weakly modulated" }];
}
/* the engine reports the strongest high-band bin even in clean audio; only call it a carrier when it scores */
function carrierFound(d) { const c = ev(d, "carrier_peak"); return !!(c && c.assessable && d.annotations.carrier_peak_hz && c.risk >= d.thresholds.suspicious_risk); }

/* ---- detection breakdown (HTML meters against engine thresholds) ---- */
function meter({ label, value, display, min, max, log, ticks = [], zones = [], color = "var(--accent)" }) {
  const pos = x => {
    if (x == null || !isFinite(x)) return 0;
    const p = log ? (Math.log10(Math.max(x, min)) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) : (x - min) / (max - min);
    return Math.max(0, Math.min(1, p)) * 100;
  };
  const z = zones.map(([a, b, c]) => `<div class="zone" style="left:${pos(a)}%;width:${pos(b) - pos(a)}%;background:${c}"></div>`).join("");
  const tk = ticks.map(([x, l]) => `<div class="tick" style="left:${pos(x)}%"><em>${l}</em></div>`).join("");
  const has = value != null && isFinite(value);
  return `<div class="meter"><div class="lab"><span>${label}</span><b>${has ? display : "—"}</b></div>
    <div class="track">${z}${has ? `<div class="fill" style="width:${pos(value)}%;background:${color};opacity:.55"></div><div class="knob" style="left:${pos(value)}%"></div>` : ""}${tk}</div></div>`;
}
function breakdown(d, oob, car) {
  const t = d.thresholds, a = d.annotations, spec = ev(d, "spectral_profile");
  const rA = oob ? oob.risk : 0, rB = car ? car.risk : 0, ok = oob && oob.assessable;
  const sev = f => f && f.assessable ? `<span class="tag t-${f.risk >= t.high_risk ? "HIGH_RISK" : f.risk >= t.suspicious_risk ? "SUSPICIOUS" : "CLEAR"}" style="height:20px;font-size:11px">${f.severity}</span>` : `<span class="tag t-INSUFFICIENT_DATA" style="height:20px;font-size:11px">not assessable</span>`;
  let h = `<div class="det"><div class="det-h"><h4>Out-of-band energy</h4>${sev(oob)}<span class="rho">ρ<sub>A</sub> <b>${rA.toFixed(2)}</b></span></div>
    <p>${oob ? oob.detail : ""}</p>`;
  if (ok) {
    h += meter({ label: "Share of energy above 18 kHz", value: a.oob_ratio * 100, display: (a.oob_ratio * 100).toFixed(2) + "%",
      min: .01, max: 100, log: true, zones: [[1.09, 4.36, "rgba(251,191,36,.18)"], [4.36, 100, "rgba(248,113,113,.16)"]],
      ticks: [[1.09, "1.1%"], [4.36, "4.4%"], [t.oob_saturation_ratio * 100, "10%"]] });
    h += meter({ label: "Band level (must clear the floor)", value: a.oob_level_dbfs, display: a.oob_level_dbfs.toFixed(0) + " dBFS",
      min: -120, max: 0, zones: [[-120, t.oob_min_level_dbfs, "rgba(139,154,179,.14)"]], ticks: [[t.oob_min_level_dbfs, t.oob_min_level_dbfs + " dBFS floor"]] });
  }
  h += `</div><div class="det"><div class="det-h"><h4>Modulated carrier</h4>${sev(car)}<span class="rho">ρ<sub>B</sub> <b>${rB.toFixed(2)}</b></span></div>
    <p>${car ? car.detail : ""}</p>`;
  if (car && car.e.prominence_db != null) {
    const ex = car.e.prominence_db - car.e.noise_threshold_db;
    h += meter({ label: "Peak above CFAR noise floor", value: ex, display: ex.toFixed(0) + " dB", min: 0, max: 40,
      ticks: [[t.carrier_prominence_saturation_db, "saturates"]] });
    h += meter({ label: "Peak narrowness", value: car.e.narrowness, display: car.e.narrowness.toFixed(2), min: 0, max: 1,
      zones: [[t.narrow_floor, t.narrow_full, "rgba(76,195,255,.14)"], [t.narrow_full, 1, "rgba(76,195,255,.26)"]],
      ticks: [[t.narrow_floor, "broad"], [t.narrow_full, "narrow"]] });
    h += meter({ label: "Modulation sidebands", value: car.e.sideband_db, display: car.e.sideband_db.toFixed(0) + " dB", min: -120, max: 0,
      zones: [[-120, t.sideband_floor_db, "rgba(139,154,179,.14)"], [t.sideband_full_db, 0, "rgba(248,113,113,.14)"]],
      ticks: [[t.sideband_floor_db, "bare tone"], [t.sideband_full_db, "modulated"]] });
  }
  h += `</div>`;
  if (spec) h += `<div class="det"><div class="det-h"><h4>Spectral profile</h4><span class="tag t-INSUFFICIENT_DATA" style="height:20px;font-size:11px">context only</span></div>
    <p>${spec.detail} Not part of the score — on its own it fires on bright music.</p></div>`;
  const V = VERDICT[d.verdict];
  h += `<div class="formula">R = √(ρ<sub>A</sub> × ρ<sub>B</sub>) = √(${rA.toFixed(2)} × ${rB.toFixed(2)}) = <b style="color:${V.hex}">${d.overall_risk.toFixed(2)}</b>
    <div class="faint" style="font-size:12px;margin-top:4px">Both signatures must be present. ≥ ${t.suspicious_risk} suspicious · ≥ ${t.high_risk} high risk.</div></div>`;
  return h;
}

/* ---- canvases ---- */
function drawAnalyze() {
  const d = state.data; if (!d) return;
  drawSpectrogram(d); drawOverview(d); drawPSD(d); drawTimeline(d); drawDecisionMap(d);
}
function drawSpectrogram(d) {
  const c = $("#spec"), { ctx, W, H } = fit(c), sp = d.spectrogram, [F, T] = sp.shape, fmax = sp.fmax_hz, sc = state.scale;
  const L = 50, R = 64, Tm = 8, B = 26, x0 = L, y0 = Tm, pw = W - L - R, ph = H - Tm - B;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#04060c"; ctx.fillRect(x0, y0, pw, ph);
  paintGrid(ctx, state.grid, F, T, x0, y0, pw, ph, fmax, sc);
  const yOf = f => y0 + fracOf(f, fmax, sc) * ph;
  const a = d.annotations, edge = d.thresholds.oob_edge_hz;
  // measured band shading
  if (edge < fmax) { ctx.fillStyle = "rgba(248,113,113,.07)"; ctx.fillRect(x0, y0, pw, yOf(edge) - y0); }
  // frequency axis
  ctx.font = "11px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  freqTicks(fmax, sc).forEach(f => { const y = yOf(f); if (y < y0 - 1 || y > y0 + ph + 1) return;
    ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + pw, y); ctx.stroke();
    ctx.fillStyle = AX; ctx.fillText(kHz(f), x0 - 8, y); });
  ctx.save(); ctx.translate(12, y0 + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillStyle = "rgba(109,122,147,.9)"; ctx.fillText("frequency (Hz)", 0, 0); ctx.restore();
  // time axis
  const dur = sp.dur_s || d.duration_sec, st = niceStep(dur, 6);
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let t = 0; t <= dur + 1e-9; t += st) { const x = x0 + (t / dur) * pw;
    ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.moveTo(x, y0 + ph); ctx.lineTo(x, y0 + ph + 4); ctx.stroke();
    ctx.fillStyle = AX; ctx.fillText(t.toFixed(st < 1 ? 1 : 0) + " s", x, y0 + ph + 8); }
  // annotations
  let edgeY = null;
  if (edge < fmax) { edgeY = yOf(edge); ctx.strokeStyle = "#f87171"; ctx.lineWidth = 1.4; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(x0, edgeY); ctx.lineTo(x0 + pw, edgeY); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; }
  if (carrierFound(d) && a.carrier_peak_hz < fmax) {
    const y = yOf(a.carrier_peak_hz); ctx.strokeStyle = "rgba(251,191,36,.9)"; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + pw, y); ctx.stroke();
    let py = y; if (edgeY != null && Math.abs(py - edgeY) < 24) py = edgeY - 24;
    pill(ctx, `carrier ${(a.carrier_peak_hz / 1000).toFixed(2)} kHz`, x0 + pw - 8, Math.max(y0 + 12, py - 14), "#fbbf24");
  }
  if (edgeY != null) pill(ctx, "18 kHz edge", x0 + pw - 8, Math.min(y0 + ph - 12, edgeY + 14), "#f87171");
  // colour bar
  const cbx = W - R + 16, cbw = 11, g = ctx.createLinearGradient(0, y0 + ph, 0, y0);
  for (let i = 0; i <= 10; i++) { const v = Math.round(i * 25.5); g.addColorStop(i / 10, `rgb(${LUT[v * 3]},${LUT[v * 3 + 1]},${LUT[v * 3 + 2]})`); }
  ctx.fillStyle = g; roundRect(ctx, cbx, y0, cbw, ph, 4); ctx.fill();
  ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = AX; ctx.font = "10.5px Inter";
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
$$("#scaleSeg button").forEach(b => b.onclick = () => {
  $$("#scaleSeg button").forEach(x => x.classList.toggle("on", x === b)); state.scale = b.dataset.s; if (state.data) drawSpectrogram(state.data);
});
function drawOverview(d) {
  const { ctx, W, H } = fit($("#ov")), env = d.waveform, L = 50, R = 64, pw = W - L - R, mid = H / 2, n = env.length, col = VERDICT[d.verdict].hex;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,.025)"; roundRect(ctx, L, 0, pw, H, 8); ctx.fill();
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, col + "cc"); g.addColorStop(.5, col + "55"); g.addColorStop(1, col + "cc");
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(L, mid);
  for (let i = 0; i < n; i++) ctx.lineTo(L + i / (n - 1) * pw, mid - env[i] * (H * .44));
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(L + i / (n - 1) * pw, mid + env[i] * (H * .44));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(109,122,147,.9)"; ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText("level", L - 8, mid);
  // mark worst window
  const w = d.windows; if (w && w.length > 1) { let worst = w[0]; w.forEach(x => { if (RANK[x.verdict] > RANK[worst.verdict] || (x.verdict === worst.verdict && x.overall_risk > worst.overall_risk)) worst = x; });
    const dur = d.duration_sec, x = L + worst.start_sec / dur * pw, ww = Math.min(1, dur) / dur * pw;
    ctx.strokeStyle = VERDICT[worst.verdict].hex; ctx.lineWidth = 1.5; roundRect(ctx, x + .75, 1, ww - 1.5, H - 2, 6); ctx.stroke(); ctx.lineWidth = 1; }
}
function drawPSD(d) {
  const { ctx, W, H } = fit($("#psd")), L = 40, R = 10, T = 8, B = 24, ps = d.psd, fs = ps.freqs_hz, db = ps.psd_db, fmax = fs[fs.length - 1];
  ctx.clearRect(0, 0, W, H); if (!fs.length) return;
  let lo = Math.min(...db), hi = Math.max(...db); lo = Math.floor(lo / 10) * 10; hi = Math.ceil(hi / 10) * 10;
  const X = f => L + f / fmax * (W - L - R), Y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B), edge = d.thresholds.oob_edge_hz;
  ctx.font = "10.5px Inter"; ctx.fillStyle = AX;
  const ys = niceStep(hi - lo, 4); ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let v = lo; v <= hi; v += ys) { ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke(); ctx.fillText(v, L - 6, Y(v)); }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  freqTicks(fmax, "lin").forEach(f => ctx.fillText(kHz(f), X(f), H - B + 7));
  if (edge < fmax) { ctx.fillStyle = "rgba(248,113,113,.07)"; ctx.fillRect(X(edge), T, X(fmax) - X(edge), H - T - B); }
  const g = ctx.createLinearGradient(0, T, 0, H - B); g.addColorStop(0, "rgba(76,195,255,.30)"); g.addColorStop(1, "rgba(76,195,255,0)");
  ctx.beginPath(); fs.forEach((f, i) => i ? ctx.lineTo(X(f), Y(db[i])) : ctx.moveTo(X(f), Y(db[i])));
  ctx.strokeStyle = "#4cc3ff"; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.lineTo(X(fmax), H - B); ctx.lineTo(X(0), H - B); ctx.closePath(); ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1;
  if (edge < fmax) { ctx.strokeStyle = "#f87171"; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(X(edge), T); ctx.lineTo(X(edge), H - B); ctx.stroke(); ctx.setLineDash([]); }
  const fc = carrierFound(d) ? d.annotations.carrier_peak_hz : null;
  if (fc) { let i = 0; while (i < fs.length - 1 && fs[i] < fc) i++;
    ctx.fillStyle = "#fbbf24"; ctx.beginPath(); ctx.arc(X(fc), Y(db[i]), 4, 0, 7); ctx.fill(); }
}
function drawTimeline(d) {
  const { ctx, W, H } = fit($("#tl")), L = 30, R = 8, T = 8, B = 22, t = d.thresholds;
  ctx.clearRect(0, 0, W, H);
  const w = d.windows.length ? d.windows : [{ start_sec: 0, verdict: d.verdict, overall_risk: d.overall_risk }];
  const dur = Math.max(d.duration_sec, 1e-3), Y = v => T + (1 - v) * (H - T - B), X = s => L + s / dur * (W - L - R);
  ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  [[0, "0"], [t.suspicious_risk, ".33"], [t.high_risk, ".66"], [1, "1"]].forEach(([v, l]) => {
    ctx.strokeStyle = v === 0 || v === 1 ? GRID : "rgba(255,255,255,.16)"; ctx.setLineDash(v === 0 || v === 1 ? [] : [3, 4]);
    ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke(); ctx.fillStyle = AX; ctx.fillText(l, L - 6, Y(v)); });
  ctx.setLineDash([]);
  const win = Math.min(1, dur), bw = Math.max(4, X(Math.min(.5, dur)) - X(0) - 3);
  let worst = w[0]; w.forEach(x => { if (RANK[x.verdict] > RANK[worst.verdict] || (x.verdict === worst.verdict && x.overall_risk > worst.overall_risk)) worst = x; });
  w.forEach(x => { const h = x.verdict === "INSUFFICIENT_DATA" ? .1 : Math.max(.03, x.overall_risk), cx = X(x.start_sec + win / 2);
    ctx.fillStyle = VERDICT[x.verdict].hex; ctx.globalAlpha = x === worst ? 1 : .55; roundRect(ctx, cx - bw / 2, Y(h), bw, Y(0) - Y(h), 3); ctx.fill(); ctx.globalAlpha = 1; });
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = AX;
  const st = niceStep(dur, 5); for (let s = 0; s <= dur + 1e-9; s += st) ctx.fillText(s.toFixed(st < 1 ? 1 : 0) + " s", X(s), H - B + 7);
  $("#tlNote").textContent = `${w.length} window${w.length > 1 ? "s" : ""} of 1 s · worst at ${worst.start_sec.toFixed(1)} s (${VERDICT[worst.verdict].label.toLowerCase()}, risk ${worst.overall_risk.toFixed(2)})`;
}
function drawDecisionMap(d) {
  const c = $("#dmap"), { ctx, W, H } = fit(c), L = 40, R = 12, T = 10, B = 34, pw = W - L - R, ph = H - T - B, t = d.thresholds;
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
  ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.strokeRect(L + .5, T + .5, pw - 1, ph - 1);
  ctx.fillStyle = AX; ctx.font = "10.5px Inter"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  [0, .5, 1].forEach(v => ctx.fillText(v, X(v), T + ph + 6));
  ctx.fillText("ρA  out-of-band energy", L + pw / 2, T + ph + 19);
  ctx.textAlign = "right"; ctx.textBaseline = "middle"; [0, .5, 1].forEach(v => ctx.fillText(v, L - 6, Y(v)));
  ctx.save(); ctx.translate(11, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText("ρB  carrier", 0, 0); ctx.restore();
  const oob = ev(d, "out_of_band_energy"), car = ev(d, "carrier_peak");
  if (!oob || !oob.assessable) {
    ctx.fillStyle = "rgba(6,10,18,.7)"; ctx.fillRect(L, T, pw, ph); ctx.fillStyle = "#a9b4c8"; ctx.font = "12.5px Inter";
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("Not assessable at this sample rate", L + pw / 2, T + ph / 2); return; }
  const px = X(oob.risk), py = Y(car ? car.risk : 0), col = VERDICT[d.verdict].hex;
  const rg = ctx.createRadialGradient(px, py, 0, px, py, 22); rg.addColorStop(0, col + "aa"); rg.addColorStop(1, col + "00");
  ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(px, py, 22, 0, 7); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
}

/* ---- gate ---- */
$$(".gopt").forEach(o => o.onclick = () => $$(".gopt").forEach(x => x.classList.toggle("on", x === o)));
$("#gateBtn").onclick = async () => {
  if (!state.blob) return;
  const fd = new FormData(); fd.append("file", state.blob, state.name || "clip.wav"); fd.append("action", $(".gopt.on").dataset.a); fd.append("window", "1.0");
  $("#gateBtn").disabled = true;
  try {
    const r = await fetch("/api/gate", { method: "POST", body: fd }); const d = await r.json();
    if (!r.ok) throw new Error(d.detail || r.statusText);
    $("#gateOut").innerHTML = `<div class="gres"><span class="big g-${d.decision}">${d.decision.toUpperCase()}</span><p>${d.reason}</p></div>`;
  } catch (e) { $("#gateOut").innerHTML = `<div class="err">${e.message}</div>`; }
  $("#gateBtn").disabled = false;
};

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
  // voice band-limit: two one-pole low-passes (~12 dB/oct above 5.5 kHz) so the synthetic
  // voice rolls off like real speech instead of flooding the ultrasonic band with noise
  const aLP = Math.exp(-2 * Math.PI * 4500 / sr), lps = [0, 0, 0, 0];   // 4 poles: ~24 dB/oct above 4.5 kHz
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
        for (let k = 0; k < 3; k++) { const c = g.co[k]; const yk = c.b0 * x + c.b2 * c.x2 - c.a1 * c.y1 - c.a2 * c.y2;
          c.x2 = c.x1; c.x1 = x; c.y2 = c.y1; c.y1 = yk; y += GAIN[k] * yk; }
        y *= env;
      } else { const w = rnd(); y = (.7 * w + .3 * prev) * .22 * env; prev = w; }   // fricative: noise, not a differentiator
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
  const room = speech(sr, secs, seed + 11);                       // someone talking near the device
  if (kind === "benign") return { sr, x: room };
  const n = room.length, x = new Float32Array(n);
  if (kind === "beacon") {
    for (let i = 0; i < n; i++) x[i] = .7 * room[i] + .16 * Math.sin(2 * Math.PI * 19000 * i / sr) * (1 + .003 * Math.sin(2 * Math.PI * .4 * i / sr));
    return { sr, x: norm(x, .9) };
  }
  const cmd = speech(sr, secs, seed + 101);                        // the injected "command" envelope (no words)
  if (kind === "phone") {                                          // ADC removed the carrier; only the demodulated ghost remains
    for (let i = 0; i < n; i++) x[i] = .7 * room[i] + .22 * cmd[i];
    return { sr, x: norm(x, .9) };
  }
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

/* ---- sample cards with live thumbnails ---- */
const DEMO_NAMES = { attack: "ultrasonic_injection_48k.wav", benign: "clean_speech_48k.wav", beacon: "retail_beacon_19k.wav", phone: "phone_capture_16k.wav" };
const demoCache = {};
async function loadDemo(kind) {
  if (!demoCache[kind]) { const { sr, x } = demoAudio(kind); const blob = encodeWAV(x, sr);
    demoCache[kind] = { blob, data: await scanBlob(blob, DEMO_NAMES[kind]) }; }
  return demoCache[kind];
}
async function initSamples() {
  for (const card of $$(".sample")) {
    const kind = card.dataset.demo;
    card.onclick = async () => { card.style.opacity = .6; const c = await loadDemo(kind); card.style.opacity = 1; analyzeBlob(c.blob, DEMO_NAMES[kind], c.data); };
    try { const c = await loadDemo(kind); const cv = card.querySelector("canvas"), { ctx, W, H } = fit(cv);
      const sp = c.data.spectrogram; paintGrid(ctx, decodeGrid(sp), sp.shape[0], sp.shape[1], 0, 0, W, H, sp.fmax_hz, "lin");
      if (sp.fmax_hz > 18000) { const y = (1 - 18000 / sp.fmax_hz) * H; ctx.strokeStyle = "#f87171"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    } catch { /* engine offline: card still clickable */ }
  }
}

/* ============================================================ inputs: upload, drag, record */
const fileIn = $("#fileIn");
fileIn.onchange = () => { const f = fileIn.files[0]; if (f) analyzeBlob(f, f.name); fileIn.value = ""; };
function dropTarget(el, onFiles, pick) {
  ["dragenter", "dragover"].forEach(t => el.addEventListener(t, e => { e.preventDefault(); el.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => el.addEventListener(t, e => { e.preventDefault(); el.classList.remove("over"); }));
  el.addEventListener("drop", e => onFiles(e.dataTransfer.files));
  el.addEventListener("click", e => { if (!e.target.closest("button")) pick(); });
}
dropTarget($("#dz"), fs => fs[0] && analyzeBlob(fs[0], fs[0].name), () => fileIn.click());
document.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "upload") fileIn.click();
  if (a === "record") toggleRecord();
  if (a === "new") { $("#a-main").classList.add("hidden"); $("#a-empty").classList.remove("hidden"); state.data = null; show("analyze"); }
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
    if (tot < m.sr * .3) { $("#aErr").textContent = "Recording too short."; return; }
    return analyzeBlob(encodeWAV(x, m.sr), "recording.wav");
  }
  try { rec = await openMic(); } catch (e) { $("#aErr").textContent = "Microphone unavailable: " + e.message; return; }
  rec.chunks = []; rec.pn.onaudioprocess = e => rec && rec.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  btns.forEach(b => { b.classList.add("on"); b.querySelector(".rl").textContent = `Stop · ${(rec.sr / 1000).toFixed(1)} kHz`; });
}

/* ============================================================ live monitor */
const live = { src: null, mic: null, sim: null, hist: [], unseen: 0, busy: false, wf: null, wfF: 240, fmax: 24000, cols: 2400, per: 40 };
function resetLive() {
  live.hist = []; live.unseen = 0; $("#lLog").innerHTML = '<div class="faint ph">No events yet.</div>';
  live.wf = document.createElement("canvas"); live.wf.width = live.cols; live.wf.height = live.wfF;
  const c = live.wf.getContext("2d"); c.fillStyle = "#04060c"; c.fillRect(0, 0, live.cols, live.wfF);
  $("#lN").textContent = 0; $("#lF").textContent = 0; drawWaterfall(); drawStrip();
}
function setLiveState(on, label, rate) {
  $("#lDot").classList.toggle("on", on); $("#lState").textContent = label; $("#lRate").textContent = rate || "—";
  $("#liveBtn").innerHTML = live.mic ? 'Stop microphone' : '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>Start microphone';
  $("#simBtn").innerHTML = live.sim ? 'Stop simulation' : '<svg viewBox="0 0 24 24"><path d="M5 4l14 8-14 8z"/></svg>Simulated stream';
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
  const tick = () => { const p = k % 30, kind = p >= 12 && p <= 15 ? "attack" : p === 22 ? "beacon" : "benign";
    const { sr, x } = demoAudio(kind, 1.0, 1000 + k); k++; if (!live.busy) liveScore(x, sr); };
  tick(); live.sim = setInterval(tick, 1000);
};
async function liveScore(x, sr) {
  live.busy = true;
  try { const d = await scanBlob(encodeWAV(x, sr), "live.wav", "0"); if (live.mic || live.sim) liveAdd(d); }
  catch (e) { $("#lNote").textContent = "Scan failed: " + e.message; }
  live.busy = false;
}
function liveAdd(d) {
  const now = new Date().toLocaleTimeString([], { hour12: false }), v = VERDICT[d.verdict];
  live.hist.push({ v: d.verdict, r: d.overall_risk, t: now }); if (live.hist.length > 60) live.hist.shift();
  // waterfall: append this window's spectrogram, resampled to live.per columns
  const sp = d.spectrogram, [F, T] = sp.shape, g = decodeGrid(sp); live.fmax = sp.fmax_hz;
  const wc = live.wf.getContext("2d"); wc.drawImage(live.wf, -live.per, 0);
  const img = wc.createImageData(live.per, live.wfF), dd = img.data;
  for (let r = 0; r < live.wfF; r++) { const sr_ = Math.min(F - 1, Math.round(r / (live.wfF - 1) * (F - 1)));
    for (let c = 0; c < live.per; c++) { const sc = Math.min(T - 1, Math.floor(c / live.per * T)), val = g[sr_ * T + sc], o = (r * live.per + c) * 4;
      dd[o] = LUT[val * 3]; dd[o + 1] = LUT[val * 3 + 1]; dd[o + 2] = LUT[val * 3 + 2]; dd[o + 3] = 255; } }
  wc.putImageData(img, live.cols - live.per, 0);
  // gauge + counters
  const arc = $("#lArc"); arc.setAttribute("stroke", v.hex); arc.setAttribute("stroke-dasharray", `${(75 * d.overall_risk).toFixed(1)} 100`);
  $("#lRisk").textContent = d.overall_risk.toFixed(2); $("#lRisk").style.color = v.hex;
  $("#lTag").className = "tag t-" + d.verdict; $("#lTagT").textContent = v.label;
  const flags = live.hist.filter(x => x.v === "SUSPICIOUS" || x.v === "HIGH_RISK").length;
  $("#lN").textContent = live.hist.length; $("#lF").textContent = flags;
  if (d.verdict === "SUSPICIOUS" || d.verdict === "HIGH_RISK") {
    if ($("#lLog .ph")) $("#lLog").innerHTML = "";
    const fc = carrierFound(d) ? d.annotations.carrier_peak_hz : null;
    $("#lLog").insertAdjacentHTML("afterbegin", `<div class="e"><span class="t">${now}</span><div><span class="tag t-${d.verdict}" style="height:20px;font-size:11px"><span class="d"></span>${v.label}</span>
      <div class="faint" style="margin-top:4px">risk ${d.overall_risk.toFixed(2)}${fc ? ` · carrier ${(fc / 1000).toFixed(1)} kHz` : ""}${d.annotations.carrier_sideband_db != null ? ` · sidebands ${d.annotations.carrier_sideband_db.toFixed(0)} dB` : ""}</div></div></div>`);
    if (!$("#v-live").classList.contains("on")) { live.unseen++; updateBadge(); }
  }
  drawWaterfall(); drawStrip();
}
function updateBadge() { const b = $("#liveBadge"); b.textContent = live.unseen; b.classList.toggle("hidden", !live.unseen); }
function drawWaterfall() {
  const c = $("#wf"); if (!c.offsetParent) return; const { ctx, W, H } = fit(c), L = 46, R = 8, T = 6, B = 22, pw = W - L - R, ph = H - T - B;
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#04060c"; ctx.fillRect(L, T, pw, ph);
  if (live.wf) { ctx.imageSmoothingEnabled = true; ctx.drawImage(live.wf, L, T, pw, ph); }
  const fmax = live.fmax, yOf = f => T + (1 - f / fmax) * ph;
  ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  freqTicks(fmax, "lin").forEach(f => { const y = yOf(f); ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.fillStyle = AX; ctx.fillText(kHz(f), L - 7, y); });
  if (fmax > 18000) { const y = yOf(18000); ctx.strokeStyle = "#f87171"; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke(); ctx.setLineDash([]); }
  ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillStyle = AX;
  [60, 45, 30, 15, 0].forEach(s => ctx.fillText(s ? `−${s} s` : "now", L + (1 - s / 60) * pw, T + ph + 6));
  if (!live.hist.length) { ctx.fillStyle = "rgba(169,180,200,.6)"; ctx.font = "13px Inter"; ctx.textBaseline = "middle"; ctx.fillText("Waiting for audio", L + pw / 2, T + ph / 2); }
}
function drawStrip() {
  const c = $("#ls"); if (!c.offsetParent) return; const { ctx, W, H } = fit(c), L = 46, R = 8, T = 6, B = 6, pw = W - L - R, ph = H - T - B;
  ctx.clearRect(0, 0, W, H); const Y = v => T + (1 - v) * ph;
  ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  [[0, "0"], [.33, ".33"], [.66, ".66"], [1, "1"]].forEach(([v, l]) => { ctx.strokeStyle = v % 1 ? "rgba(255,255,255,.16)" : GRID; ctx.setLineDash(v % 1 ? [3, 4] : []);
    ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(L + pw, Y(v)); ctx.stroke(); ctx.fillStyle = AX; ctx.fillText(l, L - 7, Y(v)); });
  ctx.setLineDash([]); const bw = pw / 60;
  live.hist.forEach((x, i) => { const j = 60 - live.hist.length + i, h = x.v === "INSUFFICIENT_DATA" ? .08 : Math.max(.03, x.r);
    ctx.fillStyle = VERDICT[x.v].hex; ctx.globalAlpha = .85; roundRect(ctx, L + j * bw + 1, Y(h), Math.max(1, bw - 2), Y(0) - Y(h), 2); ctx.fill(); ctx.globalAlpha = 1; });
}

/* ============================================================ batch */
const batch = { rows: [], sortK: "risk", dir: -1, filter: "all" };
const batchIn = $("#batchIn");
batchIn.onchange = () => { batchAdd(batchIn.files); batchIn.value = ""; };
dropTarget($("#bdz"), batchAdd, () => batchIn.click());
async function batchAdd(files) {
  const list = [...files].filter(f => /\.wav$/i.test(f.name));
  const rows = list.map(f => ({ name: f.name, file: f, verdict: null, risk: -1 }));
  batch.rows.push(...rows); renderBatch();
  for (const r of rows) {
    try { const d = await scanBlob(r.file, r.name); Object.assign(r, { verdict: d.verdict, risk: d.overall_risk, sr: d.sample_rate, dur: d.duration_sec,
      oob: d.annotations.oob_ratio, car: carrierFound(d) ? d.annotations.carrier_peak_hz : null, data: d }); }
    catch (e) { r.verdict = "ERROR"; r.err = e.message; }
    renderBatch();
  }
}
$$("#v-batch th").forEach(th => th.onclick = () => { const k = th.dataset.k; batch.dir = batch.sortK === k ? -batch.dir : -1; batch.sortK = k; renderBatch(); });
$$("#bFilter button").forEach(b => b.onclick = () => { $$("#bFilter button").forEach(x => x.classList.toggle("on", x === b)); batch.filter = b.dataset.f; renderBatch(); });
$("#clearBtn").onclick = () => { batch.rows = []; renderBatch(); };
$("#csvBtn").onclick = () => {
  if (!batch.rows.length) return;
  const lines = ["file,verdict,risk,sample_rate_hz,duration_s,oob_ratio,carrier_hz"];
  batch.rows.forEach(r => lines.push([`"${r.name.replace(/"/g, '""')}"`, r.verdict || "", r.risk >= 0 ? r.risk : "", r.sr || "", r.dur ?? "", r.oob ?? "", r.car ?? ""].join(",")));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = "echoguard_batch.csv"; a.click();
};
function renderBatch() {
  const R = batch.rows, done = R.filter(r => r.verdict && r.verdict in VERDICT), cnt = v => done.filter(r => r.verdict === v).length;
  $("#bCount").textContent = `${R.length} file${R.length === 1 ? "" : "s"}${R.length > done.length ? ` · ${R.length - done.length} pending` : ""}`;
  $("#kpis").innerHTML = [["Scored", done.length, "var(--text)"], ["Clear", cnt("CLEAR"), "var(--ok)"], ["Suspicious", cnt("SUSPICIOUS"), "var(--warn)"],
    ["High risk", cnt("HIGH_RISK"), "var(--bad)"], ["Insufficient data", cnt("INSUFFICIENT_DATA"), "var(--na)"]]
    .map(([k, v, c]) => `<div class="kpi"><div class="k">${k}</div><div class="v" style="color:${c}">${v}</div></div>`).join("");
  const f = batch.filter, keep = r => f === "all" || (f === "flag" ? (r.verdict === "SUSPICIOUS" || r.verdict === "HIGH_RISK") : r.verdict === f);
  const key = r => batch.sortK === "verdict" ? (RANK[r.verdict] ?? -1) : batch.sortK === "name" ? r.name.toLowerCase() : (r[batch.sortK] ?? -1);
  const rows = R.filter(keep).sort((a, b) => { const x = key(a), y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * batch.dir; });
  if (!R.length) { $("#bBody").innerHTML = `<tr><td colspan="7" class="faint" style="padding:28px;text-align:center;cursor:default">No files yet — drop some WAVs above.</td></tr>`; return; }
  const ic = `<svg viewBox="0 0 24 24"><path d="M3 12h2l2-5 3 10 2.5-7 2 4H21"/></svg>`;
  $("#bBody").innerHTML = rows.map(r => {
    const i = R.indexOf(r), V = VERDICT[r.verdict];
    const vcell = !r.verdict ? `<span class="spin"></span>` : V ? `<span class="tag t-${r.verdict}"><span class="d"></span>${V.label}</span>` : `<span class="err" style="margin:0">${r.err || "error"}</span>`;
    const risk = r.risk >= 0 ? `<div class="rbar"><i><u style="width:${r.risk * 100}%;background:${V.hex}"></u></i>${r.risk.toFixed(2)}</div>` : "—";
    return `<tr data-i="${i}"><td><div class="fname">${ic}${r.name}</div></td><td>${vcell}</td><td class="n">${risk}</td>
      <td class="n">${r.sr ? (r.sr / 1000).toFixed(1) + " kHz" : "—"}</td><td class="n">${r.dur != null ? r.dur.toFixed(2) + " s" : "—"}</td>
      <td class="n">${r.oob != null ? (r.oob * 100).toFixed(r.oob < .01 ? 2 : 1) + "%" : "—"}</td><td class="n">${r.car ? (r.car / 1000).toFixed(2) + " kHz" : "—"}</td></tr>`;
  }).join("");
  $$("#bBody tr[data-i]").forEach(tr => tr.onclick = () => { const r = R[+tr.dataset.i]; if (r.data) analyzeBlob(r.file, r.name, r.data); });
}

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
$("#classes").innerHTML = CLASSES.map(([t, s, p, chips]) =>
  `<div class="cls"><h4>${t}</h4><div class="faint" style="font-size:12px;margin-bottom:6px">${s}</div><p>${p}</p><div class="row">${chips.map(([c, k]) => `<span class="chip ${k}">${c}</span>`).join("")}</div></div>`).join("");
function drawCoverage() {
  const c = $("#cbar"); if (!c.offsetParent) return; const { ctx, W, H } = fit(c), L = 36, R = 10, T = 22, B = 40, pw = W - L - R, ph = H - T - B;
  const data = [["No ADC · raw 192 kHz", 100, "#4cc3ff"], ["ADC → 48 kHz", 33, "#fbbf24"], ["ADC → 44.1 kHz", 8, "#fbbf24"], ["ADC → 16 kHz", 0, "#8b9ab3"]];
  ctx.clearRect(0, 0, W, H); ctx.font = "10.5px Inter"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  [0, 50, 100].forEach(v => { const y = T + (1 - v / 100) * ph; ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke(); ctx.fillStyle = AX; ctx.fillText(v + "%", L - 6, y); });
  const bw = pw / data.length;
  data.forEach(([l, v, col], i) => { const x = L + i * bw + bw * .2, w = bw * .6, h = Math.max(2, ph * v / 100), y = T + ph - h;
    const g = ctx.createLinearGradient(0, y, 0, T + ph); g.addColorStop(0, col); g.addColorStop(1, col + "44");
    ctx.fillStyle = g; roundRect(ctx, x, y, w, h, 5); ctx.fill();
    ctx.fillStyle = "#e9eef8"; ctx.font = "600 13px Inter"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText(v ? v + "%" : "no verdict", x + w / 2, y - 6);
    ctx.fillStyle = AX; ctx.font = "11px Inter"; ctx.textBaseline = "top"; ctx.fillText(l, x + w / 2, T + ph + 9); });
}

/* ============================================================ misc */
$$(".copy").forEach(b => b.onclick = e => { e.stopPropagation(); const txt = b.parentElement.childNodes[0].textContent.trim();
  navigator.clipboard?.writeText(txt).then(() => { b.textContent = "Copied"; setTimeout(() => b.textContent = "Copy", 1200); }); });

health(); resetLive(); renderBatch(); initSamples();
