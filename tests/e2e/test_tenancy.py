"""Multi-tenancy + auth, end-to-end (defense-in-depth).

Asserts tenant isolation at BOTH layers (app-level org scoping in the API *and* Postgres RLS via the
least-privilege role), RBAC role gating, the three principal types (API token / browser session /
dev-open), storage quota (413) and rate limit (429) enforcement, and the full browser-auth lifecycle
(bootstrap -> signup create/join -> approve -> per-team scoping).

Maps to ARCHITECTURE.md §10 Phase 4/4b.
"""

from __future__ import annotations

import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

import helpers
from helpers import ApiClient, CONFIG, mint_token, sha256_hex

pytestmark = pytest.mark.tenancy


def _unique(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


# -------------------------------------------------------------------------------------------------
# Tenant isolation
# -------------------------------------------------------------------------------------------------
def test_cross_tenant_isolation_at_api_layer(org_a, org_b):
    """Tenant B sees none of tenant A's projects/runs through the API."""
    a, b = org_a.client(), org_b.client()
    a_run = helpers.create_run(a, "secret-project")

    a_projects = {p["slug"] for p in a.get("/v1/projects").json()}
    b_projects = {p["slug"] for p in b.get("/v1/projects").json()}
    assert "secret-project" in a_projects
    assert "secret-project" not in b_projects

    # B cannot fetch A's run (RLS-scoped lookup misses → 404).
    assert b.get(f"/v1/runs/{a_run['id']}").status_code == 404
    assert a.get(f"/v1/runs/{a_run['id']}").status_code == 200
    a.close()
    b.close()


def test_cross_tenant_isolation_at_rls_layer(org_a, org_b):
    """Even at the raw DB, the least-privilege `resonance_app` role only sees the org set in
    `app.current_org` — RLS filters tenant A's rows out for tenant B (the API's WHERE clause never
    runs here)."""
    a = org_a.client()
    a_run = helpers.create_run(a, "rls-project")
    run_id = a_run["id"]

    with helpers.pg_app(org_a.org_id) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM runs WHERE id = %s", (run_id,))
        assert cur.fetchone()["n"] == 1  # A sees its own run

    with helpers.pg_app(org_b.org_id) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) AS n FROM runs WHERE id = %s", (run_id,))
        assert cur.fetchone()["n"] == 0  # B sees zero of A's rows, enforced by RLS
        cur.execute("SELECT count(*) AS n FROM runs")
        assert cur.fetchone()["n"] == 0  # B's whole runs table is empty
    a.close()


# -------------------------------------------------------------------------------------------------
# RBAC
# -------------------------------------------------------------------------------------------------
def test_rbac_member_denied_owner_allowed(org):
    """Management endpoints require admin+: a member token is 403, the owner token succeeds."""
    owner = org.client()
    member_token = mint_token(owner, org.org_id, "member")
    member = ApiClient(token=member_token)

    # Minting tokens is admin-gated.
    assert member.post(f"/v1/orgs/{org.org_id}/tokens",
                       json={"name": "x", "role": "member"}).status_code == 403
    assert owner.post(f"/v1/orgs/{org.org_id}/tokens",
                      json={"name": "x", "role": "member"}).status_code == 200

    # A member CAN read/write data (not blanket-denied) ...
    owner.post("/v1/projects", json={"slug": "rbac-proj", "name": "rbac"})
    assert member.get("/v1/projects").status_code == 200
    # ... but deleting a project is admin-gated.
    assert member.delete("/v1/projects/rbac-proj").status_code == 403
    assert owner.delete("/v1/projects/rbac-proj").status_code == 204
    owner.close()
    member.close()


# -------------------------------------------------------------------------------------------------
# Principals
# -------------------------------------------------------------------------------------------------
def test_principals_token_dev_open_and_invalid(dev_api, org):
    """The three principal resolutions: a valid API token scopes to its org; dev-open (no token)
    falls back to the seeded `dev` org; an invalid token is rejected (401)."""
    assert dev_api.get("/v1/org").json()["slug"] == "dev"
    assert org.client().get("/v1/org").json()["slug"] == org.slug
    assert ApiClient(token="rsn_not_a_real_token").get("/v1/org").status_code == 401


# -------------------------------------------------------------------------------------------------
# Quotas + rate limits
# -------------------------------------------------------------------------------------------------
def test_storage_quota_returns_413(make_org):
    """A tenant over its storage quota gets 413 at prepare-time, before any bytes are uploaded."""
    quota_org = make_org(storage_quota_bytes=1000)
    api = quota_org.client()
    # Within quota: an upload URL is issued.
    small = api.post("/v1/assets/prepare",
                     json={"sha256": sha256_hex(b"small"), "size_bytes": 500})
    assert small.status_code == 200 and small.json()["upload_url"]
    # Over quota: rejected with 413, no URL.
    big = api.post("/v1/assets/prepare",
                   json={"sha256": sha256_hex(b"big"), "size_bytes": 5000})
    assert big.status_code == 413
    api.close()


