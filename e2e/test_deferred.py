"""Roadmap criteria that are listed in the issue but intentionally NOT yet implemented.

These are kept as explicit, skipped placeholders so the suite documents the full §10 / issue scope
and the gate turns green automatically the moment the feature lands (delete the skip + flesh out the
assertion). They never fail the gate while the feature is a documented deferral.

See ARCHITECTURE.md §9 — "Remaining" under Phase 5.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.deferred


@pytest.mark.skip(reason="Storage tiering lifecycle (hot->ia->archive, warm-on-access, per-tenant "
                         "policy) is a Phase 5 deferral — not yet implemented (ARCHITECTURE.md §9).")
def test_storage_tiering_lifecycle():
    """When tiering lands: assert DB tier == S3 object tag, hot->ia->archive by policy,
    warm-on-access restores hot, per-tenant override re-tiers, and the sweep is idempotent."""


@pytest.mark.skip(reason="System-metrics (CPU/GPU) ingestion path lands with issue #10 — the "
                         "ClickHouse system_metrics table exists but nothing logs to it yet.")
def test_system_metrics_path():
    """When #10 lands: SDK system stats -> ingest -> ClickHouse system_metrics, read back via the
    API, co-located on the same shard as the run's product metrics."""
