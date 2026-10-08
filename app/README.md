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
(design system), `static/console.js` (rendering, inputs, live monitor, batch).

## Views

| View | What it does |
| --- | --- |
| **Analyze** | Drop or upload a WAV, record from the mic, or pick a sample. The verdict is a sentence that cites the measured numbers (share of energy above 18 kHz, carrier frequency, sideband level) and what an agent should do. Below it: a spectrogram (linear or log frequency, hover readout, carrier and 18 kHz edge marked), a waveform overview with the worst window outlined, a *detection breakdown* whose meters show each measurement against the engine's actual thresholds, a *decision map* placing the capture on the ρA × ρB plane with the 0.33 / 0.66 contours, the Welch spectrum, the window timeline and the agent confirmation gate. |
| **Live monitor** | Microphone or a simulated stream, scored in 1 s windows: a scrolling 60 s spectrogram waterfall, a risk strip with the thresholds, a live gauge and an event log of flagged windows. Unseen flags show as a badge on the nav. |
| **Batch** | Drop many WAVs: KPI counts, a sortable and filterable table with risk bars, CSV export, click a row to open it in Analyze. |
| **Coverage** | Detection through a device capture chain, the agent gate policy, and the attack classes with what a stored recording keeps — what the screen cannot see is shown as plainly as what it can. |
| **API** | Endpoint and Python reference with copy buttons. |

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

POST /api/gate   multipart: file=<wav> action=routine|sensitive|critical [command=...]
    -> decision (allow|confirm|block), verdict, risk, reason, report{}

GET  /api/health -> { status, engine, version, thresholds }
```

```bash
curl -F file=@clip.wav -F window=1.0 http://127.0.0.1:8000/api/scan
curl -F file=@clip.wav -F action=critical -F command="unlock the door" \
     http://127.0.0.1:8000/api/gate
```

## Notes

- Verdicts match `echoguard scan`; the service calls the same `Pipeline`.
- Stateless: uploads (max 25 MB) and live windows are scored in memory and discarded.
- The spectrogram is computed server-side (STFT, 1024-point Hann, 75% overlap) and
  sent as a compact 8-bit grid; the browser colours, rescales and draws it.
- For a deployment, run behind a reverse proxy over HTTPS (browsers only allow
  microphone access on secure origins or localhost) and restrict origins.
