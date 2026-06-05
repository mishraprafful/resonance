"""Resonance control + query plane.

Projects/runs CRUD against Postgres, metric queries against ClickHouse (server-side downsampled).
Tenant-scoped by org_id on every query. Phase 1 (W&B-parity baseline).
"""

from __future__ import annotations

import json

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from . import clickhouse, db, storage
from .auth import resolve_org
from .models import (
    AssetPrepareRequest,
    AssetPrepareResponse,
    AudioLogCreate,
    AudioLogEntry,
    MetricSeries,
    Project,
    Run,
    RunCreate,
    RunUpdate,
)

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


# --- audio (first-class, content-addressed) ---
@app.post("/v1/assets/prepare", response_model=AssetPrepareResponse)
def prepare_asset(
    body: AssetPrepareRequest, org_id: str = Depends(resolve_org)
) -> AssetPrepareResponse:
    """Dedup check + presigned upload coordination. Returns no upload_url when content exists,
    so re-logging identical audio uploads zero bytes."""
    key = storage.blob_key(org_id, body.sha256)
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM assets WHERE org_id = %s AND sha256 = %s", (org_id, body.sha256)
        )
        if cur.fetchone() or storage.exists(key):
            return AssetPrepareResponse(exists=True, storage_key=key)
    return AssetPrepareResponse(
        exists=False, storage_key=key, upload_url=storage.presign_put(key, body.media_type)
    )


@app.post("/v1/audio", response_model=AudioLogEntry)
def log_audio(body: AudioLogCreate, org_id: str = Depends(resolve_org)) -> AudioLogEntry:
    """Register an uploaded asset (idempotent on org+sha) and a per-run audio log entry.
    A new asset is left with derived_at NULL so a worker picks it up for derivation."""

    def _upsert_asset(cur, sha: str, size: int) -> None:
        cur.execute(
            "INSERT INTO assets "
            "(org_id, sha256, media_type, size_bytes, storage_key, sample_rate) "
            "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (org_id, sha256) DO NOTHING",
            (org_id, sha, body.media_type, size, storage.blob_key(org_id, sha), body.sample_rate),
        )

    with db.connection() as conn:
        with conn.cursor() as cur:
            _upsert_asset(cur, body.asset_sha, body.size_bytes)
            # Register the reference too so it is tracked + derived (waveform/spectrogram for A/B).
            if body.reference_sha:
                _upsert_asset(cur, body.reference_sha, 0)
            cur.execute(
                "INSERT INTO audio_logs "
                "(org_id, run_id, key, step, asset_sha, reference_sha, caption) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
                (org_id, body.run_id, body.key, body.step, body.asset_sha,
                 body.reference_sha, body.caption),
            )
            audio_log_id = str(cur.fetchone()["id"])
    return AudioLogEntry(
        id=audio_log_id, key=body.key, step=body.step, caption=body.caption,
        asset_sha=body.asset_sha, reference_sha=body.reference_sha,
        sample_rate=body.sample_rate, duration_s=body.duration_s,
    )


@app.get("/v1/runs/{run_id}/audio", response_model=list[AudioLogEntry])
def list_audio(run_id: str, org_id: str = Depends(resolve_org)) -> list[AudioLogEntry]:
    """List a run's audio logs with presigned URLs for the audio, reference, and derivations."""
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT al.id, al.key, al.step, al.caption, al.asset_sha, al.reference_sha, "
            "       a.sample_rate, a.duration_s, a.derived_at, a.derivations "
            "FROM audio_logs al "
            "LEFT JOIN assets a ON a.org_id = al.org_id AND a.sha256 = al.asset_sha "
            "WHERE al.org_id = %s AND al.run_id = %s ORDER BY al.key, al.step",
            (org_id, run_id),
        )
        rows = cur.fetchall()
    out: list[AudioLogEntry] = []
    for r in rows:
        deriv = r.get("derivations") or {}
        out.append(
            AudioLogEntry(
                id=str(r["id"]), key=r["key"], step=r["step"], caption=r["caption"],
                asset_sha=r["asset_sha"], reference_sha=r["reference_sha"],
                sample_rate=r["sample_rate"], duration_s=r["duration_s"],
                derived=r["derived_at"] is not None,
                audio_url=storage.presign_get(storage.blob_key(org_id, r["asset_sha"])),
                reference_url=(
                    storage.presign_get(storage.blob_key(org_id, r["reference_sha"]))
                    if r["reference_sha"] else None
                ),
                peaks_url=storage.presign_get(deriv["peaks_key"]) if deriv.get("peaks_key") else None,
                spectrogram_url=(
                    storage.presign_get(deriv["spectrogram_key"])
                    if deriv.get("spectrogram_key") else None
                ),
            )
        )
    return out


def _stringify_ids(row: dict) -> dict:
    """psycopg returns UUIDs/JSON natively; coerce for pydantic str fields."""
    out = dict(row)
    for k in ("id", "org_id", "project_id"):
        if k in out and out[k] is not None:
            out[k] = str(out[k])
    if "config" in out and isinstance(out["config"], str):
        out["config"] = json.loads(out["config"])
    return out
