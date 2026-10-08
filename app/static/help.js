/* EchoGuard Console — help text behind every ⓘ.
   Keys are section titles (normalised: lower-case, trimmed) or explicit ids.
   t = what it is · d = what it shows · r = how to read it / what to do. */
"use strict";
const HELP = {
  // pages
  "page:overview": { t: "Overview", d: "A summary of everything analysed in this browser and the state of the engine behind the console.", r: "Click a KPI to open History filtered to it. Click a bar in the trend to open that capture." },
  "page:analyze": { t: "Analyze", d: "Screens one recording for an inaudible (ultrasonic) voice-command injection and explains the decision.", r: "Drop a WAV at 44.1 kHz or higher. Every number comes from the detector; the browser only draws." },
  "page:live": { t: "Live monitor", d: "Scores the microphone (or a simulated stream) one second at a time with the same engine.", r: "Flagged windows go to the event log; save them to History to inspect later." },
  "page:batch": { t: "Batch screening", d: "Scores many WAV files in sequence and tabulates the results.", r: "Click a row to open it in Analyze. Export CSV for a spreadsheet." },
  "page:history": { t: "History", d: "Every capture analysed in this browser, with its audio, kept in IndexedDB on this machine.", r: "Nothing here is on the server. Clear it from Settings or with the button." },
  "page:compare": { t: "Compare", d: "Two stored captures side by side with a difference table.", r: "Useful for before/after: the same room with and without an emitter, or a file through two capture chains." },
  "page:policies": { t: "Gate policies", d: "The rules an agent follows: for each verdict and action class, allow, confirm or block.", r: "The saved policy is sent with every gate evaluation. Dry-run it on a stored capture before saving." },
  "page:coverage": { t: "Coverage & limits", d: "What this screen can and cannot detect once audio has passed through a real device.", r: "Read this before trusting a CLEAR from a phone recording." },
  "page:api": { t: "API", d: "The same engine over HTTP for integrating into an assistant or a pipeline.", r: "Stateless by default; see the README for field-test retention." },
  "page:settings": { t: "Settings", d: "Preferences for this browser only.", r: "" },

  // overview
  "recent captures": { t: "Recent captures", d: "The latest analyses in this browser, newest first, with their risk score and verdict.", r: "Click a row to reopen it in Analyze with the full breakdown." },
  "risk over recent captures": { t: "Risk trend", d: "One bar per capture (last 40, oldest on the left): bar height is the risk score R, colour is the verdict.", r: "Dashed lines mark the 0.33 (suspicious) and 0.66 (high risk) thresholds. Grey stubs are captures that could not be assessed." },
  "quick actions": { t: "Quick actions", d: "Shortcuts to the most common starting points.", r: "" },
  "engine": { t: "Engine", d: "The detector service this console talks to: its version, uptime, the detectors it runs and the constants that decide verdicts.", r: "If this reads offline, nothing can be scored — start the server." },
  "coverage at a glance": { t: "Coverage at a glance", d: "Share of simulated injections still detected after a device's capture chain, from the benchmark (12 attacks per condition).", r: "Raw 192 kHz keeps the carrier; a phone's 48 kHz converter removes most of it; 16 kHz removes it entirely." },

  // analyze
  "verdict": { t: "Verdict", d: "The engine's decision for the whole capture: the worst 1 s window decides. CLEAR, SUSPICIOUS (R ≥ 0.33), HIGH RISK (R ≥ 0.66) or INSUFFICIENT DATA (sample rate too low to look).", r: "The sentence underneath cites the measured values that produced it. 'Insufficient data' is 'could not check', never 'clean'." },
  "risk score": { t: "Risk score R", d: "R = √(ρA × ρB): the geometric mean of the out-of-band energy risk (ρA) and the modulated-carrier risk (ρB).", r: "Both signatures must be present — a loud high band with no carrier, or a tone with no modulation, scores low." },
  "stat:oob": { t: "Energy above 18 kHz", d: "The share of the capture's total energy that lies above the 18 kHz edge, where human voice has none.", r: "Clean recordings sit near 0 %. Above ~1 % is worth a look; above 4.4 % saturates ρA. The dBFS figure is the band's absolute level — it must clear −60 dBFS to count." },
  "stat:carrier": { t: "Carrier", d: "The narrowband peak above 15 kHz that the CFAR detector found, if it also scored as a carrier.", r: "An ultrasonic command is carried on such a tone. A steady tone with no modulation (a beacon, a power supply) is reported here as 'unmodulated tone' and does not count." },
  "stat:sideband": { t: "Modulation sidebands", d: "Energy in the speech-band region on either side of the carrier, relative to the carrier peak.", r: "−60 dB is a bare tone; −35 dB or above is fully modulated — the fingerprint of an amplitude-modulated command." },
  "spectrogram": { t: "Spectrogram", d: "Time (left to right) against frequency (bottom to top); colour is level in dB. Computed server-side with a 1024-point STFT.", r: "The dashed red line is the 18 kHz edge; the shaded band above it is what the out-of-band detector measures. A yellow line marks a detected carrier. Drag to zoom a time range (on the strip above or here); double-click to reset; hover for a readout. Switch to Log to see the voice band in detail." },
  "detection breakdown": { t: "Detection breakdown", d: "Each detector's measurements on meters drawn against the engine's own thresholds, with the engine's detail text.", r: "Click any meter for what it measures and where the thresholds come from. Click a window in the timeline to see this breakdown for that second alone." },
  "decision map": { t: "Decision map", d: "The ρA × ρB plane. The two curves are where R = 0.33 and R = 0.66. The dot is this capture.", r: "Moving right means more high-band energy; moving up means a clearer modulated carrier. Hover to read R at any point." },
  "power spectrum": { t: "Power spectrum", d: "Welch power spectral density of the whole capture: level per frequency.", r: "Voice falls away above ~8 kHz. A spike above 18 kHz with the red edge to its left is the carrier (yellow dot). Hover for the level at any frequency." },
  "window timeline": { t: "Window timeline", d: "The capture is scored in overlapping 1 s windows; each bar is one window's risk, coloured by its verdict.", r: "The brightest bar is the worst window — it sets the overall verdict. Click a bar to select that window and inspect it on its own." },
  "agent confirmation gate": { t: "Agent confirmation gate", d: "What an action-taking assistant should do with a command heard in this capture, under the active policy.", r: "Pick the action's class and evaluate. Critical actions ask for confirmation even on CLEAR by default — the screen is one signal, not a guarantee." },
  "notes & tags": { t: "Notes & tags", d: "Free text and labels stored with this capture in History.", r: "Searchable from History. Type a tag and press Enter." },

  // live
  "spectrogram waterfall": { t: "Spectrogram waterfall", d: "The last 60 s of audio, one second per column, scored by the engine as it arrives.", r: "Dashed red is the 18 kHz edge. A persistent bright line above it is a carrier; look at the risk strip below for the engine's view." },
  "current window": { t: "Current window", d: "The verdict and risk of the most recent 1 s window.", r: "" },
  "session": { t: "Session", d: "Counts since the monitor was started: windows scored, flagged, peak and mean risk.", r: "" },
  "event log": { t: "Event log", d: "Every window the engine flagged, newest first, with its carrier and sideband measurements.", r: "'Save flags' copies them to History with their audio so they can be reopened in Analyze." },

  // batch / history / compare
  "results": { t: "Results", d: "One row per file: verdict, risk, sample rate, duration and the two headline measurements.", r: "Sort by clicking a column; filter with the buttons; click a row to open it in Analyze." },
  "differences": { t: "Differences", d: "B minus A for each measure. Green is towards clean, red towards injection.", r: "" },

  // policies
  "policy matrix": { t: "Policy matrix", d: "Rows are how sensitive an action is; columns are the verdict; each cell is what the agent does.", r: "Edit cells, then Save as active. Reset restores the engine's default." },
  "what each decision means": { t: "Decisions", d: "allow / confirm / block, and the exit codes the CLI returns so shell pipelines can branch on them.", r: "" },
  "policy as json": { t: "Policy as JSON", d: "The exact object the console sends as the policy form field to /api/gate.", r: "Copy it into your own integration." },
  "presets": { t: "Presets", d: "Starting points: the engine default, a stricter one, a permissive one, and audit-only (never blocks, always logs).", r: "" },
  "dry run": { t: "Dry run", d: "Evaluates a stored capture under the policy being edited, for all three action classes, without saving.", r: "" },
  "principles": { t: "Principles", d: "The reasoning behind the default policy.", r: "" },

  // coverage
  "detection through a device capture chain": { t: "Capture chain", d: "Benchmark result: the same 12 simulated injections, with and without a simulated ADC anti-alias filter and resampling.", r: "The carrier lives above 20 kHz; anything that low-passes before storing audio removes it. Click a bar for details." },
  "default agent gate policy": { t: "Gate policy", d: "The matrix currently in force for gate evaluations.", r: "" },
  "attack classes": { t: "Attack classes", d: "The eleven classes in docs/threat_model.md, with what this screen can see of each and what public data exists.", r: "Chips: amber = partial, red = not covered or no data, green = covered." },

  // api
  "scan response": { t: "Scan response", d: "Fields returned by POST /api/scan and what they mean.", r: "" },

  // settings
  "appearance": { t: "Appearance", d: "Theme, density and sidebar state, stored in this browser.", r: "" },
  "analysis defaults": { t: "Analysis defaults", d: "Window and hop lengths sent with every scan. The worst window decides the verdict.", r: "Shorter windows localise an injection in time; longer ones average more noise." },
  "data & privacy": { t: "Data & privacy", d: "Where things are kept: captures in this browser's IndexedDB, preferences in localStorage, nothing on the server unless field-test retention is on.", r: "" },
  "keyboard shortcuts": { t: "Keyboard shortcuts", d: "", r: "" },
  "about": { t: "About", d: "", r: "" },

  // compare rows
  "cmp:rate": { t: "Sample rate", d: "How many samples per second the capture holds; the highest frequency it can contain is half of that (Nyquist).", r: "Two captures at different rates are not directly comparable above the lower Nyquist. Below 36 kHz the engine cannot assess the ultrasonic band at all." },
  "cmp:duration": { t: "Duration", d: "Length of the capture; it is scored in overlapping 1 s windows and the worst window decides.", r: "A longer clean capture gives more chances for a false alarm; a longer attack gives more chances to catch it." },
  "rho:a": { t: "ρA — out-of-band energy risk", d: "Risk from the share of energy above 18 kHz: 0 at 1.1 %, 1 at 4.4 % (requires the band to clear −60 dBFS).", r: "" },
  "rho:b": { t: "ρB — modulated carrier risk", d: "Risk from a narrowband peak above 15 kHz: prominence over the CFAR floor × narrowness × modulation-sideband strength.", r: "A bare tone (no sidebands) is capped near 0.05 regardless of how loud it is." },
  "live:window": { t: "Live window", d: "One second of audio scored on its own by the engine, exactly as a file would be.", r: "Open it in Analyze for the full breakdown, or save it to History to keep it." },

  // meters (dynamic values are appended by the console)
  "meter:oob_ratio": { t: "Share of energy above 18 kHz", d: "Energy in 18 kHz–Nyquist divided by total energy, from the Welch spectrum.", r: "Risk ρA rises from 0 at 1.1 % to 1 at 4.4 %; the detector saturates at 10 %. Human voice has essentially nothing here, so a few percent is already striking." },
  "meter:oob_level": { t: "Band level floor", d: "Absolute level of the high band in dBFS.", r: "Below −60 dBFS the band is treated as empty even if its share is high — guards against near-silent recordings where tiny noise dominates the ratio." },
  "meter:prominence": { t: "Peak above CFAR noise floor", d: "How far the strongest high-band bin stands above a constant-false-alarm-rate threshold derived from the Welch estimate's chi-square statistics.", r: "Saturates at 30 dB. A real carrier is typically tens of dB above the floor." },
  "meter:narrowness": { t: "Peak narrowness", d: "Fraction of the peak's local energy concentrated in its central bins: 1.0 is a pure tone, lower is broadband noise.", r: "Below 0.60 the peak does not count as a tone; above 0.85 it fully counts." },
  "meter:sideband": { t: "Modulation sidebands", d: "Level of the bands either side of the carrier (speech-band offsets) relative to the carrier peak.", r: "Below −60 dB the carrier is a bare tone (ρB ≈ 0.05 at most: beacons, whine). From −60 to −35 dB risk rises linearly. A bare tone can never reach HIGH RISK on its own." },
};
