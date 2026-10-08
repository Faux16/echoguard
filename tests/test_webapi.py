"""Web API: /api/scan and /api/gate over the real engine."""

from __future__ import annotations

import io

import numpy as np
import pytest
from scipy.io import wavfile

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from app.server import app  # noqa: E402
from tests import synth  # noqa: E402

SR = 48_000
client = TestClient(app)


def _wav_bytes(sig, sr=SR):
    buf = io.BytesIO()
    wavfile.write(buf, sr, (np.clip(sig, -1, 1) * 32767).astype(np.int16))
    return buf.getvalue()


def _scan(sig, sr=SR, **form):
    files = {"file": ("clip.wav", _wav_bytes(sig, sr), "audio/wav")}
    return client.post("/api/scan", files=files, data=form)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["engine"] == "echoguard"


def test_index_served():
    r = client.get("/")
    assert r.status_code == 200 and "EchoGuard" in r.text


def test_scan_attack_high_risk_with_psd_and_annotations():
    r = _scan(synth.out_of_band(sample_rate=SR))
    assert r.status_code == 200
    d = r.json()
    assert d["verdict"] == "HIGH_RISK"
    assert d["psd"]["freqs_hz"] and len(d["psd"]["freqs_hz"]) == len(d["psd"]["psd_db"])
    assert d["annotations"]["carrier_peak_hz"] is not None
    assert d["annotations"]["oob_edge_hz"] == 18000.0
    assert d["windows"] and all("verdict" in w for w in d["windows"])


def test_scan_returns_spectrogram_and_waveform():
    import base64
    d = _scan(synth.out_of_band(duration=1.5, sample_rate=SR)).json()
    sg = d["spectrogram"]
    f_bins, t_bins = sg["shape"]
    assert f_bins > 10 and t_bins > 10
    assert len(base64.b64decode(sg["data"])) == f_bins * t_bins
    assert sg["fmax_hz"] == pytest.approx(SR / 2, rel=0.01)
    assert sg["vmax_db"] > sg["vmin_db"]
    assert d["waveform"] and max(d["waveform"]) == pytest.approx(1.0)
    assert d["analysis_ms"] >= 0
    t = d["thresholds"]
    assert t["oob_edge_hz"] == 18000.0 and t["suspicious_risk"] == 0.33 and t["high_risk"] == 0.66
    assert t["sideband_floor_db"] < t["sideband_full_db"] < 0


def test_scan_benign_clear():
    d = _scan(synth.benign_speechlike(sample_rate=SR)).json()
    assert d["verdict"] == "CLEAR"


def test_scan_low_rate_is_insufficient_with_note():
    d = _scan(synth.benign_speechlike(sample_rate=16_000), sr=16_000).json()
    assert d["verdict"] == "INSUFFICIENT_DATA"
    assert "44.1" in d["capture_note"]


def test_scan_rejects_non_wav():
    r = client.post("/api/scan", files={"file": ("x.wav", b"not a wav", "audio/wav")})
    assert r.status_code == 400


def test_gate_blocks_critical_on_attack():
    files = {"file": ("a.wav", _wav_bytes(synth.out_of_band(sample_rate=SR)), "audio/wav")}
    r = client.post("/api/gate", files=files, data={"action": "critical", "command": "unlock"})
    assert r.status_code == 200
    d = r.json()
    assert d["decision"] == "block" and d["command"] == "unlock"


def test_gate_allows_sensitive_on_benign():
    files = {"file": ("b.wav", _wav_bytes(synth.benign_speechlike(sample_rate=SR)), "audio/wav")}
    d = client.post("/api/gate", files=files, data={"action": "sensitive"}).json()
    assert d["decision"] == "allow"


def test_gate_rejects_bad_action():
    files = {"file": ("b.wav", _wav_bytes(synth.benign_speechlike(sample_rate=SR)), "audio/wav")}
    r = client.post("/api/gate", files=files, data={"action": "bogus"})
    assert r.status_code == 422
