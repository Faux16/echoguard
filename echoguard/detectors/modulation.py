"""High-frequency carrier detector.

Ultrasonic injection carries a command on a high-frequency carrier that the
microphone's non-linearity demodulates back down to audible baseband. A
recording made near such an attack tends to show a strong, narrow spectral
peak high in the band (often with modulation sidebands around it). Ordinary
speech and music do not contain a dominant narrowband tone above ~15 kHz.

This detector looks for a narrowband peak in the high band that stands far
above the local spectral floor. It does not attempt to demodulate or recover
any content - it only flags the structural signature.
"""

from __future__ import annotations

import numpy as np

from .base import Detector, Finding, clip01
from ._dsp import welch_psd, band_power, total_power

HIGH_BAND_LOW = 15_000.0  # Hz
# Peak-to-median ratio (in dB) at which we treat the tone as fully suspicious.
PROMINENCE_DB_SATURATION = 30.0
# The high band must hold at least this fraction of total energy before we
# even assess a peak - otherwise we'd be measuring the ratio of noise to noise
# inside an essentially silent band (a false positive on normal speech).
MIN_HIGH_BAND_FRACTION = 1e-3


class CarrierPeakDetector(Detector):
    name = "carrier_peak"

    def analyze(self, signal: np.ndarray, sample_rate: int) -> Finding:
        nyquist = sample_rate / 2.0
        if nyquist <= HIGH_BAND_LOW:
            return Finding(
                name=self.name,
                risk=0.0,
                detail=(
                    f"Capture bandwidth too low to assess high-band carriers "
                    f"(Nyquist {nyquist/1000:.1f} kHz <= 15 kHz)."
                ),
                evidence={"assessable": False},
                assessable=False,
            )

        freqs, psd = welch_psd(signal, sample_rate)
        mask = freqs >= HIGH_BAND_LOW
        if not np.any(mask) or np.count_nonzero(mask) < 4:
            return Finding(
                name=self.name,
                risk=0.0,
                detail="Not enough high-band spectral resolution to assess.",
                evidence={"assessable": False},
                assessable=False,
            )

        # Energy gate: ignore peaks in a band that carries no real energy.
        high_fraction = band_power(freqs, psd, HIGH_BAND_LOW, nyquist) / total_power(freqs, psd)
        if high_fraction < MIN_HIGH_BAND_FRACTION:
            return Finding(
                name=self.name,
                risk=0.0,
                detail="No significant energy in the high band; no carrier to assess.",
                evidence={"assessable": True, "high_band_fraction": high_fraction},
            )

        band = psd[mask]
        band_freqs = freqs[mask]
        floor = float(np.median(band)) or 1e-20
        peak = float(np.max(band))
        peak_freq = float(band_freqs[int(np.argmax(band))])
        prominence_db = 10.0 * np.log10(peak / floor) if floor > 0 else 0.0

        risk = clip01(prominence_db / PROMINENCE_DB_SATURATION)
        if risk >= 0.66:
            detail = (
                f"Dominant narrowband tone at {peak_freq/1000:.1f} kHz stands "
                f"{prominence_db:.0f} dB above the local noise floor - the signature of "
                f"a modulated ultrasonic carrier, not speech or music."
            )
        elif risk >= 0.33:
            detail = (
                f"Elevated narrowband energy at {peak_freq/1000:.1f} kHz "
                f"({prominence_db:.0f} dB above floor); unusual for speech."
            )
        else:
            detail = "No dominant high-band carrier tone detected."

        return Finding(
            name=self.name,
            risk=risk,
            detail=detail,
            evidence={
                "assessable": True,
                "peak_freq_hz": peak_freq,
                "prominence_db": prominence_db,
                "high_band_fraction": high_fraction,
            },
        )
