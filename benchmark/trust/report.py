"""Assemble benchmark/trust/RESULTS.md from the runners' JSON."""

from __future__ import annotations

import json
import os
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "results")


def pct(x) -> str:
    return "—" if x is None else f"{100 * x:.1f} %"


def main() -> None:
    sp = json.load(open(os.path.join(RES, "speaker.json"), encoding="utf-8")) if os.path.exists(os.path.join(RES, "speaker.json")) else None
    ct = json.load(open(os.path.join(RES, "content.json"), encoding="utf-8")) if os.path.exists(os.path.join(RES, "content.json")) else None
    L = [f"# Trust layer — evaluation on public proxies\n\n*{date.today().isoformat()}.* These are stand-in datasets: read speech and "
         "synthetic speech, not recordings through real devices. They calibrate the checks and expose gaps; "
         "the matched-device corpus (Phase 0) is what the numbers must eventually come from.\n"]
    if sp:
        L.append(f"## L2 / L3 — speaker checks on {sp['dataset']}\n")
        L.append(f"{sp['speakers']} speakers · model `{sp['model']}` · enrol on {sp['enrol_utts']} utterances · utterances truncated to {sp['max_sec']} s · wake segment {sp['wake_sec']} s · {sp['embeddings']} embeddings in {sp['elapsed_s']} s.\n")
        L.append("| Check | Trials | EER | Threshold at EER | FAR at 5 % FRR | FAR at 1 % FRR | Target mean sim | Impostor mean sim |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
        for name, key in (("L2 speaker verification", "L2_speaker_verification"), ("L3 same speaker (wake vs command)", "L3_same_speaker_wake_vs_command")):
            b = sp[key]
            L.append(f"| {name} | {b['trials']} | {pct(b['eer'])} | {b['eer_threshold']:.3f} | {pct(b['far_at_frr5'])} (thr {b['threshold_frr5']:.3f}) | {pct(b['far_at_frr1'])} (thr {b['threshold_frr1']:.3f}) | {b['target_mean']:.3f} | {b['impostor_mean']:.3f} |")
        L.append("\nAt the checks' current default thresholds (trust ≥ 0.67 accepts, < 0.34 rejects):\n")
        L.append("| Check | accept at sim ≥ | reject below sim | FAR (impostor accepted) | FRR (genuine rejected) | genuine left undecided | impostor left undecided |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |")
        for name, key in (("L2", "L2_speaker_verification"), ("L3", "L3_same_speaker_wake_vs_command")):
            d = sp[key]["at_default_thresholds"]
            L.append(f"| {name} | {d['accept_at']:.3f} | {d['reject_below']:.3f} | {pct(d['far'])} | {pct(d['frr'])} | {pct(d['undecided_target'])} | {pct(d['undecided_impostor'])} |")
        L.append("\nUndecided means the check lands in the *suspect* band, which the gate turns into a confirmation rather than a block.\n")
    if ct:
        c = ct["counts"]
        L.append(f"## L4 — content safety\n\nText level: deepset/prompt-injections (English rows: {c['deepset_injections']} injections, {c['deepset_benign']} benign) and {c['slurp_commands']} unique SLURP voice-assistant commands.\n")
        L.append("| Positives vs negatives | Detection rate | False-alarm rate |\n| --- | ---: | ---: |")
        for key, name in (("deepset_injections_vs_deepset_benign", "deepset injections vs deepset benign"), ("deepset_injections_vs_slurp_commands", "deepset injections vs SLURP commands")):
            t = ct["text_level"][key]
            L.append(f"| {name} | {pct(t['detection_rate'])} ({t['detected']}/{t['positives']}) | {pct(t['false_alarm_rate'])} ({t['false_alarms']}/{t['negatives']}) |")
        t = ct["text_level"]["deepset_injections_vs_slurp_commands"]
        if t["false_alarm_examples"]:
            L.append("\nFalse alarms on SLURP: " + "; ".join(f"“{x}”" for x in t["false_alarm_examples"]) + ".")
        L.append("\nWhat the misses look like (deepset is a text set for a news chatbot; many of its “injections” are off-topic requests — translate, tell a joke, write SQL — that are not command hijacks and are out of scope for an action gate):\n")
        L.extend(f"- {x}" for x in t["missed_examples"][:12])
        if "spoken_level" in ct:
            s = ct["spoken_level"]
            L.append(f"\nSpoken level: {s['rendered']['injections']} injections and {s['rendered']['benign']} SLURP commands rendered with macOS `say` ({', '.join(s['rendered']['voices'])}), transcribed with {s['asr']} (mean WER {pct(s['mean_wer_vs_reference'])} against the reference text), scored on the transcript.\n")
            L.append("| | Detection rate | False-alarm rate | Decisions changed by ASR errors |\n| --- | ---: | ---: | ---: |")
            L.append(f"| TTS → Whisper → rules | {pct(s['detection_rate'])} ({s['detected']}/{s['positives']}) | {pct(s['false_alarm_rate'])} ({s['false_alarms']}/{s['negatives']}) | {s['decisions_changed_by_asr']} of {s['positives'] + s['negatives']} |")
            if s["examples"]:
                L.append("\n| Reference | Whisper heard | Voice | Trust |\n| --- | --- | --- | ---: |")
                L.extend(f"| {e['ref']} | {e['asr']} | {e['voice']} | {e['trust']} |" for e in s["examples"][:6])
    L.append("\n## Reading these numbers\n")
    L.append("- L2/L3 are on clean read speech with a strong pretrained model; a kitchen, a phone microphone and a loudspeaker will all make them worse. The EER thresholds here are the starting point for the defaults, not the final values.")
    L.append("- L3 uses a 1 s wake segment on purpose: that is what a real wake word gives the embedder, and it is the hard case.")
    L.append("- L4's rule set is the transparent baseline. Its false-alarm rate on real commands is the number to protect; its detection rate on a text chatbot set understates what matters, because the threat for an action-taking agent is a command hijack, not an off-topic question. The spoken-injection corpus (300 templates, read and TTS-rendered) is the proper test and is still to be built.")
    L.append("- No replay / clone (anti-spoofing) check is evaluated because none exists yet; ASVspoof is the dataset for it.")
    with open(os.path.join(HERE, "RESULTS.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(L) + "\n")
    print("\n".join(L))


if __name__ == "__main__":
    main()
