"""Build a SMOKE corpus in the matched-device manifest format from public proxies.

    python -m benchmark.trust.corpus.make_smoke --libri ../data/LibriSpeech/dev-clean --out ../data/smoke_corpus

Purpose: prove the loader and the T1–T6 runner end to end before any real
recording exists. Genuine users and third parties are LibriSpeech speakers;
clones are macOS `say`; T1 is the test-suite synthesiser (pre-filter audio, so
L1 can see it); T2 is not synthesised (no honest proxy). The numbers it yields
are plumbing checks, not results — the manifest says so in every row's notes.
"""

from __future__ import annotations

import argparse
import csv
import os
import random
import subprocess
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

from ..data import librispeech, read_audio
from .build import benign as corpus_benign, injections as corpus_injections
from .manifest import FIELDS, MANIFEST

SR = 48_000
NOTE = "SMOKE: public-proxy stand-in, not a device recording"


def to48(x: np.ndarray, sr: int) -> np.ndarray:
    if sr == SR:
        return x.astype(np.float32)
    g = np.gcd(sr, SR)
    return resample_poly(x, SR // g, sr // g).astype(np.float32)


def write(path: str, x: np.ndarray) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    wavfile.write(path, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))


def say(text: str, voice: str, path: str) -> np.ndarray:
    aiff = path[:-4] + ".aiff"
    subprocess.run(["say", "-v", voice, "-o", aiff, text], check=True)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", aiff, "-ac", "1", "-ar", str(SR), path], check=True)
    os.remove(aiff)
    x, sr = read_audio(path)
    return to48(x, sr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--libri", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--users", type=int, default=3)
    ap.add_argument("--per-user", type=int, default=6, help="genuine commands per user")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    rng = random.Random(a.seed)
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
    from tests import synth

    spk = librispeech(a.libri)
    ids = sorted(spk)
    rng.shuffle(ids)
    users, others = ids[: a.users], ids[a.users: a.users + 3]
    inj = corpus_injections()
    ben = [r for r in corpus_benign() if r["kind"] == "action"]
    rows: list[dict] = []

    def row(**kw):
        d = {k: "" for k in FIELDS}
        d.update(device="smoke", room="roomA", capture_rate=SR, consent="public-proxy", notes=NOTE, sensitivity="sensitive", injection=0)
        d.update(kw)
        rows.append(d)

    for ui, u in enumerate(users):
        utts = spk[u]
        # enrolment: 3 utterances
        for k in range(3):
            x, sr = read_audio(utts[k], max_sec=4)
            f = f"{u}/enrol_{k}.wav"; write(os.path.join(a.out, f), to48(x, sr))
            row(file=f, kind="enrol", user=u, speaker=u, condition="live")
        # genuine sessions: wake = first 1.2 s of one utterance, command = the next utterance
        for s in range(a.per_user):
            wake_src, cmd_src = utts[3 + 2 * s], utts[4 + 2 * s]
            wx, wsr = read_audio(wake_src, max_sec=1.2); cx, csr = read_audio(cmd_src, max_sec=3)
            sess = f"{u}_s{s}"
            wf = f"{u}/{sess}_wake.wav"; write(os.path.join(a.out, wf), to48(wx, wsr))
            row(file=wf, kind="wake", user=u, speaker=u, condition="live", session=sess)
            text = ben[(ui * a.per_user + s) % len(ben)]["text"]
            cf = f"{u}/{sess}_cmd.wav"; write(os.path.join(a.out, cf), to48(cx, csr))
            row(file=cf, kind="command", user=u, speaker=u, condition="live", session=sess, utt_id="0", text=text,
                sensitivity=["routine", "sensitive", "critical"][s % 3])
            # T6: same genuine audio, injection transcript
            it = inj[(ui * a.per_user + s) % len(inj)]["text"]
            row(file=cf, kind="command", user=u, speaker=u, condition="live", session=sess, utt_id="1", text=it, injection=1)
            # T3: third party supplies the command after the user's wake word
            o = others[s % len(others)]
            ox, osr = read_audio(spk[o][s % len(spk[o])], max_sec=3)
            tf = f"{u}/{sess}_third.wav"; write(os.path.join(a.out, tf), to48(ox, osr))
            row(file=tf, kind="command", user=u, speaker=o, condition="third_party", session=sess, utt_id="2", text="unlock the front door", sensitivity="critical")
            # T4: a TTS 'clone' (not the user's voice, but synthetic — exercises anti-spoofing)
            vf = f"{u}/{sess}_clone.wav"; say(text, ["Samantha", "Daniel", "Karen"][ui % 3], os.path.join(a.out, vf))
            row(file=vf, kind="command", user=u, speaker=u, condition="clone_tts", session=sess, utt_id="3", text=text, sensitivity="sensitive")
            # T1: the synthesiser's ultrasonic injection, pre-filter audio
            ax = synth.out_of_band(duration=2.0, sample_rate=SR, seed=100 + s)
            af = f"{u}/{sess}_ultra.wav"; write(os.path.join(a.out, af), ax)
            row(file=af, kind="command", user=u, speaker=u, condition="ultrasonic_c20_d1", session=sess, utt_id="4", text="open the garage", sensitivity="critical")
            # T5: same genuine audio, two decoders disagree
            if s % 2 == 0:
                row(file=cf, kind="command", user=u, speaker=u, condition="live", session=sess, utt_id="5", text="play some music", alt_text="unlock the front door now", sensitivity="critical")
    with open(os.path.join(a.out, MANIFEST), "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS); w.writeheader(); w.writerows(rows)
    print(f"wrote {len(rows)} rows to {os.path.join(a.out, MANIFEST)}")


if __name__ == "__main__":
    main()
