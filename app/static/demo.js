/* EchoGuard Console — demo mode.
   Fills every view with illustrative data so a feature walk-through never starts from an empty screen.
   - Fleet numbers (Executive summary) are generated in the browser from a fixed seed: illustrative, not measured.
   - Captures (Activity, History, Batch, Compare, policy dry runs) are generated with the built-in sample
     synthesiser at varied carriers, strengths and voices, and each one is scored by the real engine. Opening one shows the engine's actual analysis of that sample.
   - The Trust gate opens on a decision the engine actually returned for the ultrasonic sample.
   Nothing is written to browser storage while demo mode is on. A server in field-test mode still retains the scans the demo triggers. */
"use strict";

const Demo = { on: false, real: null, hist: null };

/* ------------------------------------------------------------ deterministic random */
function demoRng(seed) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ------------------------------------------------------------ fleet: the executive summary */
const DEMO_SOURCES = [
  { client: "home-hub · kitchen", w: .24, sr: 48000, flag: .010 },
  { client: "smart-speaker · living room", w: .20, sr: 44100, flag: .008 },
  { client: "car · infotainment", w: .16, sr: 48000, flag: .006 },
  { client: "banking-ivr · phone line", w: .14, sr: 16000, flag: 0 },
  { client: "kiosk · hotel lobby", w: .16, sr: 48000, flag: .009 },
  { client: "qa-lab · test rig 3", w: .10, sr: 96000, flag: .32 },
];
const slug = s => s.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase();
function demoFleet(days) {
  const R = demoRng(20261010 + days), now = Date.now() / 1000, DAY = 86400, rows = [];
  const pick = () => { let u = R(), acc = 0; for (const s of DEMO_SOURCES) { acc += s.w; if (u <= acc) return s; } return DEMO_SOURCES[0]; };
  for (let d = days - 1; d >= 0; d--) {
    const start = Math.floor((now - d * DAY) / DAY) * DAY, wd = new Date(start * 1000).getUTCDay();
    let n = Math.round((wd === 0 || wd === 6 ? 150 : 215) + (R() - .5) * 50);
    for (let i = 0; i < n; i++) {
      const s = pick(), ts = start + R() * Math.min(DAY, now - 60 - start); let verdict, risk, car = null;
      if (s.sr < 36000) { verdict = "INSUFFICIENT_DATA"; risk = null; }
      else { const u = R(); if (u < s.flag * .4) { verdict = "HIGH_RISK"; risk = .68 + R() * .32; } else if (u < s.flag) { verdict = "SUSPICIOUS"; risk = .34 + R() * .3; } else { verdict = "CLEAR"; risk = R() * R() * .2; }
        if (verdict !== "CLEAR") car = s.flag > .1 ? 20000 + R() * 20000 : 18800 + R() * 2400; }
      rows.push({ ts, client: s.client, sr: s.sr, verdict, risk, car, ms: 14 + R() * R() * 90 });
    }
    if (d === Math.min(6, days - 1)) for (let i = 0; i < 38; i++) {   // the incident: an injection burst at the lobby kiosk
      const ts = Math.min(now - 30, start + DAY * .58 + i * 37); rows.push({ ts, client: "kiosk · hotel lobby", sr: 48000, verdict: i % 7 ? "HIGH_RISK" : "SUSPICIOUS", risk: i % 7 ? .82 + R() * .18 : .45 + R() * .2, car: 25000 + R() * 2000, ms: 18 + R() * 40 });
    }
  }
  rows.sort((a, b) => a.ts - b.ts);
  const V = Object.keys(VERDICT), byDay = {}, clients = {}, rates = {}, gates = { allow: 0, confirm: 0, block: 0 };
  rows.forEach(r => {
    const day = new Date(r.ts * 1000).toISOString().slice(0, 10); byDay[day] = byDay[day] || Object.fromEntries(V.map(v => [v, 0])); byDay[day][r.verdict]++;
    const c = clients[r.client] = clients[r.client] || { client: r.client, n: 0, flagged: 0, insufficient: 0, last_ts: 0, peak: 0 };
    c.n++; c.flagged += isFlag(r.verdict); c.insufficient += r.verdict === "INSUFFICIENT_DATA"; c.last_ts = Math.max(c.last_ts, r.ts); c.peak = Math.max(c.peak, r.risk || 0);
    rates[r.sr] = (rates[r.sr] || 0) + 1;
    if ((r.ts * 1000) % 10 < 3.2) gates[r.verdict === "HIGH_RISK" ? "block" : r.verdict === "CLEAR" ? ((r.ts * 7) % 10 < 9.4 ? "allow" : "confirm") : "confirm"]++;
  });
  const scored = rows.filter(r => r.verdict !== "INSUFFICIENT_DATA"), flagged = rows.filter(r => isFlag(r.verdict)), ms = rows.map(r => r.ms).sort((a, b) => a - b);
  const total = Object.values(rates).reduce((a, b) => a + b, 0);
  return {
    enabled: true, demo: true, days, generated_utc: new Date().toISOString(), total: rows.length, scored: scored.length, flagged: flagged.length,
    by_verdict: Object.fromEntries(V.map(v => [v, rows.filter(r => r.verdict === v).length])),
    by_day: Object.entries(byDay).sort().map(([day, v]) => ({ day, ...v })),
    clients: Object.values(clients).sort((a, b) => b.n - a.n),
    rates: Object.entries(rates).map(([sr, n]) => ({ sr: +sr, n })).sort((a, b) => a.sr - b.sr),
    assessable_share: Object.entries(rates).filter(([sr]) => +sr >= 36000).reduce((a, [, n]) => a + n, 0) / total,
    carriers_hz: flagged.map(r => r.car).filter(Boolean).sort((a, b) => a - b),
    latency_ms: { p50: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * .95)], max: ms[ms.length - 1] },
    gates, mean_risk: scored.reduce((a, r) => a + r.risk, 0) / scored.length,
    timeline: rows.slice(-600).map(r => [r.ts, r.verdict, r.risk]),
    recent_flagged: flagged.slice(-12).reverse().map(r => ({ ts: r.ts, client: r.client, file: `${slug(r.client)}_${new Date(r.ts * 1000).toISOString().slice(5, 16).replace(/[-:T]/g, "")}.wav`, verdict: r.verdict, risk: r.risk, sr: r.sr, carrier: r.car })),
  };
}

