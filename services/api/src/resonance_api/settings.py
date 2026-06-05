"""Runtime configuration for the control/query API, resolved from environment."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class Settings:
    postgres_dsn: str = os.environ.get(
        "POSTGRES_DSN",
        "postgresql://resonance:resonance@localhost:5432/resonance",
    )
    clickhouse_url: str = os.environ.get("CLICKHOUSE_URL", "http://localhost:8123")
    clickhouse_db: str = os.environ.get("CLICKHOUSE_DB", "resonance")
    clickhouse_user: str = os.environ.get("CLICKHOUSE_USER", "resonance")
    clickhouse_password: str = os.environ.get("CLICKHOUSE_PASSWORD", "resonance")
    default_org_slug: str = os.environ.get("RESONANCE_DEFAULT_ORG", "dev")


settings = Settings()
