"""Detection metrics shared by the trust-harness runners."""

from __future__ import annotations

import numpy as np


def eer(scores, is_target) -> tuple[float, float]:
    """Equal error rate for a similarity score where higher = more likely target.

    Returns (eer, threshold_at_eer). Sweeps the threshold over the sorted scores.
    """
    s = np.asarray(scores, dtype=np.float64)
    t = np.asarray(is_target, dtype=bool)
    if t.sum() == 0 or (~t).sum() == 0:
        raise ValueError("need both target and non-target trials")
    order = np.argsort(s)
    s, t = s[order], t[order]
    n_t, n_n = t.sum(), (~t).sum()
    # threshold just below s[i]: accept everything >= s[i]
    frr = np.cumsum(t) / n_t                     # targets rejected (score < threshold)
    far = 1.0 - np.cumsum(~t) / n_n              # non-targets accepted
    i = int(np.argmin(np.abs(frr - far)))
    return float((frr[i] + far[i]) / 2), float(s[i])


def rates_at(scores, is_target, accept_at: float, reject_below: float) -> dict:
    """FAR / FRR / undecided share for a two-threshold decision."""
    s = np.asarray(scores, dtype=np.float64)
    t = np.asarray(is_target, dtype=bool)
    acc = s >= accept_at
    rej = s < reject_below
    return {
        "far": float(acc[~t].mean()) if (~t).any() else None,        # impostors accepted
        "frr": float(rej[t].mean()) if t.any() else None,            # genuine rejected
        "undecided_target": float((~acc & ~rej)[t].mean()) if t.any() else None,
        "undecided_impostor": float((~acc & ~rej)[~t].mean()) if (~t).any() else None,
    }


def far_at_frr(scores, is_target, frr_target: float = 0.05) -> tuple[float, float]:
    """The false-accept rate when the threshold is set so that FRR = frr_target."""
    s = np.asarray(scores, dtype=np.float64)
    t = np.asarray(is_target, dtype=bool)
    thr = float(np.quantile(s[t], frr_target))
    return float((s[~t] >= thr).mean()), thr
