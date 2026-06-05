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
    AudioPage,
    Dataset,
    DatasetCreate,
    DatasetDetail,
    MetricSeries,
    PresignResponse,
    Project,
    Rating,
    RatingCreate,
    Run,
    RunCreate,
    RunUpdate,
)
from .settings import settings

app = FastAPI(title="Resonance API", version="0.1.0")


class Health(BaseModel):
    status: str = "ok"
    service: str = "api"


@app.get("/healthz", response_model=Health)
def healthz() -> Health:
    return Health()


@app.on_event("startup")
def _startup() -> None:
    # Idempotent dev migration so a running stack (which won't re-run init.sql) has new tables.
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "CREATE TABLE IF NOT EXISTS ratings ("
            " id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
            " org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,"
            " test_id TEXT NOT NULL, asset_sha TEXT NOT NULL, run_id UUID, label TEXT,"
            " score INT NOT NULL, blind BOOLEAN NOT NULL DEFAULT FALSE,"
            " created_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        )
        cur.execute("CREATE INDEX IF NOT EXISTS ratings_test_idx ON ratings (org_id, test_id)")


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


@app.get("/v1/runs/{run_id}/audio/keys")
def list_audio_keys(run_id: str, org_id: str = Depends(resolve_org)) -> dict:
    """Distinct audio keys for a run (so the UI can browse per key without scanning everything)."""
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT key FROM audio_logs WHERE org_id = %s AND run_id = %s ORDER BY key",
            (org_id, run_id),
        )
        return {"run_id": run_id, "keys": [r["key"] for r in cur.fetchall()]}


@app.get("/v1/runs/{run_id}/audio", response_model=AudioPage)
def list_audio(
    run_id: str,
    key: str | None = None,
    limit: int | None = None,
    cursor: str | None = None,
    org_id: str = Depends(resolve_org),
) -> AudioPage:
    """Paginated audio logs (keyset on step,id). No presigned URLs — the UI mints those lazily via
    /v1/assets/{sha}/url, so listing 1000s of clips never signs thousands of URLs up front."""
    limit = max(1, min(limit or settings.audio_page_size, 500))
    where = ["al.org_id = %s", "al.run_id = %s"]
    params: list = [org_id, run_id]
    if key is not None:
        where.append("al.key = %s")
        params.append(key)
    if cursor:  # keyset: cursor = "<step>|<id>"
        c_step, c_id = cursor.split("|", 1)
        where.append("(al.step, al.id) > (%s, %s)")
        params += [int(c_step), c_id]
    params.append(limit + 1)  # fetch one extra to detect a next page

    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT al.id, al.key, al.step, al.caption, al.asset_sha, al.reference_sha, "
            "       a.sample_rate, a.duration_s, a.derived_at, a.derivations "
            "FROM audio_logs al "
            "LEFT JOIN assets a ON a.org_id = al.org_id AND a.sha256 = al.asset_sha "
            f"WHERE {' AND '.join(where)} ORDER BY al.step, al.id LIMIT %s",
            params,
        )
        rows = cur.fetchall()

    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = f"{last['step']}|{last['id']}"
        rows = rows[:limit]
    items = []
    for r in rows:
        deriv = r.get("derivations") or {}
        items.append(
            AudioLogEntry(
                id=str(r["id"]), key=r["key"], step=r["step"], caption=r["caption"],
                asset_sha=r["asset_sha"], reference_sha=r["reference_sha"],
                sample_rate=r["sample_rate"], duration_s=r["duration_s"],
                derived=r["derived_at"] is not None,
                has_peaks=bool(deriv.get("peaks_key")),
                has_spectrogram=bool(deriv.get("spectrogram_key")),
            )
        )
    return AudioPage(items=items, next_cursor=next_cursor)


