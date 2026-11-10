"""Storage lifecycle tiering sweep (Phase 5).

Non-destructive automation: each pass recomputes every asset's target tier from its **age since last
activity** (`max(last_accessed_at, created_at)`) against a **per-tenant policy** (platform defaults
otherwise) and reconciles two things:

  - the **DB** `storage_tier` (`hot` -> `ia` -> `archive`), the source of truth the UI/API read, and
  - an **S3 object tag** (`resonance-tier`) on the blob, so a real S3/GCS bucket lifecycle rule can
    transition the underlying storage class by tag — PB-scale cost economics are enforced by the
    object store, not by us proxying bytes.

Access **warms** an asset: the control API bumps `last_accessed_at` (and flips the DB tier back to
`hot`) when it mints a playback URL, so the next sweep re-tags the object to `hot`. Nothing is ever
deleted here — tiering only changes storage class/cost, never the content (retention/expiration is a
separate, deliberately-gated concern).

The worker runs as the Postgres superuser (RLS-bypass), so the sweep covers **every** tenant in one
pass. The transition logic is pure (`target_tier`/`policy_for`) and unit-tested; `sweep_once` takes
an S3 client + DB connection so it is testable with fakes.
"""

from __future__ import annotations

import os

TIERS = ("hot", "ia", "archive")

# Object-tag key the engine writes; S3/GCS bucket lifecycle rules filter transitions on it.
TAG_KEY = os.environ.get("LIFECYCLE_TAG_KEY", "resonance-tier")
BUCKET = os.environ.get("S3_BUCKET", "resonance-blobs")

ENABLED = os.environ.get("LIFECYCLE_ENABLED", "true").lower() == "true"
SWEEP_S = float(os.environ.get("LIFECYCLE_SWEEP_S", "300"))
# Platform default thresholds (days since last activity). Per-tenant orgs.lifecycle_policy overrides.
DEFAULT_IA_DAYS = float(os.environ.get("LIFECYCLE_IA_DAYS", "30"))
DEFAULT_ARCHIVE_DAYS = float(os.environ.get("LIFECYCLE_ARCHIVE_DAYS", "90"))


def policy_for(
    org_row: dict,
    ia_default: float = DEFAULT_IA_DAYS,
    archive_default: float = DEFAULT_ARCHIVE_DAYS,
) -> tuple[float, float]:
    """Resolve (ia_days, archive_days) for an org: its lifecycle_policy override, else defaults."""
    p = org_row.get("lifecycle_policy") or {}
    ia = float(p.get("ia_days", ia_default))
    archive = float(p.get("archive_days", archive_default))
    return ia, archive


def target_tier(age_days: float, ia_days: float, archive_days: float) -> str:
    """Tier an asset should live in given its age since last activity. Archive wins over IA."""
    if age_days >= archive_days:
        return "archive"
    if age_days >= ia_days:
        return "ia"
    return "hot"


def get_tier_tag(s3, key: str) -> str | None:
    """Current `resonance-tier` object tag, or None if untagged/absent."""
    try:
        tags = s3.get_object_tagging(Bucket=BUCKET, Key=key).get("TagSet", [])
    except Exception:
        return None
    for t in tags:
        if t.get("Key") == TAG_KEY:
            return t.get("Value")
    return None


def set_tier_tag(s3, key: str, tier: str) -> None:
    """Stamp the `resonance-tier` tag on the object (what real lifecycle rules transition on)."""
    s3.put_object_tagging(
        Bucket=BUCKET, Key=key, Tagging={"TagSet": [{"Key": TAG_KEY, "Value": tier}]}
    )


def sweep_once(s3, conn) -> dict:
    """One full pass over all assets. Updates the DB tier when it should change and reconciles the
    object tag to the target. Returns {'scanned','transitioned','retagged'}. Idempotent: a steady
    state does no writes."""
    stats = {"scanned": 0, "transitioned": 0, "retagged": 0}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT a.org_id, a.sha256, a.storage_key, a.storage_tier, "
            "       EXTRACT(EPOCH FROM now() - COALESCE(a.last_accessed_at, a.created_at)) "
            "         / 86400.0 AS age_days, "
            "       o.lifecycle_policy "
            "FROM assets a JOIN orgs o ON o.id = a.org_id"
        )
        rows = cur.fetchall()

    for row in rows:
        stats["scanned"] += 1
        ia_days, archive_days = policy_for(row)
        target = target_tier(float(row["age_days"]), ia_days, archive_days)

        if target != row["storage_tier"]:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE assets SET storage_tier = %s, tiered_at = now() "
                    "WHERE org_id = %s AND sha256 = %s",
                    (target, str(row["org_id"]), row["sha256"]),
                )
            stats["transitioned"] += 1

        # Reconcile the object tag toward the target (only writes when it differs).
        try:
            if get_tier_tag(s3, row["storage_key"]) != target:
                set_tier_tag(s3, row["storage_key"], target)
                stats["retagged"] += 1
        except Exception as exc:  # tagging is best-effort; DB tier stays the source of truth
            print(f"lifecycle: tag failed for {row['sha256'][:12]}: {exc!r}")

    return stats


def sweep_loop(stop, dsn: str) -> None:  # pragma: no cover - needs a live DB + object store
    """Periodic sweep on its own DB connection + S3 client until `stop` is set."""
    import psycopg
    from psycopg.rows import dict_row

    from .main import _s3  # deferred to avoid a circular import (main spawns this loop)

    s3 = _s3()
    print(f"lifecycle: sweeping every {SWEEP_S:.0f}s (ia>={DEFAULT_IA_DAYS}d, archive>={DEFAULT_ARCHIVE_DAYS}d)")
    with psycopg.connect(dsn, autocommit=True, row_factory=dict_row) as conn:
        while not stop.is_set():
            try:
                stats = sweep_once(s3, conn)
                if stats["transitioned"] or stats["retagged"]:
                    print(f"lifecycle sweep: {stats}")
            except Exception as exc:
                print(f"lifecycle sweep error: {exc!r}")
            stop.wait(SWEEP_S)
