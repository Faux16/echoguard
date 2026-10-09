"""T1–T6 scenario runner: the end-to-end numbers an integrator needs.

    python -m benchmark.trust.run_scenarios --root ../data/smoke_corpus
    python -m benchmark.trust.run_scenarios --root /path/to/matched_device_corpus --reverb

Loads a matched-device corpus (benchmark/trust/corpus/manifest.py), enrols each
user from their enrolment rows, runs the full TrustGate on every command trial
with its wake word and the device owner's profile, and reports per threat class:

    unauthorised actions executed   attack trials decided ALLOW
    stopped                         attack trials decided CONFIRM or BLOCK, and by which check
    needless confirmations/blocks   benign trials not ALLOWed (for critical actions, CONFIRM is expected)

Results go to benchmark/trust/results/scenarios.json. Numbers are only as real
as the corpus: on the smoke corpus they prove the pipeline, nothing else.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections import defaultdict

from echoguard.gate import ActionSensitivity, GateDecision
from echoguard.trust import Layer, SpeakerProfile, TrustContext, TrustGate, default_checks
from echoguard.trust.checks.reverb import ReverbConsistencyCheck
from echoguard.trust.checks.speaker import Embedder

from .corpus.manifest import load, summary
from .data import read_audio

HERE = os.path.dirname(os.path.abspath(__file__))
CLASS_LABEL = {"T1": "inaudible injection", "T2": "hidden audible command", "T3": "third-party speech / playback of another voice",
               "T4": "impersonation (replay or clone of the user)", "T5": "adversarial transcription", "T6": "spoken prompt injection",
               "BENIGN": "genuine user, ordinary command", "BENIGN_HF": "genuine user with high-frequency sound", "UNKNOWN": "unclassified"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--reverb", action="store_true", help="add the experimental reverberation-consistency check")
    ap.add_argument("--required", default="L1,L2,L4", help="layers that must assess for TRUSTED")
    ap.add_argument("--checks", default="", help="comma list of check names to run (default: all default checks)")
    ap.add_argument("--out", default=os.path.join(HERE, "results", "scenarios.json"))
    a = ap.parse_args()
    t0 = time.time()

    trials = load(a.root)
    info = summary(trials)
    print(f"corpus: {info['trials']} command trials · classes {info['by_class']} · users {info['users']} · "
          f"{info['with_wake']} with wake, {info['with_enrolment']} with enrolment")

    checks = default_checks() + ([ReverbConsistencyCheck()] if a.reverb else [])
    if a.checks:
        wanted = {c.strip() for c in a.checks.split(",") if c.strip()}
        unknown = wanted - {c.name for c in checks}
        if unknown:
            raise SystemExit(f"unknown checks {sorted(unknown)}; available: {[c.name for c in checks]}")
        checks = [c for c in checks if c.name in wanted]
    gate = TrustGate(checks=checks, required_layers=tuple(Layer(x.strip()) for x in a.required.split(",") if x.strip()))

    # enrol every user once
    profiles: dict[str, SpeakerProfile] = {}
    emb = Embedder.shared()
    enrol_rows = defaultdict(list)
    for t in trials:
        for r in t.enrol:
            enrol_rows[r.user].append(r)
    if emb.available:
        for user, rows in enrol_rows.items():
            utts = [read_audio(r.path) for r in sorted({r.path: r for r in rows}.values(), key=lambda r: r.path)]
            profiles[user] = SpeakerProfile.enrol(user, utts, embedder=emb)
        print(f"enrolled {len(profiles)} user(s): {', '.join(f'{u} ({p.n_utterances} utt)' for u, p in profiles.items())}")
    else:
        print(f"speaker model unavailable ({emb.error}); L2/L3 will report could-not-check")

    per_trial, by_class = [], defaultdict(lambda: {"n": 0, "allow": 0, "confirm": 0, "block": 0, "levels": defaultdict(int), "caught_by": defaultdict(int)})
    cache: dict[str, tuple] = {}

    def audio(path):
        if path not in cache:
            cache[path] = read_audio(path)
        return cache[path]

    for t in trials:
        x, sr = audio(t.command.path)
        wake = None
        if t.wake is not None:
            wx, wsr = audio(t.wake.path)
            wake = wx if wsr == sr else None
        ctx = TrustContext(audio=x, sample_rate=sr, transcript=t.command.text or None, alt_transcript=t.command.alt_text or None,
                           wake_audio=wake, speaker_profile=profiles.get(t.command.user),
                           meta={"file": t.command.file, "device": t.command.device, "room": t.command.room, "condition": t.command.condition})
        res = gate.evaluate(ctx, ActionSensitivity(t.command.sensitivity), command=t.command.text)
        cls = t.threat_class
        b = by_class[cls]
        b["n"] += 1
        b[res.decision.value] += 1
        b["levels"][res.level.value] += 1
        weakest = min((s for s in res.score.signals if s.assessable), key=lambda s: s.trust, default=None)
        if res.decision is not GateDecision.ALLOW and weakest is not None and weakest.trust < 0.67:
            b["caught_by"][weakest.name] += 1
        per_trial.append({"file": t.command.file, "class": cls, "condition": t.command.condition, "device": t.command.device, "room": t.command.room,
                          "speaker": t.command.speaker, "user": t.command.user, "sensitivity": t.command.sensitivity,
                          "decision": res.decision.value, "level": res.level.value, "weakest": weakest.name if weakest else None,
                          "signals": {s.name: (None if not s.assessable else round(s.trust, 3)) for s in res.score.signals}})

    # headline numbers
    attack = [p for p in per_trial if p["class"].startswith("T")]
    benign = [p for p in per_trial if p["class"].startswith("BENIGN")]
    executed = [p for p in attack if p["decision"] == "allow"]
    needless = [p for p in benign if p["decision"] == "block" or (p["decision"] == "confirm" and p["sensitivity"] != "critical")]
    out = {
        "corpus": os.path.abspath(a.root), "summary": info, "checks": [c.name for c in checks], "required_layers": a.required,
        "speaker_model": emb.available, "profiles": {u: p.n_utterances for u, p in profiles.items()},
        "headline": {
            "attack_trials": len(attack), "unauthorised_actions_executed": len(executed),
            "unauthorised_rate": round(len(executed) / len(attack), 4) if attack else None,
            "benign_trials": len(benign), "needless_confirm_or_block": len(needless),
            "needless_rate": round(len(needless) / len(benign), 4) if benign else None,
        },
        "by_class": {k: {**v, "label": CLASS_LABEL.get(k, k), "levels": dict(v["levels"]), "caught_by": dict(v["caught_by"])} for k, v in sorted(by_class.items())},
        "executed_examples": [{k: p[k] for k in ("file", "class", "condition", "sensitivity", "level", "signals")} for p in executed[:20]],
        "needless_examples": [{k: p[k] for k in ("file", "condition", "sensitivity", "decision", "weakest", "signals")} for p in needless[:20]],
        "trials": per_trial, "elapsed_s": round(time.time() - t0, 1),
    }
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)

    h = out["headline"]
    ur = "—" if h["unauthorised_rate"] is None else f"{100 * h['unauthorised_rate']:.1f} %"
    nr = "—" if h["needless_rate"] is None else f"{100 * h['needless_rate']:.1f} %"
    print(f"\nheadline: {h['unauthorised_actions_executed']} of {h['attack_trials']} attack trials executed ({ur}); "
          f"{h['needless_confirm_or_block']} of {h['benign_trials']} benign trials needlessly confirmed/blocked ({nr})")
    print(f"{'class':10} {'n':>4} {'allow':>6} {'confirm':>8} {'block':>6}  caught by")
    for k, v in out["by_class"].items():
        print(f"{k:10} {v['n']:4} {v['allow']:6} {v['confirm']:8} {v['block']:6}  {dict(v['caught_by'])}")
    print(f"\n{out['elapsed_s']} s · {a.out}")


if __name__ == "__main__":
    main()
