"""L1 (experimental) — reverberation consistency between the wake word and the command.

The physics (paper §VIII): the demodulated residue of an ultrasonic injection is
convolved with the room's response at the *carrier* frequency, which air
absorption damps within metres, and the microphone's squaring halves its decay
time again. Its apparent reverberation time therefore cannot exceed
0.161 / (8 m(f_c)) — about 0.09 s at 30 kHz — whatever the room. A genuine
command spoken in the same room as the wake word carries the room's speech-band
reverberation (0.3–1.0 s in ordinary rooms). The statistic is

    Λ = T60(wake) − T60(command)

near zero for a genuine command, large and positive for an injected one.

The T60 estimator here is a deliberately simple blind proxy: the distribution of
decay slopes of the short-time energy envelope after speech offsets, taking the
slowest decays as the room tail. It is NOT calibrated; it exists so the matched
-device corpus can measure Λ and decide whether the bound separates in practice.
Until then the check is not in `default_checks()` and reports its own
uncertainty. A dead room (T60(wake) below `min_room_t60`) is reported as *could
not check* rather than guessed.
"""

from __future__ import annotations

from typing import Optional

import numpy as np
from scipy.ndimage import median_filter
from scipy.signal import butter, sosfiltfilt

from ..signals import Layer, TrustContext, TrustSignal
from .base import Check, ramp

FRAME_SEC = 0.010
MIN_SECONDS = 1.0


def _envelope_db(x: np.ndarray, sr: int) -> np.ndarray:
    """Short-time energy in dB of the 300–3000 Hz band, 10 ms frames."""
    sos = butter(4, [300, min(3000, 0.45 * sr)], btype="band", fs=sr, output="sos")
    y = sosfiltfilt(sos, np.asarray(x, dtype=np.float64))
    n = int(FRAME_SEC * sr)
    frames = len(y) // n
    e = (y[: frames * n].reshape(frames, n) ** 2).mean(axis=1)
    return 10.0 * np.log10(e + 1e-12)


def estimate_t60(x: np.ndarray, sr: int, min_decay_db: float = 15.0, slowest_fraction: float = 0.25) -> Optional[float]:
    """Blind T60 proxy from decay slopes after energy peaks. None if no usable decays."""
    env = _envelope_db(x, sr)
    if len(env) < 20:
        return None
    env = median_filter(env, size=5, mode="nearest")      # frame-to-frame noise would end every decay early
    floor = np.percentile(env, 10)
    slopes = []
    i = 1
    while i < len(env) - 3:
        # a local peak at least 20 dB above the floor starts a candidate decay
        if env[i] > env[i - 1] and env[i] >= env[i + 1] and env[i] - floor > 20:
            j = i + 1
            while j < len(env) and env[j] <= env[j - 1] + 2.5 and env[i] - env[j] < 40:
                j += 1
            drop = env[i] - env[j - 1]
            if drop >= min_decay_db and j - i >= 6:                      # >= 60 ms, >= 15 dB
                t = np.arange(j - i) * FRAME_SEC
                slope = np.polyfit(t, env[i:j], 1)[0]                 # dB/s, negative
                if slope < -60:                                        # ignore flat / rising
                    slopes.append(60.0 / -slope)
            i = j
        else:
            i += 1
    if len(slopes) < 3:
        return None
    s = np.sort(slopes)
    tail = s[int(len(s) * (1 - slowest_fraction)):]                     # the slowest decays carry the room
    return float(np.median(tail))


class ReverbConsistencyCheck(Check):
    """Λ = T60(wake) − T60(command). Experimental; see module docstring."""

    name = "reverb_consistency"
    layer = Layer.SIGNAL

    def __init__(self, hostile_at: float = 0.25, clean_at: float = 0.08, min_room_t60: float = 0.15):
        self.hostile_at = hostile_at      # Λ at or above this → the command carries no room → hostile
        self.clean_at = clean_at          # Λ at or below this → consistent → clean
        self.min_room_t60 = min_room_t60  # below this the room is too dead to test

    def run(self, ctx: TrustContext) -> TrustSignal:
        if ctx.audio is None or ctx.wake_audio is None or not ctx.sample_rate:
            return self.unassessable("needs both the wake-word segment and the command")
        if min(len(ctx.audio), len(ctx.wake_audio)) < MIN_SECONDS * ctx.sample_rate:
            return self.unassessable(f"a segment is shorter than {MIN_SECONDS:.0f} s")
        t_wake = estimate_t60(ctx.wake_audio, ctx.sample_rate)
        t_cmd = estimate_t60(ctx.audio, ctx.sample_rate)
        if t_wake is None or t_cmd is None:
            return self.unassessable("too few speech offsets to estimate a decay")
        if t_wake < self.min_room_t60:
            return self.unassessable(f"room too dead to test (wake T60 {t_wake:.2f} s)", t60_wake=round(t_wake, 3), t60_command=round(t_cmd, 3))
        lam = t_wake - t_cmd
        trust = ramp(lam, self.hostile_at, self.clean_at)
        if trust >= 0.67:
            detail = f"Command carries the same room as the wake word (T60 {t_cmd:.2f} s vs {t_wake:.2f} s)."
        elif trust >= 0.34:
            detail = f"Command is drier than the wake word (T60 {t_cmd:.2f} s vs {t_wake:.2f} s)."
        else:
            detail = f"Command carries almost no room reverberation (T60 {t_cmd:.2f} s vs {t_wake:.2f} s) — consistent with a demodulated injection."
        return self.signal(trust, detail, t60_wake=round(t_wake, 3), t60_command=round(t_cmd, 3), lambda_s=round(lam, 3),
                           thresholds={"hostile_at": self.hostile_at, "clean_at": self.clean_at, "min_room_t60": self.min_room_t60},
                           experimental=True)
