"""SDK configuration, resolved from explicit args then environment."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class Settings:
    """Connection + behaviour settings for the SDK.

    `mode="offline"` spools everything to a local directory and uploads nothing — useful for
    development and for resuming after a crash. `mode="online"` talks to the ingestion gateway.
    """

    # Control plane (projects/runs lifecycle, queries) and ingest hot path (metrics).
    api_url: str = os.environ.get("RESONANCE_API_URL", "http://localhost:8000")
    ingest_url: str = os.environ.get("RESONANCE_INGEST_URL", "http://localhost:8080")
    api_token: str | None = os.environ.get("RESONANCE_API_TOKEN")
    org: str = os.environ.get("RESONANCE_ORG", "dev")
    mode: str = os.environ.get("RESONANCE_MODE", "offline")  # offline | online
    spool_dir: str = os.environ.get("RESONANCE_SPOOL_DIR", ".resonance")

    # Background flush tuning — the training loop must never block on these.
    flush_interval_s: float = 2.0
    flush_max_batch: int = 1000