@pytest.mark.slow
def test_rate_limit_returns_429(make_org):
    """A tenant exceeding its per-minute request budget gets 429. Run on a dedicated org and aligned
    to the start of a fixed window so the burst lands in one window (no cross-test interference)."""
    rl_org = make_org()
    api = rl_org.client()
    limit = 600  # RESONANCE_RATE_LIMIT_PER_MIN default

    # Align to the next minute boundary so all requests count in a single window.
    if 60 - (time.time() % 60) < 10:
        time.sleep(60 - (time.time() % 60) + 0.5)

    def hit(_):
        return api.get("/v1/org").status_code

    with ThreadPoolExecutor(max_workers=20) as pool:
        codes = list(pool.map(hit, range(limit + 120)))
    assert 429 in codes, "expected at least one 429 once the per-minute budget is exceeded"
    assert codes.count(200) >= 1
    api.close()


# -------------------------------------------------------------------------------------------------
# Browser auth (username/password sessions)
# -------------------------------------------------------------------------------------------------
def _session() -> ApiClient:
    """An API client backed by its own cookie jar (a browser session)."""
    return ApiClient(client=httpx.Client(timeout=15.0))


def _signup(sess: ApiClient, *, team_mode: str, team_slug: str | None = None,
            team_name: str | None = None) -> dict:
    resp = sess.post("/v1/auth/signup", json={
        "username": _unique("user"), "password": "pw-correct-horse",
        "team_mode": team_mode, "team_slug": team_slug, "team_name": team_name,
    })
    resp.raise_for_status()
    return resp.json()


def test_browser_bootstrap_makes_platform_admin(dev_api):
    """First-run bootstrap creates a platform admin. Only runnable once per DB; on an already-
    initialized stack we assert the endpoint is correctly closed instead."""
    status = httpx.get(f"{CONFIG.api_url}/v1/auth/bootstrap-status", timeout=10).json()
    sess = _session()
    if status["needs_bootstrap"]:
        out = sess.post("/v1/auth/bootstrap",
                        json={"username": _unique("admin"), "password": "pw"}).json()
        assert out["is_admin"] is True and out["current_org"]
        me = sess.get("/v1/auth/me").json()
        assert me["is_admin"] is True
    else:
        # Already initialized — bootstrap must be refused.
        assert sess.post("/v1/auth/bootstrap",
                         json={"username": "x", "password": "y"}).status_code == 409
    sess.close()


def test_browser_signup_create_team_makes_owner():
    """Signing up with "create a team" makes the user the owner of a fresh org."""
    sess = _session()
    slug = _unique("team")
    out = _signup(sess, team_mode="create", team_slug=slug, team_name="My Team")
    assert out["current_org"] and out["pending"] is False
    me = sess.get("/v1/auth/me").json()
    team = next(t for t in me["teams"] if t["slug"] == slug)
    assert team["role"] == "owner"
    sess.close()


def test_browser_signup_join_pending_then_approved_member():
    """Signup "join" creates a pending request; an owner approves it and the joiner becomes a
    member of that team."""
    owner = _session()
    slug = _unique("jointeam")
    created = _signup(owner, team_mode="create", team_slug=slug, team_name="Join Team")
    org_id = created["current_org"]

    joiner = _session()
    joined = _signup(joiner, team_mode="join", team_slug=slug)
    assert joined["pending"] is True and joined["current_org"] is None
    me_before = joiner.get("/v1/auth/me").json()
    assert any(r["slug"] == slug for r in me_before["pending_requests"])
    assert all(t["slug"] != slug for t in me_before["teams"])

    # The owner sees and approves the request.
    requests = owner.get(f"/v1/teams/{org_id}/requests").json()["requests"]
    req = next(r for r in requests if r["status"] == "pending")
    approved = owner.post(f"/v1/teams/{org_id}/requests/{req['id']}/approve").json()
    assert approved["status"] == "approved"

    me_after = joiner.get("/v1/auth/me").json()
    team = next(t for t in me_after["teams"] if t["slug"] == slug)
    assert team["role"] == "member"
    owner.close()
    joiner.close()


def test_browser_session_data_is_team_scoped(dev_api):
    """A session's data is scoped to its active team: a brand-new team sees zero of the dev org's
    projects, and a project it creates is invisible to the dev org."""
    # Ensure the dev org has at least one project to (not) leak.
    dev_api.post("/v1/projects", json={"slug": _unique("dev-proj"), "name": "dev"})
    dev_projects = {p["slug"] for p in dev_api.get("/v1/projects").json()}

    sess = _session()
    slug = _unique("scoped")
    _signup(sess, team_mode="create", team_slug=slug, team_name="Scoped")

    # Fresh team: sees none of the dev org's projects.
    assert sess.get("/v1/projects").json() == []
    own = _unique("scoped-proj")
    sess.post("/v1/projects", json={"slug": own, "name": "mine"})
    assert {p["slug"] for p in sess.get("/v1/projects").json()} == {own}

    # And the dev org never sees the team's project.
    assert own not in {p["slug"] for p in dev_api.get("/v1/projects").json()}
    assert dev_projects.isdisjoint({own})
    sess.close()
