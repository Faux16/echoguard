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
import re
import time
from datetime import datetime, timezone
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
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
from echoguard.trust import Layer, SpeakerProfile, TrustContext, TrustGate, default_checks
from echoguard.trust.checks.liveness import SpoofScorer
from echoguard.trust.checks.speaker import Embedder

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
PROFILES_DIR = os.environ.get("ECHOGUARD_PROFILES_DIR") or os.path.join(os.path.expanduser("~"), ".cache", "echoguard", "profiles")
STATIC = os.path.join(HERE, "static")
# Opt-in retention for field testing: when set, every upload and its result are written
# here. Off by default (stateless); the UI tells users when it is on.
CAPTURE_DIR = os.environ.get("ECHOGUARD_CAPTURE_DIR") or None
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


def _read_upload(upload: UploadFile) -> tuple[np.ndarray, int, bytes]:
    raw = upload.file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(413, "file too large (max 25 MB)")
    if not raw:
        raise HTTPException(400, "empty upload")
    try:
        sr, data = wavfile.read(io.BytesIO(raw))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"could not read WAV: {exc}") from exc
    return to_float_mono(np.asarray(data)).astype(np.float64), int(sr), raw


def _retain(kind: str, request: Request, filename: Optional[str], raw: bytes, result: dict) -> Optional[str]:
    """Write the upload and a light copy of its result to CAPTURE_DIR (if enabled)."""
    if not CAPTURE_DIR:
        return None
    os.makedirs(CAPTURE_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%f")[:-3] + "Z"
    client = (request.client.host if request.client else "unknown").replace(":", "_")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", os.path.basename(filename or "upload.wav"))[:80]
    base = os.path.join(CAPTURE_DIR, f"{stamp}_{client}_{kind}_{safe}")
    with open(base + ".wav", "wb") as fh:
        fh.write(raw)
    light = {k: v for k, v in result.items() if k not in ("spectrogram", "psd", "waveform")}
    light["_meta"] = {"received_utc": stamp, "client": client, "kind": kind,
                      "user_agent": request.headers.get("user-agent", ""), "bytes": len(raw)}
    with open(base + ".json", "w", encoding="utf-8") as fh:
        json.dump(light, fh, indent=1, default=str)
    return base


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
async def api_scan(request: Request,
                   file: UploadFile = File(...),
                   window: Optional[float] = Form(1.0),
                   hop: float = Form(0.5)) -> JSONResponse:
    signal, sr, raw = _read_upload(file)
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
    _retain("scan", request, file.filename, raw, payload)
    return JSONResponse(payload)


@app.post("/api/gate")
async def api_gate(request: Request,
                   file: UploadFile = File(...),
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
    signal, sr, raw = _read_upload(file)
    gate = ConfirmationGate(policy=custom, window_sec=(window or None), hop_sec=hop)
    try:
        result = gate.evaluate(signal, sr, sensitivity, command=command)
    except InvalidInput as exc:
        raise HTTPException(400, f"audio cannot be analysed: {exc}") from exc
    payload = result.to_dict()
    payload["decisions"] = [d.value for d in GateDecision]
    payload["policy_source"] = "custom" if custom else "default"
    payload["capture_note"] = _capture_note(result.verdict, sr)
    _retain("gate", request, file.filename, raw, {**payload, "filename": file.filename, "action": action, "policy": policy})
    return JSONResponse(payload)


_fleet_cache: dict = {"key": None, "rows": []}


def _load_captures() -> list[dict]:
    """Parse every retained result once per change (keyed on the directory listing + mtimes)."""
    if not CAPTURE_DIR or not os.path.isdir(CAPTURE_DIR):
        return []
    names = sorted(n for n in os.listdir(CAPTURE_DIR) if n.endswith(".json"))
    key = tuple((n, os.path.getmtime(os.path.join(CAPTURE_DIR, n))) for n in names)
    if key == _fleet_cache["key"]:
        return _fleet_cache["rows"]
    rows = []
    for n in names:
        try:
            with open(os.path.join(CAPTURE_DIR, n), encoding="utf-8") as fh:
                d = json.load(fh)
        except (OSError, ValueError):
            continue
        meta, rep = d.get("_meta", {}), d.get("report") or d
        ev = {f["name"]: f.get("evidence") or {} for f in rep.get("findings", [])}
        ann = d.get("annotations") or {
            "oob_ratio": ev.get("out_of_band_energy", {}).get("out_of_band_ratio"),
            "carrier_peak_hz": ev.get("carrier_peak", {}).get("peak_freq_hz"),
            "carrier_sideband_db": ev.get("carrier_peak", {}).get("sideband_db")}
        car = next((f for f in rep.get("findings", []) if f["name"] == "carrier_peak"), None)
        carrier = ann.get("carrier_peak_hz") if car and car.get("assessable") and car.get("risk", 0) >= SUSPICIOUS_RISK else None
        try:
            ts = datetime.strptime(meta.get("received_utc", "")[:19], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            ts = os.path.getmtime(os.path.join(CAPTURE_DIR, n))
        rows.append({
            "ts": ts, "client": meta.get("client", "unknown"), "kind": meta.get("kind", "scan"),
            "file": d.get("filename") or n, "verdict": d.get("verdict"), "risk": d.get("overall_risk", d.get("risk")),
            "sr": rep.get("sample_rate"), "dur": rep.get("duration_sec"), "oob": ann.get("oob_ratio"),
            "carrier": carrier, "sideband": ann.get("carrier_sideband_db"), "ms": d.get("analysis_ms"),
            "decision": d.get("decision"), "action": d.get("action"),
        })
    _fleet_cache.update(key=key, rows=rows)
    return rows


@app.get("/api/fleet")
async def fleet(days: int = 30) -> dict:
    """Aggregates over retained captures for the executive view."""
    if not CAPTURE_DIR:
        return {"enabled": False}
    days = max(1, min(int(days), 365))
    now = time.time()
    rows = [r for r in _load_captures() if r["ts"] >= now - days * 86400]
    by_day: dict[str, dict] = {}
    for r in rows:
        day = datetime.fromtimestamp(r["ts"], timezone.utc).strftime("%Y-%m-%d")
        by_day.setdefault(day, dict.fromkeys(VERDICTS, 0))
        if r["verdict"] in VERDICTS:
            by_day[day][r["verdict"]] += 1
    clients: dict[str, dict] = {}
    for r in rows:
        c = clients.setdefault(r["client"], {"client": r["client"], "n": 0, "flagged": 0, "insufficient": 0, "last_ts": 0, "peak": 0.0})
        c["n"] += 1
        c["flagged"] += r["verdict"] in ("SUSPICIOUS", "HIGH_RISK")
        c["insufficient"] += r["verdict"] == INSUFFICIENT_DATA
        c["last_ts"] = max(c["last_ts"], r["ts"])
        c["peak"] = max(c["peak"], float(r["risk"] or 0))
    rates: dict[int, int] = {}
    for r in rows:
        if r["sr"]:
            rates[int(r["sr"])] = rates.get(int(r["sr"]), 0) + 1
    carriers = sorted(float(r["carrier"]) for r in rows if r["carrier"])
    ms = sorted(float(r["ms"]) for r in rows if r["ms"] is not None)
    gates = {d.value: 0 for d in GateDecision}
    for r in rows:
        if r["decision"] in gates:
            gates[r["decision"]] += 1
    scored = [r for r in rows if r["verdict"] in ("CLEAR", "SUSPICIOUS", "HIGH_RISK")]
    flagged = [r for r in rows if r["verdict"] in ("SUSPICIOUS", "HIGH_RISK")]
    return {
        "enabled": True, "days": days, "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "total": len(rows), "scored": len(scored), "flagged": len(flagged),
        "by_verdict": {v: sum(r["verdict"] == v for r in rows) for v in VERDICTS},
        "by_day": [{"day": d, **v} for d, v in sorted(by_day.items())],
        "clients": sorted(clients.values(), key=lambda c: -c["n"]),
        "rates": [{"sr": sr, "n": n} for sr, n in sorted(rates.items())],
        "assessable_share": (sum(n for sr, n in rates.items() if sr >= 36_000) / sum(rates.values())) if rates else None,
        "carriers_hz": carriers,
        "latency_ms": {"p50": ms[len(ms) // 2], "p95": ms[int(len(ms) * .95) - 1 if len(ms) > 1 else 0], "max": ms[-1]} if ms else None,
        "gates": gates,
        "mean_risk": (sum(float(r["risk"] or 0) for r in scored) / len(scored)) if scored else None,
        "recent_flagged": [
            {k: r[k] for k in ("ts", "client", "file", "verdict", "risk", "sr", "carrier", "sideband", "oob")}
            for r in sorted(flagged, key=lambda r: -r["ts"])[:12]
        ],
    }


# ---------------------------------------------------------------- trust layer

_trust_gate = TrustGate()


def _profile_path(pid: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", pid)[:64]
    return os.path.join(PROFILES_DIR, safe + ".json")


def _list_profiles() -> list[dict]:
    if not os.path.isdir(PROFILES_DIR):
        return []
    out = []
    for n in sorted(os.listdir(PROFILES_DIR)):
        if n.endswith(".json"):
            try:
                p = SpeakerProfile.load(os.path.join(PROFILES_DIR, n))
                out.append({"id": n[:-5], "name": p.name, "utterances": p.n_utterances, "meta": p.meta})
            except (OSError, ValueError, KeyError):
                continue
    return out


def _trust_models() -> dict:
    """Which optional models are loaded right now (never triggers a load)."""
    return {"speaker_embedder": Embedder.shared()._enc is not None,
            "anti_spoofing": SpoofScorer.shared()._model is not None}


@app.get("/api/profiles")
async def api_profiles() -> dict:
    return {"profiles": _list_profiles(), "models": _trust_models()}


@app.post("/api/enrol")
async def api_enrol(request: Request, name: str = Form(...), files: list[UploadFile] = File(...)) -> JSONResponse:
    """Enrol a speaker from one or more WAVs; returns the profile id."""
    if not name.strip():
        raise HTTPException(422, "name is required")
    emb = Embedder.shared()
    if not emb.available:
        raise HTTPException(503, emb.error or "speech model unavailable")
    utts = []
    for f in files:
        sig, sr, _ = _read_upload(f)
        if len(sig) < 0.8 * sr:
            raise HTTPException(400, f"{f.filename}: enrolment utterances must be at least 0.8 s")
        utts.append((sig, sr))
    profile = SpeakerProfile.enrol(name.strip(), utts, embedder=emb)
    profile.meta = {"enrolled_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    "client": request.client.host if request.client else "unknown"}
    pid = re.sub(r"[^A-Za-z0-9._-]+", "_", name.strip().lower())[:40] + "_" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    os.makedirs(PROFILES_DIR, exist_ok=True)
    profile.save(_profile_path(pid))
    return JSONResponse({"id": pid, "name": profile.name, "utterances": profile.n_utterances})


@app.delete("/api/profiles/{pid}")
async def api_profile_delete(pid: str) -> dict:
    path = _profile_path(pid)
    if not os.path.exists(path):
        raise HTTPException(404, "no such profile")
    os.remove(path)
    return {"deleted": pid}


@app.post("/api/trust")
async def api_trust(request: Request,
                    file: UploadFile = File(...),
                    action: str = Form(...),
                    transcript: Optional[str] = Form(None),
                    alt_transcript: Optional[str] = Form(None),
                    wake: Optional[UploadFile] = File(None),
                    profile_id: Optional[str] = Form(None),
                    command: Optional[str] = Form(None),
                    required_layers: Optional[str] = Form(None)) -> JSONResponse:
    """Run every trust check on a command and return the gate decision with the full tuple."""
    try:
        sensitivity = ActionSensitivity(action)
    except ValueError:
        raise HTTPException(422, f"action must be one of {[s.value for s in ActionSensitivity]}") from None
    signal, sr, raw = _read_upload(file)
    wake_sig = None
    if wake is not None and wake.filename:
        wake_sig, wsr, _ = _read_upload(wake)
        if wsr != sr:
            raise HTTPException(422, "wake and command must have the same sample rate")
    profile = None
    if profile_id:
        path = _profile_path(profile_id)
        if not os.path.exists(path):
            raise HTTPException(404, "no such profile")
        profile = SpeakerProfile.load(path)
    gate = _trust_gate
    if required_layers:
        try:
            layers = tuple(Layer(x.strip()) for x in required_layers.split(",") if x.strip())
        except ValueError:
            raise HTTPException(422, "required_layers must be a comma list of L1,L2,L3,L4") from None
        gate = TrustGate(checks=_trust_gate.checks, required_layers=layers)
    ctx = TrustContext(audio=signal, sample_rate=sr, transcript=transcript, alt_transcript=alt_transcript,
                       wake_audio=wake_sig, speaker_profile=profile,
                       meta={"client": request.client.host if request.client else "unknown", "filename": file.filename})
    try:
        result = gate.evaluate(ctx, sensitivity, command=command)
    except InvalidInput as exc:
        raise HTTPException(400, f"audio cannot be analysed: {exc}") from exc
    payload = result.to_dict()
    payload["models"] = _trust_models()
    payload["profile"] = profile.name if profile else None
    payload["capture_note"] = _capture_note(INSUFFICIENT_DATA if sr < 36_000 else "CLEAR", sr)
    _retain("trust", request, file.filename, raw, {**payload, "filename": file.filename, "action": action, "transcript": transcript})
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
        "retention": bool(CAPTURE_DIR),
        "trust_checks": [c.name for c in default_checks()], "trust_models": _trust_models(),
    }


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(os.path.join(STATIC, "index.html"))


if os.path.isdir(STATIC):
    app.mount("/static", StaticFiles(directory=STATIC), name="static")
