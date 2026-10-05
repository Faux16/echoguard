"""Generate sample WAV fixtures to try the CLI against.

Run:  python examples/make_fixtures.py
Then: echoguard scan fixtures/benign.wav
      echoguard scan fixtures/out_of_band.wav
      echoguard scan fixtures/modulated_carrier.wav
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import synth  # noqa: E402

SR = 48_000
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    synth.write_wav(os.path.join(OUT, "benign.wav"), synth.benign_speechlike(sample_rate=SR), SR)
    synth.write_wav(os.path.join(OUT, "out_of_band.wav"), synth.out_of_band(sample_rate=SR), SR)
    synth.write_wav(
        os.path.join(OUT, "modulated_carrier.wav"), synth.modulated_carrier(sample_rate=SR), SR
    )
    # A low-bandwidth (16 kHz) capture: benign content, but too narrow to screen
    # the ultrasonic band -> demonstrates the INSUFFICIENT_DATA verdict.
    synth.write_wav(
        os.path.join(OUT, "lowrate.wav"), synth.benign_speechlike(sample_rate=16_000), 16_000
    )
    print(f"wrote fixtures to {OUT}")


if __name__ == "__main__":
    main()
