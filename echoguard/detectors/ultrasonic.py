"""Out-of-band / near-ultrasound energy detector.

Many inaudible-command attacks (DolphinAttack-class ultrasonic injection, NUIT
near-ultrasound in media) deposit energy above the human-voice band. Genuine
speech has almost no energy above ~8 kHz and essentially none above ~16 kHz.
A clip with significant energy in the 18 kHz+ region is therefore a strong
signal of injection or near-ultrasound carriage.

This detector needs bandwidth: if the capture's Nyquist frequency does not
reach 18 kHz (sample rate below ~36 kHz) it cannot assess the band and says so
rather than returning a false "clear".
"""

from __future__ import annotations

import numpy as np

from .base import Detector, Finding, clip01
from ._dsp import welch_psd, band_power, total_power

NEAR_ULTRASOUND_LOW = 18_000.0  # Hz
# Fraction of total energy above the threshold that we treat as fully suspicious.
SATURATION_RATIO = 0.10


class OutOfBandEnergyDetector(Detector):
    name = "out_of_band_energy"

    def analyze(self, signal: np.ndarray, sample_rate: int) -> Finding:
        nyquist = sample_rate / 2.0
        if nyquist < NEAR_ULTRASOUND_LOW:
            return Finding(
                name=self.name,
                risk=0.0,
                detail=(
                    f"Capture bandwidth too low to assess ultrasonic bands "
                    f"(Nyquist {nyquist/1000:.1f} kHz < 18 kHz). "
                    f"Re-capture at >= 44.1 kHz to enable this check."
                ),
                evidence={"nyquist_hz": nyquist, "assessable": False},
            )

        freqs, psd = welch_psd(signal, sample_rate)
        total = total_power(freqs, psd)
        oob = band_power(freqs, psd, NEAR_ULTRASOUND_LOW, nyquist)
        ratio = oob / total

        risk = clip01(ratio / SATURATION_RATIO)
        if risk >= 0.66:
            detail = (
                f"{ratio*100:.1f}% of signal energy sits above 18 kHz - well beyond "
                f"the human-voice band. Consistent with ultrasonic/near-ultrasound injection."
            )
        elif risk >= 0.33:
            detail = (
                f"{ratio*100:.1f}% of signal energy is above 18 kHz - higher than "
                f"expected for speech; worth a closer look."
            )
        else:
            detail = f"Negligible energy above 18 kHz ({ratio*100:.2f}%); consistent with normal audio."

        return Finding(
            name=self.name,
            risk=risk,
            detail=detail,
            evidence={
                "nyquist_hz": nyquist,
                "assessable": True,
                "out_of_band_ratio": ratio,
            },
        )
