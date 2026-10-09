"""L2 / L3 — speaker identity and source attribution on speaker embeddings.

Embeddings come from a pretrained ECAPA-TDNN (SpeechBrain,
`speechbrain/spkrec-ecapa-voxceleb`, 16 kHz). The model is optional
(`pip install echoguard[trust]`); without it, both checks report
"could not check" and the gate treats the speaker as unverified.

Thresholds below are PROVISIONAL — ECAPA cosine scores on VoxCeleb sit around
0.25–0.35 at the equal-error point; the Phase 0 corpus calibrates them per
device. They are exposed as constructor arguments for that reason.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy.signal import resample_poly

from ..signals import Layer, TrustContext, TrustSignal
from .base import Check, ramp

MODEL_SOURCE = "speechbrain/spkrec-ecapa-voxceleb"
MODEL_RATE = 16_000
MIN_SECONDS = 0.8     # ECAPA is unreliable on shorter segments


def _to_16k(x: np.ndarray, sr: int) -> np.ndarray:
    x = np.asarray(x, dtype=np.float32)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr == MODEL_RATE:
        return x
    g = np.gcd(int(sr), MODEL_RATE)
    return resample_poly(x, MODEL_RATE // g, int(sr) // g).astype(np.float32)


class Embedder:
    """Lazy wrapper so importing echoguard.trust never imports torch."""

    _shared: Optional[Embedder] = None

    def __init__(self, source: str = MODEL_SOURCE, savedir: Optional[str] = None):
        self.source = source
        self.savedir = savedir or os.path.join(os.path.expanduser("~"), ".cache", "echoguard", "ecapa")
        self._enc = None
        self._error: Optional[str] = None

    @classmethod
    def shared(cls) -> Embedder:
        if cls._shared is None:
            cls._shared = cls()
        return cls._shared

    @property
    def available(self) -> bool:
        self._load()
        return self._enc is not None

    @property
    def error(self) -> Optional[str]:
        self._load()
        return self._error

    def _load(self) -> None:
        if self._enc is not None or self._error is not None:
            return
        try:
            import torch  # noqa: F401
            from speechbrain.inference.speaker import EncoderClassifier
            self._enc = EncoderClassifier.from_hparams(source=self.source, savedir=self.savedir,
                                                       run_opts={"device": "cpu"})
        except ImportError:
            self._error = "speech model not installed (pip install 'echoguard[trust]')"
        except Exception as exc:  # noqa: BLE001 — model download / load failures
            self._error = f"speech model unavailable ({type(exc).__name__}: {exc})"

    def embed(self, x: np.ndarray, sr: int) -> np.ndarray:
        import torch
        self._load()
        if self._enc is None:
            raise RuntimeError(self._error or "model not loaded")
        wav = torch.from_numpy(_to_16k(x, sr))[None, :]
        with torch.no_grad():
            emb = self._enc.encode_batch(wav)
        v = emb.squeeze().cpu().numpy().astype(np.float32)
        return v / (np.linalg.norm(v) + 1e-9)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


@dataclass
class SpeakerProfile:
    """An enrolled user: the mean of several utterance embeddings."""

    name: str
    embedding: np.ndarray
    n_utterances: int = 1
    meta: dict = field(default_factory=dict)

    @classmethod
    def enrol(cls, name: str, utterances: list[tuple[np.ndarray, int]],
              embedder: Optional[Embedder] = None) -> SpeakerProfile:
        emb = embedder or Embedder.shared()
        vecs = [emb.embed(x, sr) for x, sr in utterances]
        mean = np.mean(vecs, axis=0)
        return cls(name=name, embedding=mean / (np.linalg.norm(mean) + 1e-9), n_utterances=len(vecs))

    def save(self, path: str) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"name": self.name, "n_utterances": self.n_utterances, "meta": self.meta,
                       "embedding": self.embedding.tolist()}, fh)

    @classmethod
    def load(cls, path: str) -> SpeakerProfile:
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        return cls(name=d["name"], embedding=np.asarray(d["embedding"], dtype=np.float32),
                   n_utterances=int(d.get("n_utterances", 1)), meta=d.get("meta", {}))


class SpeakerVerificationCheck(Check):
    """L2: is the command spoken by the enrolled user?"""

    name = "speaker_verification"
    layer = Layer.SPEAKER

    def __init__(self, embedder: Optional[Embedder] = None,
                 reject_below: float = 0.15, accept_from: float = 0.50):
        self.embedder = embedder
        self.reject_below = reject_below
        self.accept_from = accept_from

    def run(self, ctx: TrustContext) -> TrustSignal:
        if ctx.audio is None or not ctx.sample_rate:
            return self.unassessable("no audio was provided")
        if ctx.speaker_profile is None:
            return self.unassessable("no enrolled speaker profile")
        if len(ctx.audio) < MIN_SECONDS * ctx.sample_rate:
            return self.unassessable(f"command shorter than {MIN_SECONDS:.1f} s")
        emb = self.embedder or Embedder.shared()
        if not emb.available:
            return self.unassessable(emb.error or "speech model unavailable")
        score = cosine(emb.embed(ctx.audio, ctx.sample_rate), ctx.speaker_profile.embedding)
        trust = ramp(score, self.reject_below, self.accept_from)
        who = ctx.speaker_profile.name
        if trust >= 0.67:
            detail = f"Voice matches the enrolled user {who} (similarity {score:.2f})."
        elif trust >= 0.34:
            detail = f"Voice is a weak match for {who} (similarity {score:.2f})."
        else:
            detail = f"Voice does not match the enrolled user {who} (similarity {score:.2f})."
        return self.signal(trust, detail, similarity=round(score, 3), profile=who,
                           thresholds={"reject_below": self.reject_below, "accept_from": self.accept_from})


class SameSpeakerCheck(Check):
    """L3: did the wake word and the command come from the same voice?

    A command spoken by someone other than the person who woke the agent — a
    second person, a TV, a phone on speaker — is the T3 signature. No enrolment
    is needed: the two segments are compared with each other.
    """

    name = "same_speaker"
    layer = Layer.SOURCE

    def __init__(self, embedder: Optional[Embedder] = None,
                 different_below: float = 0.20, same_from: float = 0.55):
        self.embedder = embedder
        self.different_below = different_below
        self.same_from = same_from

    def run(self, ctx: TrustContext) -> TrustSignal:
        if ctx.audio is None or ctx.wake_audio is None or not ctx.sample_rate:
            return self.unassessable("needs both the wake-word segment and the command")
        if min(len(ctx.audio), len(ctx.wake_audio)) < MIN_SECONDS * ctx.sample_rate:
            return self.unassessable(f"a segment is shorter than {MIN_SECONDS:.1f} s")
        emb = self.embedder or Embedder.shared()
        if not emb.available:
            return self.unassessable(emb.error or "speech model unavailable")
        score = cosine(emb.embed(ctx.wake_audio, ctx.sample_rate), emb.embed(ctx.audio, ctx.sample_rate))
        trust = ramp(score, self.different_below, self.same_from)
        if trust >= 0.67:
            detail = f"Wake word and command are the same voice (similarity {score:.2f})."
        elif trust >= 0.34:
            detail = f"Wake word and command may be different voices (similarity {score:.2f})."
        else:
            detail = f"The command was not spoken by the voice that woke the agent (similarity {score:.2f})."
        return self.signal(trust, detail, similarity=round(score, 3),
                           thresholds={"different_below": self.different_below, "same_from": self.same_from})
