"""L1 — signal integrity, by the EchoGuard pipeline.

Trust is 1 - injection risk, taken from the worst 1 s window. A capture whose
sample rate is too low for the ultrasonic band is reported as not assessable
("could not check"), exactly as the pipeline's INSUFFICIENT_DATA verdict.
"""

from __future__ import annotations

from typing import Optional

from ...pipeline import INSUFFICIENT_DATA, InvalidInput, Pipeline
from ..signals import Layer, TrustContext, TrustSignal
from .base import Check


class SignalIntegrityCheck(Check):
    name = "signal_integrity"
    layer = Layer.SIGNAL

    def __init__(self, pipeline: Optional[Pipeline] = None,
                 window_sec: Optional[float] = 1.0, hop_sec: float = 0.5):
        self.pipeline = pipeline or Pipeline()
        self.window_sec = window_sec
        self.hop_sec = hop_sec

    def run(self, ctx: TrustContext) -> TrustSignal:
        if ctx.audio is None or not ctx.sample_rate:
            return self.unassessable("no audio was provided")
        try:
            if self.window_sec:
                windowed = self.pipeline.analyze_windows(ctx.audio, ctx.sample_rate,
                                                         window_sec=self.window_sec, hop_sec=self.hop_sec)
                report, n = windowed.summary, len(windowed.windows)
            else:
                report, n = self.pipeline.analyze(ctx.audio, ctx.sample_rate), 1
        except InvalidInput as exc:
            return self.unassessable(f"audio cannot be analysed ({exc})")
        ev = {"verdict": report.verdict, "risk": round(float(report.overall_risk), 3),
              "sample_rate": report.sample_rate, "windows": n,
              "findings": [{"name": f.name, "risk": round(float(f.risk), 3), "severity": f.severity,
                            "assessable": f.assessable, "detail": f.detail, "evidence": f.evidence}
                           for f in report.findings]}
        if report.verdict == INSUFFICIENT_DATA:
            return self.unassessable(
                f"capture at {report.sample_rate / 1000:.1f} kHz cannot show the ultrasonic band; "
                f"capture at 44.1 kHz or higher", **ev)
        worst = max(report.findings, key=lambda f: f.risk, default=None)
        if report.overall_risk < 0.05:
            detail = "No injection signature: no modulated ultrasonic carrier and no out-of-band energy."
        else:
            detail = (f"Injection risk {report.overall_risk:.2f} ({report.verdict}): "
                      f"{worst.detail if worst else ''}").strip()
        return self.signal(1.0 - float(report.overall_risk), detail, **ev)