/* ------------------------------------------------------------ captures: Activity, History, Batch, Compare */
const DEMO_CAPTURES = [
  // name, kind, hours ago, tags, note, generator options (carrier fc / strength amp, beacon bfc / bamp)
  ["kiosk_lobby_incident_1412.wav", "attack", 26, ["incident", "kiosk"], "Flagged during the lobby kiosk burst: a 20 kHz carrier with speech-band sidebands. The gate blocked the unlock request.", { fc: 20000, amp: .38 }],
  ["kiosk_lobby_incident_1409.wav", "attack", 26.1, ["incident", "kiosk"], "First capture of the lobby burst, same emitter.", { fc: 20050, amp: .3 }],
  ["kiosk_lobby_incident_1415.wav", "attack", 25.9, ["incident", "kiosk"], "Last capture of the burst; the emitter was moved further away.", { fc: 19980, amp: .16 }],
  ["kitchen_hub_set_timer.wav", "benign", 3, ["baseline"], "Ordinary command in a quiet kitchen."],
  ["retail_store_19k_beacon.wav", "beacon", 7, ["false-positive-check", "retail"], "A shop's 19 kHz audio beacon: a steady tone with no sidebands, so it is correctly cleared.", { bfc: 19000, bamp: .16 }],
  ["ivr_call_pay_invoice.wav", "phone", 9, ["telephony"], "A 16 kHz phone line cannot carry ultrasound. The engine says 'could not check' rather than 'clear'; the gate asks for confirmation."],
  ["living_room_lights_off.wav", "benign", 14, ["baseline"], "Routine smart-home command."],
  ["car_navigate_home.wav", "benign", 20, ["baseline", "car"], "In-car command over road noise."],
  ["qa_rig3_injection_21k_lvl1.wav", "attack", 30, ["lab", "injection"], "Controlled injection test on the QA rig, 21.5 kHz carrier, full drive.", { fc: 21500, amp: .34 }],
  ["qa_rig3_injection_21k_lvl2.wav", "attack", 30.2, ["lab", "injection"], "Same rig at a lower drive level, still flagged.", { fc: 21500, amp: .14 }],
  ["qa_rig3_injection_21k_lvl4.wav", "attack", 30.4, ["lab", "injection"], "Same rig at a much lower drive level. Still clearly flagged: this capture is taken before any converter, so the carrier survives intact. Through a phone's 48 kHz converter it would not (see Coverage & limits).", { fc: 21500, amp: .055 }],
  ["qa_rig3_injection_23k_lvl1.wav", "attack", 31, ["lab", "injection"], "Higher carrier, 23 kHz, close to the 24 kHz Nyquist limit of a 48 kHz capture.", { fc: 23000, amp: .3 }],
  ["mall_ad_beacon_18k.wav", "beacon", 40, ["false-positive", "retail"], "Advertising beacon at 18.6 kHz, flagged suspicious: the tone sits close enough to the voice band that room speech reads as weak sidebands. A real false positive; the gate asks for confirmation rather than blocking. Worth reviewing.", { bfc: 18600, bamp: .1 }],
  ["ivr_call_check_balance.wav", "phone", 46, ["telephony"], "Telephony-rate audio: the signal check cannot run."],
  ["kitchen_hub_weather.wav", "benign", 60, ["baseline"], "Routine query."],
  ["hotel_room_tv_ad_20k.wav", "beacon", 75, ["false-positive-check", "hotel"], "TV advert with a loud 20.5 kHz tracking tone: plenty of high-frequency energy, still no modulation.", { bfc: 20500, bamp: .3 }],
  ["car_call_mom.wav", "benign", 90, ["car"], "Hands-free call request."],
  ["kiosk_lobby_baseline.wav", "benign", 120, ["kiosk", "baseline"], "The same kiosk a week earlier, before the incident."],
  ["office_pa_system_tone.wav", "beacon", 140, ["false-positive-check"], "Public-address pilot tone at 19.5 kHz.", { bfc: 19500, bamp: .22 }],
  ["car_infotainment_radio.wav", "benign", 160, ["car"], "Command with the radio playing."],
  ["qa_rig3_injection_20k_lvl6.wav", "attack", 200, ["lab", "injection"], "Earlier rig run at the lowest drive level. Still flagged in a pre-converter capture.", { fc: 20000, amp: .035 }],
  ["smart_speaker_music.wav", "benign", 230, ["baseline"], "Request over background music."],
];
async function demoHistory() {
  const now = Date.now();
  const recs = await Promise.all(DEMO_CAPTURES.map(async ([name, kind, hoursAgo, tags, note, opt], i) => {
    const { sr, x } = demoAudio(kind, 2.4, 7 + i * 13, opt || {}), blob = encodeWAV(x, sr), data = await scanBlob(blob, name, "1.0", "0.5");
    const rec = recordFrom(data, blob, name, { id: "demo-" + i, ts: now - hoursAgo * 3600e3, tags, note, source: tags.includes("lab") ? "batch" : "upload" });
    rec.demoKind = kind; rec.full = data; return rec;
  }));
  return recs.sort((a, b) => b.ts - a.ts);
}

