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


def test_expand_dataset_source_dir_and_list(tmp_path: Path):
    from resonance.run import _expand_dataset_source

    (tmp_path / "a.wav").write_bytes(b"a")
    (tmp_path / "b.flac").write_bytes(b"b")
    (tmp_path / "notes.txt").write_text("ignore me")
    # directory -> only audio files, sorted
    got = _expand_dataset_source(str(tmp_path))
    assert [Path(p).name for p in got] == ["a.wav", "b.flac"]
    # explicit list of paths and manifest dicts
    assert _expand_dataset_source(["x.wav", "y.wav"]) == ["x.wav", "y.wav"]
    assert _expand_dataset_source([{"path": "z.wav", "sha256": "deadbeef"}]) == ["z.wav"]
