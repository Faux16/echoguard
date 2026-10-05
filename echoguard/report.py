"""Human-readable rendering of a Report."""

from __future__ import annotations

from .pipeline import Report, CLEAR, SUSPICIOUS, HIGH_RISK

_VERDICT_MARK = {CLEAR: "[ OK ]", SUSPICIOUS: "[ ?? ]", HIGH_RISK: "[ !! ]"}


def render_text(report: Report, source: str = "") -> str:
    lines = []
    header = f"EchoGuard scan{f': {source}' if source else ''}"
    lines.append(header)
    lines.append("=" * len(header))
    lines.append(
        f"Sample rate : {report.sample_rate} Hz "
        f"(Nyquist {report.sample_rate/2000:.1f} kHz)"
    )
    lines.append(f"Duration    : {report.duration_sec:.2f} s")
    mark = _VERDICT_MARK.get(report.verdict, "")
    lines.append(f"Verdict     : {mark} {report.verdict}  (risk {report.overall_risk:.2f})")
    lines.append("")
    lines.append("Detectors:")
    for f in report.findings:
        lines.append(f"  - {f.name:<20} {f.severity:<10} risk {f.risk:.2f}")
        lines.append(f"      {f.detail}")
    return "\n".join(lines)
