"""Baseline anti-spoofing detector: standardised features + logistic regression.

A deliberately simple, transparent classifier so the benchmark is reproducible
and the numbers are honest about being a baseline. Reports the ASVspoof-standard
Equal Error Rate (EER).
"""

from __future__ import annotations

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler


class SpoofDetector:
    """Train on (features, label) where label 1 = spoof, 0 = genuine."""

    def __init__(self):
        self.scaler = StandardScaler()
        self.clf = LogisticRegression(max_iter=1000, class_weight="balanced")

    def fit(self, X: np.ndarray, y: np.ndarray) -> "SpoofDetector":
        Xs = self.scaler.fit_transform(X)
        self.clf.fit(Xs, y)
        return self

    def score(self, X: np.ndarray) -> np.ndarray:
        """Return spoof probability in [0, 1] per row."""
        Xs = self.scaler.transform(X)
        return self.clf.predict_proba(Xs)[:, 1]


def equal_error_rate(scores: np.ndarray, labels: np.ndarray) -> float:
    """EER: the error rate where false-accept rate equals false-reject rate.

    labels: 1 = spoof (positive), 0 = genuine.
    """
    scores = np.asarray(scores)
    labels = np.asarray(labels)
    # Sweep thresholds; the EER is the point where false-accept and
    # false-reject rates are closest to equal.
    gaps = []
    for t in np.unique(scores):
        pred = scores >= t
        far = np.mean(pred[labels == 0]) if (labels == 0).any() else 0.0   # genuine called spoof
        frr = np.mean(~pred[labels == 1]) if (labels == 1).any() else 0.0  # spoof called genuine
        gaps.append((abs(far - frr), (far + frr) / 2))
    return float(min(gaps, key=lambda g: g[0])[1])
