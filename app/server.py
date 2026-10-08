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

import base64
import io
import json
import os
import time
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from scipy import signal as sps
from scipy.io import wavfile

from echoguard import ConfirmationGate, Pipeline
from echoguard.audio import to_float_mono
from echoguard.detectors._dsp import compute_spectrum
from echoguard.detectors import modulation as _mod
from echoguard.detectors import ultrasonic as _oob
from echoguard.detectors.ultrasonic import NEAR_ULTRASOUND_LOW
from echoguard.gate import DEFAULT_POLICY, ActionSensitivity, GateDecision
from echoguard.pipeline import HIGH_RISK_RISK, INSUFFICIENT_DATA, SUSPICIOUS_RISK, VERDICTS, InvalidInput

# The engine's own constants, so the UI's meters show real thresholds rather than guesses.
THRESHOLDS = {
    "suspicious_risk": SUSPICIOUS_RISK,
    "high_risk": HIGH_RISK_RISK,
    "oob_edge_hz": _oob.NEAR_ULTRASOUND_LOW,
    "oob_saturation_ratio": _oob.SATURATION_RATIO,
    "oob_min_level_dbfs": _oob.MIN_BAND_LEVEL_DBFS,
    "carrier_band_low_hz": _mod.HIGH_BAND_LOW,
    "carrier_prominence_saturation_db": _mod.PROMINENCE_DB_SATURATION,
    "narrow_floor": _mod.NARROW_FLOOR,
    "narrow_full": _mod.NARROW_FULL,
    "sideband_floor_db": _mod.SIDEBAND_FLOOR_DB,
    "sideband_full_db": _mod.SIDEBAND_FULL_DB,
}

HERE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(HERE, "static")
MAX_BYTES = 25 * 1024 * 1024          # 25 MB upload cap
MAX_PSD_POINTS = 1024                  # downsample the spectrum for the plot

app = FastAPI(title="EchoGuard", version="0.3.0",
              description="Defensive screen for inaudible voice-command injection.")
_pipeline = Pipeline()
_gate = ConfirmationGate()
_started = time.time()


def default_policy_json() -> dict:
    return {s.value: {v: d.value for v, d in m.items()} for s, m in DEFAULT_POLICY.items()}


def parse_policy(raw: Optional[str]) -> Optional[dict]:
    """Validate a {sensitivity: {verdict: decision}} JSON policy from the client."""
    if not raw:
        return None
    try:
        obj = json.loads(raw)
    except ValueError as exc:
        raise HTTPException(422, f"policy is not valid JSON: {exc}") from None
    if not isinstance(obj, dict):
        raise HTTPException(422, "policy must be an object of sensitivity -> verdict -> decision")
    out: dict = {}
    for s_key, row in obj.items():
        try:
            sens = ActionSensitivity(s_key)
        except ValueError:
            raise HTTPException(422, f"unknown sensitivity {s_key!r}") from None
        if not isinstance(row, dict) or set(row) != set(VERDICTS):
            raise HTTPException(422, f"policy[{s_key}] must map every verdict {list(VERDICTS)}")
        try:
            out[sens] = {v: GateDecision(d) for v, d in row.items()}
        except ValueError as exc:
            raise HTTPException(422, f"policy[{s_key}]: {exc}") from None
    # fill any sensitivity the client left out with the default
    for sens, row in DEFAULT_POLICY.items():
        out.setdefault(sens, row)
    return out


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


def _waveform(signal: np.ndarray, points: int = 900) -> list:
    """Downsampled peak envelope in [0,1] for the overview strip."""
    n = len(signal)
    if n <= points:
        env = np.abs(signal)
    else:
        step = n // points
        env = np.abs(signal[: step * points]).reshape(points, step).max(axis=1)
    peak = float(env.max()) or 1.0
    return [round(float(v / peak), 3) for v in env]


