"""Resonance control + query plane.

Projects/runs CRUD against Postgres, metric queries against ClickHouse (server-side downsampled).
Tenant-scoped by org_id on every query. Phase 1 (W&B-parity baseline).
"""

from __future__ import annotations

import json
import re
import secrets

from fastapi import Depends, FastAPI, HTTPException, Response
from pydantic import BaseModel

from . import auth_routes, clickhouse, db, media, queue, storage
from .auth import Principal, principal, require_role, resolve_org, token_hash
from .models import (
    AssetPrepareRequest,
    AssetPrepareResponse,
    AudioLogCreate,
    AudioLogEntry,
    AudioPage,
    Dataset,
    DatasetCreate,
    DatasetDetail,
    Member,
    MemberCreate,
    MetricSeries,
    Org,
    OrgCreate,
    OrgCreated,
    PresignResponse,
    Project,
    ProjectCreate,
    Rating,
    RatingCreate,
    Run,
    RunCreate,
    RunUpdate,
    TokenCreate,
    TokenCreated,
    TokenInfo,
)
from .settings import settings

app = FastAPI(title="Resonance API", version="0.1.0")
app.include_router(auth_routes.router)


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
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM projects WHERE org_id = %s ORDER BY created_at DESC", (org_id,)
        )
        return [Project(**_stringify_ids(r)) for r in cur.fetchall()]


@app.post("/v1/projects", response_model=Project, status_code=201)
def create_project(
    body: ProjectCreate,
    org_id: str = Depends(resolve_org),
    _: Principal = Depends(require_role("member")),
) -> Project:
    """Create a project in the active tenant. Runs still create projects on demand at log time;
    this lets the UI create an empty project up front (e.g. a freshly created team)."""
    # URL-safe slug (matches the web client's slugify): lowercase, non-alphanumerics -> '-', trimmed.
    slug = re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", body.slug.strip().lower())).strip("-")
    if not slug:
        raise HTTPException(status_code=422, detail="slug is required")
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM projects WHERE org_id = %s AND slug = %s", (org_id, slug)
        )
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="a project with that slug already exists")
        cur.execute(
            "INSERT INTO projects (org_id, slug, name) VALUES (%s, %s, %s) RETURNING *",
            (org_id, slug, body.name or slug),
        )
        return Project(**_stringify_ids(cur.fetchone()))


@app.delete("/v1/projects/{slug}", status_code=204)
def delete_project(
    slug: str,
    org_id: str = Depends(resolve_org),
    _: Principal = Depends(require_role("admin")),
) -> Response:
    """Permanently delete a project and everything under it (runs, audio logs, dataset versions
    cascade via FKs). Content-addressed assets are org-level/deduped and are intentionally left in
    place; ClickHouse metric rows for the deleted runs are orphaned (swept by retention TTL)."""
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM projects WHERE org_id = %s AND slug = %s RETURNING id", (org_id, slug)
        )
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="project not found")
    return Response(status_code=204)


# --- runs ---
@app.post("/v1/runs", response_model=Run)
def create_run(body: RunCreate, org_id: str = Depends(resolve_org)) -> Run:
    with db.tenant_connection(org_id) as conn:
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
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT r.* FROM runs r JOIN projects p ON p.id = r.project_id "
            "WHERE r.org_id = %s AND p.slug = %s ORDER BY r.created_at DESC",
            (org_id, slug),
        )
        return [Run(**_stringify_ids(r)) for r in cur.fetchall()]


@app.get("/v1/runs/{run_id}", response_model=Run)
def get_run(run_id: str, org_id: str = Depends(resolve_org)) -> Run:
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM runs WHERE org_id = %s AND id = %s", (org_id, run_id))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="run not found")
        return Run(**_stringify_ids(row))


