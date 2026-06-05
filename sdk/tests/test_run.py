import json
from pathlib import Path

import resonance
from resonance.config import Settings


def test_offline_run_spools_events(tmp_path: Path):
    settings = Settings(mode="offline", spool_dir=str(tmp_path))
    run = resonance.init(project="t", config={"lr": 1e-3}, settings=settings)
    run.log({"loss": 0.5}, step=0)
    run.log({"loss": 0.4}, step=1)
    run.finish()

    events = [
        json.loads(line)
        for line in (tmp_path / run.id / "events.jsonl").read_text().splitlines()
    ]
    kinds = [e["event"] for e in events]
    assert kinds[0] == "run_start"
    assert kinds.count("metrics") == 2
    assert kinds[-1] == "run_finish"


def test_log_audio_is_content_addressed(tmp_path: Path):
    settings = Settings(mode="offline", spool_dir=str(tmp_path))
    run = resonance.init(project="t", settings=settings)
    audio_file = tmp_path / "a.wav"
    audio_file.write_bytes(b"RIFFfake-wav-bytes")
    run.log_audio("samples/val", audio_file, sample_rate=22050, step=0)
    run.finish()

    events = [
        json.loads(line)
        for line in (tmp_path / run.id / "events.jsonl").read_text().splitlines()
    ]
    audio = next(e for e in events if e["event"] == "audio")
    assert len(audio["sha256"]) == 64  # sha256 hex digest
    assert "_bytes" not in audio       # raw bytes stripped before spooling
