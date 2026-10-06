"""EXPERIMENTAL anti-spoofing module (replay / deepfake detection).

This is a SEPARATE concern from EchoGuard's core inaudible-injection detectors.
Replay and voice-clone attacks are normal-band audio with no ultrasonic
signature, so the core detectors do not apply. This module provides a simple,
honest baseline detector plus feature extraction, for benchmarking on public
datasets such as ASVspoof. It is a baseline scaffold, not a state-of-the-art
anti-spoofing system - its value is that it makes those datasets usable and
produces a real EER you can compare against.
"""

from .detector import SpoofDetector, equal_error_rate
from .features import extract_features

__all__ = ["SpoofDetector", "equal_error_rate", "extract_features"]
