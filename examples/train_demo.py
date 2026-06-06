"""End-to-end demo: log several fake training runs into one project on Resonance.

Offline (default) spools to ./.resonance. Online streams to a running stack:

    make up                            # full local stack + services + UI
    RESONANCE_MODE=online python examples/train_demo.py   # (or: make demo)

All runs land in a single project (``test-project`` by default, override with DEMO_PROJECT); the
project is created on demand at init. Each run trains a different "vocoder" toward the SAME 440 Hz
reference, logging full-length (≥3 min) audio samples per step — so the Compare view has cross-run
material to A/B at original quality, and the shared reference exercises dedup.
"""

from __future__ import annotations

import math
import os
import random
import time

import numpy as np

import resonance

SR = 22050
# Long-form clips by default (≥3 min = 180s) to exercise the real target: full-length audio.
AUDIO_SECONDS = float(os.environ.get("DEMO_AUDIO_SECONDS", "180"))
# Audio samples per run (each is its own ≥3-min clip).
N_SAMPLES = int(os.environ.get("DEMO_SAMPLES", "4"))

# Everything lands in one project (created on demand at init); override the name with DEMO_PROJECT.
PROJECT = os.environ.get("DEMO_PROJECT", "test-project")

# A few runs, each a different model converging to the same reference. Trim with DEMO_RUNS.
RUNS: list[tuple[str, dict]] = [
    ("hifigan-vocoder", {"model": "hifigan", "lr": 3e-4}),
    ("diffwave-vocoder", {"model": "diffwave", "lr": 2e-4}),
    ("bigvgan-vocoder", {"model": "bigvgan", "lr": 1e-4}),
]
N_RUNS = int(os.environ.get("DEMO_RUNS", str(len(RUNS))))


def _tone(freq: float, seconds: float = AUDIO_SECONDS, noise: float = 0.0) -> np.ndarray:
    # Slowly drifting pitch so a 3-min spectrogram actually shows structure.
    t = np.linspace(0, seconds, int(SR * seconds), endpoint=False)
    drift = freq + 20.0 * np.sin(2 * np.pi * 0.01 * t)
    sig = 0.3 * np.sin(2 * np.pi * drift * t)
    if noise:
        sig = sig + noise * np.random.randn(len(t))
    return sig.astype(np.float32)


def train_run(run_name: str, config: dict, reference: np.ndarray, offset: float) -> str:
    run = resonance.init(project=PROJECT, config=config, name=run_name)
    mb = SR * AUDIO_SECONDS * 2 / 1e6  # ~16-bit PCM WAV size estimate
    print(f"[{PROJECT}/{run_name}] run {run.id} ({run.settings.mode}); "
          f"{N_SAMPLES} clips of {AUDIO_SECONDS:.0f}s (~{mb:.0f} MB each)")

    steps = 200
    log_at = {int(i * steps / N_SAMPLES) for i in range(N_SAMPLES)}
    for step in range(steps):
        mel = 1.0 / (1 + step * 0.02) + random.uniform(-0.02, 0.02)
        adv = 0.5 + 0.4 * math.sin(step / 15) + random.uniform(-0.03, 0.03)
        run.log({"loss/mel": mel, "loss/adv": adv}, step=step)
        if step in log_at:
            # Each model approaches 440 Hz from a different offset, with shrinking noise.
            sample = _tone(440.0 + offset * (1 - step / steps), noise=0.3 * (1 - step / steps))
            run.log_audio(
                "samples/val", sample, sample_rate=SR, step=step,
                reference=reference, caption=f"{config['model']} step {step}",
            )
        time.sleep(0.005)

    run.finish()
    return run.id


def main() -> None:
    reference = _tone(440.0)  # shared ground-truth target (deduped across all projects)

    # Register a small content-addressed dataset version once (deduped on upload).
    try:
        import tempfile

        import soundfile as sf

        d = tempfile.mkdtemp(prefix="resonance-dataset-")
        for i, f in enumerate([330.0, 440.0, 550.0]):
            sf.write(f"{d}/clip_{i}.wav", _tone(f, seconds=2.0), SR)
        seed = resonance.init(project=PROJECT, config={"role": "dataset-seed"}, name="dataset-seed")
        seed.log_dataset("valset", d)
        seed.finish()
        print(f"logged dataset 'valset' (3 clips) from {d}")
    except Exception as exc:  # soundfile optional
        print(f"dataset step skipped: {exc!r}")

    for i, (run_name, config) in enumerate(RUNS[:N_RUNS]):
        train_run(run_name, config, reference, offset=40.0 + 30.0 * i)

    print(f"done — {min(N_RUNS, len(RUNS))} runs in project '{PROJECT}'")


if __name__ == "__main__":
    main()
