"""The trust gate: run the checks, summarise them, decide.

Decision = policy[sensitivity][trust level], the same shape as
`echoguard.gate.DEFAULT_POLICY` with the single verdict replaced by the trust
level of the whole tuple. The reason names the weakest check so the agent (or
the audit reader) sees why.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

from ..gate import ActionSensitivity, GateDecision
from .checks.base import Check
from .checks.content import ContentSafetyCheck, TranscriptConsistencyCheck
from .checks.signal_integrity import SignalIntegrityCheck
from .checks.speaker import SameSpeakerCheck, SpeakerVerificationCheck
from .signals import Layer, TrustContext, TrustLevel, TrustScore, TrustSignal

# Default policy over (sensitivity x trust level). UNVERIFIED is "could not
# check": fine for routine actions, a confirmation for anything that matters.
DEFAULT_TRUST_POLICY: dict = {
    ActionSensitivity.ROUTINE: {
        TrustLevel.TRUSTED: GateDecision.ALLOW,
        TrustLevel.UNVERIFIED: GateDecision.ALLOW,
        TrustLevel.SUSPECT: GateDecision.CONFIRM,
        TrustLevel.HOSTILE: GateDecision.BLOCK,
    },
    ActionSensitivity.SENSITIVE: {
        TrustLevel.TRUSTED: GateDecision.ALLOW,
        TrustLevel.UNVERIFIED: GateDecision.CONFIRM,
        TrustLevel.SUSPECT: GateDecision.CONFIRM,
        TrustLevel.HOSTILE: GateDecision.BLOCK,
    },
    ActionSensitivity.CRITICAL: {
        TrustLevel.TRUSTED: GateDecision.CONFIRM,
        TrustLevel.UNVERIFIED: GateDecision.CONFIRM,
        TrustLevel.SUSPECT: GateDecision.BLOCK,
        TrustLevel.HOSTILE: GateDecision.BLOCK,
    },
}

# Which layers must have assessed for the tuple to count as TRUSTED.
DEFAULT_REQUIRED_LAYERS: tuple[Layer, ...] = (Layer.SIGNAL, Layer.SPEAKER, Layer.CONTENT)

_DECISION_VERB = {
    GateDecision.ALLOW: "proceed",
    GateDecision.CONFIRM: "require explicit confirmation before proceeding",
    GateDecision.BLOCK: "do not execute",
}


def default_checks() -> list[Check]:
    return [SignalIntegrityCheck(), SpeakerVerificationCheck(), SameSpeakerCheck(),
            ContentSafetyCheck(), TranscriptConsistencyCheck()]


@dataclass
class TrustResult:
    decision: GateDecision
    sensitivity: ActionSensitivity
    score: TrustScore
    reason: str
    command: Optional[str] = None
    elapsed_ms: float = 0.0
    audit: dict = field(default_factory=dict)

    @property
    def level(self) -> TrustLevel:
        return self.score.level

    @property
    def allowed(self) -> bool:
        return self.decision is GateDecision.ALLOW

    def to_dict(self) -> dict:
        return {
            "decision": self.decision.value,
            "sensitivity": self.sensitivity.value,
            "level": self.level.value,
            "reason": self.reason,
            "command": self.command,
            "elapsed_ms": round(self.elapsed_ms, 1),
            "trust": self.score.to_dict(),
            "audit": self.audit,
        }


class TrustGate:
    """Run every check, summarise, and apply the policy.

    `required_layers` says which layers must be assessable for a command to be
    TRUSTED; an integrator without enrolment can drop SPEAKER so clean L1+L4
    results are not permanently 'unverified'.
    """

    def __init__(self, checks: Optional[list[Check]] = None, policy: Optional[dict] = None,
                 required_layers: tuple[Layer, ...] = DEFAULT_REQUIRED_LAYERS):
        self.checks = checks if checks is not None else default_checks()
        self.policy = policy if policy is not None else DEFAULT_TRUST_POLICY
        self.required_layers = required_layers

    def score(self, ctx: TrustContext) -> TrustScore:
        signals: list[TrustSignal] = [c.run(ctx) for c in self.checks]
        return TrustScore(signals=signals, required_layers=self.required_layers)

    def decide(self, sensitivity: ActionSensitivity, level: TrustLevel) -> GateDecision:
        by_level = self.policy.get(sensitivity)
        if by_level is None:
            raise ValueError(f"no policy for sensitivity {sensitivity!r}")
        return by_level.get(level, GateDecision.BLOCK)

    def evaluate(self, ctx: TrustContext, sensitivity: ActionSensitivity,
                 command: Optional[str] = None) -> TrustResult:
        if not isinstance(sensitivity, ActionSensitivity):
            raise TypeError("sensitivity must be an ActionSensitivity")
        t0 = time.perf_counter()
        score = self.score(ctx)
        level = score.level
        decision = self.decide(sensitivity, level)
        reason = self._reason(decision, sensitivity, score)
        elapsed = (time.perf_counter() - t0) * 1000
        audit = {"ts": time.time(), "sensitivity": sensitivity.value, "level": level.value,
                 "decision": decision.value, "command": command, "meta": dict(ctx.meta),
                 "checks": [s.to_dict() for s in score.signals]}
        return TrustResult(decision=decision, sensitivity=sensitivity, score=score, reason=reason,
                           command=command or ctx.transcript, elapsed_ms=elapsed, audit=audit)

    @staticmethod
    def _reason(decision: GateDecision, sensitivity: ActionSensitivity, score: TrustScore) -> str:
        verb = _DECISION_VERB[decision].capitalize()
        level = score.level
        assessed = [s for s in score.signals if s.assessable]
        if level in (TrustLevel.HOSTILE, TrustLevel.SUSPECT):
            weakest = min(assessed, key=lambda s: s.trust)
            return (f"{verb}: a {sensitivity.value} action with a {level.value} command — "
                    f"{weakest.layer.label}: {weakest.detail}")
        if level is TrustLevel.UNVERIFIED:
            missing = [s for s in score.unassessed if s.layer in score.required_layers]
            names = "; ".join(f"{s.layer.label}: {s.detail[len('Could not check: '):].rstrip('.')}" for s in missing)
            return f"{verb}: a {sensitivity.value} action could not be fully verified — {names}."
        checked = ", ".join(sorted({s.layer.label for s in assessed}))
        return f"{verb}: a {sensitivity.value} action with a trusted command (checked: {checked})."
