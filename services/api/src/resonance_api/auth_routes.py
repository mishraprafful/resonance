"""Account + session HTTP routes: first-run admin bootstrap, signup (create/join team), login,
logout, me, team switching, team creation, and join-request approval.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Response

from . import accounts, db
from .accounts import CurrentUser, current_user
from .models import Credentials, SignupRequest, SwitchTeam, TeamCreate

router = APIRouter()


def _slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", s.lower()).strip("-") or "team"


def _require_credentials(username: str, password: str) -> None:
    """Reject empty/whitespace usernames and empty passwords (account-creation paths)."""
    if not username or not username.strip():
        raise HTTPException(status_code=400, detail="username is required")
    if not password:
        raise HTTPException(status_code=400, detail="password must not be empty")


def _set_cookie(resp: Response, token: str) -> None:
    resp.set_cookie(
        accounts.COOKIE_NAME, token, max_age=accounts.SESSION_TTL_S,
        httponly=True, samesite="lax",
    )


def _memberships(cur, user_id: str) -> list[dict]:
    cur.execute(
        "SELECT o.id, o.slug, o.name, m.role FROM org_members m "
        "JOIN orgs o ON o.id = m.org_id WHERE m.user_id = %s ORDER BY o.name",
        (user_id,),
    )
    return [
        {"org_id": str(r["id"]), "slug": r["slug"], "name": r["name"], "role": r["role"]}
        for r in cur.fetchall()
    ]


def _role_in_org(cur, user_id: str, org_id: str) -> str | None:
    cur.execute(
        "SELECT role FROM org_members WHERE user_id = %s AND org_id = %s", (user_id, org_id)
    )
    row = cur.fetchone()
    return row["role"] if row else None


def _is_platform_admin(cur, user_id: str) -> bool:
    cur.execute("SELECT is_admin FROM users WHERE id = %s", (user_id,))
    row = cur.fetchone()
    return bool(row and row["is_admin"])


# --- bootstrap (first run) ---
@router.get("/v1/auth/bootstrap-status")
def bootstrap_status() -> dict:
    with db.connection() as c, c.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM users")
        return {"needs_bootstrap": cur.fetchone()["n"] == 0}


@router.post("/v1/auth/bootstrap")
def bootstrap(body: Credentials, response: Response) -> dict:
    _require_credentials(body.username, body.password)
    with db.connection() as c, c.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM users")
        if cur.fetchone()["n"] > 0:
            raise HTTPException(status_code=409, detail="already initialized")
        cur.execute("INSERT INTO orgs (slug, name) VALUES ('dev','Dev Org') ON CONFLICT (slug) DO NOTHING")
        cur.execute("SELECT id FROM orgs WHERE slug = 'dev'")
        org_id = str(cur.fetchone()["id"])
        cur.execute(
            "INSERT INTO users (username, password_hash, is_admin) VALUES (%s,%s,true) RETURNING id",
            (body.username, accounts.hash_password(body.password)),
        )
        user_id = str(cur.fetchone()["id"])
        cur.execute(
            "INSERT INTO org_members (org_id, user_id, role) VALUES (%s,%s,'owner') "
            "ON CONFLICT DO NOTHING",
            (org_id, user_id),
        )
    token = accounts.create_session(user_id, org_id)
    _set_cookie(response, token)
    return {"username": body.username, "is_admin": True, "current_org": org_id}


# --- signup / login / logout ---
@router.post("/v1/auth/signup")
def signup(body: SignupRequest, response: Response) -> dict:
    _require_credentials(body.username, body.password)
    with db.connection() as c, c.cursor() as cur:
        cur.execute("SELECT 1 FROM users WHERE username = %s", (body.username,))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="username taken")
        cur.execute(
            "INSERT INTO users (username, password_hash) VALUES (%s,%s) RETURNING id",
            (body.username, accounts.hash_password(body.password)),
        )
        user_id = str(cur.fetchone()["id"])
        current_org: str | None = None

        if body.team_mode == "create":
            slug = _slugify(body.team_slug or body.team_name or body.username + "-team")
            cur.execute("SELECT 1 FROM orgs WHERE slug = %s", (slug,))
            if cur.fetchone():
                raise HTTPException(status_code=409, detail="team slug already exists")
            cur.execute(
                "INSERT INTO orgs (slug, name) VALUES (%s,%s) RETURNING id",
                (slug, body.team_name or slug),
            )
            current_org = str(cur.fetchone()["id"])
            cur.execute(
                "INSERT INTO org_members (org_id, user_id, role) VALUES (%s,%s,'owner')",
                (current_org, user_id),
            )
        elif body.team_mode == "join":
            cur.execute("SELECT id FROM orgs WHERE slug = %s", (body.team_slug,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="team not found")
            cur.execute(
                "INSERT INTO membership_requests (user_id, org_id) VALUES (%s,%s) "
                "ON CONFLICT (user_id, org_id) DO NOTHING",
                (user_id, str(row["id"])),
            )
        else:
            raise HTTPException(status_code=400, detail="team_mode must be create|join")

    token = accounts.create_session(user_id, current_org)
    _set_cookie(response, token)
    return {"username": body.username, "current_org": current_org,
            "pending": body.team_mode == "join"}


@router.post("/v1/auth/login")
def login(body: Credentials, response: Response) -> dict:
    with db.connection() as c, c.cursor() as cur:
        cur.execute(
            "SELECT id, password_hash FROM users WHERE username = %s", (body.username,)
        )
        row = cur.fetchone()
        if not row or not accounts.verify_password(body.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="invalid username or password")
        user_id = str(row["id"])
        teams = _memberships(cur, user_id)
    current_org = teams[0]["org_id"] if teams else None
    token = accounts.create_session(user_id, current_org)
    _set_cookie(response, token)
    return {"username": body.username, "current_org": current_org}


@router.post("/v1/auth/logout")
def logout(response: Response, u: CurrentUser = Depends(current_user)) -> dict:
    accounts.delete_session(u.token)
    response.delete_cookie(accounts.COOKIE_NAME)
    return {"ok": True}


@router.get("/v1/auth/me")
def me(u: CurrentUser = Depends(current_user)) -> dict:
    with db.connection() as c, c.cursor() as cur:
        cur.execute("SELECT username, is_admin FROM users WHERE id = %s", (u.user_id,))
        urow = cur.fetchone()
        if not urow:
            raise HTTPException(status_code=401, detail="user not found")
        teams = _memberships(cur, u.user_id)
        cur.execute(
            "SELECT o.slug, r.status FROM membership_requests r JOIN orgs o ON o.id = r.org_id "
            "WHERE r.user_id = %s AND r.status = 'pending'",
            (u.user_id,),
        )
        pending = [{"slug": r["slug"], "status": r["status"]} for r in cur.fetchall()]
    current = u.current_org or (teams[0]["org_id"] if teams else None)
    return {
        "username": urow["username"], "is_admin": urow["is_admin"],
        "current_org": current, "teams": teams, "pending_requests": pending,
    }


@router.post("/v1/auth/switch-team")
def switch_team(body: SwitchTeam, u: CurrentUser = Depends(current_user)) -> dict:
    with db.connection() as c, c.cursor() as cur:
        if not _role_in_org(cur, u.user_id, body.org_id):
            raise HTTPException(status_code=403, detail="not a member of that team")
    accounts.update_session(u.token, current_org=body.org_id)
    return {"current_org": body.org_id}


# --- teams + join requests ---
@router.get("/v1/teams")
def list_teams() -> dict:
    """Public list of teams (so the signup page can offer 'join existing')."""
    with db.connection() as c, c.cursor() as cur:
        cur.execute("SELECT id, slug, name FROM orgs ORDER BY name")
        return {"teams": [{"id": str(r["id"]), "slug": r["slug"], "name": r["name"]}
                          for r in cur.fetchall()]}


@router.post("/v1/teams")
def create_team(body: TeamCreate, u: CurrentUser = Depends(current_user)) -> dict:
    slug = _slugify(body.slug)
    with db.connection() as c, c.cursor() as cur:
        cur.execute("SELECT 1 FROM orgs WHERE slug = %s", (slug,))
        if cur.fetchone():
            raise HTTPException(status_code=409, detail="team slug already exists")
        cur.execute("INSERT INTO orgs (slug, name) VALUES (%s,%s) RETURNING id",
                    (slug, body.name or slug))
        org_id = str(cur.fetchone()["id"])
        cur.execute("INSERT INTO org_members (org_id, user_id, role) VALUES (%s,%s,'owner')",
                    (org_id, u.user_id))
    accounts.update_session(u.token, current_org=org_id)
    return {"org_id": org_id, "slug": slug}


@router.post("/v1/teams/{org_id}/join-request")
def request_join(org_id: str, u: CurrentUser = Depends(current_user)) -> dict:
    with db.connection() as c, c.cursor() as cur:
        if _role_in_org(cur, u.user_id, org_id):
            raise HTTPException(status_code=409, detail="already a member")
        cur.execute(
            "INSERT INTO membership_requests (user_id, org_id) VALUES (%s,%s) "
            "ON CONFLICT (user_id, org_id) DO UPDATE SET status='pending', decided_at=NULL "
            "RETURNING id",
            (u.user_id, org_id),
        )
        return {"request_id": str(cur.fetchone()["id"]), "status": "pending"}


@router.get("/v1/teams/{org_id}/requests")
def list_requests(org_id: str, u: CurrentUser = Depends(current_user)) -> dict:
    with db.connection() as c, c.cursor() as cur:
        role = _role_in_org(cur, u.user_id, org_id)
        if role not in ("owner", "admin") and not _is_platform_admin(cur, u.user_id):
            raise HTTPException(status_code=403, detail="requires team admin")
        cur.execute(
            "SELECT r.id, u.username, r.status FROM membership_requests r "
            "JOIN users u ON u.id = r.user_id "
            "WHERE r.org_id = %s AND r.status = 'pending' ORDER BY r.created_at",
            (org_id,),
        )
        return {"requests": [{"id": str(r["id"]), "username": r["username"], "status": r["status"]}
                             for r in cur.fetchall()]}


@router.post("/v1/teams/{org_id}/requests/{req_id}/{action}")
def decide_request(org_id: str, req_id: str, action: str,
                   u: CurrentUser = Depends(current_user)) -> dict:
    if action not in ("approve", "deny"):
        raise HTTPException(status_code=400, detail="action must be approve|deny")
    with db.connection() as c, c.cursor() as cur:
        role = _role_in_org(cur, u.user_id, org_id)
        if role not in ("owner", "admin") and not _is_platform_admin(cur, u.user_id):
            raise HTTPException(status_code=403, detail="requires team admin")
        cur.execute(
            "SELECT user_id, role FROM membership_requests WHERE id = %s AND org_id = %s",
            (req_id, org_id),
        )
        req = cur.fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="request not found")
        if action == "approve":
            cur.execute(
                "INSERT INTO org_members (org_id, user_id, role) VALUES (%s,%s,%s) "
                "ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role",
                (org_id, req["user_id"], req["role"]),
            )
        cur.execute(
            "UPDATE membership_requests SET status = %s, decided_at = now() WHERE id = %s",
            ("approved" if action == "approve" else "denied", req_id),
        )
    return {"status": "approved" if action == "approve" else "denied"}
