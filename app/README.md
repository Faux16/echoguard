# EchoGuard Console

A web platform over the real engine — `echoguard.Pipeline` and
`echoguard.ConfirmationGate`. No DSP is reimplemented in the browser, so every
number on screen is exactly what the detector computed. It doubles as a demo
surface, an analyst workstation, and an HTTP API.

```bash
pip install -e ".[webui]"
uvicorn app.server:app --reload       # http://127.0.0.1:8000
```

## Views

| View | What it does |
| --- | --- |
| **Analyze** | Upload a WAV, record from the mic, or load a demo (attack / benign / 16 kHz). Shows a spectrogram with the 18 kHz out-of-band edge and any detected carrier marked, a waveform strip, a radial risk gauge with the verdict, telemetry (out-of-band energy and level, carrier frequency, prominence, modulation sideband, narrowness, CFAR floor, Welch d.o.f.), the live decision rule `R = √(ρA·ρB)`, the Welch PSD, the window timeline, and the agent confirmation gate. |
| **Live monitor** | Streams the microphone and scores every 1 s window with the engine: a rolling 60 s risk strip with the 0.33 / 0.66 thresholds, a live gauge, and an event log of flagged windows. Warns if the mic runs below 36 kHz. |
| **Batch** | Drop many WAVs; each is scored in turn. Summary counts, a sortable table (verdict, risk, rate, duration, energy above 18 kHz, carrier), CSV export, and click-a-row to open it in Analyze. |
| **Coverage** | The capture-chain finding, the agent gate policy, and the eleven attack classes with what each leaves in a stored recording — so a viewer sees what the screen cannot detect, not only what it can. |
| **API** | Endpoint reference with `curl` and Python examples. |

Demo clips are synthetic (a voice-like source, plus for "attack" a 20 kHz carrier modulated by a speech-band signal); they carry no command content.

A 16 kHz capture returns **INSUFFICIENT_DATA**, and the console says so plainly — "could not check", not "clean" — because the ultrasonic band is above Nyquist. Most browsers record at 48 kHz, which is assessable.

## API

```
POST /api/scan   multipart: file=<wav> [window=1.0] [hop=0.5]
    -> verdict, overall_risk, sample_rate, duration_sec, findings[], annotations{},
       psd{freqs_hz[], psd_db[]}, spectrogram{shape, data(base64 uint8), fmax_hz, dur_s,
       vmin_db, vmax_db}, waveform[], windows[], capture_note, analysis_ms

POST /api/gate   multipart: file=<wav> action=routine|sensitive|critical [command=...]
    -> decision (allow|confirm|block), verdict, risk, reason, report{}

GET  /api/health -> { status, engine, version }
```

```bash
curl -F file=@clip.wav -F window=1.0 http://127.0.0.1:8000/api/scan
curl -F file=@clip.wav -F action=critical -F command="unlock the door" \
     http://127.0.0.1:8000/api/gate
```

## Notes

- Verdicts match `echoguard scan`; the service calls the same `Pipeline`.
- Stateless: uploads (max 25 MB) and live windows are scored in memory and discarded.
- The spectrogram is computed server-side (STFT, 1024-point Hann, 75% overlap) and sent as a compact 8-bit grid; the browser only colours and draws it.
- For a deployment, run behind a reverse proxy over HTTPS (browsers only allow microphone access on secure origins or localhost) and restrict origins.
