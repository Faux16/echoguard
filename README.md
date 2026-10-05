# EchoGuard

**A baseline open-source detector for inaudible / injected voice-command attacks.**

Voice assistants and, increasingly, action-taking AI voice agents and wearables have been attacked for nearly a decade — DolphinAttack (2017), SurfingAttack (2020), NUIT (2023), audio prompt injection against AI agents (2026). The attack literature is deep. The **defense** side is thin, older, and — critically — lives almost entirely in research papers. There is no simple, deployable tool a developer or device maker can run to screen a captured audio clip for the fingerprints these attacks leave behind.

EchoGuard is a first step toward closing that gap. It is **defensive only**: it inspects audio and reports risk. It does not generate attacks and ships no attack payloads.

> Status: `v0.1.0` — baseline detector. This is a screening tool, not a guarantee. See [Limitations](#limitations).

## What it does

Given a WAV clip, EchoGuard runs three detectors and returns a risk verdict with reasons:

| Detector | Looks for | Catches (class) |
| --- | --- | --- |
| `out_of_band_energy` | Significant energy above 18 kHz | Ultrasonic / near-ultrasound injection (DolphinAttack, NUIT) |
| `carrier_peak` | A dominant narrowband tone high in the band | Modulated ultrasonic carriers |
| `spectral_profile` | Energy roll-off inconsistent with human speech | Generic injected / synthetic / hidden-audio content |

Each detector returns a risk in `[0, 1]` with the numbers behind its decision. The overall verdict is conservative — the maximum across detectors — because any one high-confidence signature is worth flagging.

## Install

```bash
pip install -e .
```

Requires Python 3.9+, numpy, scipy.

## Usage

```bash
# Scan a clip
echoguard scan recording.wav

# Machine-readable output
echoguard scan recording.wav --json
```

Exit codes: `0` = CLEAR, `1` = SUSPICIOUS, `2` = HIGH_RISK, `3` = read error — so it drops into CI or a capture pipeline.

### Example

```
$ echoguard scan out_of_band.wav
EchoGuard scan: out_of_band.wav
========================================
Sample rate : 48000 Hz (Nyquist 24.0 kHz)
Duration    : 1.00 s
Verdict     : [ !! ] HIGH_RISK  (risk 1.00)

Detectors:
  - out_of_band_energy   high       risk 1.00
      97.2% of signal energy sits above 18 kHz - well beyond the human-voice band.
      Consistent with ultrasonic/near-ultrasound injection.
  - carrier_peak         high       risk 1.00
      Dominant narrowband tone at 20.0 kHz stands 119 dB above the local noise floor.
  - spectral_profile     high       risk 1.00
      99% of energy extends up to 20.0 kHz - inconsistent with a live speaker.
```

### Try it on sample fixtures

```bash
python examples/make_fixtures.py
echoguard scan fixtures/benign.wav            # -> CLEAR
echoguard scan fixtures/out_of_band.wav       # -> HIGH_RISK
echoguard scan fixtures/modulated_carrier.wav # -> HIGH_RISK
```

The fixtures are **synthetic test signals** with particular spectral shapes (band-limited noise, a high-frequency tone, an AM carrier). They contain no speech, no command, and nothing that can drive a device — they exist only to validate the detectors.

## Capture matters

Detecting ultrasonic and near-ultrasound energy requires a recording whose Nyquist frequency reaches into that band. A standard 16 kHz voice capture **cannot** see 18 kHz, and EchoGuard says so rather than returning a false "clear". For meaningful results, capture at **44.1 kHz or higher**.

## How it works

1. Load the WAV as a mono float signal at its true sample rate.
2. Estimate the power spectral density (Welch).
3. Each detector measures one property (out-of-band energy ratio, high-band peak prominence, 99% energy roll-off) and maps it to a risk score with a documented threshold.
4. Aggregate to a verdict.

Every threshold is a named constant in the detector module, so they are easy to audit and tune.

## Limitations

This is a **baseline screen**, and it is honest about what it is not:

- It detects **spectral signatures**, not intent. A legitimate clip with genuine ultrasonic content (some music, test tones) can flag — that is a feature of a screen, not a classifier.
- It does **not** cover replay or voice-clone spoofing (that needs liveness/anti-spoofing models) or application-layer abuse (skill squatting). Those are on the roadmap.
- It works on recorded clips. Real-time, on-device deployment is future work.
- Thresholds are set against synthetic fixtures and need calibration on real-world captures across devices.

## Roadmap

- [ ] Real-device capture dataset across phones / speakers / wearables
- [ ] Replay & voice-clone (anti-spoofing) detector module
- [ ] Streaming / real-time mode
- [ ] Benchmark against the current attack generation (NUIT, hearable-generated sound, audio prompt injection)
- [ ] Reference integration for an action-taking voice agent's confirmation step

## Research context

EchoGuard is built on, and credits, a decade of prior work. See `docs/` for the attack/defense landscape. Key references: DolphinAttack (CCS 2017), SurfingAttack (NDSS 2020), NUIT (2023), EarArray (NDSS 2021), and the ACM Computing Surveys *Voice Assistant Security* survey (2022).

## Contributing

Issues and PRs welcome — especially real-world captures and new detector modules. Run the tests with:

```bash
pip install -e ".[dev]"
pytest -q
```

## License

MIT — see [LICENSE](LICENSE).

---

*EchoGuard is a defensive research tool. Use it only on audio you are authorised to analyse.*