/* ------------------------------------------------------------ trust gate: a real engine decision for the ultrasonic sample */
const DEMO_TRUST = {"decision":"block","sensitivity":"critical","level":"hostile","reason":"Do not execute: a critical action with a hostile command — signal integrity: Injection risk 1.00 (HIGH_RISK): 95.4% of signal energy sits above 18 kHz - well beyond the human-voice band. Consistent with ultrasonic/near-ultrasound injection.","command":"unlock the front door","elapsed_ms":503.6,"trust":{"level":"hostile","overall":0,"required_layers":["L1","L4"],"layers":{"L1":0,"L2":0.187,"L3":null,"L4":1},"signals":[{"name":"signal_integrity","layer":"L1","layer_label":"signal integrity","trust":0,"assessable":true,"band":"hostile","detail":"Injection risk 1.00 (HIGH_RISK): 95.4% of signal energy sits above 18 kHz - well beyond the human-voice band. Consistent with ultrasonic/near-ultrasound injection.","evidence":{"verdict":"HIGH_RISK","risk":1,"sample_rate":48000,"windows":4}},{"name":"speaker_verification","layer":"L2","layer_label":"speaker identity","trust":0.265,"assessable":true,"band":"hostile","detail":"Voice does not match the enrolled user Alex (similarity 0.24).","evidence":{"similarity":0.243,"profile":"Alex"}},{"name":"anti_spoofing","layer":"L2","layer_label":"speaker identity","trust":0.187,"assessable":true,"band":"hostile","detail":"Voice reads as synthetic, converted or replayed (bonafide score -1.16).","evidence":{"bonafide_logit":-1.16}},{"name":"same_speaker","layer":"L3","layer_label":"source attribution","trust":null,"assessable":false,"band":"unassessed","detail":"Could not check: needs both the wake-word segment and the command.","evidence":{}},{"name":"content_safety","layer":"L4","layer_label":"content safety","trust":1,"assessable":true,"band":"clean","detail":"No spoken-injection pattern in the transcript.","evidence":{"matches":[]}},{"name":"transcript_consistency","layer":"L4","layer_label":"content safety","trust":null,"assessable":false,"band":"unassessed","detail":"Could not check: needs transcripts from two decoders.","evidence":{}}]},"profile":"Alex","capture_note":"Capture at 48.0 kHz covers the ultrasonic band."};

