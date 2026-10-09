"""L2 / L3 on LibriSpeech dev-clean: speaker verification and same-speaker trials.

    python -m benchmark.trust.run_speaker --root ../data/LibriSpeech/dev-clean

Per speaker: enrol on the first `--enrol` utterances; the next `--targets`
utterances are target trials; the same number of impostor utterances are drawn
from other speakers. L3 pairs the first `--wake-sec` seconds of one utterance
("wake word") with another utterance ("command"), same or different speaker.
Results go to benchmark/trust/results/speaker.json.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time

import numpy as np

from echoguard.trust.checks.speaker import Embedder, SameSpeakerCheck, SpeakerVerificationCheck, cosine

from .data import librispeech, read_audio
from .metrics import eer, far_at_frr, rates_at

HERE = os.path.dirname(os.path.abspath(__file__))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--enrol", type=int, default=3)
    ap.add_argument("--targets", type=int, default=15)
    ap.add_argument("--max-sec", type=float, default=6.0, help="truncate utterances for speed")
    ap.add_argument("--wake-sec", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=os.path.join(HERE, "results", "speaker.json"))
    a = ap.parse_args()
    rng = random.Random(a.seed)

    spk = librispeech(a.root)
    emb = Embedder.shared()
    if not emb.available:
        raise SystemExit(emb.error)
    cache: dict[tuple[str, float], np.ndarray] = {}

    def E(path: str, sec: float | None = None) -> np.ndarray:
        key = (path, sec or 0.0)
        if key not in cache:
            x, sr = read_audio(path, max_sec=sec or a.max_sec)
            cache[key] = emb.embed(x, sr)
        return cache[key]

    t0 = time.time()
    # ---- L2: enrol + verify
    v_scores, v_target = [], []
    speakers = sorted(spk)
    for s in speakers:
        utts = spk[s]
        if len(utts) < a.enrol + 2:
            continue
        enrol = np.mean([E(p) for p in utts[: a.enrol]], axis=0)
        enrol /= np.linalg.norm(enrol) + 1e-9
        targets = utts[a.enrol: a.enrol + a.targets]
        others = [p for o in speakers if o != s for p in spk[o][a.enrol:]]
        impostors = rng.sample(others, min(len(targets), len(others)))
        for p in targets:
            v_scores.append(cosine(E(p), enrol)); v_target.append(True)
        for p in impostors:
            v_scores.append(cosine(E(p), enrol)); v_target.append(False)

    # ---- L3: wake (first wake-sec of one utterance) vs command (another utterance)
    w_scores, w_target = [], []
    for s in speakers:
        utts = spk[s]
        if len(utts) < 4:
            continue
        pairs = [(utts[i], utts[i + 1]) for i in range(0, min(len(utts) - 1, 2 * a.targets), 2)]
        for wake_p, cmd_p in pairs:
            w_scores.append(cosine(E(wake_p, a.wake_sec), E(cmd_p))); w_target.append(True)
            o = rng.choice([x for x in speakers if x != s])
            w_scores.append(cosine(E(wake_p, a.wake_sec), E(rng.choice(spk[o])))); w_target.append(False)

    ver, same = SpeakerVerificationCheck(), SameSpeakerCheck()
    # the check's accept/reject points in similarity units (trust .67 / .34 on its ramp)
    def pts(lo, hi):
        return lo + 0.67 * (hi - lo), lo + 0.34 * (hi - lo)
    v_acc, v_rej = pts(ver.reject_below, ver.accept_from)
    w_acc, w_rej = pts(same.different_below, same.same_from)

    def block(scores, target, acc, rej):
        e, thr = eer(scores, target)
        far5, thr5 = far_at_frr(scores, target, 0.05)
        far1, thr1 = far_at_frr(scores, target, 0.01)
        return {"trials": len(scores), "targets": int(sum(target)), "eer": round(e, 4), "eer_threshold": round(thr, 3),
                "far_at_frr5": round(far5, 4), "threshold_frr5": round(thr5, 3),
                "far_at_frr1": round(far1, 4), "threshold_frr1": round(thr1, 3),
                "at_default_thresholds": {"accept_at": round(acc, 3), "reject_below": round(rej, 3),
                                          **{k: (None if v is None else round(v, 4)) for k, v in rates_at(scores, target, acc, rej).items()}},
                "target_mean": round(float(np.mean([s for s, t in zip(scores, target) if t])), 3),
                "impostor_mean": round(float(np.mean([s for s, t in zip(scores, target) if not t])), 3)}

    out = {
        "dataset": "LibriSpeech dev-clean (read speech, 16 kHz, clean)", "speakers": len(speakers),
        "model": emb.source, "enrol_utts": a.enrol, "max_sec": a.max_sec, "wake_sec": a.wake_sec,
        "L2_speaker_verification": block(v_scores, v_target, v_acc, v_rej),
        "L3_same_speaker_wake_vs_command": block(w_scores, w_target, w_acc, w_rej),
        "elapsed_s": round(time.time() - t0, 1), "embeddings": len(cache),
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
