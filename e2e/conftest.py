"""Pytest fixtures + stack-readiness gate for the Resonance E2E suite.

The suite assumes the full stack is already up (the `make e2e` target / CI workflow bring it up via
`scripts/dev.sh`). This conftest only *waits* for the planes + services to report healthy, then
hands tests a set of clients and per-test isolated tenants. It never boots or mocks anything.
"""

from __future__ import annotations

import httpx
import pytest

import helpers
from helpers import CONFIG, ApiClient, Org, create_org, wait_until


def _ping(url: str) -> bool:
    try:
        return httpx.get(url, timeout=3.0).status_code < 500
    except Exception:
        return False


@pytest.fixture(scope="session", autouse=True)
def stack_ready() -> None:
    """Block until every plane + service is reachable, with a clear message naming the laggard.

    This is the one sanctioned long wait: a freshly-started stack (sharded ClickHouse + Keeper,
    Redpanda topic creation, MinIO bucket init) takes time to converge. Once green, the assertions
    below must not need readiness retries.
    """
    checks = {
        "control API": lambda: _ping(f"{CONFIG.api_url}/healthz"),
        "ingest gateway": lambda: _ping(f"{CONFIG.ingest_url}/healthz"),
        "media gateway": lambda: _ping(f"{CONFIG.media_url}/healthz"),
        "clickhouse shard-1": lambda: _ping(f"{CONFIG.ch_shard1_url}/ping"),
        "clickhouse shard-2": lambda: _ping(f"{CONFIG.ch_shard2_url}/ping"),
        "postgres": _pg_ready,
        "object store": _s3_ready,
    }
    for name, check in checks.items():
        wait_until(check, timeout=120, interval=2, message=f"{name} did not become ready")
    # The dev org must exist (init SQL seeds it) for the dev-open path the SDK uses.
    wait_until(
        lambda: ApiClient().get("/v1/org").status_code == 200,
        timeout=30, message="dev-open default org not resolvable",
    )


def _pg_ready() -> bool:
    try:
        with helpers.pg_super() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            return True
    except Exception:
        return False


def _s3_ready() -> bool:
    try:
        helpers.s3_client().head_bucket(Bucket=CONFIG.s3_bucket)
        return True
    except Exception:
        return False


@pytest.fixture
def dev_api() -> ApiClient:
    """Dev-open client (no token) → resolves to the seeded ``dev`` org as owner."""
    client = ApiClient()
    yield client
    client.close()


@pytest.fixture
def make_org():
    """Factory: provision a fresh, isolated tenant on demand. No teardown — the stack is ephemeral."""
    created: list[ApiClient] = []

    def _make(storage_quota_bytes: int | None = None) -> Org:
        return create_org(storage_quota_bytes=storage_quota_bytes)

    yield _make
    for c in created:
        c.close()


@pytest.fixture
def org(make_org) -> Org:
    return make_org()


@pytest.fixture
def org_a(make_org) -> Org:
    return make_org()


@pytest.fixture
def org_b(make_org) -> Org:
    return make_org()
