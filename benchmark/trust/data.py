"""Data access for the trust harness: LibriSpeech, SLURP, deepset, TTS rendering, ASR."""

from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import subprocess
from typing import Iterable, Optional

import numpy as np

# ---------------------------------------------------------------- LibriSpeech

def librispeech(root: str) -> dict[str, list[str]]:
    """speaker id -> sorted list of flac paths (dev-clean: 40 speakers)."""
    out: dict[str, list[str]] = {}
    for p in sorted(glob.glob(os.path.join(root, "*", "*", "*.flac"))):
        spk = os.path.basename(os.path.dirname(os.path.dirname(p)))
        out.setdefault(spk, []).append(p)
    if not out:
        raise FileNotFoundError(f"no flac files under {root}")
    return out


def read_audio(path: str, max_sec: Optional[float] = None) -> tuple[np.ndarray, int]:
    import soundfile as sf
    x, sr = sf.read(path, dtype="float32", always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if max_sec:
        x = x[: int(max_sec * sr)]
    return x, int(sr)


# ---------------------------------------------------------------- text sets

def slurp_sentences(folder: str) -> list[str]:
    """Unique spoken-assistant commands from SLURP's text annotations."""
    seen, out = set(), []
    for name in ("test.jsonl", "devel.jsonl"):
        p = os.path.join(folder, name)
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                s = json.loads(line).get("sentence", "").strip().lower()
                if s and s not in seen:
                    seen.add(s)
                    out.append(s)
    if not out:
        raise FileNotFoundError(f"no SLURP jsonl under {folder}")
    return out


_EN = re.compile(r"\b(the|and|you|your|to|of|is|are|please|ignore|all|instructions?|what|how|do|not)\b", re.I)
_DE = re.compile(r"\b(und|der|die|das|nicht|ist|ich|sie|ein|eine|bitte|alle|anweisungen)\b", re.I)


def deepset(folder: str) -> tuple[list[str], list[str]]:
    """(injections, benign) English rows of deepset/prompt-injections (label 1 = injection)."""
    import pandas as pd
    frames = [pd.read_parquet(p) for p in sorted(glob.glob(os.path.join(folder, "*.parquet")))]
    if not frames:
        raise FileNotFoundError(f"no parquet under {folder}")
    df = pd.concat(frames, ignore_index=True)
    inj, ben = [], []
    for text, label in zip(df["text"], df["label"]):
        t = str(text).strip()
        if len(_DE.findall(t)) > len(_EN.findall(t)):      # drop the German rows
            continue
        (inj if int(label) == 1 else ben).append(t)
    return inj, ben


# ---------------------------------------------------------------- TTS + ASR

VOICES = ("Samantha", "Daniel", "Karen", "Rishi")


def render_tts(texts: Iterable[str], out_dir: str, voices: tuple[str, ...] = VOICES, rate_hz: int = 16_000) -> list[dict]:
    """Render each text with macOS `say`, round-robin over voices, to 16 kHz mono WAV.

    Returns [{text, voice, path}]; existing files are reused (keyed on text+voice).
    """
    os.makedirs(out_dir, exist_ok=True)
    out = []
    for i, text in enumerate(texts):
        voice = voices[i % len(voices)]
        key = hashlib.sha1(f"{voice}|{text}".encode()).hexdigest()[:12]
        wav = os.path.join(out_dir, f"{key}.wav")
        if not os.path.exists(wav):
            aiff = wav[:-4] + ".aiff"
            subprocess.run(["say", "-v", voice, "-o", aiff, text], check=True)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", aiff, "-ac", "1", "-ar", str(rate_hz), wav], check=True)
            os.remove(aiff)
        out.append({"text": text, "voice": voice, "path": wav})
    return out


class ASR:
    """faster-whisper, small and CPU-bound; good enough to inject realistic recognition errors."""

    def __init__(self, model: str = "base.en"):
        from faster_whisper import WhisperModel
        self.model = WhisperModel(model, device="cpu", compute_type="int8")

    def transcribe(self, path: str) -> str:
        x, sr = read_audio(path)                      # decode ourselves: faster-whisper's PyAV path breaks on newer av
        if sr != 16_000:
            from scipy.signal import resample_poly
            g = np.gcd(sr, 16_000)
            x = resample_poly(x, 16_000 // g, sr // g).astype(np.float32)
        segments, _ = self.model.transcribe(np.asarray(x, dtype=np.float32), beam_size=1, language="en", vad_filter=False)
        return " ".join(s.text.strip() for s in segments).strip()


def transcribe_all(items: list[dict], cache_path: str, asr: Optional[ASR] = None) -> list[dict]:
    """Add `asr` to each item, caching transcripts by path."""
    cache: dict[str, str] = {}
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as fh:
            cache = json.load(fh)
    todo = [it for it in items if it["path"] not in cache]
    if todo:
        asr = asr or ASR()
        for it in todo:
            cache[it["path"]] = asr.transcribe(it["path"])
        with open(cache_path, "w", encoding="utf-8") as fh:
            json.dump(cache, fh, indent=1)
    for it in items:
        it["asr"] = cache[it["path"]]
    return items
