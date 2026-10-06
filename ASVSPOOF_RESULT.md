# Anti-Spoofing Benchmark — Real Result (ASVspoof 2019 LA)

**As-of:** 2026-10-06  **Module:** `echoguard/spoof` (baseline)  **Script:** `benchmark/asvspoof_hf.py`

## Result

**EER = 16.9%** on ASVspoof 2019 LA (Logical Access), the standard anti-spoofing benchmark.

| Setting | Value |
| --- | --- |
| Dataset | ASVspoof 2019 LA eval set (public Hugging Face parquet mirror) |
| Audio | FLAC, all 16 kHz — condition-matched (no sample-rate shortcut) |
| Split | speaker-disjoint (train/eval share no voice): 46 train / 21 eval speakers |
| Clips | 1,800 train (900 bonafide / 900 spoof) · 900 eval (450 / 450), balanced subset |
| Detector | baseline: handcrafted spectral features + logistic regression |
| **Equal Error Rate** | **16.9%** |

## Is this number trustworthy?

Yes, for what it is. Unlike the earlier in-the-wild pilot (where real=44.1 kHz and fake=16 kHz let the classifier cheat on sample rate), ASVspoof 2019 is **condition-matched** — genuine and spoof share recording conditions — and the split is **speaker-disjoint**, so there is no leakage. 16.9% reflects the detector actually distinguishing bonafide from spoofed speech.

## Context — this is a baseline, not a headline

- State-of-the-art ASVspoof systems reach ~1% EER using deep models. **16.9% is an honest baseline** from a deliberately simple feature+LR detector. Present it that way: "a lightweight, transparent baseline gets 16.9% EER; the point is a runnable, reproducible starting line, not a leaderboard entry."
- It is a **balanced subset** of the eval set (for a quick, reproducible run). A full-set run and a stronger model are straightforward next steps on a bigger machine.
- This is a **separate class** from EchoGuard's core inaudible-injection detectors. Keep the two distinct in the talk.

## Reproduce

```bash
pip install datasets soundfile huggingface_hub scikit-learn
python benchmark/asvspoof_hf.py                 # the run above
python benchmark/asvspoof_hf.py --shards 4 --per-class 1500   # larger
```

_No fabrication: the number comes from a real run on real ASVspoof 2019 LA data, reproducible with the script above._
