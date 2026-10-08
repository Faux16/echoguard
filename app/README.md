# EchoGuard Console

A web platform over the real engine — `echoguard.Pipeline` and
`echoguard.ConfirmationGate`. No DSP is reimplemented in the browser: every
number on screen, every meter threshold and every verdict sentence is derived
from the detector's own output and its own constants (served in the scan
response as `thresholds`). It is a demo surface, an analyst workstation and an
HTTP API in one.

```bash
pip install -e ".[webui]"
uvicorn app.server:app --reload       # http://127.0.0.1:8000
```

Files: `server.py` (FastAPI), `static/index.html` (structure), `static/console.css`
(design system: theme tokens, components, density, print), `static/console.js`
(routing, rendering, inputs, live monitor, persistence).

## Views

| View | What it does |
| --- | --- |
| **Executive** | The fleet-level view: screenings per day stacked by verdict, verdict mix, flag rate over assessable captures, capture quality (sample rates and assessable share), detected-carrier histogram, gate decisions, a per-source table (volume, flag rate, could-not-assess share, peak risk, last seen) and recent flagged captures, for 7 / 30 / 90 / 365 days, with a print layout. Reads `/api/fleet` when retention is on, otherwise this browser's History (and says so). |
| **Overview** | Session KPIs (captures, flagged, could-not-assess, last verdict), recent captures, a risk trend over the last 40 captures, quick actions, engine status (version, uptime, detectors, thresholds) and the capture-chain coverage chart. |
| **Analyze** | Drop or upload a WAV, record from the mic, or pick a sample. The verdict is a sentence that cites the measured numbers (share of energy above 18 kHz, carrier frequency, sideband level) and what an agent should do. Below it: a spectrogram (linear or log frequency, hover readout, carrier and 18 kHz edge marked), a waveform overview with the worst window outlined, a *detection breakdown* whose meters show each measurement against the engine's actual thresholds, a *decision map* on the ρA × ρB plane with the 0.33 / 0.66 contours, the Welch spectrum, the window timeline, the agent confirmation gate (under the active policy) and notes/tags. Export as JSON, a self-contained HTML report, the spectrogram PNG or the WAV. |
| **Live monitor** | Microphone or a simulated stream, scored in 1 s windows: a scrolling 60 s spectrogram waterfall, a risk strip, a gauge and an event log. Flagged windows can be saved to History; unseen flags show as a badge on the nav. |
| **Batch** | Drop many WAVs: KPI counts, a sortable and filterable table with risk bars, CSV export; rows open in Analyze and are added to History. |
| **History** | Every analysed capture (upload, recording, batch, saved live flags) with its audio, kept in the browser's IndexedDB. Search by name, tag or note; filter; sort; export JSON/CSV; delete; open; send to Compare. Samples are not stored unless you ask. |
| **Compare** | Two captures side by side with the verdict narrative, measurements and a B − A difference table (risk, out-of-band share, carrier, sidebands, ρA, ρB). |
| **Gate policies** | Edit the verdict × action-class → allow/confirm/block matrix, pick a preset (Default, Strict, Permissive, Audit only), dry-run it against a stored capture, and save it as the active policy — which is then sent to `/api/gate` with every evaluation. |
| **Coverage & limits** | Detection through a device capture chain, the active gate policy, and the attack classes with what a stored recording keeps — what the screen cannot see is shown as plainly as what it can. |
| **API** | Endpoint and Python reference with copy buttons. |
| **Settings** | Theme (system / dark / light), density, sidebar, analysis window and hop, autosave, toasts, local-storage usage, shortcuts, about. |

Platform: collapsible sidebar (`[`), dark and light themes (`T`), a command
palette (`⌘K`) that jumps to views, actions, samples and history, number keys
for views, hash routing, toasts, whole-page drag-and-drop, and print styles.
Preferences live in `localStorage`; captures live in IndexedDB. Nothing is
stored server-side.

The samples are synthetic — a formant-synthesised voice with no words, plus (for
the injection sample) a 20 kHz carrier modulated by a second voice-like signal;
the beacon sample adds an unmodulated 19 kHz tone; the phone sample is the
injection recorded at 16 kHz. Their thumbnails and verdicts come from the engine
at page load, so the cards show what the detector actually does with them.

A 16 kHz capture returns **INSUFFICIENT_DATA** and the page says so plainly —
"could not look", not "clean" — because the ultrasonic band is above Nyquist.
Most browsers record at 48 kHz, which is assessable.

## API

```
POST /api/scan   multipart: file=<wav> [window=1.0] [hop=0.5]
    -> verdict, overall_risk, sample_rate, duration_sec, findings[], annotations{},
       thresholds{}, psd{freqs_hz[], psd_db[]}, spectrogram{shape, data(base64 uint8),
       fmax_hz, dur_s, vmin_db, vmax_db}, waveform[], windows[], capture_note, analysis_ms

POST /api/gate   multipart: file=<wav> action=routine|sensitive|critical
                 [command=...] [window] [hop] [policy=<json>]
    -> decision (allow|confirm|block), verdict, risk, reason, policy_source, report{}

GET  /api/fleet?days=30 -> { enabled, total, scored, flagged, by_verdict{}, by_day[], clients[],
                            rates[], assessable_share, carriers_hz[], latency_ms{}, gates{},
                            mean_risk, recent_flagged[] }   (enabled:false without retention)

GET  /api/health -> { status, engine, version, uptime_s, detectors[], thresholds{},
                      default_policy{}, verdicts[] }
```

`policy` is a JSON object `{sensitivity: {verdict: decision}}`; any sensitivity
left out falls back to the engine default, and a malformed matrix is a 422.

```bash
curl -F file=@clip.wav -F window=1.0 http://127.0.0.1:8000/api/scan
curl -F file=@clip.wav -F action=critical -F command="unlock the door" \
     -F policy='{"critical":{"CLEAR":"confirm","SUSPICIOUS":"block","HIGH_RISK":"block","INSUFFICIENT_DATA":"block"}}' \
     http://127.0.0.1:8000/api/gate
```

## Field testing: retaining uploads

By default the server is stateless. For a field test where you want to inspect
what testers sent, set `ECHOGUARD_CAPTURE_DIR`; every `/api/scan` and
`/api/gate` upload is then written there as `<utc>_<client>_<kind>_<name>.wav`
plus a `.json` with the engine result and request metadata. `/api/health`
reports `retention: true` and the console tells users on load.

```bash
ECHOGUARD_CAPTURE_DIR=./captures uvicorn app.server:app --host 0.0.0.0
python -m app.review_captures ./captures          # one line per upload + counts
```

Serving on the network: bind `--host 0.0.0.0`. Microphone capture needs a
secure context, so put HTTPS in front for other machines, e.g.
`caddy reverse-proxy --from https://<lan-ip>:8443 --to http://127.0.0.1:8000 --internal-certs`
(testers accept the self-signed certificate once).

## Notes

- Verdicts match `echoguard scan`; the service calls the same `Pipeline`.
- Stateless unless `ECHOGUARD_CAPTURE_DIR` is set: uploads (max 25 MB) and live windows are scored in memory and discarded.
- The spectrogram is computed server-side (STFT, 1024-point Hann, 75% overlap) and
  sent as a compact 8-bit grid; the browser colours, rescales and draws it.
- For a deployment, run behind a reverse proxy over HTTPS (browsers only allow
  microphone access on secure origins or localhost) and restrict origins.
