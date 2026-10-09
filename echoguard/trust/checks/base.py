"""The check interface. A check looks at a `TrustContext` and returns one
`TrustSignal`. It never raises on missing inputs: it reports `assessable=False`
with the reason, so the gate can treat it as unverified."""

from __future__ import annotations

from abc import ABC, abstractmethod

from ..signals import Layer, TrustContext, TrustSignal


class Check(ABC):
    name: str = "check"
    layer: Layer = Layer.SIGNAL

    @abstractmethod
    def run(self, ctx: TrustContext) -> TrustSignal: ...

    def unassessable(self, why: str, **evidence) -> TrustSignal:
        return TrustSignal(name=self.name, layer=self.layer, trust=0.0, assessable=False,
                           detail=f"Could not check: {why}.", evidence=evidence)

    def signal(self, trust: float, detail: str, **evidence) -> TrustSignal:
        t = min(1.0, max(0.0, float(trust)))
        return TrustSignal(name=self.name, layer=self.layer, trust=t, assessable=True,
                           detail=detail, evidence=evidence)


def ramp(x: float, lo: float, hi: float) -> float:
    """Linear map of x from [lo, hi] onto [0, 1], clipped. lo > hi inverts."""
    if lo == hi:
        return 1.0 if x >= hi else 0.0
    return min(1.0, max(0.0, (x - lo) / (hi - lo)))
