# resonance (Python SDK)

Audio-first ML experiment tracking client.

```python
import resonance

run = resonance.init(project="vocoder", config={"lr": 3e-4})
for step in range(1000):
    run.log({"loss/mel": mel_loss}, step=step)
    if step % 100 == 0:
        run.log_audio("samples/val", wav, sample_rate=22050, step=step, reference=ref_wav)
run.finish()
```

**Non-blocking by design:** every `log*` call enqueues onto a background thread; the training loop
never waits on network or disk. Set `RESONANCE_MODE=online` (Phase 1+) to stream to a gateway;
default `offline` spools to `.resonance/` and is crash-safe.

Install (dev): `pip install -e ".[dev,audio]"`
