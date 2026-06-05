"""End-to-end demo: log a fake training run to Resonance.

Offline (default) spools to ./.resonance. Online streams to a running stack:

    make dev-up                       # Postgres, ClickHouse, MinIO, Redpanda, Redis
    # run the api + ingest gateways (see each service README), then:
    RESONANCE_MODE=online python examples/train_demo.py
"""

from __future__ import annotations

import math
import random
import time

import numpy as np

import resonance

SR = 22050


def _tone(freq: float, seconds: float = 1.0, noise: float = 0.0) -> np.ndarray:
    t = np.linspace(0, seconds, int(SR * seconds), endpoint=False)
    sig = 0.3 * np.sin(2 * np.pi * freq * t)
    if noise:
        sig = sig + noise * np.random.randn(len(t))
    return sig.astype(np.float32)


def main() -> None:
    run = resonance.init(project="vocoder-demo", config={"lr": 3e-4, "model": "hifigan"})
    print(f"run id: {run.id}  (mode={run.settings.mode})")

    reference = _tone(440.0)  # the "ground truth" target, for A/B
    for step in range(200):
        mel = 1.0 / (1 + step * 0.02) + random.uniform(-0.02, 0.02)
        adv = 0.5 + 0.4 * math.sin(step / 15) + random.uniform(-0.03, 0.03)
        run.log({"loss/mel": mel, "loss/adv": adv}, step=step)
        if step % 50 == 0:
            # Generated sample converges toward 440 Hz with shrinking noise as training proceeds —
            # uploaded (content-addressed), then a worker derives waveform + spectrogram.
            sample = _tone(440.0 + (200 - step), noise=0.3 * (1 - step / 200))
            run.log_audio(
                "samples/val", sample, sample_rate=SR, step=step,
                reference=reference, caption=f"step {step}",
            )
        time.sleep(0.01)

    run.finish()
    print("done")


if __name__ == "__main__":
    main()
