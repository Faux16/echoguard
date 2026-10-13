/* EchoGuard Console — review workflow.
   Flagged captures become work items: New → Investigating → Resolved (with an outcome), each with an owner,
   notes and an activity trail. Related items are grouped into incidents that carry a response checklist with
   real actions (tighten the gate policy, resolve every capture, close). False positives can be turned into
   known-source rules that pre-label future matches; a rule never changes a verdict and never auto-clears.
   State lives in this browser (localStorage). In demo mode it lives in memory and is seeded. */
"use strict";

const TQ = { real: null, sel: null, inc: null, picked: new Set(), scope: "open", outcomeFor: null };
const TQ_KEY = "eg.triage.v1";
const ME = () => prefs.analyst || "You";
const inDemo = () => typeof Demo !== "undefined" && Demo.on;
function tqS() {
  if (inDemo()) return Demo.tq || (Demo.tq = tqSeedDemo());
  if (!TQ.real) { try { TQ.real = JSON.parse(localStorage.getItem(TQ_KEY) || "null"); } catch { TQ.real = null; } TQ.real = TQ.real || { items: {}, incidents: [], rules: [], seq: 1 }; }
  return TQ.real;
}
function tqSave() { if (inDemo()) return; try { localStorage.setItem(TQ_KEY, JSON.stringify(tqS())); } catch { /* storage blocked */ } }
const OUT = { attack: "Confirmed attack", false_positive: "False positive", test: "Expected test" };
const STAT = { new: "New", investigating: "Investigating", resolved: "Resolved" };
const initials = n => (n || "?").split(/[\s.]+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase();
const ago = ts => { const s = (Date.now() - ts) / 1000; return s < 3600 ? Math.max(1, Math.round(s / 60)) + " min" : s < 86400 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " d"; };

/* ------------------------------------------------------------ items */
function tqItem(r) {
  const s = tqS();
  if (!s.items[r.id]) s.items[r.id] = { status: "new", resolution: null, assignee: null, incident: null, created: r.ts,
    log: [{ ts: r.ts, who: "EchoGuard", t: `Flagged ${VERDICT[r.verdict].label.toLowerCase()} · risk ${(r.risk ?? 0).toFixed(2)}` }] };
  return s.items[r.id];
}
function tqAll() {
  const fl = history.filter(r => isFlag(r.verdict)).sort((a, b) => a.ts - b.ts);
  return fl.map((r, i) => ({ r, it: tqItem(r), key: "EG-" + (101 + i), m: window.hxM ? hxM(r) : {}, rule: tqRule(r) }));
}
function tqRule(r) { const m = window.hxM ? hxM(r) : {}; if (!m.peak) return null; return tqS().rules.find(u => Math.abs(m.peak - u.peak) <= u.tol) || null; }
function tqLog(it, t, who = ME()) { it.log.push({ ts: Date.now(), who, t }); }
function tqSet(id, patch, msg) { const r = history.find(x => x.id === id); if (!r) return; const it = tqItem(r); Object.assign(it, patch); if (msg) tqLog(it, msg); tqSave(); renderQueue(); }
function tqStatus(id, st) {
  const r = history.find(x => x.id === id), it = r && tqItem(r); if (!it || it.status === st) return;
  if (st === "resolved") { TQ.sel = id; TQ.inc = null; TQ.outcomeFor = id; return renderQueue(); }
  tqSet(id, { status: st, resolution: null, assignee: it.assignee || (st === "investigating" ? ME() : null) }, st === "investigating" ? "Started investigating" : "Moved back to New");
}
function tqResolve(id, out, note) {
  const r = history.find(x => x.id === id); if (!r) return; const it = tqItem(r);
  Object.assign(it, { status: "resolved", resolution: out, assignee: it.assignee || ME() }); tqLog(it, `Resolved as ${OUT[out].toLowerCase()}${note ? ": " + note : ""}`);
  TQ.outcomeFor = null; tqSave(); renderQueue(); toast(`${tqAll().find(x => x.r.id === id)?.key} resolved as ${OUT[out].toLowerCase()}`, "ok");
}

/* ------------------------------------------------------------ incidents and rules */
function tqIncident(ids, title) {
  const s = tqS(), key = "INC-" + String(s.seq++).padStart(3, "0"), now = Date.now();
  const inc = { id: key, key, title, status: "open", created: now, items: ids.slice(), steps: { review: false, policy: false, source: false, resolve: false }, log: [{ ts: now, who: ME(), t: `Opened with ${ids.length} capture${ids.length > 1 ? "s" : ""}` }] };
  s.incidents.unshift(inc);
  ids.forEach(id => { const r = history.find(x => x.id === id); if (r) { const it = tqItem(r); it.incident = key; tqLog(it, `Added to ${key}`); } });
  TQ.picked.clear(); TQ.inc = key; TQ.sel = null; tqSave(); renderQueue(); toast(`${key} opened`, "ok"); return inc;
}
const policyTight = () => { const P = activePolicy(); return P.sensitive?.SUSPICIOUS === "block" && P.critical?.INSUFFICIENT_DATA === "block"; };
function tqIncSteps(inc) {
  const its = inc.items.map(id => history.find(r => r.id === id)).filter(Boolean).map(r => tqItem(r));
  inc.steps.review = its.length > 0 && its.every(i => i.status !== "new");
  inc.steps.policy = inc.steps.policy || policyTight();
  inc.steps.resolve = its.length > 0 && its.every(i => i.status === "resolved");
  if (inc.status !== "closed") inc.status = inc.steps.policy && inc.steps.source ? "contained" : "open";
  return its;
}
function tqRuleAdd(r, label) {
  const m = window.hxM ? hxM(r) : {}; if (!m.peak) return;
  const s = tqS(); s.rules.unshift({ id: "R-" + Date.now().toString(36), label, peak: m.peak, tol: 200, created: Date.now(), by: ME(), from: r.name });
  tqLog(tqItem(r), `Created known-source rule "${label}"`); tqSave(); renderQueue(); toast("Known-source rule saved", "ok");
}

/* ------------------------------------------------------------ rendering */
function renderQueue() {
  if (!$("#qBoard")) return;
  const all = tqAll(), s = tqS(), open = all.filter(x => x.it.status !== "resolved"), week = Date.now() - 7 * 864e5;
  updateQueueBadge(all);
  const oldest = open.length ? Math.min(...open.map(x => x.r.ts)) : null;
  kpiCards($("#qKpis"), [["New", all.filter(x => x.it.status === "new").length, all.some(x => x.it.status === "new") ? "var(--bad)" : "var(--text)", "waiting for triage"],
    ["Investigating", all.filter(x => x.it.status === "investigating").length, "var(--warn)", `${all.filter(x => x.it.status === "investigating" && x.it.assignee === ME()).length} assigned to you`],
    ["Resolved", all.filter(x => x.it.status === "resolved").length, "var(--ok)", `${all.filter(x => x.it.status === "resolved" && x.it.resolution === "false_positive").length} false positive`],
    ["Open incidents", s.incidents.filter(i => i.status !== "closed").length, "var(--accent)", `${s.incidents.length} in total`],
    ["Oldest open", oldest ? ago(oldest) : "—", "var(--text)", oldest ? "since flagged" : "queue is clear"]]);
  const scope = TQ.scope, pass = x => scope !== "mine" || x.it.assignee === ME();
  const cols = [["new", "New", "Triage: worth investigating?"], ["investigating", "Investigating", "Decide the outcome"], ["resolved", "Resolved", "Outcome recorded"]].filter(c => scope !== "open" || c[0] !== "resolved");
  $("#qBoard").style.setProperty("--cols", cols.length);
  $("#qBoard").innerHTML = cols.map(([st, label, hint]) => { const xs = all.filter(x => x.it.status === st && pass(x)).sort((a, b) => b.r.risk - a.r.risk || b.r.ts - a.r.ts);
    const cap = st === "resolved" && !TQ.allResolved ? 6 : 1e9, more = xs.length - Math.min(cap, xs.length);
    return `<div class="qcol" data-st="${st}"><div class="qch"><b>${label}</b><span class="qn">${xs.length}</span><em>${hint}</em></div><div class="qcards">${xs.slice(0, cap).map(qCard).join("")}${more > 0 ? `<button class="btn sm ghost qmore">Show ${more} more</button>` : st === "resolved" && TQ.allResolved && xs.length > 6 ? `<button class="btn sm ghost qmore">Show fewer</button>` : ""}${xs.length ? "" : `<div class="qempty">${st === "new" ? "Nothing waiting" : st === "investigating" ? "Drag a capture here, or start investigating" : "Nothing resolved yet"}</div>`}</div></div>`; }).join("");
  $$("#qBoard .qmore").forEach(b => b.onclick = () => { TQ.allResolved = !TQ.allResolved; renderQueue(); });
  $("#qGroup").disabled = TQ.picked.size < 1; $("#qGroup").innerHTML = `${icon("incident")}${TQ.picked.size ? `Group ${TQ.picked.size} into incident` : "Group into incident"}`;
  bindBoard();
  // incidents
  $("#qIncs").innerHTML = s.incidents.length ? s.incidents.map(inc => { const its = tqIncSteps(inc), rs = inc.items.map(id => history.find(r => r.id === id)).filter(Boolean), done = Object.values(inc.steps).filter(Boolean).length + (inc.status === "closed" ? 1 : 0);
    const peak = Math.max(0, ...rs.map(r => r.risk || 0)), car = rs.map(r => window.hxM ? hxM(r).peak : null).filter(Boolean);
    return `<button class="inc${TQ.inc === inc.id ? " on" : ""}" data-inc="${inc.id}"><div class="it"><span class="ik">${inc.key}</span><span class="ist s-${inc.status}">${inc.status}</span></div><b>${esc(inc.title)}</b>
      <div class="im"><span>${rs.length} capture${rs.length === 1 ? "" : "s"}</span><span>peak ${peak.toFixed(2)}</span>${car.length ? `<span>${(Math.min(...car) / 1000).toFixed(1)}${Math.max(...car) - Math.min(...car) > 300 ? "–" + (Math.max(...car) / 1000).toFixed(1) : ""} kHz</span>` : ""}<span>${ago(inc.created)} ago</span></div>
      <div class="ip"><i style="width:${done / 5 * 100}%"></i></div><span class="ipl">${done} of 5 response steps</span></button>`; }).join("")
    : `<div class="card"><div class="empty"><b>No incidents</b>Tick related captures on the board and press "Group into incident".</div></div>`;
  $$("#qIncs .inc").forEach(b => b.onclick = () => { TQ.inc = b.dataset.inc; TQ.sel = null; renderQueue(); });
  // rules
  const rules = s.rules;
  $("#qRules").innerHTML = rules.length ? `<div class="rules">${rules.map(u => { const n = all.filter(x => x.rule === u).length; return `<div class="rl"><span class="ri">${icon("rule")}</span><div><b>${esc(u.label)}</b><span>tonal peak ${(u.peak / 1000).toFixed(2)} kHz ± ${(u.tol / 1000).toFixed(1)} · from ${esc(u.from)} · ${esc(u.by)}, ${ago(u.created)} ago</span></div><span class="rn">${n} match${n === 1 ? "" : "es"}</span><button class="iconbtn" data-rdel="${u.id}" title="Delete rule">${icon("trash")}</button></div>`; }).join("")}</div>`
    : `<div class="empty" style="padding:20px"><b>No rules yet</b>Resolve a flagged capture as a false positive, then save its tonal peak as a known source.</div>`;
  $$("#qRules [data-rdel]").forEach(b => b.onclick = () => { s.rules = s.rules.filter(u => u.id !== b.dataset.rdel); tqSave(); renderQueue(); });
  renderDrawer(all);
}
function qCard(x) {
  const { r, it, key, m, rule } = x, inc = it.incident;
  return `<div class="qcard${TQ.sel === r.id ? " on" : ""}" draggable="true" data-id="${r.id}">
    <div class="qt"><label class="qpick" title="Select for an incident"><input type="checkbox" data-pick="${r.id}"${TQ.picked.has(r.id) ? " checked" : ""}><span></span></label><span class="qk">${key}</span><span class="qr" style="color:${VERDICT[r.verdict].hex}">${r.risk.toFixed(2)}</span></div>
    <b class="qnm">${esc(r.name)}</b>
    <div class="qm"><span class="vdot" style="background:${VERDICT[r.verdict].hex}"></span>${VERDICT[r.verdict].label}${m.peak ? ` · ${(m.peak / 1000).toFixed(1)} kHz` : ""} · ${ago(r.ts)}</div>
    <div class="qf">${it.resolution ? `<span class="qchip o-${it.resolution}">${OUT[it.resolution]}</span>` : ""}${inc ? `<span class="qchip incc">${inc}</span>` : ""}${rule && it.status !== "resolved" ? `<span class="qchip rule">known source?</span>` : ""}<span class="sp"></span>${it.assignee ? `<span class="av" title="${esc(it.assignee)}">${initials(it.assignee)}</span>` : `<span class="av none" title="Unassigned">${icon("user2")}</span>`}</div></div>`;
}
function bindBoard() {
  $$("#qBoard .qcard").forEach(c => {
    c.onclick = e => { if (e.target.closest(".qpick")) return; TQ.sel = c.dataset.id; TQ.inc = null; TQ.outcomeFor = null; renderQueue(); };
    c.ondragstart = e => { e.dataTransfer.setData("text/plain", c.dataset.id); c.classList.add("drag"); };
    c.ondragend = () => c.classList.remove("drag");
  });
  $$("#qBoard [data-pick]").forEach(cb => cb.onchange = () => { cb.checked ? TQ.picked.add(cb.dataset.pick) : TQ.picked.delete(cb.dataset.pick); $("#qGroup").disabled = TQ.picked.size < 1; $("#qGroup").innerHTML = `${icon("incident")}${TQ.picked.size ? `Group ${TQ.picked.size} into incident` : "Group into incident"}`; });
  $$("#qBoard .qcol").forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add("over"); };
    col.ondragleave = () => col.classList.remove("over");
    col.ondrop = e => { e.preventDefault(); col.classList.remove("over"); const id = e.dataTransfer.getData("text/plain"); if (id) tqStatus(id, col.dataset.st); };
  });
}
function renderDrawer(all) {
  const el = $("#qDrawer");
  if (TQ.inc) return renderIncDrawer(el, tqS().incidents.find(i => i.id === TQ.inc), all);
  const x = all.find(a => a.r.id === TQ.sel) || all.find(a => a.it.status === "new") || all[0];
  if (!x) { el.innerHTML = `<div class="empty" style="padding:70px 20px">${icon("queue")}<b style="margin-top:10px">The queue is empty</b>Flagged captures from Signal analysis, Batch screening or the API land here automatically.</div>`; return; }
  TQ.sel = x.r.id;
  const { r, it, key, m, rule } = x, steps = ["new", "investigating", "resolved"], si = steps.indexOf(it.status);
  const f = (r.data?.findings || []).filter(z => z.assessable !== false).sort((a, b) => b.risk - a.risk)[0];
  const sims = all.filter(o => o.r.id !== r.id && o.it.status !== "resolved" && m.peak && o.m.peak && Math.abs(o.m.peak - m.peak) <= 300);
  const outcome = TQ.outcomeFor === r.id;
  let next = "";
  if (it.status === "new") next = `<div class="nx"><b>Triage.</b> Is this worth investigating? Most flagged captures are; known sources and scheduled tests are the usual exceptions.</div><div class="nxa"><button class="btn primary" data-act="inv">${icon("search")}Start investigating</button>${it.assignee ? "" : `<button class="btn" data-act="me">${icon("user2")}Assign to me</button>`}</div>`;
  else if (it.status === "investigating" || outcome) next = `<div class="nx${outcome ? " hl" : ""}"><b>${outcome ? "Choose an outcome to resolve." : "Decide the outcome."}</b> Look at the evidence below, compare similar captures, then record what this was.</div>
    <div class="outs">${Object.entries(OUT).map(([k, l]) => `<button class="out o-${k}" data-out="${k}"><b>${l}</b><span>${k === "attack" ? "A real injection attempt" : k === "false_positive" ? "Benign audio the engine flagged" : "A known, scheduled test"}</span></button>`).join("")}</div>
    <input class="inp" id="qOutNote" placeholder="Optional: one line on how you decided" style="width:100%;margin-top:8px">`;
  else next = `<div class="nx done"><b>Resolved: ${OUT[it.resolution]}.</b> ${esc(it.assignee || "")} · ${ago(it.log[it.log.length - 1].ts)} ago</div><div class="nxa"><button class="btn" data-act="reopen">Reopen</button>${it.resolution === "false_positive" && m.peak && !rule ? `<button class="btn primary" data-act="rule">${icon("rule")}Save as known source</button>` : ""}</div>
    ${it.resolution === "false_positive" && m.peak && !rule ? `<input class="inp" id="qRuleLabel" value="${esc(`Known source near ${(m.peak / 1000).toFixed(1)} kHz`)}" style="width:100%;margin-top:8px">` : ""}`;
  el.innerHTML = `<div class="dz-top"><span class="qk">${key}</span><span class="ist s-${it.status}">${STAT[it.status]}</span>${it.incident ? `<button class="qchip incc" data-goinc="${it.incident}">${it.incident}</button>` : ""}<span class="sp"></span><span class="faint" style="font-size:12px">flagged ${ago(r.ts)} ago</span></div>
    <h2 class="dz-name">${esc(r.name)}</h2>
    <div class="stepper">${steps.map((s, i) => `<div class="st${i < si ? " done" : i === si ? " cur" : ""}"><i>${i < si ? icon("check") : i + 1}</i><span>${STAT[s]}</span></div>`).join('<span class="sl"></span>')}</div>
    ${rule && it.status !== "resolved" ? `<div class="rulehint">${icon("rule")}<div><b>Matches a known source: ${esc(rule.label)}</b><span>Tonal peak within ${(rule.tol / 1000).toFixed(1)} kHz of the rule. The verdict is unchanged; you decide.</span></div><button class="btn sm" data-out="false_positive">Resolve as false positive</button></div>` : ""}
    <div class="dz-next">${next}</div>
    <div class="dz-sec"><div class="hd-h"><span>Evidence</span><em>R = √(ρA × ρB)</em></div>
      <div class="ev"><div><span>Risk</span><b style="color:${VERDICT[r.verdict].hex}">${r.risk.toFixed(2)}</b></div><div><span>ρA energy</span><b>${(m.ra ?? 0).toFixed(2)}</b></div><div><span>ρB carrier</span><b>${(m.rb ?? 0).toFixed(2)}</b></div><div><span>Tonal peak</span><b>${m.peak ? (m.peak / 1000).toFixed(2) : "—"}<small>${m.peak ? "kHz" : ""}</small></b></div></div>
      <p class="why">${esc(f ? f.detail : "—")}</p>
      <div class="nxa"><button class="btn sm" data-act="open">${icon("analyze")}Open analysis</button><button class="btn sm" data-act="hist">${icon("history")}View in History</button></div></div>
    ${sims.length ? `<div class="dz-sec"><div class="hd-h"><span>Open captures with the same carrier</span><em>±0.3 kHz</em></div><div class="sims">${sims.map(o => `<button data-sel="${o.r.id}"><span class="sd" style="background:${VERDICT[o.r.verdict].hex}"></span><span class="sn">${o.key} · ${esc(o.r.name)}</span><span class="sr">${STAT[o.it.status]}</span></button>`).join("")}</div>
      ${!it.incident ? `<button class="btn sm" data-act="group" style="margin-top:8px">${icon("incident")}Open an incident with these ${sims.length + 1}</button>` : ""}</div>` : ""}
    <div class="dz-sec"><div class="hd-h"><span>Owner</span><em>${it.assignee ? "" : "unassigned"}</em></div><div class="owner">${it.assignee ? `<span class="av">${initials(it.assignee)}</span><b>${esc(it.assignee)}</b>` : `<span class="faint">Nobody owns this yet.</span>`}<span class="sp"></span>${it.assignee === ME() ? `<button class="btn sm ghost" data-act="unassign">Unassign</button>` : `<button class="btn sm" data-act="me">Assign to me</button>`}</div></div>
    <div class="dz-sec"><div class="hd-h"><span>Activity</span><em>${it.log.length} event${it.log.length === 1 ? "" : "s"}</em></div>
      <div class="compose"><textarea class="inp" id="qNote" rows="2" placeholder="Add a note for the team…"></textarea><button class="btn sm primary" data-act="note">Add note</button></div>
      <div class="tl2">${it.log.slice().reverse().map(e => `<div><span class="av sm">${e.who === "EchoGuard" ? icon("spark") : initials(e.who)}</span><div><b>${esc(e.who)}</b> ${esc(e.t)}<em>${fmtWhen(e.ts)}</em></div></div>`).join("")}</div></div>`;
  const act = (a, fn) => $$(`#qDrawer [data-act="${a}"]`).forEach(b => b.onclick = fn);
  act("inv", () => tqStatus(r.id, "investigating"));
  act("me", () => tqSet(r.id, { assignee: ME() }, "Assigned to themselves"));
  act("unassign", () => tqSet(r.id, { assignee: null }, "Unassigned"));
  act("reopen", () => tqSet(r.id, { status: "investigating", resolution: null }, "Reopened"));
  act("rule", () => tqRuleAdd(r, ($("#qRuleLabel")?.value || "").trim() || `Known source near ${(m.peak / 1000).toFixed(1)} kHz`));
  act("open", () => openRecord(r.id));
  act("hist", () => { hist.facet = null; hist.sel = r.id; go("history"); setTimeout(() => $("#hExplorer")?.scrollIntoView({ behavior: "smooth" }), 80); });
  act("group", () => tqIncident([r.id, ...sims.map(o => o.r.id)], `${(m.peak / 1000).toFixed(1)} kHz carrier · ${sims.length + 1} captures`));
  act("note", () => { const t = $("#qNote").value.trim(); if (!t) return; tqLog(it, `noted: “${t}”`); tqSave(); renderQueue(); });
  $$("#qDrawer [data-out]").forEach(b => b.onclick = () => tqResolve(r.id, b.dataset.out, $("#qOutNote")?.value.trim()));
  $$("#qDrawer [data-sel]").forEach(b => b.onclick = () => { TQ.sel = b.dataset.sel; renderQueue(); });
  $$("#qDrawer [data-goinc]").forEach(b => b.onclick = () => { TQ.inc = b.dataset.goinc; renderQueue(); });
}
function renderIncDrawer(el, inc, all) {
  if (!inc) { TQ.inc = null; return renderDrawer(all); }
  const its = tqIncSteps(inc), xs = all.filter(x => inc.items.includes(x.r.id)), st = inc.steps;
  const steps = [
    ["review", "Triage every grouped capture", "Each capture is at least under investigation.", st.review, !st.review && `<button class="btn sm" data-i="review">Start investigating all</button>`],
    ["policy", "Tighten what the agent may do", `Switch to the Strict gate policy: sensitive and critical actions are blocked on any flag or unverified capture. Now: ${esc(prefs.policy ? prefs.policyName : "Default")}.`, st.policy, !st.policy && `<button class="btn sm primary" data-i="policy">Apply Strict policy</button>`],
    ["source", "Find and remove the source", "Locate the emitter (a speaker, a phone, a hidden device) and take it out of the room.", st.source, !st.source && `<input class="inp" id="qSrcNote" placeholder="What was found, and where" style="flex:1;min-width:160px"><button class="btn sm" data-i="source">Mark done</button>`],
    ["resolve", "Resolve the captures", "Record the outcome for each grouped capture.", st.resolve, !st.resolve && `<button class="btn sm" data-i="resolve">Resolve all as confirmed attack</button>`],
    ["close", "Close the incident", "Once contained and every capture is resolved.", inc.status === "closed", inc.status !== "closed" && `<button class="btn sm primary" data-i="close"${st.policy && st.source && st.resolve && st.review ? "" : " disabled"}>Close incident</button>`],
  ];
  el.innerHTML = `<div class="dz-top"><span class="qk">${inc.key}</span><span class="ist s-${inc.status}">${inc.status}</span><span class="sp"></span><button class="btn sm ghost" data-i="back">Back to capture</button></div>
    <h2 class="dz-name">${esc(inc.title)}</h2>
    <div class="incmeta"><span>${xs.length} capture${xs.length === 1 ? "" : "s"}</span><span>opened ${ago(inc.created)} ago</span><span>peak risk ${Math.max(0, ...xs.map(x => x.r.risk)).toFixed(2)}</span></div>
    <div class="dz-sec"><div class="hd-h"><span>Response checklist</span><em>${steps.filter(s => s[3]).length} of 5 done</em></div>
      <div class="chk">${steps.map(([k, t, d, ok, ctl], i) => `<div class="ck${ok ? " ok" : ""}"><span class="cn">${ok ? icon("check") : i + 1}</span><div><b>${t}</b><span>${d}</span>${ctl ? `<div class="cc">${ctl}</div>` : ""}</div></div>`).join("")}</div></div>
    <div class="dz-sec"><div class="hd-h"><span>Captures</span><em>click to open</em></div><div class="sims">${xs.map(o => `<button data-sel="${o.r.id}"><span class="sd" style="background:${VERDICT[o.r.verdict].hex}"></span><span class="sn">${o.key} · ${esc(o.r.name)}</span><span class="sr">${o.it.resolution ? OUT[o.it.resolution] : STAT[o.it.status]}</span></button>`).join("")}</div></div>
    <div class="dz-sec"><div class="hd-h"><span>Incident log</span><em>${inc.log.length} events</em></div><div class="tl2">${inc.log.slice().reverse().map(e => `<div><span class="av sm">${initials(e.who)}</span><div><b>${esc(e.who)}</b> ${esc(e.t)}<em>${fmtWhen(e.ts)}</em></div></div>`).join("")}</div></div>`;
  const ilog = t => inc.log.push({ ts: Date.now(), who: ME(), t });
  const on = (k, fn) => $$(`#qDrawer [data-i="${k}"]`).forEach(b => b.onclick = fn);
  on("back", () => { TQ.inc = null; renderQueue(); });
  on("review", () => { xs.forEach(o => { if (o.it.status === "new") { o.it.status = "investigating"; o.it.assignee = o.it.assignee || ME(); tqLog(o.it, `Started investigating (${inc.key})`); } }); ilog("Started investigating every capture"); tqSave(); renderQueue(); });
  on("policy", () => { if (inDemo() && !localStorage.getItem("eg.demo.prevPolicy")) { try { localStorage.setItem("eg.demo.prevPolicy", JSON.stringify({ policy: prefs.policy, name: prefs.policyName })); } catch { /* storage blocked */ } }
    prefs.policy = PRESETS.Strict; prefs.policyName = "Strict"; savePrefs(); renderFootPolicy(); inc.steps.policy = true; ilog("Applied the Strict gate policy"); tqSave(); renderQueue(); toast("Strict policy is now active for every gate evaluation", "ok"); });
  on("source", () => { const t = $("#qSrcNote")?.value.trim(); inc.steps.source = true; ilog(t ? `Source found: ${t}` : "Marked the source as removed"); tqSave(); renderQueue(); });
  on("resolve", () => { xs.forEach(o => { if (o.it.status !== "resolved") { Object.assign(o.it, { status: "resolved", resolution: "attack", assignee: o.it.assignee || ME() }); tqLog(o.it, `Resolved as confirmed attack (${inc.key})`); } }); ilog("Resolved every capture as a confirmed attack"); tqSave(); renderQueue(); });
  on("close", () => { inc.status = "closed"; ilog("Closed the incident"); tqSave(); renderQueue(); toast(`${inc.key} closed`, "ok"); });
  $$("#qDrawer [data-sel]").forEach(b => b.onclick = () => { TQ.inc = null; TQ.sel = b.dataset.sel; renderQueue(); });
}
function updateQueueBadge(all) { const b = $("#queueBadge"); if (!b) return; const n = (all || tqAll()).filter(x => x.it.status === "new").length; b.textContent = n; b.classList.toggle("hidden", !n); }