@app.patch("/v1/runs/{run_id}", response_model=Run)
def update_run(run_id: str, body: RunUpdate, org_id: str = Depends(resolve_org)) -> Run:
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
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
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM assets WHERE org_id = %s AND sha256 = %s", (org_id, body.sha256)
        )
        if cur.fetchone() or storage.exists(key):
            return AssetPrepareResponse(exists=True, storage_key=key)  # dedup: already stored
        # Enforce the tenant storage quota before issuing an upload URL.
        cur.execute("SELECT storage_quota_bytes FROM orgs WHERE id = %s", (org_id,))
        quota = cur.fetchone()["storage_quota_bytes"]
        if quota is not None:
            cur.execute("SELECT COALESCE(SUM(size_bytes), 0) AS used FROM assets WHERE org_id = %s", (org_id,))
            used = cur.fetchone()["used"]
            if used + body.size_bytes > quota:
                raise HTTPException(
                    status_code=413,
                    detail=f"storage quota exceeded ({used}+{body.size_bytes} > {quota} bytes)",
                )
    return AssetPrepareResponse(
        exists=False, storage_key=key, upload_url=storage.presign_put(key, body.media_type)
    )


@app.post("/v1/audio", response_model=AudioLogEntry)
def log_audio(body: AudioLogCreate, org_id: str = Depends(resolve_org)) -> AudioLogEntry:
    """Register an uploaded asset (idempotent on org+sha) and a per-run audio log entry.
    A new asset is left with derived_at NULL so a worker picks it up for derivation."""

    new_assets: list[tuple[str, str]] = []  # (sha, storage_key) newly inserted this request

    def _upsert_asset(cur, sha: str, size: int) -> None:
        key = storage.blob_key(org_id, sha)
        cur.execute(
            "INSERT INTO assets "
            "(org_id, sha256, media_type, size_bytes, storage_key, sample_rate) "
            "VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (org_id, sha256) DO NOTHING",
            (org_id, sha, body.media_type, size, key, body.sample_rate),
        )
        if cur.rowcount:  # a fresh asset (not a dedup hit) needs derivation
            new_assets.append((sha, key))

    with db.tenant_connection(org_id) as conn:
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

    # Event-driven derivation: enqueue the new assets so workers process on queue depth. Best-effort
    # — the asset rows are already persisted with derived_at NULL, so the worker's poll backstop
    # derives them even if the queue is down or unconfigured. Published after commit so a consumer
    # never races ahead of the committed row.
    for sha, key in new_assets:
        queue.publish_derivation(org_id, sha, key)
    return AudioLogEntry(
        id=audio_log_id, key=body.key, step=body.step, caption=body.caption,
        asset_sha=body.asset_sha, reference_sha=body.reference_sha,
        sample_rate=body.sample_rate, duration_s=body.duration_s,
    )


@app.get("/v1/runs/{run_id}/audio/keys")
def list_audio_keys(run_id: str, org_id: str = Depends(resolve_org)) -> dict:
    """Distinct audio keys for a run (so the UI can browse per key without scanning everything)."""
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
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

    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
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


def _resolve_asset_key(org_id: str, sha: str, kind: str) -> str:
    """Map (asset, kind) -> object-store key. `original` is the exact uploaded bytes; peaks/
    spectrogram come from the worker's recorded derivation keys."""
    if kind == "original":
        return storage.blob_key(org_id, sha)
    if kind in ("peaks", "spectrogram"):
        with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT derivations FROM assets WHERE org_id = %s AND sha256 = %s", (org_id, sha)
            )
            row = cur.fetchone()
        key = ((row or {}).get("derivations") or {}).get(f"{kind}_key")
        if not key:
            raise HTTPException(status_code=404, detail=f"{kind} not available for asset")
        return key
    raise HTTPException(status_code=400, detail="kind must be original|peaks|spectrogram")


