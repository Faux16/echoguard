"""L4 — content safety on the transcript.

`ContentSafetyCheck` is a transparent, rule-based spoken-injection screen: it
looks for the families of phrasing that try to change what the agent is, what
it must obey, or what it should reveal. It is the baseline the learned model in
Phase 2 is measured against, and it stays in the stack as an explainable floor.
Every match is reported, so a reviewer can see exactly why a transcript scored.

`TranscriptConsistencyCheck` compares two decoders' transcripts (T5: adversarial
perturbations that make humans hear one thing and the ASR another tend to be
decoder-specific). It needs `alt_transcript`; without it, it cannot assess.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from ..signals import Layer, TrustContext, TrustSignal
from .base import Check, ramp


@dataclass(frozen=True)
class Pattern:
    family: str
    regex: str
    weight: float      # how much trust one match removes (0–1)
    note: str


# Weights: 0.9 removes almost all trust on its own (hostile); 0.5 lands in the
# suspect band; 0.25 only matters in combination. Phrasing is deliberately
# tolerant of ASR output: no punctuation, filler words, contractions.
PATTERNS: tuple[Pattern, ...] = (
    # override — the sentence exists to cancel the agent's standing instructions
    Pattern("override", r"\b(ignore|disregard|forget|override|bypass)\b.{0,30}\b(previous|prior|earlier|above|all|your|the|any)\b.{0,20}\b(instructions?|rules?|guidelines?|prompts?|directions?|policy|policies|restrictions?)\b", 0.9,
            "asks the agent to discard its instructions"),
    Pattern("override", r"\b(ignore|disregard|forget)\b.{0,16}\b(everything|all|what|the above|above|before|previous|prior|earlier|so far)\b", 0.8,
            "asks the agent to discard what came before"),
    Pattern("override", r"\b(new|updated|revised|different)\s+(instructions?|rules?|system prompt|orders?)\b", 0.6,
            "announces replacement instructions"),
    Pattern("override", r"\b(now (comes|here comes|here is|here's)|(start|begin) with|next is|here comes)\s+(a|the|your)?\s*(new|next|second|another)?\s*(task|assignment|mission|job|instructions?|orders?)\b", 0.5,
            "introduces a replacement task"),
    Pattern("override", r"\bfrom now on\b.{0,40}\b(you|your)\b", 0.5, "tries to change standing behaviour"),
    # forcing — constrains every future answer or forbids the agent's normal responses
    Pattern("forcing", r"\b(answer|respond|reply|say)\b.{0,30}\b(every|all|any)\s+(question|request|prompt|message)s?\b.{0,20}\bwith\b", 0.6,
            "forces a fixed response to everything"),
    Pattern("forcing", r"\b(you('re| are) (not )?supposed to|you must (always|never)|at all times)\b", 0.4,
            "dictates how the agent must respond"),
    # role change — the sentence redefines what the agent is
    Pattern("role_change", r"\b(you are now|you're now|act as|pretend (to be|you are|you're)|roleplay as|take the role of|behave as|you are (a|an)\s+\w+\s*(who|that|and|now|from now))\b", 0.7,
            "assigns the agent a new identity or role"),
    Pattern("role_change", r"\b(let's|lets|let us)\s+play\s+a\s+game\b", 0.5, "frames a behaviour change as a game"),
    Pattern("role_change", r"\b(developer|debug|admin|god|unrestricted|jailbreak)\s+mode\b", 0.9,
            "invokes a privileged mode"),
    Pattern("role_change", r"\b(do anything now|no restrictions|without (any )?(restrictions|limits|filters))\b", 0.8,
            "asks for unrestricted behaviour"),
    # exfiltration — the sentence asks the agent to reveal its own configuration
    Pattern("exfiltration", r"\b(repeat|reveal|show|print|read( out)?|tell me|what (is|are))\b.{0,30}\b(system prompt|your (instructions|rules|configuration|prompt)|hidden (instructions|prompt))\b", 0.8,
            "asks the agent to disclose its instructions"),
    # authority claim — the speaker asserts a right to override
    Pattern("authority", r"\b(i am|i'm|this is)\s+(the|your)\s+(developer|administrator|admin|owner|operator|creator|engineer)\b", 0.6,
            "claims an authority the voice channel cannot prove"),
    Pattern("authority", r"\b(this is (a|an)\s+)?(test|emergency|security)\s+(mode|override|protocol)\b", 0.5,
            "invokes an exceptional mode"),
    # tool abuse — redirecting outputs to a third party named in the command itself
    # a destination recited inside the command (a number, an account) rather than a named contact
    Pattern("tool_abuse", r"\b(send|forward|share|text|transfer|wire|pay)\b.{0,40}\b(to|at)\s+(this|the following|that)\s+(number|account|wallet|iban)\b", 0.5,
            "routes an action to a destination supplied in the command"),
    Pattern("tool_abuse", r"\b(my|the)\s+(location|password|passcode|pin|one[- ]time (code|password)|verification code|2fa code|card number|bank details)\b.{0,40}\b(send|forward|share|read|tell|text)\b|\b(send|forward|share|read( out)?|tell|text)\b.{0,40}\b(my|the)\s+(location|password|passcode|pin|one[- ]time (code|password)|verification code|2fa code|card number|bank details)\b", 0.6,
            "moves a secret or the user's location"),
    # concealment — asking the agent to hide what it did
    Pattern("concealment", r"\b(don't|do not|never)\s+(tell|notify|inform|alert|mention)\b.{0,30}\b(the (user|owner)|anyone|them|him|her)\b", 0.7,
            "asks the agent to hide the action"),
    Pattern("concealment", r"\b(secretly|without (telling|asking|confirming|confirmation|notifying))\b|\b(quietly|silently)\s+(send|transfer|pay|unlock|delete|forward|share|disable|turn off)\b", 0.5,
            "asks for the action to be done without confirmation"),
)

_SPACES = re.compile(r"\s+")


def normalise(text: str) -> str:
    t = text.lower().replace("’", "'")
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    t = re.sub(r"\b(um+|uh+|erm+|like|you know)\b", " ", t)   # ASR filler
    return _SPACES.sub(" ", t).strip()


class ContentSafetyCheck(Check):
    name = "content_safety"
    layer = Layer.CONTENT

    def __init__(self, patterns: tuple[Pattern, ...] = PATTERNS):
        self.patterns = [(p, re.compile(p.regex)) for p in patterns]

    def run(self, ctx: TrustContext) -> TrustSignal:
        if not ctx.transcript or not ctx.transcript.strip():
            return self.unassessable("no transcript was provided")
        text = normalise(ctx.transcript)
        matches: list[dict[str, Any]] = []
        for p, rx in self.patterns:
            m = rx.search(text)
            if m:
                matches.append({"family": p.family, "note": p.note, "weight": p.weight, "text": m.group(0)})
        if not matches:
            return self.signal(1.0, "No spoken-injection pattern in the transcript.", matches=[], length=len(text))
        # the strongest match sets the floor; each extra family removes a little more
        strongest = max(float(m["weight"]) for m in matches)
        families = {str(m["family"]) for m in matches}
        trust = max(0.0, 1.0 - strongest - 0.1 * (len(families) - 1))
        families_txt = ", ".join(sorted(families))
        detail = (f"Transcript matches {len(matches)} spoken-injection pattern{'s' if len(matches) > 1 else ''} "
                  f"({families_txt}): {matches[0]['note']} — “{matches[0]['text']}”.")
        return self.signal(trust, detail, matches=matches, length=len(text))


def _wer(ref: list[str], hyp: list[str]) -> float:
    """Word error rate by edit distance; 0 = identical."""
    if not ref:
        return 0.0 if not hyp else 1.0
    d = list(range(len(hyp) + 1))
    for i in range(1, len(ref) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(hyp) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (ref[i - 1] != hyp[j - 1]))
            prev = cur
    return d[len(hyp)] / len(ref)


class TranscriptConsistencyCheck(Check):
    """Two decoders should agree on what was said; a large disagreement on a
    command that will trigger an action is the T5 signature."""

    name = "transcript_consistency"
    layer = Layer.CONTENT

    def __init__(self, agree_wer: float = 0.15, disagree_wer: float = 0.5):
        self.agree_wer = agree_wer
        self.disagree_wer = disagree_wer

    def run(self, ctx: TrustContext) -> TrustSignal:
        if not ctx.transcript or not ctx.alt_transcript:
            return self.unassessable("needs transcripts from two decoders")
        a, b = normalise(ctx.transcript).split(), normalise(ctx.alt_transcript).split()
        wer = _wer(a, b)
        trust = ramp(wer, self.disagree_wer, self.agree_wer)
        if wer <= self.agree_wer:
            detail = f"Two decoders agree (word error rate {wer:.2f})."
        else:
            detail = f"Decoders disagree (word error rate {wer:.2f}) — the command may not be what a listener heard."
        return self.signal(trust, detail, wer=round(wer, 3), words=len(a))
