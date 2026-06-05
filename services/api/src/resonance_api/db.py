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
    with pool().connection() as conn:
        conn.row_factory = dict_row
        yield conn


def close() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
