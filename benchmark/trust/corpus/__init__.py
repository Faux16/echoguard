"""Spoken-injection corpus: what someone would *say* to hijack a voice agent that acts.

This is the author-written seed (v0). It is expanded by slot filling into a few
hundred utterances, rendered by TTS and transcribed for evaluation, and is the
list people read aloud in Phase 0. It is deliberately about command hijacks —
override, role change, forcing, exfiltration, authority claims, tool abuse,
concealment — not off-topic chat, which is a different problem.

    from benchmark.trust.corpus import injections, benign
    inj = injections()      # [{"text", "family", "seed_id"}]
    ben = benign()          # [{"text", "kind"}]  action-shaped commands that must NOT be flagged
"""

from .build import benign, injections, seed_count

__all__ = ["injections", "benign", "seed_count"]
