"""Shared helpers for the Resonance end-to-end suite.

These tests drive the *real* running stack (the same one `make up` brings up): the control/query
API, the Go ingest + media gateways, the audio-derivation worker, and the data planes (Postgres,
sharded ClickHouse, MinIO, Redpanda, Redis). Nothing here is mocked — the point of this suite is to
prove the product works when the pieces are wired together.

Connection details default to the dev-stack ports wired by `scripts/dev.sh`; override via E2E_* env.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import os
import time
import uuid
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlparse

import boto3
import httpx
import numpy as np
import psycopg
import soundfile as sf
from botocore.client import Config as BotoConfig
from psycopg.rows import dict_row


# --------------------------------------------------------------------------------------------------
# Configuration (defaults match scripts/dev.sh; CI/`make e2e` keep these defaults).
# --------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class E2EConfig:
    api_url: str = os.environ.get("E2E_API_URL", "http://localhost:8000")
    ingest_url: str = os.environ.get("E2E_INGEST_URL", "http://localhost:18080")
    media_url: str = os.environ.get("E2E_MEDIA_URL", "http://localhost:8090")

    # ClickHouse: shard-1 and shard-2 HTTP interfaces are both exposed so we can prove a run's
    # points co-locate on exactly one shard while the Distributed table still aggregates them.
    ch_shard1_url: str = os.environ.get("E2E_CH_SHARD1_URL", "http://localhost:8123")
    ch_shard2_url: str = os.environ.get("E2E_CH_SHARD2_URL", "http://localhost:8124")
    ch_db: str = os.environ.get("E2E_CH_DB", "resonance")
    ch_user: str = os.environ.get("E2E_CH_USER", "resonance")
    ch_password: str = os.environ.get("E2E_CH_PASSWORD", "resonance")

    # Two Postgres roles: superuser (bypasses RLS, like the worker) and the least-privilege
    # `resonance_app` (RLS-enforced, like the API) — we assert isolation at both layers.
    pg_super_dsn: str = os.environ.get(
        "E2E_PG_SUPER_DSN", "postgresql://resonance:resonance@localhost:5432/resonance"
    )
    pg_app_dsn: str = os.environ.get(
        "E2E_PG_APP_DSN", "postgresql://resonance_app:resonance_app@localhost:5432/resonance"
    )

    # Redpanda HTTP proxy (pandaproxy) — the derivation fast lane. The API publishes jobs here on
    # asset registration; the worker consumes them (with a Postgres poll as the correctness backstop).
    pandaproxy_url: str = os.environ.get("E2E_PANDAPROXY_URL", "http://localhost:8082")
    derivation_topic: str = os.environ.get("E2E_DERIVATION_TOPIC", "audio.derivations")

    s3_endpoint: str = os.environ.get("E2E_S3_ENDPOINT", "http://localhost:9100")
    s3_region: str = os.environ.get("E2E_S3_REGION", "us-east-1")
    s3_access_key: str = os.environ.get("E2E_S3_ACCESS_KEY", "resonance")
    s3_secret_key: str = os.environ.get("E2E_S3_SECRET_KEY", "resonance-secret")
    s3_bucket: str = os.environ.get("E2E_S3_BUCKET", "resonance-blobs")

    # Must match the secret the API and media gateway share (scripts/dev.sh default).
    media_signing_secret: str = os.environ.get(
        "E2E_MEDIA_SIGNING_SECRET", "resonance-dev-media-secret"
    )


CONFIG = E2EConfig()


# --------------------------------------------------------------------------------------------------
# Polling — the only place retries are allowed: waiting on genuinely async, external work
# (stack readiness, the Go sink's 1s flush, the derivation worker). Never to paper over a race.
# --------------------------------------------------------------------------------------------------
class WaitTimeout(AssertionError):
    pass


def wait_until(
    predicate: Callable[[], Any],
    *,
    timeout: float = 30.0,
    interval: float = 0.5,
    message: str = "condition not met",
) -> Any:
    """Poll ``predicate`` until it returns a truthy value or ``timeout`` elapses.

    Returns the truthy value (handy for "wait until rows exist, then use them"). Raises
    WaitTimeout with the last seen value on timeout so failures say what was actually observed.
    """
    deadline = time.monotonic() + timeout
    last: Any = None
    while time.monotonic() < deadline:
        last = predicate()
        if last:
            return last
        time.sleep(interval)
    raise WaitTimeout(f"{message} (waited {timeout}s; last value: {last!r})")


# --------------------------------------------------------------------------------------------------
# Control/query API client (Bearer token, browser session cookie, or dev-open).
# --------------------------------------------------------------------------------------------------
class ApiClient:
    """Thin wrapper over httpx for the control/query API.

    ``token`` sets the Bearer header (an org's API token). With no token the API's dev-open
    fallback resolves to the default ``dev`` org as owner. Pass a configured ``client`` to share a
    cookie jar (browser-session flows).
    """

    def __init__(self, token: str | None = None, client: httpx.Client | None = None):
        self.token = token
        self.base = CONFIG.api_url
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        self._client = client or httpx.Client(timeout=15.0)
        self._headers = headers

    def request(self, method: str, path: str, **kwargs) -> httpx.Response:
        headers = {**self._headers, **kwargs.pop("headers", {})}
        return self._client.request(method, f"{self.base}{path}", headers=headers, **kwargs)

    def get(self, path: str, **kwargs) -> httpx.Response:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> httpx.Response:
        return self.request("POST", path, **kwargs)

    def patch(self, path: str, **kwargs) -> httpx.Response:
        return self.request("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs) -> httpx.Response:
        return self.request("DELETE", path, **kwargs)

    def close(self) -> None:
        self._client.close()


@dataclass
class Org:
    org_id: str
    slug: str
    owner_token: str

    def client(self) -> ApiClient:
        return ApiClient(token=self.owner_token)


def create_org(storage_quota_bytes: int | None = None, slug: str | None = None) -> Org:
    """Provision a fresh tenant via POST /v1/orgs (dev-open authorizes the bootstrap) and return its
    id + a one-time owner token. Each test that needs isolation gets its own org."""
    slug = slug or f"e2e-{uuid.uuid4().hex[:12]}"
    resp = ApiClient().post(
        "/v1/orgs",
        json={"slug": slug, "name": slug, "storage_quota_bytes": storage_quota_bytes},
    )
    resp.raise_for_status()
    data = resp.json()
    return Org(org_id=data["id"], slug=data["slug"], owner_token=data["owner_token"])


def mint_token(owner: ApiClient, org_id: str, role: str, name: str | None = None) -> str:
    """Create an additional API token with a given role on an org (caller must be org admin+)."""
    resp = owner.post(
        f"/v1/orgs/{org_id}/tokens",
        json={"name": name or f"e2e-{role}", "role": role},
    )
    resp.raise_for_status()
    return resp.json()["token"]


# --------------------------------------------------------------------------------------------------
# Ingest gateway (metrics hot path).
# --------------------------------------------------------------------------------------------------
def post_metrics(org_id: str, project_id: str, run_id: str, points: list[dict]) -> httpx.Response:
    """POST a batch of metric points to the Go ingest gateway (the SDK's hot path)."""
    return httpx.post(
        f"{CONFIG.ingest_url}/v1/metrics",
        json={
            "run": {"org_id": org_id, "project_id": project_id, "run_id": run_id},
            "points": points,
        },
        timeout=15.0,
    )


# --------------------------------------------------------------------------------------------------
# ClickHouse (metrics plane) — query a specific shard or the Distributed table.
# --------------------------------------------------------------------------------------------------
def ch_query(sql: str, url: str | None = None) -> list[list[str]]:
    """Run a SELECT against a ClickHouse node and return TSV rows (list of column lists)."""
    resp = httpx.post(
        url or CONFIG.ch_shard1_url,
        params={"database": CONFIG.ch_db, "user": CONFIG.ch_user, "password": CONFIG.ch_password},
        content=f"{sql}\nFORMAT TSV",
        timeout=30.0,
    )
    resp.raise_for_status()
    return [line.split("\t") for line in resp.text.splitlines() if line.strip()]


def ch_scalar(sql: str, url: str | None = None) -> str:
    rows = ch_query(sql, url=url)
    return rows[0][0] if rows else ""


def ch_count(table: str, run_id: str, url: str | None = None) -> int:
    return int(ch_scalar(f"SELECT count() FROM resonance.{table} WHERE run_id = '{run_id}'", url=url))


# --------------------------------------------------------------------------------------------------
# Postgres (metadata plane) — superuser (RLS-bypassing) and app-role (RLS-enforced) connections.
# --------------------------------------------------------------------------------------------------
def pg_super() -> psycopg.Connection:
    return psycopg.connect(CONFIG.pg_super_dsn, row_factory=dict_row, autocommit=True)


def pg_app(org_id: str) -> psycopg.Connection:
    """App-role connection with the RLS GUC set — mirrors how the API scopes every tenant query."""
    conn = psycopg.connect(CONFIG.pg_app_dsn, row_factory=dict_row, autocommit=True)
    with conn.cursor() as cur:
        # `SET` doesn't accept bind params; set_config does. is_local=false → session-scoped (this
        # connection is autocommit, so a LOCAL setting wouldn't outlive the SET statement).
        cur.execute("SELECT set_config('app.current_org', %s, false)", (org_id,))
    return conn


def pg_super_query(sql: str, params: tuple = ()) -> list[dict]:
    with pg_super() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else []


# --------------------------------------------------------------------------------------------------
# Object store (audio/blob plane).
# --------------------------------------------------------------------------------------------------
def s3_client():
    return boto3.client(
        "s3",
        endpoint_url=CONFIG.s3_endpoint,
        region_name=CONFIG.s3_region,
        aws_access_key_id=CONFIG.s3_access_key,
        aws_secret_access_key=CONFIG.s3_secret_key,
        config=BotoConfig(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def blob_key(org_id: str, sha256: str) -> str:
    """Content-addressed object key for an original blob (mirrors the API's storage.blob_key)."""
    return f"{org_id}/blobs/{sha256[:2]}/{sha256[2:4]}/{sha256}"


def s3_count(prefix: str) -> int:
    """Count objects under a key prefix (used to prove dedup uploads zero bytes)."""
    s3 = s3_client()
    paginator = s3.get_paginator("list_objects_v2")
    n = 0
    for page in paginator.paginate(Bucket=CONFIG.s3_bucket, Prefix=prefix):
        n += page.get("KeyCount", 0)
    return n


# --------------------------------------------------------------------------------------------------
# Audio generation — deterministic WAV bytes the worker can actually decode + derive.
# --------------------------------------------------------------------------------------------------
def make_wav(seconds: float = 0.5, sample_rate: int = 22050, freq: float = 440.0,
             seed: int | None = None) -> tuple[bytes, np.ndarray]:
    """Return (wav_bytes, samples). A distinct ``seed`` yields distinct content (distinct sha256)."""
    t = np.linspace(0, seconds, int(seconds * sample_rate), endpoint=False)
    rng = np.random.default_rng(seed if seed is not None else 0)
    # A pure tone plus a tiny seeded perturbation so different seeds hash differently.
    samples = (0.4 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    if seed is not None:
        samples = (samples + 0.001 * rng.standard_normal(samples.shape).astype(np.float32))
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV")
    return buf.getvalue(), samples


def sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def upload_asset(client: ApiClient, payload: bytes, media_type: str = "audio/wav") -> str:
    """Run the full content-addressed upload: prepare -> presigned PUT (only if new) -> return sha.

    This is exactly the SDK's flow (`_put_if_new`); re-calling with identical bytes uploads nothing.
    """
    sha = sha256_hex(payload)
    resp = client.post(
        "/v1/assets/prepare",
        json={"sha256": sha, "media_type": media_type, "size_bytes": len(payload)},
    )
    resp.raise_for_status()
    data = resp.json()
    if not data["exists"] and data.get("upload_url"):
        put = httpx.put(data["upload_url"], content=payload,
                        headers={"Content-Type": media_type}, timeout=30.0)
        put.raise_for_status()
    return sha


def register_audio(client: ApiClient, run_id: str, key: str, sha: str, *, step: int | None = None,
                   size_bytes: int = 0, sample_rate: int | None = None,
                   reference_sha: str | None = None, caption: str | None = None) -> dict:
    resp = client.post(
        "/v1/audio",
        json={
            "run_id": run_id, "key": key, "asset_sha": sha, "step": step,
            "size_bytes": size_bytes, "sample_rate": sample_rate,
            "reference_sha": reference_sha, "caption": caption,
        },
    )
    resp.raise_for_status()
    return resp.json()


def create_run(client: ApiClient, project: str, name: str | None = None,
               config: dict | None = None) -> dict:
    resp = client.post(
        "/v1/runs",
        json={"project": project, "name": name or f"run-{uuid.uuid4().hex[:6]}",
              "config": config or {}},
    )
    resp.raise_for_status()
    return resp.json()


# --------------------------------------------------------------------------------------------------
# Media gateway — replicate the API's HMAC signing so we can forge expired/tampered URLs.
# --------------------------------------------------------------------------------------------------
def media_sign(object_key: str, exp: int) -> str:
    return hmac.new(
        CONFIG.media_signing_secret.encode(), f"{object_key}\n{exp}".encode(), hashlib.sha256
    ).hexdigest()


def media_url(object_key: str, exp: int, sig: str | None = None) -> str:
    sig = sig if sig is not None else media_sign(object_key, exp)
    return f"{CONFIG.media_url}/v1/stream/{object_key}?exp={exp}&sig={sig}"


def parse_stream_url(url: str) -> tuple[str, int, str]:
    """Pull (object_key, exp, sig) out of a media-gateway stream URL minted by the API."""
    parsed = urlparse(url)
    object_key = parsed.path.split("/v1/stream/", 1)[1]
    qs = dict(p.split("=", 1) for p in parsed.query.split("&"))
    return object_key, int(qs["exp"]), qs["sig"]


# --------------------------------------------------------------------------------------------------
# Redpanda fast lane — peek the derivation topic via pandaproxy (same REST API the worker consumes
# with). Uses a throwaway consumer group so it reads its own copy and never disturbs the worker's
# `resonance-derivers` group.
# --------------------------------------------------------------------------------------------------
_KAFKA_V2 = "application/vnd.kafka.v2+json"
_KAFKA_JSON_V2 = "application/vnd.kafka.json.v2+json"


def pandaproxy_await_value(topic: str, predicate: Callable[[dict], bool],
                           *, timeout: float = 30.0) -> dict | None:
    """Read records off ``topic`` (from the beginning, in a fresh group) until ``predicate`` matches
    a record value or ``timeout`` elapses. Returns the matching value, or None on timeout."""
    proxy = CONFIG.pandaproxy_url.rstrip("/")
    group = f"e2e-peek-{uuid.uuid4().hex[:8]}"
    with httpx.Client(timeout=30.0) as c:
        resp = c.post(
            f"{proxy}/consumers/{group}", headers={"Content-Type": _KAFKA_V2},
            json={"format": "json", "auto.offset.reset": "earliest", "auto.commit.enable": "false"},
        )
        resp.raise_for_status()
        base = f"{proxy}/consumers/{group}/instances/{resp.json()['instance_id']}"
        try:
            c.post(f"{base}/subscription", headers={"Content-Type": _KAFKA_V2},
                   json={"topics": [topic]}).raise_for_status()
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                r = c.get(f"{base}/records?timeout=1000", headers={"Accept": _KAFKA_JSON_V2})
                r.raise_for_status()
                for rec in r.json():
                    if predicate(rec["value"]):
                        return rec["value"]
            return None
        finally:
            try:
                c.delete(base)
            except Exception:
                pass
