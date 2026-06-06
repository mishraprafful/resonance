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

    # Object store (audio/blob plane) — S3-compatible (MinIO in dev).
    s3_endpoint: str = os.environ.get("S3_ENDPOINT", "http://localhost:9100")
    s3_region: str = os.environ.get("S3_REGION", "us-east-1")
    s3_access_key: str = os.environ.get("S3_ACCESS_KEY", "resonance")
    s3_secret_key: str = os.environ.get("S3_SECRET_KEY", "resonance-secret")
    s3_bucket: str = os.environ.get("S3_BUCKET", "resonance-blobs")
    presign_ttl_s: int = int(os.environ.get("RESONANCE_PRESIGN_TTL", "3600"))

    # Cache (presigned-URL cache so we don't re-sign on every page render).
    redis_url: str = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    audio_page_size: int = int(os.environ.get("RESONANCE_AUDIO_PAGE_SIZE", "50"))

    # Media gateway (Go). When MEDIA_PUBLIC_URL is set, audio originals are streamed through the
    # auth-scoped, CDN-frontable gateway (HMAC-signed URLs); otherwise we fall back to a direct
    # presigned object-store GET (no gateway running). The signing secret must match the gateway's.
    media_gateway_url: str = os.environ.get("MEDIA_PUBLIC_URL", "")
    media_signing_secret: str = os.environ.get("MEDIA_SIGNING_SECRET", "resonance-dev-media-secret")

    # Stream queue (Redpanda via its HTTP proxy / pandaproxy). When set, new-asset registration
    # publishes a derivation job so workers process event-driven instead of only DB-polling. The
    # worker keeps a Postgres poll as a correctness backstop, so this is best-effort.
    pandaproxy_url: str = os.environ.get("PANDAPROXY_URL", "")
    derivation_topic: str = os.environ.get("DERIVATION_TOPIC", "audio.derivations")

    # Multi-tenancy. dev_open: when no Bearer token is supplied, fall back to the default org as an
    # owner (local-dev convenience). Set RESONANCE_DEV_OPEN=false to require tokens (prod posture).
    dev_open: bool = os.environ.get("RESONANCE_DEV_OPEN", "true").lower() == "true"
    default_rate_limit_per_min: int = int(os.environ.get("RESONANCE_RATE_LIMIT_PER_MIN", "600"))


settings = Settings()
