"""Small shared DSP helpers used by the detectors."""

from __future__ import annotations

import numpy as np
from scipy import signal as sps

# np.trapz was removed in NumPy 2.0 in favour of np.trapezoid.
_trapz = getattr(np, "trapezoid", None) or getattr(np, "trapz")


def welch_psd(signal: np.ndarray, sample_rate: int):
    """Return (frequencies, power spectral density) via Welch's method.

    Window length adapts to the clip so short fixtures still produce a usable
    spectrum.
    """
    n = len(signal)
    if n == 0:
        return np.array([0.0]), np.array([0.0])
    nperseg = int(min(n, max(256, 2 ** int(np.floor(np.log2(max(sample_rate // 20, 256)))))))
    freqs, psd = sps.welch(signal, fs=sample_rate, nperseg=nperseg)
    return freqs, psd


def band_power(freqs: np.ndarray, psd: np.ndarray, low: float, high: float) -> float:
    """Integrate PSD over [low, high] Hz."""
    mask = (freqs >= low) & (freqs < high)
    if not np.any(mask):
        return 0.0
    return float(_trapz(psd[mask], freqs[mask]))


def total_power(freqs: np.ndarray, psd: np.ndarray) -> float:
    total = float(_trapz(psd, freqs))
    return total if total > 0 else 1e-20


def rolloff_frequency(freqs: np.ndarray, psd: np.ndarray, fraction: float = 0.99) -> float:
    """Frequency below which `fraction` of the total spectral energy lies."""
    cumulative = np.cumsum(psd)
    if cumulative[-1] <= 0:
        return 0.0
    cumulative = cumulative / cumulative[-1]
    idx = int(np.searchsorted(cumulative, fraction))
    idx = min(idx, len(freqs) - 1)
    return float(freqs[idx])
