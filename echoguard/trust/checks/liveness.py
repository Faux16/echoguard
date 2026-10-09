"""L2 — anti-spoofing: is this a human voice at a microphone, or synthesis / conversion / replay?

Scorer: Spectra-AASIST (`lab260/Spectra-AASIST`, MIT) — a wav2vec2-XLS-R
encoder with an AASIST graph-attention head, trained for ASVspoof-style
logical-access detection. It returns a bonafide logit; the published default
decision point is -1.14. The mapping to trust is calibrated on the ASVspoof2019 LA
evaluation attacks (benchmark/trust/RESULTS.md): on that clean 16 kHz material
the two classes are separated by several logits; expect the margin to shrink on
real device captures.

The model is optional (`pip install "echoguard[trust]"` + the first-run download
of ~1.5 GB of weights). Without it the check reports "could not check" and the
gate treats liveness as unverified.

Scope, stated plainly: this detects *synthetic and converted* speech well and
*replayed* speech (a recording played through a loudspeaker) only partly —
ASVspoof's physical-access task is a different model. Replay through a
loudspeaker is the T3 scenario and is also attacked from the source side.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from typing import Optional

import numpy as np

from ..signals import Layer, TrustContext, TrustSignal
from .base import Check, ramp
from .speaker import MIN_SECONDS, _to_16k

MODEL_REPO = "lab260/Spectra-AASIST"
SEGMENT = 64_600          # samples at 16 kHz the model was trained on (~4 s)
PREEMPHASIS = 0.97


class SpoofScorer:
    """Lazy loader; importing echoguard.trust never imports torch."""

    _shared: Optional[SpoofScorer] = None

    def __init__(self, repo: str = MODEL_REPO, cache_dir: Optional[str] = None):
        self.repo = repo
        self.cache_dir = cache_dir or os.path.join(os.path.expanduser("~"), ".cache", "echoguard", "spectra-aasist")
        self._model = None
        self._error: Optional[str] = None

    @classmethod
    def shared(cls) -> SpoofScorer:
        if cls._shared is None:
            cls._shared = cls()
        return cls._shared

    @property
    def available(self) -> bool:
        self._load()
        return self._model is not None

    @property
    def error(self) -> Optional[str]:
        self._load()
        return self._error

    def _load(self) -> None:
        if self._model is not None or self._error is not None:
            return
        try:
            import torch
            from huggingface_hub import snapshot_download
            local = snapshot_download(self.repo, cache_dir=self.cache_dir,
                                      allow_patterns=["model.py", "model.safetensors", "config.json"])
            spec = importlib.util.spec_from_file_location("spectra_aasist_model", os.path.join(local, "model.py"))
            assert spec and spec.loader
            mod = importlib.util.module_from_spec(spec)
            sys.modules["spectra_aasist_model"] = mod
            spec.loader.exec_module(mod)
            self._model = mod.SpectraAASIST.from_pretrained(local).eval().to("cpu")
            torch.set_grad_enabled(False)
        except ImportError:
            self._error = "anti-spoofing model not installed (pip install 'echoguard[trust]')"
        except Exception as exc:  # noqa: BLE001 — download / load failures
            self._error = f"anti-spoofing model unavailable ({type(exc).__name__}: {exc})"

    def bonafide_logit(self, x: np.ndarray, sr: int) -> float:
        """Mean bonafide logit over fixed-length segments of the clip (deterministic, no random crop)."""
        import torch
        self._load()
        if self._model is None:
            raise RuntimeError(self._error or "model not loaded")
        w = _to_16k(x, sr).astype(np.float32)
        w = np.concatenate([w[:1], w[1:] - PREEMPHASIS * w[:-1]]) if len(w) > 1 else w
        if len(w) < SEGMENT:                                   # repeat-pad, as the reference code does
            w = np.tile(w, int(SEGMENT / max(1, len(w))) + 1)[:SEGMENT]
        starts = list(range(0, len(w) - SEGMENT + 1, SEGMENT))
        if len(w) - SEGMENT not in starts:                     # cover the tail
            starts.append(len(w) - SEGMENT)
        batch = torch.from_numpy(np.stack([w[s: s + SEGMENT] for s in starts]))
        with torch.inference_mode():
            logits = self._model(batch)
        return float(logits[:, 1].mean())


class AntiSpoofCheck(Check):
    """Trust rises with the bonafide logit: below `spoof_below` the clip is synthetic/converted,
    above `bonafide_from` it is a live human voice at the microphone."""

    name = "anti_spoofing"
    layer = Layer.SPEAKER

    # Calibrated on ASVspoof2019 LA eval (benchmark/trust/RESULTS.md): bonafide logits sit above
    # ~3.6 (5th percentile), spoof below ~-2.3 (95th percentile); EER threshold 2.1. The accept
    # point (trust 0.67) lands at logit 1.0, the reject point (0.34) at -0.5, inside that gap.
    def __init__(self, scorer: Optional[SpoofScorer] = None,
                 spoof_below: float = -2.0, bonafide_from: float = 2.5):
        self.scorer = scorer
        self.spoof_below = spoof_below
        self.bonafide_from = bonafide_from

    def run(self, ctx: TrustContext) -> TrustSignal:
        if ctx.audio is None or not ctx.sample_rate:
            return self.unassessable("no audio was provided")
        if len(ctx.audio) < MIN_SECONDS * ctx.sample_rate:
            return self.unassessable(f"command shorter than {MIN_SECONDS:.1f} s")
        sc = self.scorer or SpoofScorer.shared()
        if not sc.available:
            return self.unassessable(sc.error or "anti-spoofing model unavailable")
        logit = sc.bonafide_logit(ctx.audio, ctx.sample_rate)
        trust = ramp(logit, self.spoof_below, self.bonafide_from)
        if trust >= 0.67:
            detail = f"Voice reads as a live human at the microphone (bonafide score {logit:.2f})."
        elif trust >= 0.34:
            detail = f"Voice has some signs of synthesis or playback (bonafide score {logit:.2f})."
        else:
            detail = f"Voice reads as synthetic, converted or replayed (bonafide score {logit:.2f})."
        return self.signal(trust, detail, bonafide_logit=round(logit, 3),
                           thresholds={"spoof_below": self.spoof_below, "bonafide_from": self.bonafide_from},
                           model=sc.repo)
