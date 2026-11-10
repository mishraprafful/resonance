"""ClickHouse query access (metrics plane) over the HTTP interface.

Read-only here; writes happen in the Go ingestion gateway. We query with JSONEachRow output and
do server-side downsampling so the UI never pulls millions of raw points.
"""

from __future__ import annotations

import json

import httpx

from .settings import settings


def query(sql: str, params: dict | None = None) -> list[dict]:
    """Run a SELECT and return rows as dicts (FORMAT JSONEachRow)."""
    r = httpx.post(
        settings.clickhouse_url,
        params={
            "database": settings.clickhouse_db,
            "user": settings.clickhouse_user,
            "password": settings.clickhouse_password,
            **(params or {}),
        },
        content=f"{sql}\nFORMAT JSONEachRow",
        timeout=30.0,
    )
    r.raise_for_status()
    return [json.loads(line) for line in r.text.splitlines() if line.strip()]


def metric_series(org_id: str, run_id: str, metric: str, max_points: int = 1000) -> list[dict]:
    """Downsampled (step, value) series for one metric of one run.

    Buckets by step so the payload is bounded (~max_points) regardless of how many points were
    logged. The bucket size is derived from the run's max step via a scalar subquery.
    """
    where = "org_id = {org:String} AND run_id = {run:String} AND metric = {metric:String}"
    sql = f"""
        WITH (SELECT max(step) FROM metrics WHERE {where}) AS max_step
        SELECT
            intDiv(step, greatest(1, intDiv(max_step, {{maxp:UInt32}}))) AS bucket,
            avg(value) AS value,
            max(step)  AS last_step
        FROM metrics
        WHERE {where}
        GROUP BY bucket
        ORDER BY bucket
    """
    return query(
        sql,
        {
            "param_org": org_id,
            "param_run": run_id,
            "param_metric": metric,
            "param_maxp": str(max_points),
        },
    )


def metric_names(org_id: str, run_id: str) -> list[str]:
    rows = query(
        "SELECT DISTINCT metric FROM metrics "
        "WHERE org_id = {org:String} AND run_id = {run:String} ORDER BY metric",
        {"param_org": org_id, "param_run": run_id},
    )
    return [r["metric"] for r in rows]