/* ------------------------------------------------------------ the guided tour strip */
const DEMO_TOUR = [
  ["exec", "Fleet posture", "How many commands were screened, what was flagged, and where."],
  ["trust", "Trust gate", "Watch the gate block an injected command and explain why. Try the scenarios."],
  ["live", "Live monitor", "A simulated stream: speech, then an injection burst every 30 s."],
  ["analyze", "Signal analysis", "Open a flagged capture and see the carrier the engine found."],
  ["policies", "Gate policies", "Decide what the agent does for each risk level, then dry-run it."],
  ["coverage", "Limits", "What the screen cannot see, and why it says so."],
];
function renderDemoStrip() {
  const el = $("#demoStrip"); if (!el) return;
  el.classList.toggle("hidden", !Demo.on); $("#demoBadge")?.classList.toggle("hidden", !Demo.on); document.body.classList.toggle("demo", Demo.on);
  if (!Demo.on) return;
  const i = DEMO_TOUR.findIndex(t => t[0] === currentView), cur = DEMO_TOUR[i];
  el.innerHTML = `<div class="dl"><span class="dtag">${icon("spark")}Demo mode</span><span class="dtx">${cur ? `<b>Step ${i + 1} · ${cur[1]}.</b> ${cur[2]}` : "Illustrative data. Follow the tour, or explore freely."}</span></div>
    <div class="dsteps">${DEMO_TOUR.map(([v, l], k) => `<button class="${v === currentView ? "on" : ""}" data-go="${v}"><i>${k + 1}</i>${l}</button>`).join("")}</div>
    <button class="btn sm ghost dx" id="demoExit">Exit demo</button>`;
  $("#demoExit").onclick = () => setDemo(false);
}

/* ------------------------------------------------------------ switching */
async function enableDemo(quiet) {
  Demo.on = true; if (!Demo.real) Demo.real = history;
  history = [];
  try { Demo.hist = Demo.hist || await demoHistory(); history = Demo.hist.slice(); }
  catch (e) { if (!quiet) toast("Demo captures need the engine: " + e.message, "bad", 5000); }
  if (!batch.rows.some(r => r.demo)) {
    const pickB = history.filter((_, i) => i % 2 === 0).slice(0, 10);
    batch.rows = pickB.map(r => ({ ...r, file: r.blob, data: r.full || r.data, demo: true })).concat(batch.rows);
  }
  trust.last = null;
}
async function disableDemo() {
  Demo.on = false; batch.rows = batch.rows.filter(r => !r.demo);
  if (live.sim && Demo.autoSim) stopLive();
  history = Demo.real || []; Demo.real = null; await loadHistory();
  trust.last = null; $("#tResBody").innerHTML = `<div class="empty"><b>No evaluation yet</b>Choose or record a command, type what the agent heard, pick the action's sensitivity, and evaluate. Or run the demo.</div>`;
  $("#tLayers").innerHTML = ""; $("#tLayersEmpty")?.classList.remove("hidden"); $("#tResult").classList.remove("has");
}
async function setDemo(on) {
  prefs.demo = !!on; savePrefs();
  if (on) await enableDemo(); else await disableDemo();
  renderBatch(); renderOverview(); renderDemoStrip();
  toast(on ? "Demo mode on: illustrative data, nothing is saved in this browser" : "Demo mode off: your own data is back", "ok", 3200);
  go(on ? "exec" : currentView);
}

