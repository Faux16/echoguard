"""EchoGuard web interface and API.

A thin FastAPI layer over the real engine (`echoguard.Pipeline` and
`echoguard.ConfirmationGate`) — no DSP is reimplemented, so what the UI shows is
exactly what the detector decides. Serves a single-page frontend and two JSON
endpoints:

    POST /api/scan   (multipart WAV [+ window, hop])  -> verdict, evidence, PSD, windows
    POST /api/gate   (multipart WAV + action)         -> allow / confirm / block

Run:
    pip install -e ".[webui]"
    uvicorn app.server:app --reload      # http://127.0.0.1:8000
"""

from __future__ import annotations

import io
import os
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from scipy.io import wavfile

from echoguard import ConfirmationGate, Pipeline
from echoguard.audio import to_float_mono
from echoguard.detectors._dsp import compute_spectrum
from echoguard.detectors.ultrasonic import NEAR_ULTRASOUND_LOW
from echoguard.gate import ActionSensitivity, GateDecision
from echoguard.pipeline import INSUFFICIENT_DATA, InvalidInput

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
MAX_BYTES = 25 * 1024 * 1024          # 25 MB upload cap
MAX_PSD_POINTS = 1024                  # downsample the spectrum for the plot

app = FastAPI(title="EchoGuard", version="0.3.0",
              description="Defensive screen for inaudible voice-command injection.")
_pipeline = Pipeline()
_gate = ConfirmationGate()


def _read_upload(upload: UploadFile) -> tuple[np.ndarray, int]:
    raw = upload.file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "file too large (max 25 MB)")
    if not raw:
        raise HTTPException(400, "empty upload")
    try:
        sr, data = wavfile.read(io.BytesIO(raw))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"could not read WAV: {exc}") from exc
    return to_float_mono(np.asarray(data)).astype(np.float64), int(sr)


def _psd_for_plot(signal: np.ndarray, sr: int) -> dict:
    spec = compute_spectrum(signal, sr)
    freqs, psd = spec.freqs, spec.psd
    if len(freqs) > MAX_PSD_POINTS:
        idx = np.linspace(0, len(freqs) - 1, MAX_PSD_POINTS).astype(int)
        freqs, psd = freqs[idx], psd[idx]
    psd_db = 10.0 * np.log10(np.asarray(psd, dtype=np.float64) + 1e-20)
    return {"freqs_hz": [round(float(f), 1) for f in freqs],
            "psd_db": [round(float(v), 2) for v in psd_db]}


def _annotations(findings: list, sr: int) -> dict:
    ev = {f.name: f.evidence for f in findings}
    carrier = ev.get("carrier_peak", {}) or {}
    oob = ev.get("out_of_band_energy", {}) or {}
    return {
        "nyquist_hz": sr / 2.0,
        "oob_edge_hz": NEAR_ULTRASOUND_LOW,
        "oob_ratio": oob.get("out_of_band_ratio"),
        "oob_level_dbfs": oob.get("out_of_band_level_dbfs"),
        "carrier_peak_hz": carrier.get("peak_freq_hz"),
        "carrier_prominence_db": carrier.get("prominence_db"),
        "carrier_sideband_db": carrier.get("sideband_db"),
    }


def _capture_note(verdict: str, sr: int) -> str:
    if verdict == INSUFFICIENT_DATA:
        return (f"Capture at {sr/1000:.1f} kHz: Nyquist {sr/2000:.1f} kHz is below the "
                f"18 kHz band the screen needs, so the ultrasonic range cannot be assessed. "
                f"This is “could not check”, not “clean”. Capture at ≥ 44.1 kHz for a verdict.")
    if sr < 44100:
        return f"Capture at {sr/1000:.1f} kHz is assessable but narrow; ≥ 44.1 kHz is recommended."
    return f"Capture at {sr/1000:.1f} kHz covers the ultrasonic band."


@app.post("/api/scan")
async def api_scan(file: UploadFile = File(...),
                   window: Optional[float] = Form(1.0),
                   hop: float = Form(0.5)) -> JSONResponse:
    signal, sr = _read_upload(file)
    try:
        if window and window > 0:
            w = _pipeline.analyze_windows(signal, sr, window_sec=window, hop_sec=hop)
            report, windows = w.summary, w.windows
        else:
            report, windows = _pipeline.analyze(signal, sr), []
    except InvalidInput as exc:
        raise HTTPException(400, f"audio cannot be analysed: {exc}") from exc

    payload = report.to_dict()
    payload["filename"] = file.filename
    payload["annotations"] = _annotations(report.findings, sr)
    payload["psd"] = _psd_for_plot(signal, sr)
    payload["capture_note"] = _capture_note(report.verdict, sr)
    payload["windows"] = [
        {"start_sec": round(float(x.start_sec), 3), "verdict": x.verdict,
         "overall_risk": round(float(x.overall_risk), 3)} for x in windows
    ]
    return JSONResponse(payload)


@app.post("/api/gate")
async def api_gate(file: UploadFile = File(...),
                   action: str = Form(...),
                   command: Optional[str] = Form(None),
                   window: Optional[float] = Form(1.0),
                   hop: float = Form(0.5)) -> JSONResponse:
    try:
        sensitivity = ActionSensitivity(action)
    except ValueError:
        raise HTTPException(422, f"action must be one of {[s.value for s in ActionSensitivity]}") from None
    signal, sr = _read_upload(file)
    gate = ConfirmationGate(window_sec=(window or None), hop_sec=hop)
    try:
        result = gate.evaluate(signal, sr, sensitivity, command=command)
    except InvalidInput as exc:
        raise HTTPException(400, f"audio cannot be analysed: {exc}") from exc
    payload = result.to_dict()
    payload["decisions"] = [d.value for d in GateDecision]
    payload["capture_note"] = _capture_note(result.verdict, sr)
    return JSONResponse(payload)


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "engine": "echoguard", "version": app.version}


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(os.path.join(STATIC, "index.html"))


if os.path.isdir(STATIC):
    app.mount("/static", StaticFiles(directory=STATIC), name="static")