def _spectrogram(signal: np.ndarray, sr: int, n_freq: int = 240, n_time: int = 480) -> dict:
    """STFT magnitude as a base64 uint8 grid (rows high->low freq), for a heatmap.

    Returns the grid plus the dB range and the frequency/time extents so the
    client can place axes and the 18 kHz line.
    """
    nper = 1024 if len(signal) >= 1024 else max(256, len(signal))
    # boundary=None / padded=False: no zero-padded edge frames (they paint bright vertical bars)
    f, t, zxx = sps.stft(signal, fs=sr, nperseg=nper, noverlap=nper * 3 // 4,
                         boundary=None, padded=False)
    mag = 20.0 * np.log10(np.abs(zxx) + 1e-10)           # (freq, time)
    # resample to a fixed grid
    if mag.shape[1] > n_time:
        cols = np.linspace(0, mag.shape[1] - 1, n_time).astype(int)
        mag, t = mag[:, cols], t[cols]
    if mag.shape[0] > n_freq:
        rows = np.linspace(0, mag.shape[0] - 1, n_freq).astype(int)
        mag, f = mag[rows, :], f[rows]
    vmax = float(np.percentile(mag, 99.7))
    vmin = max(float(np.percentile(mag, 25)), vmax - 70.0)  # floor at the quieter quartile
    u8 = np.clip((mag - vmin) / (vmax - vmin), 0, 1) * 255.0
    u8 = np.flipud(u8).astype(np.uint8)                   # row 0 = highest freq
    return {
        "shape": [int(u8.shape[0]), int(u8.shape[1])],
        "data": base64.b64encode(u8.tobytes()).decode("ascii"),
        "fmax_hz": float(f[-1]),
        "dur_s": float(t[-1]) if len(t) else 0.0,
        "vmin_db": round(vmin, 1), "vmax_db": round(vmax, 1),
    }


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
    t0 = time.perf_counter()
    try:
        if window and window > 0:
            w = _pipeline.analyze_windows(signal, sr, window_sec=window, hop_sec=hop)
            report, windows = w.summary, w.windows
        else:
            report, windows = _pipeline.analyze(signal, sr), []
    except InvalidInput as exc:
        raise HTTPException(400, f"audio cannot be analysed: {exc}") from exc
    analysis_ms = round((time.perf_counter() - t0) * 1000, 1)

    payload = report.to_dict()
    payload["filename"] = file.filename
    payload["annotations"] = _annotations(report.findings, sr)
    payload["psd"] = _psd_for_plot(signal, sr)
    payload["spectrogram"] = _spectrogram(signal, sr)
    payload["waveform"] = _waveform(signal)
    payload["capture_note"] = _capture_note(report.verdict, sr)
    payload["analysis_ms"] = analysis_ms
    payload["thresholds"] = THRESHOLDS
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
                   hop: float = Form(0.5),
                   policy: Optional[str] = Form(None)) -> JSONResponse:
    try:
        sensitivity = ActionSensitivity(action)
    except ValueError:
        raise HTTPException(422, f"action must be one of {[s.value for s in ActionSensitivity]}") from None
    custom = parse_policy(policy)
    signal, sr = _read_upload(file)
    gate = ConfirmationGate(policy=custom, window_sec=(window or None), hop_sec=hop)
    try:
        result = gate.evaluate(signal, sr, sensitivity, command=command)
    except InvalidInput as exc:
        raise HTTPException(400, f"audio cannot be analysed: {exc}") from exc
    payload = result.to_dict()
    payload["decisions"] = [d.value for d in GateDecision]
    payload["policy_source"] = "custom" if custom else "default"
    payload["capture_note"] = _capture_note(result.verdict, sr)
    return JSONResponse(payload)


@app.get("/api/health")
async def health() -> dict:
    return {
        "status": "ok", "engine": "echoguard", "version": app.version,
        "uptime_s": round(time.time() - _started, 1),
        "detectors": [d.name for d in _pipeline.detectors],
        "thresholds": THRESHOLDS,
        "default_policy": default_policy_json(),
        "verdicts": list(VERDICTS),
    }


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(os.path.join(STATIC, "index.html"))


if os.path.isdir(STATIC):
    app.mount("/static", StaticFiles(directory=STATIC), name="static")
