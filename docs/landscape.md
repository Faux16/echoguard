# Voice & Acoustic Device Security — Attack & Defense Landscape

Condensed reference for why EchoGuard exists. The field has a canonical survey:
*A Survey on Voice Assistant Security: Attacks and Countermeasures*, ACM Computing
Surveys (2022).

## Attack families

1. **Signal injection** — a command enters the mic through a channel humans can't
   perceive: ultrasonic (DolphinAttack, 2017), ultrasonic guided waves through a
   surface (SurfingAttack, 2020), laser into MEMS mics (LightCommands, 2019),
   near-ultrasound hidden in media (NUIT, 2023), power-line injection (GhostTalk,
   2022), hearable-generated sound (UltrasonicWhisper, 2023–25).
2. **Hidden & adversarial audio** — audio that sounds like noise/music to people
   but transcribes as a command (Hidden Voice Commands 2016, CommanderSong 2018,
   psychoacoustic hiding 2019).
3. **Spoofing & impersonation** — replay, synthetic, or cloned voice defeats
   speaker verification (ASVspoof challenge series).
4. **Ecosystem / app-layer** — malicious third-party skills (skill squatting, 2018).
5. **Agentic voice-agent layer (2026)** — audio prompt injection against AI
   assistants that take real actions.

## Defense families

- **Liveness & multimodal** — correlate voice with a second signal: VAuth (2017),
  VibLive (2020), WearID (2020), BoneAuth (2024), AuthGlass (2025).
- **Signal / hardware-level detection** — EarArray (2021), Watchdog (2020),
  software mitigation (Li et al., USENIX 2023), long-range detection (Roy et al.,
  2018).
- **Anti-spoofing** — ASVspoof-driven replay/deepfake detectors (2019–).
- **Ecosystem controls** — store-level skill vetting.

## The gap EchoGuard targets

- Defenses were built for the 2017–2021 attack generation; few re-tested against
  2026 attacks.
- No defense aimed at action-taking AI voice agents and always-on wearables.
- **No deployable open-source detector** a developer can simply run — EchoGuard
  starts here.
- No end-to-end study of whether assistants' confirmation steps actually stop an
  injected high-consequence action.

*As-of 2026. "No tool found" reflects a literature search, not proof of absence;
confirm with a full sweep before publication.*
