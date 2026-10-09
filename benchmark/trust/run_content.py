"""L4 content safety on public text, and on the same text spoken by TTS and transcribed.

    python -m benchmark.trust.run_content --deepset ../data/deepset --slurp ../data/slurp --tts 120

Text level: deepset injections (positives), deepset benign + SLURP commands (negatives).
Spoken level: a sample of each rendered with macOS `say` in four voices, transcribed
with Whisper, and scored on the transcript — so ASR errors are in the loop.
Results go to benchmark/trust/results/content.json; every miss and false alarm is listed.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time

from echoguard.trust import ContentSafetyCheck, TrustContext
from echoguard.trust.checks.content import _wer, normalise

from .data import deepset, render_tts, slurp_sentences, transcribe_all

HERE = os.path.dirname(os.path.abspath(__file__))
FLAG_BELOW = 0.67     # a transcript is "flagged" when its trust is below the clean band


def score(check: ContentSafetyCheck, texts: list[str]) -> list[dict]:
    out = []
    for t in texts:
        s = check.run(TrustContext(transcript=t))
        out.append({"text": t, "trust": None if not s.assessable else round(s.trust, 3),
                    "flagged": bool(s.assessable and s.trust < FLAG_BELOW),
                    "families": sorted({m["family"] for m in s.evidence.get("matches", [])})})
    return out


def summarise(pos: list[dict], neg: list[dict]) -> dict:
    tp = sum(r["flagged"] for r in pos)
    fp = sum(r["flagged"] for r in neg)
    return {"positives": len(pos), "detected": tp, "detection_rate": round(tp / len(pos), 4) if pos else None,
            "negatives": len(neg), "false_alarms": fp, "false_alarm_rate": round(fp / len(neg), 4) if neg else None,
            "missed_examples": [r["text"][:140] for r in pos if not r["flagged"]][:25],
            "false_alarm_examples": [r["text"][:140] for r in neg if r["flagged"]][:25]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--deepset", required=True)
    ap.add_argument("--slurp", required=True)
    ap.add_argument("--tts", type=int, default=0, help="render this many injections and this many benign commands")
    ap.add_argument("--tts-dir", default=os.path.join(HERE, "results", "tts"))
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default=os.path.join(HERE, "results", "content.json"))
    a = ap.parse_args()
    rng = random.Random(a.seed)
    t0 = time.time()

    inj, ben = deepset(a.deepset)
    slurp = slurp_sentences(a.slurp)
    check = ContentSafetyCheck()
    text = {
        "deepset_injections_vs_deepset_benign": summarise(score(check, inj), score(check, ben)),
        "deepset_injections_vs_slurp_commands": summarise(score(check, inj), score(check, slurp)),
    }
    out: dict = {"text_level": text, "counts": {"deepset_injections": len(inj), "deepset_benign": len(ben), "slurp_commands": len(slurp)}}

    if a.tts:
        # keep TTS inputs to sentence-sized injections; long multi-paragraph rows are not spoken commands
        short_inj = [t for t in inj if 6 <= len(t.split()) <= 40]
        pos_texts = rng.sample(short_inj, min(a.tts, len(short_inj)))
        neg_texts = rng.sample(slurp, min(a.tts, len(slurp)))
        pos = transcribe_all(render_tts(pos_texts, os.path.join(a.tts_dir, "inj")), os.path.join(a.tts_dir, "asr.json"))
        neg = transcribe_all(render_tts(neg_texts, os.path.join(a.tts_dir, "ben")), os.path.join(a.tts_dir, "asr.json"))
        pos_s = score(check, [it["asr"] for it in pos])
        neg_s = score(check, [it["asr"] for it in neg])
        wers = [_wer(normalise(it["text"]).split(), normalise(it["asr"]).split()) for it in pos + neg]
        # did ASR noise change any decision versus the reference text?
        pos_ref = score(check, [it["text"] for it in pos])
        neg_ref = score(check, [it["text"] for it in neg])
        out["spoken_level"] = {
            "rendered": {"injections": len(pos), "benign": len(neg), "voices": sorted({it["voice"] for it in pos + neg})},
            "asr": "faster-whisper base.en", "mean_wer_vs_reference": round(sum(wers) / len(wers), 4),
            **summarise(pos_s, neg_s),
            "decisions_changed_by_asr": sum(p["flagged"] != r["flagged"] for p, r in zip(pos_s + neg_s, pos_ref + neg_ref)),
            "examples": [{"ref": it["text"][:120], "asr": it["asr"][:120], "voice": it["voice"], "trust": s["trust"]}
                         for it, s in list(zip(pos, pos_s))[:8]],
        }
    out["elapsed_s"] = round(time.time() - t0, 1)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    print(json.dumps({k: v for k, v in out.items() if k != "text_level"} | {"text_level": {k: {kk: vv for kk, vv in v.items() if not kk.endswith("examples")} for k, v in text.items()}}, indent=1))


if __name__ == "__main__":
    main()
