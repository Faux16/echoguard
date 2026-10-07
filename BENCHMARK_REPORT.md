# EchoGuard — Benchmark Report

**Version:** v0.1.0  **As-of:** 2026-10-06  **Scope:** what has actually been measured, and what has not.

## Summary

EchoGuard has been benchmarked on two things that can be measured honestly without a capture lab: its **false-positive rate on benign audio** (real result) and its **detector sensitivity to a controlled synthetic probe** (characterization). Benign false positives are **0%** after a corroboration fix (down from 75%). The sensitivity analysis shows the detector flags a high-frequency carrier once it reaches ~5% of the signal level and covers 18 kHz and above, but is **blind to weak carriers (below ~3%) and to the 15–17 kHz band**. The **detection rate against real attacks has not been measured** — that requires the capture lab and is the main open item. No real-attack numbers are reported here because none have been produced; fabricating them would invalidate the work.

## 1. Benign false positives — measured, real

60 benign clips (synthetic: speech, bright music, pink noise, white noise), scored by the pipeline.

| Benign audio | FP before fix | FP after fix |
| --- | --- | --- |
| Speech | 0% | 0% |
| Bright music | 100% | 0% |
| Pink noise | 100% | 0% |
| White noise | 100% | 0% |
| **Overall (60 clips)** | **75%** | **0%** |

The original "flag if any detector fires" logic condemned any broadband/high-frequency audio. The fix scores an injection as the geometric mean of two detectors — out-of-band energy **and** a narrowband carrier, both required — which benign audio never satisfies (it trips at most one). *(Chart: `echoguard_fp_beforeafter.png`.)*

## 2. Synthetic sensitivity analysis — detector characterization

**What this is and is not.** These are controlled synthetic probes — a generic high-frequency carrier over a benign speech-band base — used to map the detector's response. They contain no voice command and drive no device. This is **not** a real-attack benchmark and makes **no** claim about real-world detection. Its purpose is to quantify the known blind spots of the corroboration rule. *(Chart: `echoguard_sensitivity.png`.)*

### A. Sensitivity to carrier strength

Carrier at 21 kHz, strength swept as a fraction of the base amplitude; 10 trials per point.

| Carrier strength (× base) | Detection |
| --- | --- |
| ≤ 0.023 | 0% |
| 0.034 | 10% |
| **0.051** | **100%** |
| ≥ 0.077 | 100% |

**Sensitivity floor ≈ 0.05.** A carrier at or above ~5% of the signal is reliably flagged; below ~3% it is missed. This is the weak-carrier blind spot, quantified: a real attack whose carrier is heavily attenuated by the time it reaches the mic could fall under this floor.

### B. Coverage across carrier frequency

Carrier strength fixed at 0.3; frequency swept.

| Carrier frequency | Detection |
| --- | --- |
| 15 kHz | 0% |
| 16 kHz | 0% |
| 17 kHz | 0% |
| 18 kHz | 100% |
| 19–23 kHz | 100% |

**Blind band: 15–17 kHz.** The out-of-band detector's threshold sits at 18 kHz, so a near-ultrasound carrier in 15–17 kHz is not corroborated and is not flagged. Lowering the threshold would extend coverage but would re-introduce false positives on bright music (which has genuine energy there) — a tuning trade-off to study on real data, not to guess at.

## 3. Not yet measured — real-attack detection

**The detection rate against real inaudible-injection attacks is unmeasured.** It requires:

- real attack captures (a controlled lab, or shared captures from the paper authors), and
- running them through the existing `benchmark/evaluate.py` harness, which is ready for exactly this.

Until that exists, EchoGuard's detection claim is limited to synthetic signals. This is stated plainly rather than papered over — see the Lab Plan for how to produce the real captures.

## 4. Limitations & recommendations

- The 0% benign FP is on synthetic benign audio; confirm on real recordings across devices.
- The corroboration rule trades sensitivity for precision: it will miss weak carriers (§2A) and the 15–17 kHz band (§2B). Both are tuning knobs to calibrate on real data.
- Recommended next step: capture a real labelled set (benign + attack), re-run both the FP and detection benchmarks, and sweep the out-of-band threshold and the corroboration weights to pick an operating point with measured, not assumed, trade-offs.

## 5. Short-clip false positives — found and fixed

The 0% benign FP in §1 was measured on 1.5 s clips. On shorter white noise at 48 kHz the carrier detector misfired: a Welch spectrum built from few segments is noisy, so its largest high-band bin stands several dB above the median by chance, and the old fixed `prominence / 30 dB` scale counted that as a carrier.

**Fix:** a constant-false-alarm-rate threshold. Each Welch bin of noise is ~ χ²(ν)/ν, with ν the equivalent degrees of freedom of the segment average (Hann, 50% overlap). The detector computes the peak-to-median ratio that noise alone exceeds with probability 10⁻³ over the high band, and scores only the prominence in excess of it. The threshold is 8.4 dB at 0.1 s, 2.7 dB at 1 s and 2.0 dB at 2 s.

| White noise, 50 clips | 0.1 s | 0.2 s | 0.3 s | 0.5 s | ≥ 1 s |
| --- | --- | --- | --- | --- | --- |
| Flagged before | 100% | 96% | 48% | 2% | 0% |
| Flagged after | 0% | 0% | 0% | 0% | 0% |

Everything else is unchanged: benign FP 0/60, sensitivity floor α ≈ 0.051, 15–17 kHz blind band, realistic synthetic attacks 12/12 with 0/12 false alarms. Regression tests: `tests/test_detectors.py::test_short_*`.

## Reproduce

```bash
python benchmark/corpus.py benchmark/corpus_benign
python benchmark/evaluate.py benchmark/corpus_benign   # benign false positives
python benchmark/sensitivity.py                        # synthetic sensitivity sweeps
```

---

*This report describes only measurements actually performed. Real-attack detection figures are intentionally absent until the capture lab produces them.*
