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
never waits on network or disk. The thread batches metrics and ships them; metadata/lifecycle calls
go to the control API.

**Modes** (env `RESONANCE_MODE`):
- `offline` (default) — append everything to a crash-safe local JSONL spool under `.resonance/`.
- `online` — create the run via the control API (`RESONANCE_API_URL`, default `:8000`), batch
  metrics to the ingest gateway (`RESONANCE_INGEST_URL`, default `:8080`), and update run state on
  `finish()`. Auth via `RESONANCE_API_TOKEN` (falls back to the seeded `dev` org locally).

Install (dev): `pip install -e ".[dev,audio]"`

See [`../examples/train_demo.py`](../examples/train_demo.py) for an end-to-end run.
