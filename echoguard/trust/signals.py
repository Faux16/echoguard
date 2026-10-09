"""Data types shared by the trust checks and the gate."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional

import numpy as np


class Layer(Enum):
    SIGNAL = "L1"     # signal integrity (EchoGuard)
    SPEAKER = "L2"    # speaker identity and liveness
    SOURCE = "L3"     # source attribution
    CONTENT = "L4"    # content safety

    @property
    def label(self) -> str:
        return {"L1": "signal integrity", "L2": "speaker identity",
                "L3": "source attribution", "L4": "content safety"}[self.value]


class TrustLevel(Enum):
    """The gate's summary of a trust tuple. Order matters: later is worse."""

    TRUSTED = "trusted"        # every required check assessable and clean
    UNVERIFIED = "unverified"  # a required check could not assess (model missing, no enrolment, 16 kHz audio)
    SUSPECT = "suspect"        # at least one check in its grey zone
    HOSTILE = "hostile"        # at least one check confident the command is not the user's

    @property
    def rank(self) -> int:
        return ["trusted", "unverified", "suspect", "hostile"].index(self.value)


@dataclass
class TrustSignal:
    """One check's answer.

    `trust` is in [0, 1] where 1 means "fully consistent with the genuine user";
    it is meaningful only when `assessable` is true. `detail` is the sentence a
    human would read; `evidence` holds the numbers behind it.
    """

    name: str
    layer: Layer
    trust: float
    assessable: bool
    detail: str
    evidence: dict = field(default_factory=dict)

    @property
    def band(self) -> str:
        if not self.assessable:
            return "unassessed"
        if self.trust < SUSPECT_BELOW_HOSTILE:
            return "hostile"
        if self.trust < TRUSTED_FROM:
            return "suspect"
        return "clean"

    def to_dict(self) -> dict:
        return {"name": self.name, "layer": self.layer.value, "layer_label": self.layer.label,
                "trust": None if not self.assessable else round(float(self.trust), 3),
                "assessable": self.assessable, "band": self.band, "detail": self.detail,
                "evidence": _jsonable(self.evidence)}


# Trust bands shared by every check. A check maps its own measurement onto [0, 1]
# so that these two cut-offs mean the same thing everywhere.
SUSPECT_BELOW_HOSTILE = 0.34   # below this a check is confident the command is not the user's
TRUSTED_FROM = 0.67            # at or above this the check is clean


@dataclass
class TrustContext:
    """Everything the checks may look at. Any field may be absent; a check that
    needs a missing field reports `assessable=False`."""

    audio: Optional[np.ndarray] = None          # mono float signal of the command
    sample_rate: Optional[int] = None
    transcript: Optional[str] = None            # what the ASR heard
    alt_transcript: Optional[str] = None        # a second decoder's transcript, for L4 consistency
    wake_audio: Optional[np.ndarray] = None     # the wake-word segment, same sample rate, for L3
    speaker_profile: Any = None                 # SpeakerProfile of the enrolled user, for L2
    channels: Optional[np.ndarray] = None       # raw multi-mic audio (n_channels, n_samples), for future L3
    meta: dict = field(default_factory=dict)    # device, room, anything the integrator wants in the audit


@dataclass
class TrustScore:
    """The trust tuple: one signal per check, summarised into a level."""

    signals: list[TrustSignal]
    required_layers: tuple[Layer, ...]

    @property
    def by_layer(self) -> dict[Layer, list[TrustSignal]]:
        out: dict[Layer, list[TrustSignal]] = {}
        for s in self.signals:
            out.setdefault(s.layer, []).append(s)
        return out

    def layer_trust(self, layer: Layer) -> Optional[float]:
        """The weakest assessable signal in a layer, or None if none could assess."""
        vals = [s.trust for s in self.signals if s.layer is layer and s.assessable]
        return min(vals) if vals else None

    @property
    def level(self) -> TrustLevel:
        assessed = [s for s in self.signals if s.assessable]
        if any(s.trust < SUSPECT_BELOW_HOSTILE for s in assessed):
            return TrustLevel.HOSTILE
        if any(s.trust < TRUSTED_FROM for s in assessed):
            return TrustLevel.SUSPECT
        for layer in self.required_layers:
            if self.layer_trust(layer) is None:
                return TrustLevel.UNVERIFIED
        return TrustLevel.TRUSTED

    @property
    def overall(self) -> Optional[float]:
        """Minimum assessable trust — the chain is as strong as its weakest check."""
        vals = [s.trust for s in self.signals if s.assessable]
        return min(vals) if vals else None

    @property
    def unassessed(self) -> list[TrustSignal]:
        return [s for s in self.signals if not s.assessable]

    def to_dict(self) -> dict:
        return {
            "level": self.level.value,
            "overall": None if self.overall is None else round(float(self.overall), 3),
            "required_layers": [layer.value for layer in self.required_layers],
            "layers": {layer.value: (None if (lt := self.layer_trust(layer)) is None else round(float(lt), 3))
                       for layer in Layer},
            "signals": [s.to_dict() for s in self.signals],
        }


def _jsonable(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj
