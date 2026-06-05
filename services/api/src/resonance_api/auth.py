"""Authentication + RBAC.

A request authenticates with a Bearer API token (`Authorization: Bearer rsn_...`). The token maps
to an org and a role. For local dev, when `dev_open` is set and no token is supplied, the request
falls back to the default org as an owner. Set RESONANCE_DEV_OPEN=false for the production posture
(tokens required).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException

from . import db, ratelimit
from .settings import settings

# Role hierarchy: higher number = more privilege.
ROLE_RANK = {"member": 1, "admin": 2, "owner": 3}


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class Principal:
    org_id: str
    role: str
    token_id: str | None = None  # None for the dev-open fallback

    def rank(self) -> int:
        return ROLE_RANK.get(self.role, 0)


def principal(authorization: str | None = Header(default=None)) -> Principal:
    """Resolve the calling principal (org + role) from the Bearer token, or the dev-open fallback."""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        with db.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE api_tokens SET last_used_at = now() WHERE token_hash = %s "
                "RETURNING id, org_id, role",
                (token_hash(token),),
            )
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="invalid api token")
        return Principal(org_id=str(row["org_id"]), role=row["role"], token_id=str(row["id"]))

    if settings.dev_open:
        with db.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM orgs WHERE slug = %s", (settings.default_org_slug,))
            row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="default org missing")
        return Principal(org_id=str(row["id"]), role="owner")

    raise HTTPException(status_code=401, detail="missing api token")


def resolve_org(p: Principal = Depends(principal)) -> str:
    """Tenant id for data endpoints, with a per-tenant rate-limit check applied here so every
    data path is covered in one place."""
    ratelimit.check(p.org_id)
    return p.org_id


def require_role(min_role: str):
    """Dependency factory gating an endpoint on a minimum org role."""
    needed = ROLE_RANK[min_role]

    def _dep(p: Principal = Depends(principal)) -> Principal:
        if p.rank() < needed:
            raise HTTPException(
                status_code=403, detail=f"requires role >= {min_role} (have {p.role})"
            )
        return p

    return _dep
