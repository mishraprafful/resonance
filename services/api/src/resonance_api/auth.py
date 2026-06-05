"""Tenant resolution.

Phase 1: resolve the org from a Bearer API token (sha256 of the token vs api_tokens.token_hash);
if no token is supplied, fall back to the seeded default org so local dev works out of the box.
Full RBAC + SSO arrives in Phase 4.
"""

from __future__ import annotations

import hashlib

from fastapi import Header, HTTPException

from . import db
from .settings import settings


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def resolve_org(authorization: str | None = Header(default=None)) -> str:
    """Return the org_id for the request. Raises 401 on an invalid token."""
    with db.connection() as conn, conn.cursor() as cur:
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1].strip()
            cur.execute(
                "SELECT org_id FROM api_tokens WHERE token_hash = %s", (token_hash(token),)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=401, detail="invalid api token")
            return str(row["org_id"])

        cur.execute("SELECT id FROM orgs WHERE slug = %s", (settings.default_org_slug,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="default org missing")
        return str(row["id"])
