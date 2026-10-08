# EchoGuard web interface

A thin FastAPI layer over the real engine — `echoguard.Pipeline` and
`echoguard.ConfirmationGate`. No DSP is reimplemented, so the UI shows exactly
what the detector decides. It is a demo surface, an analyst view, and an
integration API in one.

```bash
pip install -e ".[webui]"
uvicorn app.server:app --reload       # http://127.0.0.1:8000
```

## The page

Upload a WAV or record from the microphone, and see:

- the **verdict** (CLEAR / SUSPICIOUS / HIGH_RISK / INSUFFICIENT_DATA) and risk;
- the **spectrum**, with the 18 kHz out-of-band edge and any detected carrier peak marked;
- the **per-detector evidence** (out-of-band ratio, carrier prominence, sideband, roll-off);
- the **windowed timeline**, showing where the worst window is;
- an **agent confirmation gate** — pick an action sensitivity and get allow / confirm / block.

A capture-rate note is shown prominently: a 16 kHz upload returns INSUFFICIENT_DATA,
and the page says so plainly ("could not check", not "clean"), because the
ultrasonic band is below Nyquist. Record or upload at ≥ 44.1 kHz for a verdict.
Most browsers capture at 48 kHz, which is assessable.

## API

```
POST /api/scan   multipart: file=<wav> [window=1.0] [hop=0.5]
    -> { verdict, overall_risk, sample_rate, duration_sec, findings[],
         annotations{...}, psd{freqs_hz[],psd_db[]}, windows[], capture_note }

POST /api/gate   multipart: file=<wav> action=routine|sensitive|critical [command=...]
    -> { decision: allow|confirm|block, verdict, risk, reason, report{...} }

GET  /api/health -> { status, engine, version }
```

Example:

```bash
curl -F file=@clip.wav -F window=1.0 http://127.0.0.1:8000/api/scan
curl -F file=@clip.wav -F action=critical -F command="unlock the door" \
     http://127.0.0.1:8000/api/gate
```

## Notes

- The service calls the same `Pipeline` as the CLI; verdicts match `echoguard scan`.
- Uploads are capped at 25 MB. The server holds no state and stores nothing.
- For a deployment, run uvicorn/gunicorn behind a reverse proxy and restrict origins.
