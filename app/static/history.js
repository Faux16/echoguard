/* EchoGuard Console — History analysis.
   Everything here is derived from what each stored capture already holds: the engine's verdict and risk,
   each detector's risk and evidence (out-of-band share and level, carrier frequency, prominence, narrowness,
   sidebands, spectral roll-off) and the per-window risks. Nothing is re-scored and nothing is estimated. */
"use strict";

const HX = { pts: [], hover: null };
const THR = () => engine.info?.thresholds || { suspicious_risk: .33, high_risk: .66 };

/* ------------------------------------------------------------ per-capture measurements */
function hxM(r) {
  const f = r.data?.findings || [], by = n => f.find(x => x.name === n) || {};
  const a = by("out_of_band_energy"), b = by("carrier_peak"), p = by("spectral_profile"), ae = a.evidence || {}, be = b.evidence || {}, pe = p.evidence || {};
  return { ok: r.verdict !== "INSUFFICIENT_DATA", ra: a.risk ?? 0, rb: b.risk ?? 0, rp: p.risk ?? 0,
    oob: ae.out_of_band_ratio ?? r.oob, lvl: ae.out_of_band_level_dbfs, peak: be.peak_freq_hz ?? null, prom: be.prominence_db ?? null,
    narrow: be.narrowness ?? null, sb: be.sideband_db ?? null, roll: pe.rolloff_99_hz ?? null };
}
const fired = x => x >= THR().suspicious_risk;
const tonal = m => m.peak && m.prom != null && m.prom >= 10;
function setFacet(label, test) {
  hist.facet = { label, test }; hist.sel = null; hist.filter = "all"; $$("#hFilter button").forEach(b => b.classList.toggle("on", b.dataset.f === "all"));
  renderHistory(); $("#hExplorer").scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ------------------------------------------------------------ findings: plain-language observations */
function hxInsights(H) {
  const out = [], T = THR(), M = new Map(H.map(r => [r.id, hxM(r)]));
  const flagged = H.filter(r => isFlag(r.verdict)), na = H.filter(r => r.verdict === "INSUFFICIENT_DATA");
  // 1. one emitter? carriers of flagged captures that cluster
  const cars = flagged.map(r => ({ r, f: M.get(r.id).peak || r.car })).filter(x => x.f);
  if (cars.length) {
    const groups = []; cars.sort((a, b) => a.f - b.f).forEach(x => { const g = groups.find(g => Math.abs(g.f - x.f) <= 300); if (g) { g.n.push(x.r); g.f = (g.f * (g.n.length - 1) + x.f) / g.n.length; } else groups.push({ f: x.f, n: [x.r] }); });
    groups.sort((a, b) => b.n.length - a.n.length); const g = groups[0];
    out.push({ k: "bad", i: "warn", t: g.n.length > 1 ? `${g.n.length} flagged captures share a carrier near ${(g.f / 1000).toFixed(1)} kHz` : `One flagged capture, carrier at ${(g.f / 1000).toFixed(1)} kHz`,
      d: g.n.length > 1 ? `Same frequency within 0.3 kHz${groups.length > 1 ? `; ${groups.length - 1} other carrier group${groups.length > 2 ? "s" : ""}` : ""}. Likely one emitter or one test set-up.` : "Check where and when it was recorded.",
      f: () => setFacet(`carrier ≈ ${(g.f / 1000).toFixed(1)} kHz`, r => g.n.includes(r)) });
  } else out.push({ k: "ok", i: "check", t: "Nothing flagged", d: "No capture carries both injection signatures.", f: null });
  // 2. could not check
  if (na.length) { const rates = [...new Set(na.map(r => (r.sr / 1000).toFixed(r.sr % 1000 ? 1 : 0) + " kHz"))].join(", ");
    out.push({ k: "na", i: "info", t: `${na.length} capture${na.length > 1 ? "s" : ""} could not be checked`, d: `Recorded at ${rates}: too low a sample rate to contain the ultrasonic band. Re-record at 44.1 kHz or more; until then treat them as unverified, not clean.`, f: () => setFacet("could not be checked", r => r.verdict === "INSUFFICIENT_DATA") }); }
  // 3. false-positive control: energy or tone present but no modulation
  const tones = H.filter(r => r.verdict === "CLEAR" && (fired(M.get(r.id).ra) || tonal(M.get(r.id))));
  if (tones.length) out.push({ k: "ok", i: "check", t: `${tones.length} tone${tones.length > 1 ? "s" : ""} or beacon${tones.length > 1 ? "s" : ""} correctly cleared`, d: "High-frequency energy or a steady tone, but no speech-band sidebands: the second signature is missing, so they are not treated as commands.", f: () => setFacet("tones and beacons cleared", r => tones.includes(r)) });
  // 4. borderline
  const near = H.filter(r => r.verdict !== "INSUFFICIENT_DATA" && r.risk != null && [T.suspicious_risk, T.high_risk].some(t => Math.abs(r.risk - t) <= .06));
  if (near.length) out.push({ k: "warn", i: "search", t: `${near.length} borderline capture${near.length > 1 ? "s" : ""}`, d: `Risk within 0.06 of a threshold. Worth a second recording or a look at the window timeline.`, f: () => setFacet("borderline (±0.06 of a threshold)", r => near.includes(r)) });
  // 5. what the agent would do
  const P = activePolicy(), crit = { allow: 0, confirm: 0, block: 0 }; H.forEach(r => { const d = P.critical?.[r.verdict]; if (d in crit) crit[d]++; });
  out.push({ k: "acc", i: "policies", t: `As critical commands: ${crit.block} blocked, ${crit.confirm} confirmed, ${crit.allow} allowed`, d: `Under the ${prefs.policy ? prefs.policyName : "default"} gate policy. Change it in Gate policies.`, f: () => go("policies") });
  // 6. peak
  const top = H.filter(r => r.risk != null && r.verdict !== "INSUFFICIENT_DATA").sort((a, b) => b.risk - a.risk)[0];
  if (top && isFlag(top.verdict)) out.push({ k: "bad", i: "spark", t: `Highest risk: ${top.risk.toFixed(2)}`, d: `${top.name} · ${fmtWhen(top.ts)}`, f: () => { hist.facet = null; hist.sel = top.id; renderHistory(); $("#hExplorer").scrollIntoView({ behavior: "smooth" }); } });
  return out;
}

/* ------------------------------------------------------------ charts */
function hxMap() {
  const c = $("#hxMap"); if (!c || !c.offsetParent) return;
  const { ctx, W, H } = fit(c), L = 40, R = 14, T = 12, B = 34, pw = W - L - R, ph = H - T - B, X = v => L + v * pw, Y = v => T + (1 - v) * ph, t = THR();
  ctx.clearRect(0, 0, W, H); const ax = AX(), gr = GRID();
  // zones: the region where √(ρA·ρB) ≥ threshold
  const zone = (thr, col) => { ctx.beginPath(); ctx.moveTo(X(1), Y(1)); for (let i = 0; i <= 60; i++) { const x = thr * thr + (1 - thr * thr) * i / 60; ctx.lineTo(X(x), Y(Math.min(1, thr * thr / x))); } ctx.lineTo(X(1), Y(1)); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
  zone(t.suspicious_risk, cssVar("--warn-soft")); zone(t.high_risk, cssVar("--bad-soft"));
  ctx.font = "10.5px Helvetica"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  [0, .25, .5, .75, 1].forEach(v => { ctx.strokeStyle = gr; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(L + pw, Y(v)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(X(v), T); ctx.lineTo(X(v), T + ph); ctx.stroke(); ctx.fillStyle = ax; ctx.fillText(v.toFixed(2).replace(/0$/, ""), L - 6, Y(v)); ctx.textAlign = "center"; ctx.fillText(v.toFixed(2).replace(/0$/, ""), X(v), T + ph + 12); ctx.textAlign = "right"; });
  [[t.suspicious_risk, "--warn"], [t.high_risk, "--bad"]].forEach(([thr, col]) => { ctx.strokeStyle = cssVar(col); ctx.setLineDash([4, 4]); ctx.beginPath(); for (let i = 0; i <= 80; i++) { const x = thr * thr + (1 - thr * thr) * i / 80, y = Math.min(1, thr * thr / x); i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y)); } ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = cssVar(col); ctx.textAlign = "left"; ctx.fillText(`R = ${thr}`, X(Math.min(.97, thr * thr / .97)) + 6, Y(.97)); });
  ctx.fillStyle = ax; ctx.textAlign = "center"; ctx.fillText("ρA · energy above 18 kHz", L + pw / 2, H - 6);
  ctx.save(); ctx.translate(11, T + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("ρB · modulated carrier", 0, 0); ctx.restore();
  ctx.fillStyle = TXT3(); ctx.font = "11px Helvetica"; ctx.textAlign = "left"; ctx.fillText("speech", X(.02), Y(.06)); ctx.textAlign = "right"; ctx.fillText("energy, no modulation → tone or beacon", X(.98), Y(.06)); ctx.fillText("both signatures → injection", X(.98), Y(.93) + 14);
  // points, with a deterministic jitter so identical captures stay visible
  const hash = s => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; };
  HX.pts = history.filter(r => r.verdict !== "INSUFFICIENT_DATA").map(r => { const m = hxM(r), h = hash(r.id), jx = ((h & 255) / 255 - .5) * .035, jy = (((h >> 8) & 255) / 255 - .5) * .035;
    return { r, m, x: X(Math.max(0, Math.min(1, m.ra + jx))), y: Y(Math.max(0, Math.min(1, m.rb + jy))) }; });
  // stacked captures: a count badge where several land on the same spot
  const cl = new Map(); HX.pts.forEach(p => { const k = Math.round(p.m.ra * 20) + ":" + Math.round(p.m.rb * 20); cl.set(k, (cl.get(k) || []).concat(p)); });
  HX.pts.forEach(p => { const col = VERDICT[p.r.verdict].hex, sel = p.r.id === hist.sel, hov = HX.hover === p;
    ctx.beginPath(); ctx.arc(p.x, p.y, sel || hov ? 8 : 6, 0, 7); ctx.fillStyle = col + (sel ? "" : "cc"); ctx.fill();
    if (sel) { ctx.lineWidth = 2; ctx.strokeStyle = TXT(); ctx.stroke(); ctx.lineWidth = 1; } });
  cl.forEach(ps => { if (ps.length < 2) return; const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length, cy = ps.reduce((a, p) => a + p.y, 0) / ps.length, bx = Math.min(W - 16, cx + 14), by = Math.max(10, cy - 14);
    ctx.fillStyle = TXT(); ctx.beginPath(); ctx.arc(bx, by, 9, 0, 7); ctx.fill(); ctx.fillStyle = cssVar("--bg"); ctx.font = "600 10px Helvetica"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(ps.length, bx, by + .5); });
  const na = history.length - HX.pts.length;
  $("#hxMapLeg").innerHTML = Object.keys(VERDICT).filter(v => v !== "INSUFFICIENT_DATA").map(v => `<span><i style="background:${VERDICT[v].hex}"></i>${VERDICT[v].label}</span>`).join("")
    + `<span><i style="background:var(--warn-soft);outline:1px dashed var(--warn)"></i>R ≥ ${t.suspicious_risk}</span><span><i style="background:var(--bad-soft);outline:1px dashed var(--bad)"></i>R ≥ ${t.high_risk}</span>${na ? `<span class="faint">${na} not assessed, not plotted</span>` : ""}`;
}
function hxBind() {
  const c = $("#hxMap"), tip = $("#hxTip"); if (!c || c._b) return; c._b = 1;
  const near = e => { const b = c.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top; let best = null, bd = 14; HX.pts.forEach(p => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }); return { best, x, y }; };
  c.addEventListener("mousemove", e => { const { best, x, y } = near(e); if (best !== HX.hover) { HX.hover = best; hxMap(); } c.style.cursor = best ? "pointer" : "default";
    if (!best) return tip.classList.add("hidden"); const m = best.m, r = best.r;
    tip.innerHTML = `<b>${esc(r.name)}</b><span>${VERDICT[r.verdict].label} · R ${r.risk.toFixed(2)}</span><span>ρA ${m.ra.toFixed(2)} · ρB ${m.rb.toFixed(2)}${m.peak ? ` · ${(m.peak / 1000).toFixed(1)} kHz` : ""}</span>`;
    tip.classList.remove("hidden"); tip.style.left = Math.min(x + 14, c.clientWidth - 220) + "px"; tip.style.top = Math.max(0, y - 10) + "px"; });
  c.addEventListener("mouseleave", () => { HX.hover = null; tip.classList.add("hidden"); hxMap(); });
  c.addEventListener("click", e => { const { best } = near(e); if (!best) return; hist.facet = null; hist.sel = best.r.id; renderHistory(); $("#hExplorer").scrollIntoView({ behavior: "smooth", block: "start" }); });
}
function bars(c, data, { max, thr = [], labelEvery = 1, onClick, empty = "No data" } = {}) {
  if (!c || !c.offsetParent) return; const { ctx, W, H } = fit(c), L = 26, R = 6, T = 8, B = 22, pw = W - L - R, ph = H - T - B; ctx.clearRect(0, 0, W, H);
  const mx = max || Math.max(1, ...data.map(d => d.parts.reduce((a, p) => a + p[0], 0))), bw = pw / Math.max(1, data.length), ax = AX();
  ctx.font = "10px Helvetica"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  [0, mx].forEach(v => { const y = T + (1 - v / mx) * ph; ctx.strokeStyle = GRID(); ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke(); ctx.fillStyle = ax; ctx.fillText(v, L - 5, y); });
  if (!data.some(d => d.parts.some(p => p[0]))) { ctx.fillStyle = TXT3(); ctx.textAlign = "center"; ctx.font = "12px Helvetica"; ctx.fillText(empty, L + pw / 2, T + ph / 2); }
  data.forEach((d, i) => { let y0 = T + ph; const w = Math.max(2, bw * .62), x = L + i * bw + (bw - w) / 2;
    d.parts.forEach(([n, col]) => { if (!n) return; const h = n / mx * ph; ctx.fillStyle = col; roundRect(ctx, x, y0 - h + 1, w, Math.max(1, h - 1.5), Math.min(4, w / 2, h / 2)); ctx.fill(); y0 -= h; });
    if ((data.length - 1 - i) % labelEvery === 0) { ctx.fillStyle = ax; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText(d.l, x + w / 2, T + ph + 6); ctx.textBaseline = "middle"; } });
  thr.forEach(([pos, col]) => { const x = L + pos * pw; ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke(); ctx.setLineDash([]); });
  c.style.cursor = onClick ? "pointer" : "default";
  c.onclick = onClick ? e => { const b = c.getBoundingClientRect(), i = Math.floor((e.clientX - b.left - L) / bw); if (i >= 0 && i < data.length && data[i].parts.some(p => p[0])) onClick(data[i], i); } : null;
}
const VK = ["CLEAR", "SUSPICIOUS", "HIGH_RISK", "INSUFFICIENT_DATA"];
function hxTime(H) {
  const days = 14, t0 = new Date(); t0.setHours(0, 0, 0, 0); const key = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return Math.round((t0 - d) / 864e5); };
  const data = Array.from({ length: days }, (_, k) => { const ago = days - 1 - k, rs = H.filter(r => key(r.ts) === ago), d = new Date(t0 - ago * 864e5);
    return { l: ago === 0 ? "today" : d.toLocaleDateString([], { day: "numeric", month: "short" }), ago, parts: VK.map(v => [rs.filter(r => r.verdict === v).length, VERDICT[v].hex]) }; });
  const older = H.filter(r => key(r.ts) >= days).length;
  $("#hxTimeSub").textContent = `last ${days} days${older ? ` · ${older} older not shown` : ""}`;
  bars($("#hxTime"), data, { labelEvery: 3, onClick: d => setFacet(`on ${d.l}`, r => key(r.ts) === d.ago) });
}
function hxDist(H) {
  const t = THR(), n = 20, A = H.filter(r => r.verdict !== "INSUFFICIENT_DATA" && r.risk != null);
  const col = x => x >= t.high_risk ? cssVar("--bad") : x >= t.suspicious_risk ? cssVar("--warn") : cssVar("--ok");
  const data = Array.from({ length: n }, (_, i) => { const lo = i / n, hi = (i + 1) / n, k = A.filter(r => r.risk >= lo && (r.risk < hi || (i === n - 1 && r.risk <= 1))).length; return { l: i % 5 === 0 ? lo.toFixed(2).replace(/0$/, "") : "", lo, hi, parts: [[k, col(lo + .001)]] }; });
  const near = A.filter(r => [t.suspicious_risk, t.high_risk].some(x => Math.abs(r.risk - x) <= .06)).length;
  $("#hxDistSub").textContent = `${A.length} assessed · ${near} borderline`;
  bars($("#hxDist"), data, { thr: [[t.suspicious_risk, cssVar("--warn")], [t.high_risk, cssVar("--bad")]], onClick: d => setFacet(`risk ${d.lo.toFixed(2)}–${d.hi.toFixed(2)}`, r => r.verdict !== "INSUFFICIENT_DATA" && r.risk >= d.lo && r.risk < d.hi + (d.hi === 1 ? .001 : 0)) });
}
function hxCar(H) {
  const pk = H.map(r => ({ r, m: hxM(r) })).filter(x => tonal(x.m)), lo = 15, hi = Math.max(24, Math.ceil(Math.max(0, ...pk.map(x => x.m.peak / 1000)))), step = .5, n = Math.round((hi - lo) / step);
  const data = Array.from({ length: n }, (_, i) => { const a = lo + i * step, rs = pk.filter(x => x.m.peak / 1000 >= a && x.m.peak / 1000 < a + step);
    return { l: Number.isInteger(a) && a % 2 === 1 ? a + "k" : "", a, parts: VK.map(v => [rs.filter(x => x.r.verdict === v).length, VERDICT[v].hex]) }; });
  $("#hxCarSub").textContent = pk.length ? `${pk.length} capture${pk.length > 1 ? "s" : ""} with a tonal peak · colour = verdict` : "no tonal peaks";
  bars($("#hxCar"), data, { empty: "No tonal peaks above 15 kHz", onClick: d => setFacet(`tonal peak ${d.a.toFixed(1)}–${(d.a + step).toFixed(1)} kHz`, r => { const m = hxM(r); return tonal(m) && m.peak / 1000 >= d.a && m.peak / 1000 < d.a + step; }) });
}
function hxAgree(H) {
  const A = H.filter(r => r.verdict !== "INSUFFICIENT_DATA"), cell = (a, b) => A.filter(r => { const m = hxM(r); return fired(m.ra) === a && fired(m.rb) === b; });
  const C = [[true, true, "Both signatures", "Energy above 18 kHz and a modulated carrier: the injection pattern.", "bad"], [true, false, "Energy only", "High-frequency energy without modulation: tones, beacons, noise.", "warn"],
    [false, true, "Carrier only", "A modulated peak with little energy share: weak or distant emitters.", "warn"], [false, false, "Neither", "Ordinary audio: nothing above the voice band.", "ok"]];
  const sp = A.filter(r => fired(hxM(r).rp) === isFlag(r.verdict)).length;
  $("#hxAgree").innerHTML = `<div class="agree">${C.map(([a, b, t, d, k]) => { const rs = cell(a, b); return `<button class="ag ag-${k}" data-a="${a}" data-b="${b}"${rs.length ? "" : " disabled"}><b>${rs.length}</b><span class="t">${t}</span><span class="d">${d}</span><span class="p">${A.length ? Math.round(rs.length / A.length * 100) : 0}%</span></button>`; }).join("")}</div>
    <div class="faint" style="font-size:12px;margin-top:12px">${A.length ? `The third detector, spectral profile, agreed with the verdict on ${sp} of ${A.length} assessed captures.` : "No assessed captures yet."} A capture counts as firing a detector at ρ ≥ ${THR().suspicious_risk}.</div>`;
  $$("#hxAgree .ag").forEach(b => b.onclick = () => { const a = b.dataset.a === "true", bb = b.dataset.b === "true"; setFacet(b.querySelector(".t").textContent.toLowerCase(), r => r.verdict !== "INSUFFICIENT_DATA" && fired(hxM(r).ra) === a && fired(hxM(r).rb) === bb); });
}
function hxTags(H) {
  const tags = new Map(); H.forEach(r => ((r.tags || []).length ? r.tags : ["(untagged)"]).forEach(t => { if (!tags.has(t)) tags.set(t, []); tags.get(t).push(r); }));
  const rows = [...tags.entries()].map(([t, rs]) => { const A = rs.filter(r => r.verdict !== "INSUFFICIENT_DATA" && r.risk != null); return { t, rs, n: rs.length, f: rs.filter(r => isFlag(r.verdict)).length, na: rs.length - A.length, mean: A.length ? A.reduce((a, r) => a + r.risk, 0) / A.length : null, peak: A.length ? Math.max(...A.map(r => r.risk)) : null }; }).sort((a, b) => b.f - a.f || b.n - a.n);
  $("#hxTags").innerHTML = rows.length ? rows.map((x, i) => `<tr class="click" data-i="${i}"><td><span class="chip">${esc(x.t)}</span></td><td class="n">${x.n}</td><td class="n"${x.f ? ' style="color:var(--bad)"' : ""}>${x.f}</td><td class="n faint">${x.na || "—"}</td><td class="n">${x.mean == null ? "—" : x.mean.toFixed(2)}</td><td class="n">${x.peak == null ? "—" : rbar(x.peak, x.peak >= THR().high_risk ? "HIGH_RISK" : x.peak >= THR().suspicious_risk ? "SUSPICIOUS" : "CLEAR")}</td></tr>`).join("")
    : `<tr><td colspan="6"><div class="empty">No captures yet.</div></td></tr>`;
  $$("#hxTags tr[data-i]").forEach(tr => tr.onclick = () => { const x = rows[+tr.dataset.i]; setFacet(`tag: ${x.t}`, r => x.rs.includes(r)); });
}
function renderHistAnalysis() {
  const H = history; $("#hxWrap").classList.toggle("hidden", !H.length); $("#hExplorer").classList.toggle("hidden", !H.length);
  if (!H.length) return;
  const ins = hxInsights(H);
  $("#hxIns").innerHTML = ins.map((x, i) => `<button class="ins ins-${x.k}" data-i="${i}"${x.f ? "" : " disabled"}><span class="ii">${icon(x.i)}</span><span class="it"><b>${esc(x.t)}</b><span>${esc(x.d)}</span></span>${x.f ? icon("back", "ico go") : ""}</button>`).join("");
  $$("#hxIns .ins").forEach(b => b.onclick = () => ins[+b.dataset.i].f?.());
  hxBind(); hxMap(); hxTime(H); hxDist(H); hxCar(H); hxAgree(H); hxTags(H);
}
const _hxRedraw = redraw;
redraw = function () { _hxRedraw(); if (currentView === "history" && history.length) { hxMap(); hxTime(history); hxDist(history); hxCar(history); } };

