# Anti-Spoofing Pilot — Result and Caveat

**As-of:** 2026-10-06  **Module:** `echoguard/spoof` (experimental baseline)

## What we did

Ran the experimental anti-spoofing detector (spectral features + logistic regression) end to end on **real** deepfake-audio data: 300 clips (150 genuine, 150 synthetic) sampled from a public Hugging Face dataset (`Tanishq125/deepfake-audio-detection`), with a source-disjoint train/eval split.

**Outcome:** the full pipeline works on real audio — download, decode, featurize, train, score, EER. That milestone is met: the module is real-data-ready.

## The result is not trustworthy — and here's why (the useful part)

The pilot reported **EER = 0.0%**, which is a red flag, not a success. On inspection:

| Class | Sample rate | 95% bandwidth (mean) |
| --- | --- | --- |
| Real (YouTube) | 44,100 Hz | 3,617 Hz |
| Fake (TTS) | 16,000 Hz | 2,122 Hz |

The genuine and synthetic clips come from **different sources at different audio quality**. The classifier separated them trivially by **sample rate / bandwidth** — a recording artifact — not by any deepfake cue. A "perfect" score here means the dataset is confounded, not that the detector is good.

## What this proves

This is the classic deepfake-dataset pitfall, and catching it is the point: **a quick in-the-wild dataset gives a misleadingly perfect score.** It is exactly why controlled benchmarks like **ASVspoof** exist — there, genuine and spoof share recording conditions, so a detector cannot cheat on metadata.

## Conclusion / next step

- The anti-spoofing module and ASVspoof adapter are built and proven to run on real audio.
- A **trustworthy** EER requires a controlled, condition-matched corpus (ASVspoof 2021 or ASVspoof 5), run on a machine that can hold the tens-of-GB dataset.
- Do **not** quote the 0% pilot figure anywhere. Quote it, if at all, only as this cautionary finding.

_Honesty note: no deepfake-detection performance is claimed. The pilot demonstrates the pipeline runs and surfaces a dataset confound; the real number comes from ASVspoof._
