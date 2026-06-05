"""Resonance control + query plane.

Projects/runs CRUD against Postgres, metric queries against ClickHouse (server-side downsampled).
Tenant-scoped by org_id on every query. Phase 1 (W&B-parity baseline).
"""

from __future__ import annotations

import json

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from . import clickhouse, db
from .auth import resolve_org
from .models import MetricSeries, Project, Run, RunCreate, RunUpdate

app = FastAPI(title="Resonance API", version="0.1.0")


class Health(BaseModel):
    status: str = "ok"
    service: str = "api"


@app.get("/healthz", response_model=Health)
def healthz() -> Health:
    return Health()


@app.on_event("shutdown")
def _shutdown() -> None:
    db.close()


# --- helpers ---
def _get_or_create_project(conn, org_id: str, slug: str, name: str | None) -> dict:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM projects WHERE org_id = %s AND slug = %s", (org_id, slug)
        )
        row = cur.fetchone()
        if row:
            return row
        cur.execute(
            "INSERT INTO projects (org_id, slug, name) VALUES (%s, %s, %s) RETURNING *",
            (org_id, slug, name or slug),
        )
        return cur.fetchone()


# --- projects ---
@app.get("/v1/projects", response_model=list[Project])
def list_projects(org_id: str = Depends(resolve_org)) -> list[Project]:
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM projects WHERE org_id = %s ORDER BY created_at DESC", (org_id,)
        )
        return [Project(**_stringify_ids(r)) for r in cur.fetchall()]


# --- runs ---
@app.post("/v1/runs", response_model=Run)
def create_run(body: RunCreate, org_id: str = Depends(resolve_org)) -> Run:
    with db.connection() as conn:
        project = _get_or_create_project(conn, org_id, body.project, None)
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO runs (org_id, project_id, display_name, config) "
                "VALUES (%s, %s, %s, %s) RETURNING *",
                (org_id, project["id"], body.name, json.dumps(body.config)),
            )
            return Run(**_stringify_ids(cur.fetchone()))


@app.get("/v1/projects/{slug}/runs", response_model=list[Run])
def list_runs(slug: str, org_id: str = Depends(resolve_org)) -> list[Run]:
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT r.* FROM runs r JOIN projects p ON p.id = r.project_id "
            "WHERE r.org_id = %s AND p.slug = %s ORDER BY r.created_at DESC",
            (org_id, slug),
        )
        return [Run(**_stringify_ids(r)) for r in cur.fetchall()]


@app.get("/v1/runs/{run_id}", response_model=Run)
def get_run(run_id: str, org_id: str = Depends(resolve_org)) -> Run:
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM runs WHERE org_id = %s AND id = %s", (org_id, run_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="run not found")
        return Run(**_stringify_ids(row))


@app.patch("/v1/runs/{run_id}", response_model=Run)
def update_run(run_id: str, body: RunUpdate, org_id: str = Depends(resolve_org)) -> Run:
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE runs SET state = %s, finished_at = now() "
            "WHERE org_id = %s AND id = %s RETURNING *",
            (body.state, org_id, run_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="run not found")
        return Run(**_stringify_ids(row))


# --- metrics (query, ClickHouse) ---
@app.get("/v1/runs/{run_id}/metric-names")
def run_metric_names(run_id: str, org_id: str = Depends(resolve_org)) -> dict:
    return {"run_id": run_id, "metrics": clickhouse.metric_names(org_id, run_id)}


@app.get("/v1/runs/{run_id}/metrics", response_model=MetricSeries)
def run_metrics(
    run_id: str, metric: str, org_id: str = Depends(resolve_org)
) -> MetricSeries:
    rows = clickhouse.metric_series(org_id, run_id, metric)
    points = [{"step": int(r["last_step"]), "value": float(r["value"])} for r in rows]
    return MetricSeries(run_id=run_id, metric=metric, points=points)


def _stringify_ids(row: dict) -> dict:
    """psycopg returns UUIDs/JSON natively; coerce for pydantic str fields."""
    out = dict(row)
    for k in ("id", "org_id", "project_id"):
        if k in out and out[k] is not None:
            out[k] = str(out[k])
    if "config" in out and isinstance(out["config"], str):
        out["config"] = json.loads(out["config"])
    return out