@app.get("/v1/assets/{sha}/url", response_model=PresignResponse)
def presign_asset(
    sha: str, kind: str = "original", org_id: str = Depends(resolve_org)
) -> PresignResponse:
    """Mint a (Redis-cached) presigned GET URL on demand. `original` always serves the exact
    uploaded bytes — comparison plays original quality, never a lossy rendition."""
    key = _resolve_asset_key(org_id, sha, kind)
    return PresignResponse(sha256=sha, kind=kind, url=storage.presign_get(key))


@app.get("/v1/assets/{sha}/stream-url", response_model=PresignResponse)
def stream_asset(
    sha: str, kind: str = "original", org_id: str = Depends(resolve_org)
) -> PresignResponse:
    """Auth-scoped streaming URL for range playback. When the media gateway is configured the URL
    points at it (HMAC-signed, CDN-cacheable, bytes never transit this control plane); otherwise it
    falls back to a direct presigned object-store GET so playback works with no gateway running.
    Always serves the ORIGINAL quality on the compare path — never a lossy rendition (§7b)."""
    key = _resolve_asset_key(org_id, sha, kind)
    url = media.stream_url(key) if media.enabled() else storage.presign_get(key)
    return PresignResponse(sha256=sha, kind=kind, url=url)


# --- listening-test ratings (A/B compare) ---
@app.post("/v1/ratings", response_model=Rating)
def create_rating(body: RatingCreate, org_id: str = Depends(resolve_org)) -> Rating:
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO ratings (org_id, test_id, asset_sha, run_id, label, score, blind) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
            (org_id, body.test_id, body.asset_sha, body.run_id, body.label, body.score, body.blind),
        )
        return Rating(**_rating_row(cur.fetchone()))


@app.get("/v1/ratings", response_model=list[Rating])
def list_ratings(test_id: str, org_id: str = Depends(resolve_org)) -> list[Rating]:
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT * FROM ratings WHERE org_id = %s AND test_id = %s ORDER BY created_at",
            (org_id, test_id),
        )
        return [Rating(**_rating_row(r)) for r in cur.fetchall()]


# --- dataset versioning ---
@app.post("/v1/datasets", response_model=Dataset)
def create_dataset(body: DatasetCreate, org_id: str = Depends(resolve_org)) -> Dataset:
    """Register a content-addressed dataset version (idempotent on org+name+version)."""
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
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
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id, name, version, project_id, created_at, "
            "       jsonb_array_length(manifest) AS item_count "
            "FROM dataset_versions WHERE org_id = %s ORDER BY created_at DESC",
            (org_id,),
        )
        return [Dataset(**_dataset_row(r)) for r in cur.fetchall()]


@app.get("/v1/datasets/{dataset_id}", response_model=DatasetDetail)
def get_dataset(dataset_id: str, org_id: str = Depends(resolve_org)) -> DatasetDetail:
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
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


# --- multi-tenancy: orgs, tokens, members (auth tables; not under RLS) ---
def _new_token() -> tuple[str, str, str]:
    """Return (secret, sha256, display_prefix). The secret is shown to the caller exactly once."""
    secret = "rsn_" + secrets.token_urlsafe(24)
    return secret, token_hash(secret), secret[:12]


def _require_org_admin(p: Principal, org_id: str) -> None:
    if p.org_id != org_id or p.rank() < 2:  # admin
        raise HTTPException(status_code=403, detail="requires admin on this org")


@app.post("/v1/orgs", response_model=OrgCreated)
def create_org(body: OrgCreate, p: Principal = Depends(principal)) -> OrgCreated:
    """Provision a tenant and return a bootstrap owner token (shown once). Self-hosted bootstrap op;
    gate behind a platform admin in production."""
    secret, h, prefix = _new_token()
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT 1 FROM orgs WHERE slug = %s", (body.slug,))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="org slug already exists")
        cur.execute(
            "INSERT INTO orgs (slug, name, storage_quota_bytes) VALUES (%s,%s,%s) RETURNING *",
            (body.slug, body.name or body.slug, body.storage_quota_bytes),
        )
        org = cur.fetchone()
        cur.execute(
            "INSERT INTO api_tokens (org_id, name, token_hash, prefix, role) "
            "VALUES (%s,%s,%s,%s,'owner')",
            (org["id"], "owner", h, prefix),
        )
    return OrgCreated(**_org_row(org), owner_token=secret)