/* ------------------------------------------------------------ per-capture breakdown for the detail panel */
function histDetailExtra(r) {
  const m = hxM(r), t = THR(), P = activePolicy(), meter = (v, col) => `<i><u style="width:${Math.max(2, v * 100)}%;background:${col}"></u></i>`;
  const rc = v => v >= t.high_risk ? "var(--bad)" : v >= t.suspicious_risk ? "var(--warn)" : "var(--ok)";
  const det = m.ok ? `<div class="hd-sec"><div class="hd-h"><span>Why this verdict</span><em>R = √(ρA × ρB)</em></div><div class="dets">
      <div class="dt"><div class="dh"><b>ρA · energy above 18 kHz</b><em>${m.ra.toFixed(2)}</em></div>${meter(m.ra, rc(m.ra))}<span>${m.oob != null ? fmtPct(m.oob) + " of the energy" : "—"}${m.lvl != null ? ` · band at ${m.lvl.toFixed(0)} dBFS` : ""}</span></div>
      <div class="dt"><div class="dh"><b>ρB · modulated carrier</b><em>${m.rb.toFixed(2)}</em></div>${meter(m.rb, rc(m.rb))}<span>${m.peak ? `peak ${(m.peak / 1000).toFixed(2)} kHz · ${m.prom != null ? m.prom.toFixed(0) + " dB above floor" : ""}${m.narrow != null ? ` · narrowness ${m.narrow.toFixed(2)}` : ""}${m.sb != null ? ` · sidebands ${m.sb.toFixed(0)} dB` : ""}` : "no tonal peak above 15 kHz"}</span></div>
      <div class="dt"><div class="dh"><b>Spectral profile</b><em>${m.rp.toFixed(2)}</em></div>${meter(m.rp, rc(m.rp))}<span>${m.roll ? `99% of energy below ${(m.roll / 1000).toFixed(1)} kHz${m.roll < 9000 ? " · consistent with speech" : ""}` : "—"}</span></div>
    </div><div class="formula-l">R = √(${m.ra.toFixed(2)} × ${m.rb.toFixed(2)}) = <b>${Math.sqrt(m.ra * m.rb).toFixed(2)}</b>${Math.abs(Math.sqrt(m.ra * m.rb) - (r.risk || 0)) > .03 ? ` · whole file; the worst 1 s window scored <b>${(r.risk || 0).toFixed(2)}</b> and decides` : ""}</div></div>`
    : `<div class="hd-sec"><div class="hd-h"><span>Why this verdict</span><em>Nyquist ${(r.sr / 2000).toFixed(1)} kHz</em></div><p class="hd-note" style="margin:0">The highest frequency this file can hold is ${(r.sr / 2000).toFixed(1)} kHz, below the 18 kHz band both detectors read. The engine reports "could not check" instead of guessing.</p></div>`;
  const pol = `<div class="hd-sec"><div class="hd-h"><span>If this were a command</span><em>${prefs.policy ? esc(prefs.policyName) : "default"} policy</em></div><div class="pols">${["routine", "sensitive", "critical"].map(s => { const d = P[s]?.[r.verdict] || "—"; return `<div><span>${s}</span><b class="g-${d}">${d}</b></div>`; }).join("")}</div></div>`;
  const others = history.filter(x => x.id !== r.id).map(x => { const n = hxM(x); if (n.ok !== m.ok) return null; let dist = Math.hypot(n.ra - m.ra, n.rb - m.rb);
    if (tonal(m) && tonal(n)) dist += Math.abs(n.peak - m.peak) / 4000; else if (tonal(m) !== tonal(n)) dist += .3; if (!m.ok) dist = Math.abs(x.sr - r.sr) / 8000; return { x, n, dist }; })
    .filter(Boolean).sort((a, b) => a.dist - b.dist).slice(0, 3).filter(o => o.dist < .35);
  const sim = others.length ? `<div class="hd-sec"><div class="hd-h"><span>Similar captures</span><em>by detector risks and carrier</em></div><div class="sims">${others.map(({ x, n }) => `<button data-sim="${x.id}"><span class="sd" style="background:${VERDICT[x.verdict]?.hex}"></span><span class="sn">${esc(x.name)}</span><span class="sr">${tonal(m) && tonal(n) && Math.abs(n.peak - m.peak) < 300 ? `same carrier ±${Math.max(.1, Math.abs(n.peak - m.peak) / 1000).toFixed(1)} kHz` : riskTxt(x)}</span></button>`).join("")}</div></div>` : "";
  return det + pol + sim;
}
