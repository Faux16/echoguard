"""Anti-spoofing on ASVspoof2019 LA eval: bonafide vs synthetic / converted speech.

    python -m benchmark.trust.run_spoof --root ../data/asvspoof2019 --per-attack 80 --bonafide 500

Reads the Hugging Face parquet packaging of the LA *evaluation* partition
(`SpeechAntiSpoofingBenchmarks/ASVspoof2019_LA`: one or more `test-*.parquet`
shards plus the official protocol file for attack ids). Attacks A07–A19 were
unseen by the model's training protocol. Scores a stratified sample, reports
EER, FAR at fixed FRR, the per-attack miss rate at the EER threshold, and the
rates at the check's current trust mapping. Results go to
benchmark/trust/results/spoof.json.
"""

from __future__ import annotations

import argparse
import glob
import io
import json
import os
import random
import time
from collections import defaultdict

import numpy as np

from echoguard.trust.checks.liveness import AntiSpoofCheck, SpoofScorer

from .metrics import eer, far_at_frr, rates_at

HERE = os.path.dirname(os.path.abspath(__file__))


def protocol(root: str) -> dict[str, tuple[str, bool]]:
    """utterance id -> (attack id or '-', is_bonafide)."""
    out = {}
    for name in ("eval.trl.txt", "ASVspoof2019.LA.cm.eval.trl.txt"):
        p = os.path.join(root, name)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as fh:
                for line in fh:
                    _, utt, _, attack, label = line.split()
                    out[utt] = (attack, label == "bonafide")
            return out
    raise FileNotFoundError(f"no eval protocol under {root}")


def rows(root: str, proto: dict) -> list[dict]:
    import pyarrow.parquet as pq
    out = []
    for shard in sorted(glob.glob(os.path.join(root, "test-*.parquet"))):
        pf = pq.ParquetFile(shard)
        for i in range(pf.num_row_groups):
            t = pf.read_row_group(i, columns=["path", "audio", "label"])
            for path, audio, label in zip(t.column("path").to_pylist(), t.column("audio").to_pylist(), t.column("label").to_pylist()):
                utt = os.path.splitext(os.path.basename(path))[0]
                attack, bona = proto.get(utt, ("?", label == 0))
                out.append({"utt": utt, "attack": attack, "bonafide": bona, "bytes": audio["bytes"]})
    if not out:
        raise FileNotFoundError(f"no test-*.parquet shards under {root}")
    return out


def decode(b: bytes) -> tuple[np.ndarray, int]:
    import soundfile as sf
    x, sr = sf.read(io.BytesIO(b), dtype="float32", always_2d=False)
    return (x.mean(axis=1) if x.ndim > 1 else x), int(sr)


def sample(all_rows, per_attack: int, bonafide: int, rng: random.Random):
    by = defaultdict(list)
    for r in all_rows:
        by["bonafide" if r["bonafide"] else r["attack"]].append(r)
    out = rng.sample(by["bonafide"], min(bonafide, len(by["bonafide"])))
    for k, v in sorted(by.items()):
        if k != "bonafide":
            out.extend(rng.sample(v, min(per_attack, len(v))))
    return out, {k: len(v) for k, v in sorted(by.items())}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--per-attack", type=int, default=80)
    ap.add_argument("--bonafide", type=int, default=500)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=os.path.join(HERE, "results", "spoof.json"))
    a = ap.parse_args()
    rng = random.Random(a.seed)
    sc = SpoofScorer.shared()
    if not sc.available:
        raise SystemExit(sc.error)
    chk = AntiSpoofCheck()
    acc = chk.spoof_below + 0.67 * (chk.bonafide_from - chk.spoof_below)
    rej = chk.spoof_below + 0.34 * (chk.bonafide_from - chk.spoof_below)

    t0 = time.time()
    picked, available = sample(rows(a.root, protocol(a.root)), a.per_attack, a.bonafide, rng)
    scores, target, attack = [], [], []
    for r in picked:
        x, sr = decode(r["bytes"])
        scores.append(sc.bonafide_logit(x, sr)); target.append(r["bonafide"]); attack.append(r["attack"])
    e, thr = eer(scores, target)
    far5, thr5 = far_at_frr(scores, target, 0.05)
    far1, thr1 = far_at_frr(scores, target, 0.01)
    per = {}
    for atk in sorted(set(attack) - {"-"}):
        s = [v for v, at in zip(scores, attack) if at == atk]
        per[atk] = {"n": len(s), "miss_rate_at_eer": round(sum(v >= thr for v in s) / len(s), 4),
                    "accepted_at_default": round(sum(v >= acc for v in s) / len(s), 4), "mean_logit": round(float(np.mean(s)), 3)}
    bona = [v for v, t in zip(scores, target) if t]
    spoof = [v for v, t in zip(scores, target) if not t]
    out = {
        "dataset": "ASVspoof2019 LA evaluation partition (16 kHz; TTS and voice-conversion attacks A07-A19)",
        "source": "SpeechAntiSpoofingBenchmarks/ASVspoof2019_LA (parquet mirror, ODC-By)", "model": sc.repo,
        "shards_loaded": len(glob.glob(os.path.join(a.root, "test-*.parquet"))), "available_in_shards": available,
        "trials": len(picked), "bonafide": len(bona), "spoof": len(spoof),
        "eer": round(e, 4), "eer_threshold": round(thr, 3),
        "far_at_frr5": round(far5, 4), "threshold_frr5": round(thr5, 3), "far_at_frr1": round(far1, 4), "threshold_frr1": round(thr1, 3),
        "bonafide_mean_logit": round(float(np.mean(bona)), 3), "bonafide_p05_logit": round(float(np.quantile(bona, .05)), 3),
        "spoof_mean_logit": round(float(np.mean(spoof)), 3), "spoof_p95_logit": round(float(np.quantile(spoof, .95)), 3),
        "at_default_mapping": {"accept_at": round(acc, 3), "reject_below": round(rej, 3),
                               **{k: (None if v is None else round(v, 4)) for k, v in rates_at(scores, target, acc, rej).items()}},
        "per_attack": per, "elapsed_s": round(time.time() - t0, 1),
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k not in ("per_attack", "available_in_shards")}, indent=1))
    print("per attack:", {k: v["miss_rate_at_eer"] for k, v in per.items()})


if __name__ == "__main__":
    main()