/* ------------------------------------------------------------ hooks into the console */
// nothing is written while demo data is showing
["put", "del", "clear"].forEach(k => { const f = store[k].bind(store); store[k] = (...a) => Demo.on ? Promise.resolve() : f(...a); });

const _loadExec = loadExec;
loadExec = async function () {
  if (!Demo.on) return _loadExec();
  exec.data = demoFleet(exec.days); exec.source = "demo"; renderExec();
  $("#exSource").className = "pill warn"; $("#exSource").innerHTML = `${icon("spark")} demo data · ${exec.days} d`;
  $("#exSub").textContent = `Illustrative fleet: ${exec.data.total.toLocaleString()} screenings across ${exec.data.clients.length} sources over ${exec.days} days. Generated in the browser, not measured.`;
};
const _renderHistory = renderHistory;
renderHistory = function () { _renderHistory(); if (Demo.on) $("#hSub").textContent = `${history.length} demo captures: synthesised at varied carriers, strengths and voices, each scored by the real engine. Not saved in this browser.`; };
const _renderOverview = renderOverview;
renderOverview = function () { _renderOverview(); if (Demo.on && $("#ovSub")) $("#ovSub").textContent = "Demo captures · illustrative names · engine online"; };
const _trustEnter = trustEnter;
trustEnter = async function () {
  await _trustEnter();
  if (Demo.on && !trust.last) {
    const who = $("#tProfile").selectedOptions[0]?.value ? $("#tProfile").selectedOptions[0].textContent.split(" · ")[0] : "the enrolled user";
    const fx = JSON.parse(JSON.stringify(DEMO_TRUST).replaceAll("enrolled user Alex", "enrolled user " + who.replace(/"/g, "")));
    trust.last = fx; renderTrust(fx);
    $("#tTranscript").value = DEMO_TRUST.command; $$("#tSens .gopt").forEach(x => x.classList.toggle("on", x.dataset.a === "critical"));
    $("#tFile").textContent = DEMO_NAMES.attack; loadDemo("attack").then(c => { trust.blob = c.blob; trust.name = DEMO_NAMES.attack; }).catch(() => {});
    $("#tResSub").textContent = "demo · the engine's decision for the ultrasonic sample";
  }
};
const _go = go;
go = function (v, opts) {
  _go(v, opts); renderDemoStrip();
  if (Demo.on && currentView === "live" && !live.sim && !live.mic) { Demo.autoSim = true; $("#simBtn").click(); }
};
const _renderSettings = renderSettings;
renderSettings = function () {
  _renderSettings();
  const el = $("#setDemo"); if (!el) return;
  el.innerHTML = settingRow("Show demo data", "Fills every view with illustrative data for walking someone through the platform. Your own browser history is set aside and nothing is saved to it while demo mode is on. If the server is in field-test mode, the scans the demo runs are still retained there.", `<div class="toggle${prefs.demo ? " on" : ""}" id="demoToggle"></div>`)
    + `<div class="demofacts"><div><b>Executive summary</b>A generated 30-day fleet with six sources and one incident. Illustrative, not measured.</div><div><b>Captures</b>22 synthesised captures at varied carriers and strengths, each scored by the real engine.</div><div><b>Trust gate</b>Opens on a decision the engine actually returned. Scenarios run for real.</div><div><b>Live monitor</b>Starts the simulated stream automatically.</div></div>`;
  $("#demoToggle").onclick = () => setDemo(!prefs.demo);
};
const _paletteItems = paletteItems;
paletteItems = function (q) {
  const out = _paletteItems(""), extra = { g: "Actions", i: "spark", l: prefs.demo ? "Turn demo mode off" : "Turn demo mode on", f: () => setDemo(!prefs.demo) };
  out.splice(out.findIndex(x => x.g === "Actions"), 0, extra);
  const s = q.trim().toLowerCase(); return s ? out.filter(it => (it.l + " " + it.g).toLowerCase().includes(s)) : out;
};
$("#exRefresh").onclick = () => loadExec();
window.demoBoot = async () => { if (prefs.demo) await enableDemo(true); };
