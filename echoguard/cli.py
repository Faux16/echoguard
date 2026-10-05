"""Command-line interface: `echoguard scan file.wav`."""

from __future__ import annotations

import argparse
import json
import sys

from .audio import load_wav
from .pipeline import Pipeline, CLEAR, SUSPICIOUS, HIGH_RISK, INSUFFICIENT_DATA

_EXIT_CODE = {CLEAR: 0, SUSPICIOUS: 1, HIGH_RISK: 2, INSUFFICIENT_DATA: 4}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="echoguard",
        description="Scan a WAV clip for signs of inaudible / injected voice-command attacks.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="scan a WAV file")
    scan.add_argument("path", help="path to a .wav file")
    scan.add_argument("--json", action="store_true", help="emit JSON instead of text")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.command == "scan":
        try:
            signal, sample_rate = load_wav(args.path)
        except Exception as exc:  # noqa: BLE001 - surface a clean CLI error
            print(f"error: could not read '{args.path}': {exc}", file=sys.stderr)
            return 3

        report = Pipeline().analyze(signal, sample_rate)

        if args.json:
            print(json.dumps(report.to_dict(), indent=2))
        else:
            from .report import render_text

            print(render_text(report, source=args.path))

        return _EXIT_CODE.get(report.verdict, 0)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
