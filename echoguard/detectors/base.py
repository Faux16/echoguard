"""Detector base classes and the Finding result type."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Finding:
    """One detector's verdict on a signal.

    risk is a float in [0, 1]. severity is a coarse label derived from risk.
    detail is a short human-readable explanation. evidence holds the numbers
    behind the decision so a reviewer can audit it.
    """

    name: str
    risk: float
    detail: str
    evidence: dict = field(default_factory=dict)

    @property
    def severity(self) -> str:
        if self.risk >= 0.66:
            return "high"
        if self.risk >= 0.33:
            return "suspicious"
        return "clear"


class Detector:
    """Base class. A detector inspects (signal, sample_rate) and returns a Finding."""

    name: str = "detector"

    def analyze(self, signal, sample_rate: int) -> Finding:  # pragma: no cover
        raise NotImplementedError


def clip01(x: float) -> float:
    """Clamp a value to [0, 1]."""
    return max(0.0, min(1.0, float(x)))
