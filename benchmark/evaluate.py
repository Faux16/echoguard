"""Benchmark harness: run EchoGuard over a labelled corpus and report metrics.

Usage:
    python benchmark/evaluate.py <corpus_dir>   # dir must contain manifest.csv

manifest.csv columns: file, label (benign|attack), category

Metrics:
  - For benign audio: false-positive rate = fraction flagged SUSPICIOUS or HIGH_RISK.
    INSUFFICIENT_DATA is reported separately - it is "couldn't assess", not a false alarm.
  - For attack audio (when a real labelled set is supplied): detection rate = fraction
    flagged SUSPICIOUS or HIGH_RISK.

This harness is the measurement half of Move 1. It is ready for real attack captures;
it does not generate them.
"""

from __future__ import annotations

import os
import csv
import sys
from collections import defaultdict

from echoguard.audio import load_wav
from echoguard.pipeline import Pipeline, CLEAR, SUSPICIOUS, HIGH_RISK, INSUFFICIENT_DATA

FLAGGED = {SUSPICIOUS, HIGH_RISK}


def run(corpus_dir: str):
    manifest = os.path.join(corpus_dir, "manifest.csv")
    with open(manifest) as f:
        rows = list(csv.DictReader(f))

    pipe = Pipeline()
    # category -> verdict -> count
    tally: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    label_of: dict[str, str] = {}

    for r in rows:
        signal, sr = load_wav(os.path.join(corpus_dir, r["file"]))
        verdict = pipe.analyze(signal, sr).verdict
        tally[r["category"]][verdict] += 1
        label_of[r["category"]] = r["label"]

    return tally, label_of


def report(tally, label_of) -> str:
    lines = []
    header = f"{'category':<16}{'label':<9}{'n':>4}{'CLEAR':>7}{'SUSP':>6}{'HIGH':>6}{'INSUF':>7}{'flag%':>8}"
    lines.append(header)
    lines.append("-" * len(header))
    totals = defaultdict(int)
    for cat, counts in tally.items():
        n = sum(counts.values())
        clear = counts.get(CLEAR, 0)
        susp = counts.get(SUSPICIOUS, 0)
        high = counts.get(HIGH_RISK, 0)
        insuf = counts.get(INSUFFICIENT_DATA, 0)
        flagged = susp + high
        rate = 100.0 * flagged / n if n else 0.0
        lines.append(
            f"{cat:<16}{label_of[cat]:<9}{n:>4}{clear:>7}{susp:>6}{high:>6}{insuf:>7}{rate:>7.0f}%"
        )
        totals["n"] += n
        totals["flagged"] += flagged
        totals["benign_n"] += n if label_of[cat] == "benign" else 0
        totals["benign_flagged"] += flagged if label_of[cat] == "benign" else 0

    lines.append("")
    if totals["benign_n"]:
        fpr = 100.0 * totals["benign_flagged"] / totals["benign_n"]
        lines.append(f"Overall benign false-positive rate: {fpr:.0f}%  "
                     f"({totals['benign_flagged']}/{totals['benign_n']} benign clips flagged)")
    return "\n".join(lines)


if __name__ == "__main__":
    corpus = sys.argv[1] if len(sys.argv) > 1 else "benchmark/corpus_benign"
    tally, label_of = run(corpus)
    print(report(tally, label_of))
