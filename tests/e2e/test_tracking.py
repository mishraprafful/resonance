"""Tracking / metrics plane, end-to-end.

Proves the hot path the SDK drives: `init`/`log`/`finish` -> Go ingest gateway -> sharded
ClickHouse, and that points read back through the control API match what was logged. Also asserts
server-side downsampling, metric-name listing, the ClickHouse sharding invariant (a run co-locates
on one shard; the Distributed table aggregates from any node), and graceful backpressure.

Maps to ARCHITECTURE.md §10 Phase 1 + the Phase 5 ClickHouse-sharding criterion.
"""

from __future__ import annotations

import concurrent.futures

import pytest
import resonance
from resonance.config import Settings

import helpers
from helpers import CONFIG, post_metrics, wait_until

pytestmark = pytest.mark.tracking


def _sdk_settings(org) -> Settings:
    return Settings(
        api_url=CONFIG.api_url,
        ingest_url=CONFIG.ingest_url,
        api_token=org.owner_token,
        mode="online",
    )


def test_sdk_roundtrip_matches_logged_points(org, tmp_path):
    """SDK init/log/finish -> ingest -> ClickHouse; the API reads back exactly what was logged.

    Few enough points (<= the 1000-point downsample budget) that each step is its own bucket, so the
    averaged value equals the logged value — letting us assert an exact round-trip.
    """
    settings = _sdk_settings(org)
    settings.spool_dir = str(tmp_path)
    run = resonance.init(project="vocoder", config={"lr": 3e-4}, settings=settings)
    expected = {i: round(1.0 / (i + 1), 4) for i in range(12)}
    for step, value in expected.items():
        run.log({"loss/mel": value, "lr": 3e-4}, step=step)
    run.finish()

    api = org.client()
    # The Go sink flushes on a timer — wait for all rows to land in the Distributed table.
    wait_until(
        lambda: helpers.ch_count("metrics", run.id) >= len(expected) * 2,  # 2 metrics per step
        timeout=60, message="metric rows did not land in ClickHouse",
    )

    names = api.get(f"/v1/runs/{run.id}/metric-names").json()["metrics"]
    assert set(names) == {"loss/mel", "lr"}

    series = api.get(f"/v1/runs/{run.id}/metrics", params={"metric": "loss/mel"}).json()
    got = {p["step"]: p["value"] for p in series["points"]}
    assert got.keys() == expected.keys()
    for step, value in expected.items():
        assert got[step] == pytest.approx(value, abs=1e-6)
    api.close()


def test_downsampling_bounds_payload(org):
    """Logging far more than the budget still returns a bounded (~1000-point) series."""
    run = helpers.create_run(org.client(), project="downsample")
    n = 2500
    points = [{"metric": "loss", "step": i, "value": float(i)} for i in range(n)]
    resp = post_metrics(org.org_id, run["project_id"], run["id"], points)
    assert resp.status_code == 202, resp.text
    assert int(resp.json()["accepted"]) == n

    wait_until(lambda: helpers.ch_count("metrics", run["id"]) >= n,
               timeout=60, message="bulk metrics did not land")

    series = org.client().get(f"/v1/runs/{run['id']}/metrics", params={"metric": "loss"}).json()
    pts = series["points"]
    # Server-side bucket-averaging caps the payload near the ~1000-point budget (the step-bucket
    # math tops out around 2x the budget), far below the raw count — so the UI never pulls millions.
    assert 0 < len(pts) < n, f"series was not downsampled: {len(pts)} of {n}"
    assert len(pts) <= 2000, f"series not bounded near the budget: {len(pts)}"
    # The final bucket carries the true max step, so the tail of the curve is preserved.
    assert max(p["step"] for p in pts) == n - 1


def test_clickhouse_sharding_colocates_run_and_aggregates(org):
    """A run's points land on exactly one shard (cityHash64(run_id)); the Distributed table
    aggregates them from any node."""
    run = helpers.create_run(org.client(), project="sharding")
    n = 400
    points = [{"metric": "m", "step": i, "value": float(i)} for i in range(n)]
    assert post_metrics(org.org_id, run["project_id"], run["id"], points).status_code == 202

    wait_until(lambda: helpers.ch_count("metrics", run["id"]) >= n,
               timeout=60, message="rows did not land for sharding check")

    s1 = helpers.ch_count("metrics_local", run["id"], url=CONFIG.ch_shard1_url)
    s2 = helpers.ch_count("metrics_local", run["id"], url=CONFIG.ch_shard2_url)
    # Co-location: all rows on one shard's *_local table, none on the other.
    assert {s1, s2} == {n, 0}, f"run not co-located on one shard: shard1={s1} shard2={s2}"

    # The Distributed table returns the full count regardless of which node we ask.
    assert helpers.ch_count("metrics", run["id"], url=CONFIG.ch_shard1_url) == n
    assert helpers.ch_count("metrics", run["id"], url=CONFIG.ch_shard2_url) == n


@pytest.mark.slow
def test_backpressure_sheds_load_without_erroring(org):
    """Under a burst that can saturate the ingest buffer, the gateway only ever returns 202 (all
    accepted) or 503 (load shed) — never a 5xx error — and a 503 reports a partial accept count.

    The non-negotiable here is *graceful* backpressure: the training loop is never handed a hard
    error, and shed load is reported honestly rather than silently dropped.
    """
    run = helpers.create_run(org.client(), project="backpressure")
    batch = [{"metric": "x", "step": i, "value": float(i)} for i in range(20_000)]

    def fire(_):
        r = post_metrics(org.org_id, run["project_id"], run["id"], batch)
        return r.status_code, int(r.json()["accepted"])

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(fire, range(32)))

    for code, accepted in results:
        assert code in (202, 503), f"unexpected status {code}"
        if code == 202:
            assert accepted == len(batch)
        else:  # 503: load shed — honestly reports fewer accepted than sent
            assert accepted < len(batch)


def test_ingest_rejects_malformed_run_ref():
    """The gateway validates its contract: a metrics batch with no run id is a 400, not a silent
    accept (ClickHouse columns are UUID-typed — bad ids must not reach the sink)."""
    resp = post_metrics("", "", "", [{"metric": "x", "step": 0, "value": 1.0}])
    assert resp.status_code == 400
