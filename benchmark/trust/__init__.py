"""Evaluation harness for the trust layer (`echoguard.trust`).

Public proxies until the matched-device corpus exists:

    L2 / L3  LibriSpeech dev-clean   same- vs different-speaker trials
    L4       deepset/prompt-injections + SLURP commands, as text and as
             TTS-rendered speech transcribed by Whisper

Run the pieces, then assemble the report:

    python -m benchmark.trust.run_speaker --root ../data/LibriSpeech/dev-clean
    python -m benchmark.trust.run_content --deepset ../data/deepset --slurp ../data/slurp --tts 120
    python -m benchmark.trust.report

Every number these produce is on read speech and synthetic speech — a stand-in,
labelled as such, for recordings through real devices.
"""
