"""Voice-agent trust layer: did this command come from the authenticated, present,
live user, and is its content safe to act on?

Four layers of checks produce one `TrustScore` with provenance, and `TrustGate`
turns it, together with how sensitive the requested action is, into
ALLOW / CONFIRM / BLOCK — the same shape as `echoguard.gate`, generalised from a
single verdict to a trust tuple.

    L1  signal integrity   — EchoGuard: ultrasonic carrier, out-of-band energy
    L2  speaker identity   — is this the enrolled person (embedding match), is it a live voice (anti-spoofing)
    L3  source attribution — did the wake word and the command come from the same voice
    L4  content safety     — does the transcript look like a spoken prompt injection

A layer that cannot assess says so (`assessable=False`); the gate treats that as
*unverified*, never as safe. Layers that need a speech model (L2, L3) degrade to
unverified when `echoguard[trust]` is not installed.
"""

from .signals import Layer, TrustSignal, TrustContext, TrustScore, TrustLevel
from .checks.base import Check
from .checks.signal_integrity import SignalIntegrityCheck
from .checks.content import ContentSafetyCheck, TranscriptConsistencyCheck
from .checks.speaker import SpeakerVerificationCheck, SameSpeakerCheck, SpeakerProfile
from .checks.liveness import AntiSpoofCheck
from .checks.reverb import ReverbConsistencyCheck
from .gate import TrustGate, TrustResult, DEFAULT_TRUST_POLICY, default_checks
from .tool import TOOL_SCHEMA, handle_tool_call

__all__ = [
    "Layer", "TrustSignal", "TrustContext", "TrustScore", "TrustLevel", "Check",
    "SignalIntegrityCheck", "ContentSafetyCheck", "TranscriptConsistencyCheck",
    "SpeakerVerificationCheck", "SameSpeakerCheck", "SpeakerProfile", "AntiSpoofCheck", "ReverbConsistencyCheck",
    "TrustGate", "TrustResult", "DEFAULT_TRUST_POLICY", "default_checks",
    "TOOL_SCHEMA", "handle_tool_call",
]
