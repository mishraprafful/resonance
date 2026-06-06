"""Authentication + RBAC.

A request authenticates with a Bearer API token (`Authorization: Bearer rsn_...`). The token maps
to an org and a role. For local dev, when `dev_open` is set and no token is supplied, the request
falls back to the default org as an owner. Set RESONANCE_DEV_OPEN=false for the production posture
(tokens required).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from fastapi import Cookie, Depends, Header, HTTPException

from . import accounts, db, ratelimit
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


def principal(
    authorization: str | None = Header(default=None),
    session: str | None = Cookie(default=None, alias=accounts.COOKIE_NAME),
) -> Principal:
    """Resolve the calling principal (org + role) from, in order: a Bearer API token (SDK/CI), a
    browser session cookie (its current team + the user's role there), or the dev-open fallback."""
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

    sess = accounts.read_session(session)
    if sess:
        org = sess.get("current_org")
        if not org:
            raise HTTPException(status_code=403, detail="no active team — create or join one")
        with db.connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT role FROM org_members WHERE user_id = %s AND org_id = %s",
                (sess["user_id"], org),
            )
            row = cur.fetchone()
            if not row:
                # Platform admins (is_admin) implicitly have owner access to every team.
                cur.execute("SELECT is_admin FROM users WHERE id = %s", (sess["user_id"],))
                urow = cur.fetchone()
                if not (urow and urow["is_admin"]):
                    raise HTTPException(status_code=403, detail="not a member of the active team")
                return Principal(org_id=str(org), role="owner")
        return Principal(org_id=str(org), role=row["role"])

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
