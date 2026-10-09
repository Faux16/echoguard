# The matched-device corpus: manifest and runner

The Phase 0 recordings are consumed by two things: `benchmark/trust/corpus/manifest.py`
(loader) and `benchmark/trust/run_scenarios.py` (the T1–T6 runner). Both read one file,
`trust_manifest.csv`, at the corpus root, one row per clip.

## Columns

| Column | Values | Meaning |
| --- | --- | --- |
| `file` | path relative to the root | the WAV (any rate; ≥ 44.1 kHz for L1 to assess) |
| `kind` | `enrol` · `wake` · `command` · `roomtest` | enrolment utterance; wake-word segment; the command; a clap/balloon for T60 |
| `user` | id | the enrolled user the device belongs to — whose authority counts |
| `speaker` | id | who is actually speaking in this clip (`== user` when genuine) |
| `condition` | `live` · `playback_phone` · `playback_tv` · `playback_bt` · `clone_tts` · `clone_vc` · `third_party` · `ultrasonic_c<kHz>_d<m>` · `hidden_audio` · `benign_hf` | how the clip was produced |
| `session` | id | groups a wake row with its command rows |
| `utt_id` | id | distinguishes commands within a session |
| `text` | string | reference transcript (what was said) |
| `alt_text` | string | optional second-decoder transcript; a disagreeing one marks a T5 row |
| `injection` | 0/1 | the text is a spoken-injection phrasing |
| `sensitivity` | `routine` · `sensitive` · `critical` | what the command would trigger |
| `device`, `room`, `distance_cm`, `capture_rate`, `consent`, `notes` | | as in `docs/recording_protocol.md` |

## How rows become threat classes

| Class | Rule |
| --- | --- |
| T1 inaudible injection | `condition` starts with `ultrasonic` |
| T2 hidden audible command | `condition` = `hidden_audio` |
| T3 third party | `condition` = `third_party` (speaker ≠ user) |
| T4 impersonation | `condition` starts with `playback` or `clone` |
| T5 adversarial transcription | `alt_text` present and different from `text` |
| T6 spoken injection | `injection` = 1 on a `live` row where speaker = user |
| BENIGN | `live`, speaker = user, injection 0 |
| BENIGN_HF | `benign_hf` (keys, cutlery, music with cymbals) |

The same audio file may appear in several rows with different `text` / `utt_id` — a
genuine recording can serve as a BENIGN trial, a T6 trial (injection transcript) and a
T5 trial (disagreeing second transcript).

## What the runner reports

- **Unauthorised actions executed** — attack trials the gate decided ALLOW. The number a buyer asks first.
- **Needless confirmations or blocks** — benign trials not allowed (for `critical` commands a CONFIRM is expected and not counted).
- Per class: decisions, levels, and *which check caught it* (the weakest assessable signal).
- Every trial's per-check trust values, for drilling into misses.

```bash
python -m benchmark.trust.run_scenarios --root /path/to/corpus            # default checks
python -m benchmark.trust.run_scenarios --root /path/to/corpus --reverb   # + experimental Λ
```

## Smoke corpus

`python -m benchmark.trust.corpus.make_smoke --libri LibriSpeech/dev-clean --out smoke_corpus`
builds a small corpus in this format from public proxies (LibriSpeech speakers, macOS
TTS, the synthesiser's ultrasonic injection) so the pipeline runs today. Its rows are
marked `SMOKE` in `notes`; its numbers verify plumbing, not performance.

## Recording checklist for a session

1. Three enrolment utterances per user (`kind=enrol`), natural sentences, ~2 s each.
2. For each scripted command: a wake row (the user, `kind=wake`, 1–1.5 s) and the command row(s) that follow it, sharing `session`.
3. Repeat the same commands under every condition the device/room supports, keeping `session` so the genuine wake word is paired with each.
4. One `roomtest` clip per room (balloon pop or clap) for the reverberation bound.
5. `speaker` must always say who is really talking; `user` must always say whose device it is.
