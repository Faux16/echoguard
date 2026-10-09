"""The matched-device corpus manifest: schema, loader, validation and grouping.

A corpus is a directory with `trust_manifest.csv` and the WAVs it names. One row
per clip. Columns (see docs/corpus_manifest.md):

    file          path relative to the corpus root
    kind          enrol | wake | command | roomtest
    user          the enrolled user the device belongs to (whose authority counts)
    speaker       who is actually speaking in this clip (== user for genuine)
    condition     live | playback_phone | playback_tv | playback_bt | clone_tts | clone_vc
                  | third_party | ultrasonic_c<kHz>_d<m> | hidden_audio | benign_hf
    session       groups a wake and its command(s); the wake row shares it
    utt_id        utterance id within the session (command rows); '' for wake/enrol
    text          what was said (reference transcript)
    alt_text      optional second-decoder transcript (T5 rows)
    injection     1 if the text is a spoken-injection phrasing, else 0
    sensitivity   routine | sensitive | critical (what the command would trigger)
    device, room, distance_cm, capture_rate, consent, notes   as in the recording protocol

`load(root)` returns Trials: each command row joined to its wake row (same
session, kind=wake) and the enrolment rows of its user.
"""

from __future__ import annotations

import csv
import os
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

MANIFEST = "trust_manifest.csv"
FIELDS = ["file", "kind", "user", "speaker", "condition", "session", "utt_id", "text", "alt_text", "injection",
          "sensitivity", "device", "room", "distance_cm", "capture_rate", "consent", "notes"]
KINDS = {"enrol", "wake", "command", "roomtest"}
SENSITIVITIES = {"routine", "sensitive", "critical"}

# Threat class by condition prefix. T5 and T6 are decided by the row's text columns.
CLASS_BY_CONDITION = [
    ("ultrasonic", "T1"), ("hidden_audio", "T2"), ("third_party", "T3"),
    ("playback", "T4"), ("clone", "T4"), ("benign_hf", "BENIGN_HF"), ("live", "BENIGN"),
]


@dataclass
class Row:
    file: str
    kind: str
    user: str
    speaker: str
    condition: str
    session: str
    utt_id: str
    text: str
    alt_text: str
    injection: bool
    sensitivity: str
    device: str
    room: str
    distance_cm: str
    capture_rate: str
    consent: str
    notes: str
    path: str = ""          # absolute

    @property
    def threat_class(self) -> str:
        """T1–T6, BENIGN or BENIGN_HF for a command row."""
        if self.kind != "command":
            return ""
        if self.alt_text and self.alt_text.strip() and self.alt_text.strip().lower() != self.text.strip().lower():
            return "T5"
        if self.injection and self.condition == "live" and self.speaker == self.user:
            return "T6"
        for prefix, cls in CLASS_BY_CONDITION:
            if self.condition.startswith(prefix):
                return cls
        return "UNKNOWN"


@dataclass
class Trial:
    command: Row
    wake: Optional[Row]
    enrol: list[Row] = field(default_factory=list)

    @property
    def threat_class(self) -> str:
        return self.command.threat_class

    @property
    def is_attack(self) -> bool:
        return self.threat_class.startswith("T")


def _bool(v: str) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "y")


def read_rows(root: str) -> list[Row]:
    path = os.path.join(root, MANIFEST)
    if not os.path.exists(path):
        raise FileNotFoundError(f"no {MANIFEST} under {root}")
    rows = []
    with open(path, encoding="utf-8", newline="") as fh:
        r = csv.DictReader(fh)
        missing = [c for c in ("file", "kind", "user", "speaker", "condition") if c not in (r.fieldnames or [])]
        if missing:
            raise ValueError(f"{MANIFEST} lacks required columns: {missing}")
        for i, d in enumerate(r, start=2):
            row = Row(file=d.get("file", ""), kind=d.get("kind", "").strip(), user=d.get("user", "").strip(),
                      speaker=d.get("speaker", "").strip() or d.get("user", "").strip(), condition=d.get("condition", "live").strip() or "live",
                      session=d.get("session", "").strip(), utt_id=d.get("utt_id", "").strip(), text=d.get("text", "") or "",
                      alt_text=d.get("alt_text", "") or "", injection=_bool(d.get("injection", "0")),
                      sensitivity=(d.get("sensitivity", "") or "sensitive").strip().lower() or "sensitive",
                      device=d.get("device", "") or "", room=d.get("room", "") or "", distance_cm=d.get("distance_cm", "") or "",
                      capture_rate=d.get("capture_rate", "") or "", consent=d.get("consent", "") or "", notes=d.get("notes", "") or "",
                      path=os.path.join(root, d.get("file", "")))
            if row.kind not in KINDS:
                raise ValueError(f"{MANIFEST} line {i}: kind {row.kind!r} not in {sorted(KINDS)}")
            if row.sensitivity not in SENSITIVITIES:
                raise ValueError(f"{MANIFEST} line {i}: sensitivity {row.sensitivity!r} not in {sorted(SENSITIVITIES)}")
            if not os.path.exists(row.path):
                raise FileNotFoundError(f"{MANIFEST} line {i}: missing audio {row.file}")
            rows.append(row)
    return rows


def load(root: str) -> list[Trial]:
    rows = read_rows(root)
    enrol: dict[str, list[Row]] = defaultdict(list)
    wakes: dict[str, Row] = {}
    for r in rows:
        if r.kind == "enrol":
            enrol[r.user].append(r)
        elif r.kind == "wake":
            wakes[r.session] = r
    return [Trial(command=r, wake=wakes.get(r.session), enrol=enrol.get(r.user, [])) for r in rows if r.kind == "command"]


def summary(trials: list[Trial]) -> dict:
    out: dict = {"trials": len(trials), "by_class": defaultdict(int), "by_device": defaultdict(int), "by_room": defaultdict(int),
                 "users": sorted({t.command.user for t in trials}), "with_wake": sum(t.wake is not None for t in trials),
                 "with_enrolment": sum(bool(t.enrol) for t in trials)}
    for t in trials:
        out["by_class"][t.threat_class] += 1
        out["by_device"][t.command.device or "?"] += 1
        out["by_room"][t.command.room or "?"] += 1
    out["by_class"], out["by_device"], out["by_room"] = dict(out["by_class"]), dict(out["by_device"]), dict(out["by_room"])
    return out
