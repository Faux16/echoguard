# The trust layer: should a voice agent act on this command?

`echoguard.trust` generalises the confirmation gate from one verdict to a
**trust tuple**. Four layers of checks each answer one question; the gate
summarises them into a trust level and, with the action's sensitivity, returns
`allow`, `confirm` or `block`.

| Layer | Question | Check | Needs |
| --- | --- | --- | --- |
| L1 signal integrity | Is the audio physically genuine — no ultrasonic carrier, no out-of-band energy? | `SignalIntegrityCheck` (the EchoGuard pipeline) | audio at ≥ 44.1 kHz; below that it reports *could not check* |
| L2 speaker identity | Is this the enrolled user? | `SpeakerVerificationCheck` (ECAPA-TDNN embeddings, cosine to the enrolled profile) | `pip install "echoguard[trust]"`, a `SpeakerProfile`, ≥ 0.8 s of speech |
| L3 source attribution | Did the wake word and the command come from the same voice? | `SameSpeakerCheck` (embedding similarity between the two segments) | the wake-word segment; no enrolment needed |
| L4 content safety | Is the transcript a spoken prompt injection? Do two decoders agree? | `ContentSafetyCheck` (pattern families: override, role change, exfiltration, authority claim, tool abuse, concealment), `TranscriptConsistencyCheck` (word error rate between decoders) | the transcript; optionally a second transcript |

Every check returns a `TrustSignal` with `trust` in [0, 1] (1 = fully consistent
with the genuine user), an `assessable` flag, a sentence of detail and the
numbers behind it. The bands are shared: below 0.34 the check is *hostile*,
below 0.67 *suspect*, otherwise *clean*; not assessable is *unassessed*.

## From tuple to decision

```
level = HOSTILE     if any assessable check < 0.34
      = SUSPECT     if any assessable check < 0.67
      = UNVERIFIED  if a required layer could not assess   (default required: L1, L2, L4)
      = TRUSTED     otherwise
decision = policy[sensitivity][level]
```

| sensitivity \ level | trusted | unverified | suspect | hostile |
| --- | --- | --- | --- | --- |
| routine | allow | allow | confirm | block |
| sensitive | allow | confirm | confirm | block |
| critical | confirm | confirm | block | block |

*Unverified* is "could not check" — a 16 kHz capture, no enrolment, the model
not installed. It is never treated as safe for anything that matters, and a
`confirm` must go through a channel the attacker cannot reach: a screen tap, a
second device, a spoken passphrase. The reason names the weakest check.

## Use

```python
from echoguard.gate import ActionSensitivity
from echoguard.trust import TrustGate, TrustContext, SpeakerProfile

profile = SpeakerProfile.enrol("sanket", [(utt1, sr), (utt2, sr), (utt3, sr)])
profile.save("sanket.json")

gate = TrustGate()
ctx = TrustContext(audio=command, sample_rate=sr, transcript=asr_text,
                   wake_audio=wake_segment, speaker_profile=profile)
result = gate.evaluate(ctx, ActionSensitivity.CRITICAL, command="unlock the door")
result.decision        # GateDecision.BLOCK / CONFIRM / ALLOW
result.level           # TrustLevel
result.reason          # "Do not execute: a critical action with a hostile command — content safety: …"
result.to_dict()       # decision, level, every signal with its band and evidence, audit record
```

As a tool an LLM agent calls before acting (OpenAI / Anthropic function shape):

```python
from echoguard.trust import TOOL_SCHEMA, handle_tool_call

tools = [TOOL_SCHEMA]                       # name: check_voice_command
result = handle_tool_call(call.arguments)   # {"decision": "confirm", "reason": …, "next_step": …}
```

Drop a layer from `required_layers` if you cannot provide it (no enrolment →
`required_layers=(Layer.SIGNAL, Layer.CONTENT)`), and the tuple is TRUSTED on
clean L1 + L4 alone. Add your own check by subclassing `Check` and returning
`self.signal(...)` or `self.unassessable(...)`.

## Status and calibration

- L1 is the benchmarked EchoGuard detector (see `BENCHMARK_REPORT.md`).
- L2 and L3 use `speechbrain/spkrec-ecapa-voxceleb` with **provisional**
  thresholds (`reject_below=0.15`, `accept_from=0.50`; same-speaker
  `0.20` / `0.55`). They are constructor arguments because the Phase 0
  matched-device corpus is what calibrates them; until then treat the exact
  numbers as placeholders, not claims.
- L2 has no liveness / anti-spoofing check yet; a replayed or cloned voice of
  the enrolled user passes L2 today. That is the next check to add.
- L4 is a transparent rule baseline; the learned spoken-injection model
  (Phase 2) is measured against it and replaces it only if it is better on
  held-out phrasings.
- Multi-microphone direction-of-arrival (L3) waits on raw-channel captures.

The tool call is stateless. Audio is scored in memory; the audit record is
returned to the caller and stored nowhere by the library.
