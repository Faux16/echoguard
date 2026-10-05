"""Spectral-profile anomaly detector.

A model-agnostic sanity check: does the clip's frequency profile look like
human speech at all? Genuine voice commands roll off their energy well below
8 kHz. A clip whose 99% energy roll-off sits high in the band is inconsistent
with a human speaker and is a generic indicator of injected, synthetic, or
hidden-audio content. This is a coarse screen that complements the two
targeted detectors.
"""

from __future__ import annotations

import numpy as np

from .base import Detector, Finding, clip01
from ._dsp import welch_psd, rolloff_frequency

SPEECH_ROLLOFF_HZ = 8_000.0   # at or below: normal speech
ANOMALY_ROLLOFF_HZ = 16_000.0  # at or above: clearly not speech


class SpectralProfileDetector(Detector):
    name = "spectral_profile"

    def analyze(self, signal: np.ndarray, sample_rate: int) -> Finding:
        freqs, psd = welch_psd(signal, sample_rate)
        rolloff = rolloff_frequency(freqs, psd, fraction=0.99)

        # Map roll-off between the speech and anomaly anchors onto [0, 1].
        span = ANOMALY_ROLLOFF_HZ - SPEECH_ROLLOFF_HZ
        risk = clip01((rolloff - SPEECH_ROLLOFF_HZ) / span)

        if risk >= 0.66:
            detail = (
                f"99% of energy extends up to {rolloff/1000:.1f} kHz - far above the "
                f"~8 kHz roll-off of human speech. Profile inconsistent with a live speaker."
            )
        elif risk >= 0.33:
            detail = (
                f"Energy roll-off at {rolloff/1000:.1f} kHz is higher than typical speech."
            )
        else:
            detail = f"Energy roll-off at {rolloff/1000:.1f} kHz is consistent with human speech."

        return Finding(
            name=self.name,
            risk=risk,
            detail=detail,
            evidence={"rolloff_99_hz": rolloff},
        )
