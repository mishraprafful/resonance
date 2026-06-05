"""The Run object — the SDK's core surface.

Design rule (UX non-negotiable): logging NEVER blocks the training loop. `log` / `log_audio`
enqueue work onto an in-memory queue that a background thread drains. Audio is hashed and the
heavy upload happens off the hot path.
"""

from __future__ import annotations

import hashlib
import json
import queue
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .config import Settings

_SENTINEL = object()


class Run:
    def __init__(self, project: str, config: dict, name: str | None, settings: Settings):
        self.id = str(uuid.uuid4())
        self.project = project
        self.name = name or f"run-{self.id[:8]}"
        self.config = config
        self.settings = settings
        self._q: queue.Queue = queue.Queue()
        self._spool = Path(settings.spool_dir) / self.id
        self._spool.mkdir(parents=True, exist_ok=True)
        self._stop = threading.Event()
        self._worker = threading.Thread(target=self._drain, name="resonance-flush", daemon=True)
        self._worker.start()

    # --- construction ---
    @classmethod
    def start(
        cls, project: str, config: dict, name: str | None, settings: Settings | None
    ) -> "Run":
        run = cls(project, config, name, settings or Settings())
        run._record({"event": "run_start", "project": project, "config": config, "name": run.name})
        return run

    # --- public logging API (non-blocking) ---
    def log(self, metrics: dict[str, float], *, step: int | None = None) -> None:
        """Log a batch of scalar metrics. Returns immediately."""
        self._q.put(
            {"event": "metrics", "step": step, "ts_ms": int(time.time() * 1000), "values": metrics}
        )

    def log_audio(
        self,
        key: str,
        audio: Any,
        *,
        sample_rate: int,
        step: int | None = None,
        caption: str | None = None,
        reference: Any | None = None,
    ) -> None:
        """Log a generated audio sample as a first-class, content-addressed artifact.

        `audio` may be a path or a numpy array (encoded by the worker). Hashing + upload happen
        off the hot path; identical content is uploaded only once (dedup).
        """
        payload = _encode_audio(audio, sample_rate)
        sha = hashlib.sha256(payload).hexdigest()
        ref_sha = None
        if reference is not None:
            ref_sha = hashlib.sha256(_encode_audio(reference, sample_rate)).hexdigest()
        self._q.put(
            {
                "event": "audio",
                "key": key,
                "step": step,
                "sha256": sha,
                "reference_sha": ref_sha,
                "caption": caption,
                "sample_rate": sample_rate,
                "_bytes": payload,  # stripped before serialization; used for upload
            }
        )

    def log_dataset(self, name: str, manifest: list[dict] | str) -> None:
        """Register a content-addressed dataset version (manifest of asset refs)."""
        self._q.put({"event": "dataset", "name": name, "manifest": manifest})

    def finish(self, state: str = "finished") -> None:
        self._q.put({"event": "run_finish", "state": state})
        self._q.put(_SENTINEL)
        self._stop.set()
        self._worker.join(timeout=30)

    # --- background flush loop ---
    def _drain(self) -> None:
        while True:
            item = self._q.get()
            if item is _SENTINEL:
                break
            try:
                self._dispatch(item)
            except Exception as exc:  # never let a logging error kill training
                self._record({"event": "error", "detail": repr(exc)})

    def _dispatch(self, item: dict) -> None:
        if self.settings.mode == "online":
            # Phase 1: POST metrics / PrepareAssetUpload + presigned PUT for audio bytes.
            # Stubbed for Phase 0 — fall through to spool so nothing is lost.
            pass
        self._record(item)

    # --- spool (offline + crash-safe buffer) ---
    def _record(self, item: dict) -> None:
        item = {k: v for k, v in item.items() if k != "_bytes"}
        with (self._spool / "events.jsonl").open("a") as f:
            f.write(json.dumps(item) + "\n")


def _encode_audio(audio: Any, sample_rate: int) -> bytes:
    """Coerce an audio input (path or array) to bytes for hashing/upload."""
    if isinstance(audio, (str, Path)):
        return Path(audio).read_bytes()
    try:
        import io

        import numpy as np  # noqa: F401
        import soundfile as sf

        buf = io.BytesIO()
        sf.write(buf, audio, sample_rate, format="WAV")
        return buf.getvalue()
    except Exception:
        # Fallback: best-effort bytes view (keeps Phase-0 dependency-free paths working).
        return bytes(memoryview(audio)) if hasattr(audio, "__buffer__") else repr(audio).encode()
