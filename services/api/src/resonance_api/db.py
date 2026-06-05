"""Postgres access (metadata plane) via a psycopg connection pool."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .settings import settings

_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(settings.postgres_dsn, min_size=1, max_size=10, open=True)
    return _pool


@contextmanager
def connection() -> Iterator:
    """Plain connection — used for auth/management tables (orgs, api_tokens, members) which are
    intentionally not under RLS so the auth bootstrap can run before any tenant is selected."""
    with pool().connection() as conn:
        conn.row_factory = dict_row
        yield conn


@contextmanager
def tenant_connection(org_id: str) -> Iterator:
    """Tenant-scoped connection: sets `app.current_org` for this transaction so Postgres RLS
    filters every row to this org (defense-in-depth atop the app-level WHERE org_id clauses)."""
    with pool().connection() as conn:
        conn.row_factory = dict_row
        with conn.cursor() as cur:
            cur.execute("SELECT set_config('app.current_org', %s, true)", (org_id,))
        yield conn


def close() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
