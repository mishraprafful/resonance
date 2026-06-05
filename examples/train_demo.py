"""End-to-end demo: log a fake training run to Resonance.

Offline (default) spools to ./.resonance. Online streams to a running stack:

    make dev-up                       # Postgres, ClickHouse, MinIO, Redpanda, Redis
    # run the api + ingest gateways (see each service README), then:
    RESONANCE_MODE=online python examples/train_demo.py
"""

from __future__ import annotations

import math
import os
import random
import time

import numpy as np

import resonance

SR = 22050
# Long-form clips by default (≥3 min) to exercise the real target: full-length audio at scale.
AUDIO_SECONDS = float(os.environ.get("DEMO_AUDIO_SECONDS", "180"))
# How many audio samples to log over the run (each is its own ~3-min clip).
N_SAMPLES = int(os.environ.get("DEMO_SAMPLES", "4"))


def _tone(freq: float, seconds: float = AUDIO_SECONDS, noise: float = 0.0) -> np.ndarray:
    # Slowly drifting pitch so a 3-min spectrogram actually shows structure.
    t = np.linspace(0, seconds, int(SR * seconds), endpoint=False)
    drift = freq + 20.0 * np.sin(2 * np.pi * 0.01 * t)
    sig = 0.3 * np.sin(2 * np.pi * drift * t)
    if noise:
        sig = sig + noise * np.random.randn(len(t))
    return sig.astype(np.float32)


def main() -> None:
    run = resonance.init(project="vocoder-demo", config={"lr": 3e-4, "model": "hifigan"})
    mb = SR * AUDIO_SECONDS * 2 / 1e6  # ~16-bit PCM WAV size estimate
    print(f"run id: {run.id}  (mode={run.settings.mode}); "
          f"{N_SAMPLES} clips of {AUDIO_SECONDS:.0f}s (~{mb:.0f} MB each)")

    reference = _tone(440.0)  # the "ground truth" target, for A/B
    steps = 200
    log_at = {int(i * steps / N_SAMPLES) for i in range(N_SAMPLES)}
    for step in range(steps):
        mel = 1.0 / (1 + step * 0.02) + random.uniform(-0.02, 0.02)
        adv = 0.5 + 0.4 * math.sin(step / 15) + random.uniform(-0.03, 0.03)
        run.log({"loss/mel": mel, "loss/adv": adv}, step=step)
        if step in log_at:
            # Generated sample converges toward 440 Hz with shrinking noise as training proceeds —
            # uploaded (content-addressed), then a worker derives waveform + spectrogram.
            sample = _tone(440.0 + (steps - step), noise=0.3 * (1 - step / steps))
            run.log_audio(
                "samples/val", sample, sample_rate=SR, step=step,
                reference=reference, caption=f"step {step}",
            )
        time.sleep(0.01)

    # Register a small content-addressed dataset version (deduped on upload).
    try:
        import tempfile

        import soundfile as sf

        d = tempfile.mkdtemp(prefix="resonance-dataset-")
        for i, f in enumerate([330.0, 440.0, 550.0]):
            sf.write(f"{d}/clip_{i}.wav", _tone(f, seconds=2.0), SR)
        run.log_dataset("valset", d)
        print(f"logged dataset 'valset' (3 clips) from {d}")
    except Exception as exc:  # soundfile optional
        print(f"dataset step skipped: {exc!r}")

    run.finish()
    print("done")


if __name__ == "__main__":
    main()
