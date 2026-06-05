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

import resonance


def main() -> None:
    run = resonance.init(project="vocoder-demo", config={"lr": 3e-4, "model": "hifigan"})
    print(f"run id: {run.id}  (mode={run.settings.mode})")

    for step in range(200):
        mel = 1.0 / (1 + step * 0.02) + random.uniform(-0.02, 0.02)
        adv = 0.5 + 0.4 * math.sin(step / 15) + random.uniform(-0.03, 0.03)
        run.log({"loss/mel": mel, "loss/adv": adv}, step=step)
        if step % 50 == 0:
            # Phase 2 will actually upload + render this; for now it is hashed and recorded.
            run.log_audio("samples/val", b"RIFF" + bytes(step % 7), sample_rate=22050, step=step)
        time.sleep(0.01)

    run.finish()
    print("done")


if __name__ == "__main__":
    main()
