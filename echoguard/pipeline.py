"""The detection pipeline: run detectors, aggregate into a verdict."""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .detectors import default_detectors
from .detectors.base import Detector, Finding

CLEAR = "CLEAR"
SUSPICIOUS = "SUSPICIOUS"
HIGH_RISK = "HIGH_RISK"


@dataclass
class Report:
    """Aggregated result over all detectors."""

    overall_risk: float
    verdict: str
    findings: list[Finding] = field(default_factory=list)
    sample_rate: int = 0
    duration_sec: float = 0.0

    def to_dict(self) -> dict:
        return {
            "verdict": self.verdict,
            "overall_risk": round(self.overall_risk, 3),
            "sample_rate": self.sample_rate,
            "duration_sec": round(self.duration_sec, 3),
            "findings": [
                {
                    "name": f.name,
                    "risk": round(f.risk, 3),
                    "severity": f.severity,
                    "detail": f.detail,
                    "evidence": f.evidence,
                }
                for f in self.findings
            ],
        }


class Pipeline:
    """Runs a set of detectors over a signal and aggregates their findings.

    Aggregation is intentionally conservative: the overall risk is the maximum
    of the individual detector risks, because any one high-confidence signature
    is enough to warrant flagging. A weighted blend is also recorded in the
    evidence for tuning.
    """

    def __init__(self, detectors: list[Detector] | None = None):
        self.detectors = detectors if detectors is not None else default_detectors()

    def analyze(self, signal: np.ndarray, sample_rate: int) -> Report:
        findings = [d.analyze(signal, sample_rate) for d in self.detectors]
        overall = max((f.risk for f in findings), default=0.0)
        verdict = self._verdict(overall)
        duration = len(signal) / sample_rate if sample_rate else 0.0
        return Report(
            overall_risk=overall,
            verdict=verdict,
            findings=findings,
            sample_rate=sample_rate,
            duration_sec=duration,
        )

    @staticmethod
    def _verdict(risk: float) -> str:
        if risk >= 0.66:
            return HIGH_RISK
        if risk >= 0.33:
            return SUSPICIOUS
        return CLEAR
