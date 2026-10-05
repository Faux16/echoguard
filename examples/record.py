"""Record a short clip from the default microphone to a WAV file.

Usage:
    python examples/record.py [output.wav] [seconds]

Defaults: mytest.wav, 5 seconds, 48 kHz mono (enough bandwidth for EchoGuard).
Requires: sounddevice  ->  pip install sounddevice
"""

import sys
import numpy as np
from scipy.io import wavfile

try:
    import sounddevice as sd
except ImportError:
    sys.exit("sounddevice not installed. Run:  pip install sounddevice")

SR = 48_000


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "mytest.wav"
    secs = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0

    print(f"Recording {secs:.0f}s at {SR} Hz - speak now...")
    audio = sd.rec(int(secs * SR), samplerate=SR, channels=1, dtype="float32")
    sd.wait()

    pcm = np.clip(audio[:, 0], -1.0, 1.0)
    wavfile.write(out, SR, (pcm * 32767).astype(np.int16))
    print(f"Saved {out}  ({secs:.0f}s, {SR} Hz).  Now:  echoguard scan {out}")


if __name__ == "__main__":
    main()
