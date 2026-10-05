"""Tests: detectors fire on the right spectral signatures, stay quiet on benign audio."""

from __future__ import annotations

import numpy as np

from echoguard import Pipeline
from echoguard.pipeline import CLEAR, HIGH_RISK, SUSPICIOUS, INSUFFICIENT_DATA
from echoguard.detectors.ultrasonic import OutOfBandEnergyDetector
from echoguard.detectors.modulation import CarrierPeakDetector
from echoguard.detectors.spectral import SpectralProfileDetector
from tests import synth

SR = 48_000


def test_benign_is_clear():
    sig = synth.benign_speechlike(sample_rate=SR)
    report = Pipeline().analyze(sig, SR)
    assert report.verdict == CLEAR
    assert report.overall_risk < 0.33


def test_out_of_band_flagged_high():
    sig = synth.out_of_band(sample_rate=SR)
    report = Pipeline().analyze(sig, SR)
    assert report.verdict == HIGH_RISK
    oob = next(f for f in report.findings if f.name == "out_of_band_energy")
    assert oob.risk >= 0.66


def test_modulated_carrier_flagged():
    sig = synth.modulated_carrier(sample_rate=SR)
    report = Pipeline().analyze(sig, SR)
    assert report.verdict in (SUSPICIOUS, HIGH_RISK)
    carrier = next(f for f in report.findings if f.name == "carrier_peak")
    assert carrier.risk >= 0.33


def test_low_bandwidth_reports_unassessable():
    # 16 kHz capture cannot see 18 kHz; ultrasonic detector must say so, not false-clear.
    sig = synth.benign_speechlike(sample_rate=16_000)
    det = OutOfBandEnergyDetector()
    finding = det.analyze(sig, 16_000)
    assert finding.assessable is False
    assert finding.risk == 0.0


def test_low_bandwidth_verdict_is_insufficient_not_clear():
    # A narrow capture with nothing flagged must NOT read CLEAR - we couldn't check.
    sig = synth.benign_speechlike(sample_rate=16_000)
    report = Pipeline().analyze(sig, 16_000)
    assert report.verdict == INSUFFICIENT_DATA


def test_spectral_profile_separates_speech_from_injection():
    speech = synth.benign_speechlike(sample_rate=SR)
    inject = synth.out_of_band(sample_rate=SR)
    det = SpectralProfileDetector()
    assert det.analyze(speech, SR).risk < det.analyze(inject, SR).risk


def test_report_serialises():
    sig = synth.out_of_band(sample_rate=SR)
    d = Pipeline().analyze(sig, SR).to_dict()
    assert d["verdict"] == HIGH_RISK
    assert "findings" in d and len(d["findings"]) == 3
