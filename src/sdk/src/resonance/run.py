"""The Run object — the SDK's core surface.

Design rule (UX non-negotiable): logging NEVER blocks the training loop. `log` / `log_audio`
enqueue work onto an in-memory queue that a background thread drains, batches, and ships.

Modes:
  * offline — everything is appended to a local JSONL spool (crash-safe, no network).
  * online  — the run is created via the control API at init; metrics are batched to the ingest
              gateway; finish updates run state. Events are also spooled as a local buffer.
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
        self.org_id: str | None = None
        self.project_id: str | None = None
        self.project = project
        self.name = name or f"run-{self.id[:8]}"
        self.config = config
        self.settings = settings
        self._q: queue.Queue = queue.Queue()
        self._spool = Path(settings.spool_dir) / self.id
        self._spool.mkdir(parents=True, exist_ok=True)
        self._client = None  # lazy httpx.Client in online mode
        self._worker = threading.Thread(target=self._drain, name="resonance-flush", daemon=True)

    # --- construction ---
    @classmethod
    def start(
        cls, project: str, config: dict, name: str | None, settings: Settings | None
    ) -> "Run":
        run = cls(project, config, name, settings or Settings())
        if run.settings.mode == "online":
            run._create_remote_run()
        run._record({"event": "run_start", "project": project, "config": config, "name": run.name})
        run._worker.start()
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

        Hashing happens here (off the hot path via the queue); upload + dedup land in Phase 2.
        """
        payload = _encode_audio(audio, sample_rate)
        sha = hashlib.sha256(payload).hexdigest()
        ref_sha = None
        ref_payload = None
        if reference is not None:
            ref_payload = _encode_audio(reference, sample_rate)
            ref_sha = hashlib.sha256(ref_payload).hexdigest()
        self._q.put(
            {
                "event": "audio",
                "key": key,
                "step": step,
                "sha256": sha,
                "reference_sha": ref_sha,
                "caption": caption,
                "sample_rate": sample_rate,
                "_bytes": payload,
                "_ref_bytes": ref_payload,
            }
        )

    def log_dataset(self, name: str, source: str | list) -> None:
        """Register a content-addressed dataset version.

        `source` may be a directory path, a list of file paths, or a prebuilt manifest
        (list of {"path": ..., optionally "sha256": ...}). Items are deduped on upload, and the
        version id is the content hash of the member set — identical datasets collapse to one
        version regardless of how many runs log them.
        """
        self._q.put({"event": "dataset", "name": name, "source": source})

    def finish(self, state: str = "finished") -> None:
        self._q.put({"event": "run_finish", "state": state})
        self._q.put(_SENTINEL)
        self._worker.join(timeout=30)
        if self._client is not None:
            self._client.close()

    # --- background flush loop (batches metrics) ---
    def _drain(self) -> None:
        pending: list[dict] = []  # buffered metric points awaiting a batch flush

        def flush_metrics() -> None:
            if pending:
                self._send_metrics(pending)
                pending.clear()

        while True:
            try:
                item = self._q.get(timeout=self.settings.flush_interval_s)
            except queue.Empty:
                flush_metrics()
                continue
            if item is _SENTINEL:
                flush_metrics()
                break
            try:
                if item["event"] == "metrics":
                    for metric, value in item["values"].items():
                        pending.append(
                            {
                                "metric": metric,
                                "step": item.get("step") or 0,
                                "value": float(value),
                                "ts_ms": item["ts_ms"],
                            }
                        )
                    if len(pending) >= self.settings.flush_max_batch:
                        flush_metrics()
                else:
                    flush_metrics()
                    if item["event"] == "audio" and self.settings.mode == "online":
                        self._upload_audio(item)
                    elif item["event"] == "dataset" and self.settings.mode == "online":
                        self._upload_dataset(item)
                    elif item["event"] == "run_finish":
                        self._finish_remote_run(item["state"])
                self._record(item)
            except Exception as exc:  # never let a logging error kill training
                self._record({"event": "error", "detail": repr(exc)})

    # --- online mode (lazy httpx) ---
    def _http(self):
        if self._client is None:
            import httpx  # imported lazily so the offline path needs no network deps

            headers = {}
            if self.settings.api_token:
                headers["Authorization"] = f"Bearer {self.settings.api_token}"
            self._client = httpx.Client(headers=headers, timeout=10.0)
        return self._client

    def _create_remote_run(self) -> None:
        resp = self._http().post(
            f"{self.settings.api_url}/v1/runs",
            json={"project": self.project, "name": self.name, "config": self.config},
        )
        resp.raise_for_status()
        data = resp.json()
        self.id = data["id"]
        self.org_id = data["org_id"]
        self.project_id = data["project_id"]

    def _send_metrics(self, points: list[dict]) -> None:
        if self.settings.mode != "online":
            return
        try:
            self._http().post(
                f"{self.settings.ingest_url}/v1/metrics",
                json={
                    "run": {
                        "org_id": self.org_id or "",
                        "project_id": self.project_id or "",
                        "run_id": self.id,
                    },
                    "points": points,
                },
            )
        except Exception as exc:
            self._record({"event": "error", "detail": f"send_metrics: {exc!r}"})

    def _put_if_new(self, sha: str, payload: bytes, media_type: str) -> None:
        """Dedup check then direct-to-store PUT only when content is new (zero bytes on repeat)."""
        resp = self._http().post(
            f"{self.settings.api_url}/v1/assets/prepare",
            json={"sha256": sha, "media_type": media_type, "size_bytes": len(payload)},
        )
        resp.raise_for_status()
        data = resp.json()
        if not data["exists"] and data.get("upload_url"):
            put = self._http().put(
                data["upload_url"], content=payload, headers={"Content-Type": media_type}
            )
            put.raise_for_status()

    def _upload_audio(self, item: dict) -> None:
        """Content-addressed upload of a logged audio sample (+ optional reference), then register."""
        media_type = "audio/wav"
        try:
            self._put_if_new(item["sha256"], item["_bytes"], media_type)
            if item.get("reference_sha") and item.get("_ref_bytes") is not None:
                self._put_if_new(item["reference_sha"], item["_ref_bytes"], media_type)
            reg = self._http().post(
                f"{self.settings.api_url}/v1/audio",
                json={
                    "run_id": self.id,
                    "key": item["key"],
                    "asset_sha": item["sha256"],
                    "step": item.get("step"),
                    "reference_sha": item.get("reference_sha"),
                    "caption": item.get("caption"),
                    "media_type": media_type,
                    "size_bytes": len(item["_bytes"]),
                    "sample_rate": item.get("sample_rate"),
                },
            )
            reg.raise_for_status()
        except Exception as exc:
            self._record({"event": "error", "detail": f"upload_audio: {exc!r}"})

    def _upload_dataset(self, item: dict) -> None:
        """Upload each dataset member (content-addressed, deduped) and register the version."""
        try:
            paths = _expand_dataset_source(item["source"])
            manifest = []
            for path in paths:
                payload = Path(path).read_bytes()
                sha = hashlib.sha256(payload).hexdigest()
                self._put_if_new(sha, payload, "audio/wav")
                manifest.append({"sha256": sha, "path": str(path), "size_bytes": len(payload)})
            # Content-addressed version: identical member sets -> identical version id.
            version = hashlib.sha256(
                "".join(sorted(m["sha256"] for m in manifest)).encode()
            ).hexdigest()[:12]
            reg = self._http().post(
                f"{self.settings.api_url}/v1/datasets",
                json={
                    "name": item["name"],
                    "version": version,
                    "project_id": self.project_id,
                    "manifest": manifest,
                },
            )
            reg.raise_for_status()
        except Exception as exc:
            self._record({"event": "error", "detail": f"upload_dataset: {exc!r}"})

    def _finish_remote_run(self, state: str) -> None:
        if self.settings.mode != "online":
            return
        try:
            self._http().patch(
                f"{self.settings.api_url}/v1/runs/{self.id}", json={"state": state}
            )
        except Exception as exc:
            self._record({"event": "error", "detail": f"finish_run: {exc!r}"})

    # --- spool (offline + crash-safe buffer) ---
    def _record(self, item: dict) -> None:
        item = {k: v for k, v in item.items() if not k.startswith("_")}
        with (self._spool / "events.jsonl").open("a") as f:
            f.write(json.dumps(item) + "\n")


def _expand_dataset_source(source: str | list) -> list[str]:
    """Resolve a dataset source to a list of file paths.

    Accepts a directory (recursively globbed for audio files), a list of file paths, or a manifest
    (list of dicts carrying a 'path').
    """
    if isinstance(source, (str, Path)):
        root = Path(source)
        if root.is_dir():
            exts = {".wav", ".flac", ".ogg", ".mp3", ".opus"}
            return [str(p) for p in sorted(root.rglob("*")) if p.suffix.lower() in exts]
        return [str(root)]
    paths = []
    for item in source:
        paths.append(item["path"] if isinstance(item, dict) else str(item))
    return paths


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
        return bytes(memoryview(audio)) if hasattr(audio, "__buffer__") else repr(audio).encode()