@app.get("/v1/assets/{sha}/url", response_model=PresignResponse)
def presign_asset(
    sha: str, kind: str = "original", org_id: str = Depends(resolve_org)
) -> PresignResponse:
    """Mint a (Redis-cached) presigned GET URL on demand. `original` always serves the exact
    uploaded bytes — comparison plays original quality, never a lossy rendition."""
    if kind == "original":
        key = storage.blob_key(org_id, sha)
    elif kind in ("peaks", "spectrogram"):
        with db.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT derivations FROM assets WHERE org_id = %s AND sha256 = %s", (org_id, sha)
            )
            row = cur.fetchone()
        deriv = (row or {}).get("derivations") or {}
        key = deriv.get(f"{kind}_key")
        if not key:
            raise HTTPException(status_code=404, detail=f"{kind} not available for asset")
    else:
        raise HTTPException(status_code=400, detail="kind must be original|peaks|spectrogram")
    return PresignResponse(sha256=sha, kind=kind, url=storage.presign_get(key))


# --- listening-test ratings (A/B compare) ---
@app.post("/v1/ratings", response_model=Rating)
def create_rating(body: RatingCreate, org_id: str = Depends(resolve_org)) -> Rating:
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ratings (org_id, test_id, asset_sha, run_id, label, score, blind) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
            (org_id, body.test_id, body.asset_sha, body.run_id, body.label, body.score, body.blind),
        )
        return Rating(**_rating_row(cur.fetchone()))


@app.get("/v1/ratings", response_model=list[Rating])
def list_ratings(test_id: str, org_id: str = Depends(resolve_org)) -> list[Rating]:
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM ratings WHERE org_id = %s AND test_id = %s ORDER BY created_at",
            (org_id, test_id),
        )
        return [Rating(**_rating_row(r)) for r in cur.fetchall()]


# --- dataset versioning ---
@app.post("/v1/datasets", response_model=Dataset)
def create_dataset(body: DatasetCreate, org_id: str = Depends(resolve_org)) -> Dataset:
    """Register a content-addressed dataset version (idempotent on org+name+version)."""
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO dataset_versions (org_id, project_id, name, version, manifest) "
            "VALUES (%s,%s,%s,%s,%s) ON CONFLICT (org_id, name, version) DO NOTHING",
            (org_id, body.project_id, body.name, body.version, json.dumps(body.manifest)),
        )
        cur.execute(
            "SELECT id, name, version, project_id, created_at, "
            "       jsonb_array_length(manifest) AS item_count "
            "FROM dataset_versions WHERE org_id = %s AND name = %s AND version = %s",
            (org_id, body.name, body.version),
        )
        return Dataset(**_dataset_row(cur.fetchone()))


@app.get("/v1/datasets", response_model=list[Dataset])
def list_datasets(org_id: str = Depends(resolve_org)) -> list[Dataset]:
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, version, project_id, created_at, "
            "       jsonb_array_length(manifest) AS item_count "
            "FROM dataset_versions WHERE org_id = %s ORDER BY created_at DESC",
            (org_id,),
        )
        return [Dataset(**_dataset_row(r)) for r in cur.fetchall()]


@app.get("/v1/datasets/{dataset_id}", response_model=DatasetDetail)
def get_dataset(dataset_id: str, org_id: str = Depends(resolve_org)) -> DatasetDetail:
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, version, project_id, created_at, manifest, "
            "       jsonb_array_length(manifest) AS item_count "
            "FROM dataset_versions WHERE org_id = %s AND id = %s",
            (org_id, dataset_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="dataset not found")
        data = _dataset_row(row)
        data["items"] = row["manifest"] or []
        return DatasetDetail(**data)


def _dataset_row(r: dict) -> dict:
    return {
        "id": str(r["id"]), "name": r["name"], "version": r["version"],
        "project_id": str(r["project_id"]) if r["project_id"] else None,
        "item_count": r["item_count"] or 0, "created_at": r["created_at"],
    }


def _rating_row(r: dict) -> dict:
    return {
        "id": str(r["id"]), "test_id": r["test_id"], "asset_sha": r["asset_sha"],
        "run_id": str(r["run_id"]) if r["run_id"] else None,
        "label": r["label"], "score": r["score"], "blind": r["blind"],
    }


def _stringify_ids(row: dict) -> dict:
    """psycopg returns UUIDs/JSON natively; coerce for pydantic str fields."""
    out = dict(row)
    for k in ("id", "org_id", "project_id"):
        if k in out and out[k] is not None:
            out[k] = str(out[k])
    if "config" in out and isinstance(out["config"], str):
        out["config"] = json.loads(out["config"])
    return out
