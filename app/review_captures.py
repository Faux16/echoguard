"""Summarise uploads retained by the console (ECHOGUARD_CAPTURE_DIR).

    python -m app.review_captures /path/to/captures [--client 192.168.1.23] [--json]

Prints one line per upload — when, who, what the engine said, and the key
measurements — followed by per-client and per-verdict counts, so a field test
can be checked without opening each file.
"""

from __future__ import annotations

import argparse
import glob
import json
import os
from collections import Counter


def load(capture_dir: str) -> list[dict]:
    rows = []
    for path in sorted(glob.glob(os.path.join(capture_dir, "*.json"))):
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        meta = d.get("_meta", {})
        rep = d.get("report") or d                      # gate results nest the scan report
        ev = {f["name"]: f.get("evidence") or {} for f in rep.get("findings", [])}
        ann = d.get("annotations") or {
            "oob_ratio": ev.get("out_of_band_energy", {}).get("out_of_band_ratio"),
            "carrier_peak_hz": ev.get("carrier_peak", {}).get("peak_freq_hz"),
            "carrier_sideband_db": ev.get("carrier_peak", {}).get("sideband_db")}
        rows.append({
            "received": meta.get("received_utc", ""), "client": meta.get("client", ""), "kind": meta.get("kind", ""),
            "file": d.get("filename") or os.path.basename(path).split("_", 3)[-1][:-5], "verdict": d.get("verdict"),
            "risk": d.get("overall_risk", d.get("risk")),
            "sr": rep.get("sample_rate"), "dur": rep.get("duration_sec"), "oob": ann.get("oob_ratio"),
            "carrier": ann.get("carrier_peak_hz"), "sideband": ann.get("carrier_sideband_db"),
            "decision": d.get("decision"), "action": d.get("action"), "ms": d.get("analysis_ms"),
            "ua": meta.get("user_agent", "")[:60], "wav": path[:-5] + ".wav" if os.path.exists(path[:-5] + ".wav") else None,
        })
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("capture_dir")
    ap.add_argument("--client", help="only this client address")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    a = ap.parse_args()
    rows = [r for r in load(a.capture_dir) if not a.client or r["client"] == a.client]
    if a.json:
        print(json.dumps(rows, indent=1))
        return
    if not rows:
        print("no captures")
        return
    fmt = "{:<24} {:<15} {:<5} {:<34} {:<17} {:>5} {:>7} {:>6} {:>8} {:>9} {:>7} {:<8}"
    print(fmt.format("received (UTC)", "client", "kind", "file", "verdict", "risk", "rate", "dur", ">18kHz", "carrier", "sideb.", "gate"))
    for r in rows:
        print(fmt.format(
            r["received"], r["client"], r["kind"], r["file"][:34], r["verdict"] or "-",
            f"{r['risk']:.2f}" if r["risk"] is not None else "-",
            f"{r['sr'] / 1000:.1f}k" if r["sr"] else "-", f"{r['dur']:.1f}s" if r["dur"] is not None else "-",
            f"{r['oob'] * 100:.2f}%" if r["oob"] is not None else "-",
            f"{r['carrier'] / 1000:.2f}k" if r["carrier"] else "-",
            f"{r['sideband']:.0f}dB" if r["sideband"] is not None else "-",
            f"{r['action']}→{r['decision']}" if r["decision"] else "",
        ))
    print()
    print("by client:  " + ", ".join(f"{c} ×{n}" for c, n in Counter(r["client"] for r in rows).most_common()))
    print("by verdict: " + ", ".join(f"{v} ×{n}" for v, n in Counter(r["verdict"] for r in rows).most_common()))
    rates = Counter(r["sr"] for r in rows if r["sr"])
    print("by rate:    " + ", ".join(f"{sr / 1000:.1f} kHz ×{n}" for sr, n in sorted(rates.items())))
    low = sum(n for sr, n in rates.items() if sr < 36_000)
    if low:
        print(f"note: {low} upload(s) below 36 kHz — the ultrasonic band could not be assessed for those.")


if __name__ == "__main__":
    main()
