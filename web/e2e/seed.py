"""Seed the backend for the web E2E smoke.

Run by e2e/run.sh (with PYTHONPATH=e2e so the suite's helpers are importable) before Playwright.
Creates a dedicated user + team via signup (or logs in if it already exists), then seeds that team
with a project + a run with metrics + one derived audio sample — so when the spec logs in as this
user it sees live charts and an audio panel (waveform from peaks.json, server spectrogram).

Deliberately uses signup (not first-run bootstrap): the pytest suite consumes the one-time bootstrap
before this runs, and signup works the same on a fresh or a reused stack. Credentials are shared with
the spec via env (defaults below).
"""

from __future__ import annotations

import os
import sys

import httpx

import helpers
from helpers import CONFIG, ApiClient, create_run, make_wav, post_metrics, register_audio, upload_asset, wait_until

USER = os.environ.get("E2E_WEB_USER", "webe2e")
PASS = os.environ.get("E2E_WEB_PASS", "resonance-web-e2e")
TEAM_NAME = "Web E2E"
PROJECT_SLUG = "web-smoke"
PROJECT_NAME = "Web Smoke"
RUN_NAME = "web-smoke-run"


def main() -> int:
    sess = httpx.Client(base_url=CONFIG.api_url, timeout=15)

    # Sign up a dedicated user owning a fresh team; if it already exists (reused stack), log in.
    r = sess.post("/v1/auth/signup", json={
        "username": USER, "password": PASS, "team_mode": "create",
        "team_name": TEAM_NAME, "team_slug": TEAM_NAME,
    })
    if r.status_code == 409:
        sess.post("/v1/auth/login", json={"username": USER, "password": PASS}).raise_for_status()
        print(f"seed: user '{USER}' exists — logged in")
    else:
        r.raise_for_status()
        print(f"seed: signed up '{USER}' + team '{TEAM_NAME}'")

    me = sess.get("/v1/auth/me").json()
    org_id = me.get("current_org") or next(t["org_id"] for t in me["teams"] if t["name"] == TEAM_NAME)

    # Mint an API token for the team (the session is its owner) and seed data into it via the token,
    # so the data lands in exactly the team this user logs into.
    token = sess.post(f"/v1/orgs/{org_id}/tokens",
                      json={"name": "web-e2e-seed", "role": "owner"}).json()["token"]
    sess.close()
    api = ApiClient(token=token)

    api.post("/v1/projects", json={"slug": PROJECT_SLUG, "name": PROJECT_NAME})  # 409 if it exists
    run = create_run(api, PROJECT_SLUG, name=RUN_NAME, config={"model": "smoke-net", "lr": 3e-4})

    points = []
    for step in range(40):
        points.append({"metric": "loss", "step": step, "value": 1.0 / (step + 1)})
        points.append({"metric": "eval/loss", "step": step, "value": 0.5 / (step + 1)})
    assert post_metrics(run["org_id"], run["project_id"], run["id"], points).status_code == 202

    payload, _ = make_wav(seconds=0.75, seed=42)
    sha = upload_asset(api, payload)
    register_audio(api, run["id"], "samples/val", sha, step=0,
                   size_bytes=len(payload), sample_rate=22050, caption="a smoke sample")

    # Wait for derivation so the audio panel has peaks.json + a spectrogram to render.
    wait_until(
        lambda: bool(
            (helpers.pg_super_query(
                "SELECT derivations FROM assets WHERE org_id=%s AND sha256=%s",
                (run["org_id"], sha),
            ) or [{}])[0].get("derivations", {}).get("peaks_key")
        ),
        timeout=90, interval=1.0, message="seed audio was not derived",
    )
    print(f"seed: team '{TEAM_NAME}', project '{PROJECT_NAME}', run '{RUN_NAME}', audio derived")
    api.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