@app.get("/v1/org", response_model=Org)
def current_org(org_id: str = Depends(resolve_org)) -> Org:
    with db.tenant_connection(org_id) as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM orgs WHERE id = %s", (org_id,))
        org = cur.fetchone()
        cur.execute("SELECT COALESCE(SUM(size_bytes),0) AS used FROM assets WHERE org_id = %s", (org_id,))
        used = cur.fetchone()["used"]
    return Org(**_org_row(org), storage_used_bytes=used)


@app.post("/v1/orgs/{org_id}/tokens", response_model=TokenCreated)
def create_token(org_id: str, body: TokenCreate, p: Principal = Depends(principal)) -> TokenCreated:
    _require_org_admin(p, org_id)
    if body.role not in ("owner", "admin", "member"):
        raise HTTPException(status_code=400, detail="invalid role")
    secret, h, prefix = _new_token()
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO api_tokens (org_id, name, token_hash, prefix, role) "
            "VALUES (%s,%s,%s,%s,%s) RETURNING *",
            (org_id, body.name, h, prefix, body.role),
        )
        return TokenCreated(**_token_row(cur.fetchone()), token=secret)


@app.get("/v1/orgs/{org_id}/tokens", response_model=list[TokenInfo])
def list_tokens(org_id: str, p: Principal = Depends(principal)) -> list[TokenInfo]:
    _require_org_admin(p, org_id)
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM api_tokens WHERE org_id = %s ORDER BY created_at", (org_id,))
        return [TokenInfo(**_token_row(r)) for r in cur.fetchall()]


@app.delete("/v1/orgs/{org_id}/tokens/{token_id}")
def revoke_token(org_id: str, token_id: str, p: Principal = Depends(principal)) -> dict:
    _require_org_admin(p, org_id)
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM api_tokens WHERE org_id = %s AND id = %s", (org_id, token_id))
        return {"revoked": cur.rowcount}


@app.get("/v1/orgs/{org_id}/members", response_model=list[Member])
def list_members(org_id: str, p: Principal = Depends(principal)) -> list[Member]:
    if p.org_id != org_id:
        raise HTTPException(status_code=403, detail="not a member of this org")
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT m.user_id, u.email, m.role FROM org_members m "
            "JOIN users u ON u.id = m.user_id WHERE m.org_id = %s ORDER BY u.email",
            (org_id,),
        )
        return [Member(user_id=str(r["user_id"]), email=r["email"], role=r["role"]) for r in cur.fetchall()]


@app.post("/v1/orgs/{org_id}/members", response_model=Member)
def add_member(org_id: str, body: MemberCreate, p: Principal = Depends(principal)) -> Member:
    _require_org_admin(p, org_id)
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO users (email) VALUES (%s) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id",
            (body.email,),
        )
        user_id = cur.fetchone()["id"]
        cur.execute(
            "INSERT INTO org_members (org_id, user_id, role) VALUES (%s,%s,%s) "
            "ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role",
            (org_id, user_id, body.role),
        )
    return Member(user_id=str(user_id), email=body.email, role=body.role)


def _org_row(r: dict) -> dict:
    return {
        "id": str(r["id"]), "slug": r["slug"], "name": r["name"],
        "storage_quota_bytes": r["storage_quota_bytes"], "created_at": r["created_at"],
    }


def _token_row(r: dict) -> dict:
    return {
        "id": str(r["id"]), "name": r["name"], "role": r["role"], "prefix": r["prefix"],
        "last_used_at": r["last_used_at"], "created_at": r["created_at"],
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