/* ------------------------------------------------------------ demo seed: a queue that has been worked for a few days */
function tqSeedDemo() {
  const s = { items: {}, incidents: [], rules: [], seq: 2 }, by = n => history.find(r => r.name.startsWith(n)), H = 3600e3;
  const it = (r, st, res, who, log) => { if (!r) return; s.items[r.id] = { status: st, resolution: res, assignee: who, incident: null, created: r.ts,
    log: [{ ts: r.ts, who: "EchoGuard", t: `Flagged ${VERDICT[r.verdict].label.toLowerCase()} · risk ${r.risk.toFixed(2)}` }, ...log.map(([dt, w, t]) => ({ ts: r.ts + dt * H, who: w, t }))] }; };
  history.filter(r => r.name.startsWith("qa_rig3")).forEach(r => it(r, "resolved", "test", "QA bot", [[.1, "QA bot", "Resolved as expected test: scheduled rig run, ticket QA-482"]]));
  const k1 = by("kiosk_lobby_incident_1409"), k2 = by("kiosk_lobby_incident_1412"), k3 = by("kiosk_lobby_incident_1415");
  it(k1, "resolved", "attack", "S. Singha", [[.3, "S. Singha", "Started investigating"], [1.2, "S. Singha", "Resolved as confirmed attack"]]);
  it(k2, "resolved", "attack", "S. Singha", [[.3, "S. Singha", "Started investigating"], [1.2, "S. Singha", "Resolved as confirmed attack"]]);
  it(k3, "investigating", null, "S. Singha", [[.4, "S. Singha", "Started investigating"], [.9, "S. Singha", "noted: “Weaker than the first two: the device was moved, not removed.”"]]);
  const ids = [k1, k2, k3].filter(Boolean).map(r => r.id);
  if (ids.length) { const t0 = (k1 || k2).ts; ids.forEach(id => s.items[id].incident = "INC-001");
    s.incidents.push({ id: "INC-001", key: "INC-001", title: "Lobby kiosk injection burst", status: "open", created: t0 + .25 * H, items: ids, steps: { review: true, policy: false, source: true, resolve: false },
      log: [{ ts: t0 + .25 * H, who: "S. Singha", t: "Opened with 3 captures" }, { ts: t0 + 2 * H, who: "S. Singha", t: "Source found: a Bluetooth speaker taped under the kiosk counter, removed by facilities" }] }); }
  s.rules.push({ id: "R-demo1", label: "Office PA pilot tone", peak: 19500, tol: 200, created: Date.now() - 5 * 864e5, by: "S. Singha", from: "office_pa_system_tone.wav" });
  return s;
}

