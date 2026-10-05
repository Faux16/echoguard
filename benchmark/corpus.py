"""Generate a labelled corpus of BENIGN audio to measure EchoGuard's false-positive rate.

These are ordinary, legitimate sounds - not attacks. The point is to see how often
EchoGuard raises a flag on audio that should pass. Categories span the range a real
deployment would see:

  speech          - energy in the voice band (the easy case)
  music_bright    - broadband music with real high-frequency content (cymbals, hiss)
  pink_noise      - 1/f noise, energy weighted to lows (ambient, rumble)
  white_noise     - flat full-band noise (a hard, HF-heavy stress case)

An attack corpus is deliberately NOT generated here: real attack captures must come
from a controlled lab with proper authorization, not from synthesis. Point the
evaluator at that real set when it exists.
"""

from __future__ import annotations

import os
import csv
import numpy as np
from scipy import signal as sps
from scipy.io import wavfile

SR = 48_000
DURATION = 1.5


def _norm(x: np.ndarray, level: float = 0.9) -> np.ndarray:
    peak = float(np.max(np.abs(x))) if x.size else 1.0
    return (x / (peak or 1.0) * level).astype(np.float32)


def _bandnoise(low, high, seed):
    rng = np.random.default_rng(seed)
    n = int(DURATION * SR)
    sos = sps.butter(6, [low, high], btype="bandpass", fs=SR, output="sos")
    return sps.sosfilt(sos, rng.standard_normal(n))


def speech(seed):
    return _norm(_bandnoise(150, 3800, seed))


def music_bright(seed):
    # Broadband content up to 16 kHz: a stand-in for bright music / cymbals.
    return _norm(_bandnoise(200, 16_000, seed))


def pink_noise(seed):
    rng = np.random.default_rng(seed)
    n = int(DURATION * SR)
    white = rng.standard_normal(n)
    # Shape to ~1/f in the frequency domain.
    spectrum = np.fft.rfft(white)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    freqs[0] = freqs[1]
    spectrum = spectrum / np.sqrt(freqs)
    return _norm(np.fft.irfft(spectrum, n))


def white_noise(seed):
    rng = np.random.default_rng(seed)
    return _norm(rng.standard_normal(int(DURATION * SR)))


CATEGORIES = {
    "speech": speech,
    "music_bright": music_bright,
    "pink_noise": pink_noise,
    "white_noise": white_noise,
}


def build(out_dir: str, per_category: int = 15) -> str:
    os.makedirs(out_dir, exist_ok=True)
    manifest = os.path.join(out_dir, "manifest.csv")
    rows = []
    seed = 0
    for cat, fn in CATEGORIES.items():
        for i in range(per_category):
            seed += 1
            sig = fn(seed)
            name = f"{cat}_{i:02d}.wav"
            wavfile.write(os.path.join(out_dir, name), SR, (np.clip(sig, -1, 1) * 32767).astype(np.int16))
            rows.append({"file": name, "label": "benign", "category": cat})
    with open(manifest, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["file", "label", "category"])
        w.writeheader()
        w.writerows(rows)
    return manifest


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "benchmark/corpus_benign"
    path = build(out)
    print(f"wrote benign corpus manifest: {path}")
