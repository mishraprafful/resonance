"""Resonance control + query plane.

Serves projects/runs CRUD, run config, asset metadata, dataset manifests, and chart queries
(server-side downsampling) to the web UI. Phase 0 ships health + skeleton routes.
"""

from __future__ import annotations

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Resonance API", version="0.0.1")


class Health(BaseModel):
    status: str = "ok"
    service: str = "api"


@app.get("/healthz", response_model=Health)
def healthz() -> Health:
    return Health()


@app.get("/v1/projects")
def list_projects() -> dict:
    # Phase 1: query Postgres scoped by org_id from the auth context.
    return {"projects": [], "note": "stub"}


@app.get("/v1/runs/{run_id}/metrics")
def run_metrics(run_id: str, metric: str | None = None) -> dict:
    # Phase 1: query ClickHouse with server-side downsampling.
    return {"run_id": run_id, "metric": metric, "series": [], "note": "stub"}