/* ------------------------------------------------------------ hooks */
$$("#qScope button").forEach(b => b.onclick = () => { $$("#qScope button").forEach(x => x.classList.toggle("on", x === b)); TQ.scope = b.dataset.s; renderQueue(); });
$("#qGroup").onclick = () => { if (!TQ.picked.size) return; const rs = [...TQ.picked].map(id => history.find(r => r.id === id)).filter(Boolean), pk = rs.map(r => window.hxM ? hxM(r).peak : null).filter(Boolean);
  tqIncident([...TQ.picked], pk.length ? `${(pk[0] / 1000).toFixed(1)} kHz carrier · ${rs.length} captures` : `${rs.length} flagged captures`); };
document.addEventListener("click", e => { const b = e.target.closest("[data-qopen]"); if (b) { e.preventDefault(); TQ.sel = b.dataset.qopen; TQ.inc = null; go("queue"); } });
const _tqOverview = renderOverview;
renderOverview = function () { _tqOverview(); try { updateQueueBadge(); } catch { /* history not ready */ } };
if (window.histDetailExtra) {
  const _hde = histDetailExtra;
  histDetailExtra = function (r) {
    if (!isFlag(r.verdict)) return _hde(r);
    const x = tqAll().find(a => a.r.id === r.id); if (!x) return _hde(r);
    return `<div class="hd-sec"><div class="hd-h"><span>Review</span><em>${x.key}</em></div><div class="owner"><span class="ist s-${x.it.status}">${STAT[x.it.status]}</span>${x.it.resolution ? `<span class="qchip o-${x.it.resolution}">${OUT[x.it.resolution]}</span>` : ""}${x.it.incident ? `<span class="qchip incc">${x.it.incident}</span>` : ""}<span class="sp"></span><button class="btn sm" data-qopen="${r.id}">${icon("queue")}Open in review queue</button></div></div>` + _hde(r);
  };
}
const _tqGo = go;
go = function (v, opts) { _tqGo(v, opts); try { updateQueueBadge(); } catch { /* not ready */ } };
const _tqSettings = renderSettings;
renderSettings = function () {
  _tqSettings();
  const el = $("#setData"); if (!el || $("#setAnalyst")) return;
  el.insertAdjacentHTML("afterbegin", settingRow("Your name", "Shown on review assignments and in the activity trail", `<input class="inp" id="setAnalyst" placeholder="You" value="${esc(prefs.analyst || "")}" style="width:180px">`));
  $("#setAnalyst").onchange = e => { prefs.analyst = e.target.value.trim(); savePrefs(); toast("Name saved", "ok"); };
};
