"""High-frequency carrier detector.

Ultrasonic injection carries a command on a high-frequency carrier that the
microphone's non-linearity demodulates back down to audible baseband. A
recording made near such an attack tends to show a strong, narrow spectral
peak high in the band (often with modulation sidebands around it). Ordinary
speech and music do not contain a dominant narrowband tone above ~15 kHz.

This detector looks for a narrowband peak in the high band that stands far
above the local spectral floor. It does not attempt to demodulate or recover
any content - it only flags the structural signature.

The threshold is constant-false-alarm-rate (CFAR): even pure noise has a
largest bin that sits a few dB above the median, and that margin grows as the
clip gets shorter (fewer Welch segments, noisier spectrum). We compute the
prominence noise alone would reach with probability NOISE_FALSE_ALARM_PROB and
score only the prominence in excess of it. Without this, short noise clips
(~0.2 s at 48 kHz) were flagged almost every time.
"""

from __future__ import annotations

import numpy as np
from scipy import stats

from .base import Detector, Finding, clip01
from ._dsp import Spectrum, band_power, total_power

HIGH_BAND_LOW = 15_000.0  # Hz
# Prominence (in dB) above the noise threshold at which we treat the tone as fully suspicious.
PROMINENCE_DB_SATURATION = 30.0
# Probability that a noise-only high band produces a peak above the CFAR threshold.
NOISE_FALSE_ALARM_PROB = 1e-3
# The high band must hold at least this fraction of total energy before we
# even assess a peak - otherwise we'd be measuring the ratio of noise to noise
# inside an essentially silent band (a false positive on normal speech).
MIN_HIGH_BAND_FRACTION = 1e-3
# A carrier is narrow: a tone (and its slow speech-rate sidebands) sits in a
# couple of Welch bins. Narrowness = power within +-NARROW_INNER bins of the
# peak over power within +-NARROW_OUTER bins. Synthetic carriers (AM, DSB-SC,
# SSB, aliased) measure 1.00; a 19 kHz beacon under heavy noise 0.79; cymbal,
# scissor and lighter resonances on real recordings 0.17-0.61. The carrier
# risk is scaled down between NARROW_FLOOR and NARROW_FULL.
NARROW_INNER = 2
NARROW_OUTER = 20
NARROW_FLOOR = 0.60
NARROW_FULL = 0.85

_EMPTY_EVIDENCE = {
    "assessable": None,
    "high_band_fraction": None,
    "peak_freq_hz": None,
    "prominence_db": None,
    "noise_threshold_db": None,
    "excess_db": None,
    "narrowness": None,
    "welch_dof": None,
}


def peak_narrowness(band: np.ndarray, k: int) -> float:
    lo_i, hi_i = max(0, k - NARROW_INNER), min(len(band), k + NARROW_INNER + 1)
    lo_o, hi_o = max(0, k - NARROW_OUTER), min(len(band), k + NARROW_OUTER + 1)
    outer = float(band[lo_o:hi_o].sum())
    return float(band[lo_i:hi_i].sum() / outer) if outer > 0 else 0.0


def noise_prominence_threshold_db(dof: float, n_bins: int,
                                  false_alarm_prob: float = NOISE_FALSE_ALARM_PROB) -> float:
    """Peak-to-median ratio (dB) that a flat noise band exceeds with probability `false_alarm_prob`.

    Each bin ~ chi2(dof)/dof. The max of n_bins independent bins exceeds t with
    probability 1 - F(t)^n_bins; solve for t, then divide by the median bin.
    """
    per_bin = -np.expm1(np.log1p(-false_alarm_prob) / max(n_bins, 1))
    peak = stats.chi2.isf(per_bin, dof)
    median = stats.chi2.median(dof)
    return float(10.0 * np.log10(peak / median))


class CarrierPeakDetector(Detector):
    name = "carrier_peak"

    def analyze_spectrum(self, spectrum: Spectrum) -> Finding:
        nyquist = spectrum.nyquist
        if nyquist <= HIGH_BAND_LOW:
            return Finding(
                name=self.name,
                risk=0.0,
                detail=(
                    f"Capture bandwidth too low to assess high-band carriers "
                    f"(Nyquist {nyquist/1000:.1f} kHz <= 15 kHz)."
                ),
                evidence={**_EMPTY_EVIDENCE, "assessable": False},
                assessable=False,
            )

        freqs, psd = spectrum.freqs, spectrum.psd
        mask = freqs >= HIGH_BAND_LOW
        if np.count_nonzero(mask) < 4:
            return Finding(
                name=self.name,
                risk=0.0,
                detail="Not enough high-band spectral resolution to assess.",
                evidence={**_EMPTY_EVIDENCE, "assessable": False},
                assessable=False,
            )

        # Energy gate: ignore peaks in a band that carries no real energy.
        high_fraction = band_power(freqs, psd, HIGH_BAND_LOW, nyquist) / total_power(freqs, psd)
        if high_fraction < MIN_HIGH_BAND_FRACTION:
            return Finding(
                name=self.name,
                risk=0.0,
                detail="No significant energy in the high band; no carrier to assess.",
                evidence={**_EMPTY_EVIDENCE, "assessable": True,
                          "high_band_fraction": float(high_fraction)},
            )

        band = psd[mask]
        band_freqs = freqs[mask]
        floor = float(np.median(band)) or 1e-20
        k = int(np.argmax(band))
        peak = float(band[k])
        peak_freq = float(band_freqs[k])
        prominence_db = float(10.0 * np.log10(peak / floor)) if floor > 0 else 0.0
        dof = spectrum.dof
        threshold_db = noise_prominence_threshold_db(dof, len(band))
        excess_db = prominence_db - threshold_db
        narrowness = peak_narrowness(band, k)
        narrow_factor = clip01((narrowness - NARROW_FLOOR) / (NARROW_FULL - NARROW_FLOOR))

        risk = clip01(excess_db / PROMINENCE_DB_SATURATION) * narrow_factor
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
        elif excess_db > 0 and narrow_factor < 1.0:
            detail = (
                f"High-band peak at {peak_freq/1000:.1f} kHz is broad (narrowness "
                f"{narrowness:.2f}) - a resonance or broadband content, not a carrier."
            )
        else:
            detail = "No dominant high-band carrier tone detected."

        return Finding(
            name=self.name,
            risk=risk,
            detail=detail,
            evidence={
                "assessable": True,
                "high_band_fraction": float(high_fraction),
                "peak_freq_hz": peak_freq,
                "prominence_db": prominence_db,
                "noise_threshold_db": float(threshold_db),
                "excess_db": float(excess_db),
                "narrowness": narrowness,
                "welch_dof": float(dof),
            },
        )
