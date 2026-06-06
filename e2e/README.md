# Resonance end-to-end suite

The **merge-gating source of truth**: a passing `make e2e` run is the authoritative signal that the
whole platform works. Unlike the per-component unit suites (which mock their neighbours), this suite
boots the *real* stack — all three data planes plus every backend service — and sends real data
through the full path, so a green run means the product actually works when the pieces are wired
together.

It runs against the **same stack `make up` uses**, so dev and CI stay in sync and integration
gotchas (ClickHouse healthcheck/IPv6, pandaproxy topic creation, RLS scoping, schema drift) are
caught here rather than in production.

## Run it

```bash
make e2e                      # bring up the full stack + services, run the suite, tear down
make e2e-web                  # also run the Playwright web UI E2E (starts the web dev server)
KEEP_UP=1 make e2e            # leave everything running afterwards (debug a failure)
E2E_NO_STACK=1 ./e2e/run.sh   # run against an already-up stack (e.g. you ran `make up`)
E2E_PYTEST_ARGS="-k audio -x" ./e2e/run.sh   # focus on one plane, stop on first failure
```

`make e2e` is `e2e/run.sh`, which: brings up the docker dev stack → waits for the data planes →
builds + starts the backend services (`ingest`, `media`, `api`, `worker`) on the host via
`scripts/dev.sh` (web/vite is skipped via `DEV_SERVICES` unless `E2E_WEB` is set) → waits for them →
runs `pytest` → (with `E2E_WEB`) seeds + runs the Playwright web UI E2E → tears everything down.
Service logs are left under `.run/*.log` on failure.

Requirements: Docker + `docker compose`, Go 1.22, Python 3.11, and `libsndfile` (for `soundfile`).
The web UI E2E additionally needs Node 20 + a Playwright browser (`make e2e-web` installs both on
first run; CI installs them explicitly). Everything else installs into the shared `.venv`
(`e2e/requirements.txt` + the editable SDK/API/workers).

## What it covers (and where each criterion lives)

The suite is organized by data plane and asserts the **Phase exit criteria** in `ARCHITECTURE.md`
§10, so it doubles as living verification of the roadmap.

| File | Plane / concern | §10 mapping |
|------|-----------------|-------------|
| `test_tracking.py` | SDK→ingest→ClickHouse→API round-trip (exact), server-side downsampling, metric-name listing, **ClickHouse sharding** (per-run co-location + Distributed aggregation), graceful backpressure, ingest contract validation | Phase 1 + Phase 5 sharding |
| `test_audio.py` | content-addressed **dedup (zero bytes on re-log)**, derivation (peaks + spectrogram + probes, **Postgres poll backstop**, idempotency), lazy/paginated listing (no URLs up front), media-gateway **range 200/206 + HMAC verify/expire/tamper 403**, **original-quality** compare path (§7b), dataset version collapse, ratings round-trip | Phase 2 / 3 + §7b |
| `test_tenancy.py` | cross-tenant denial at **API layer and raw DB/RLS layer**, RBAC (member 403 / owner 200), the three principals (token / browser session / dev-open), **storage quota 413**, **rate limit 429**, browser auth (bootstrap → signup create/join → approve → per-team scoping) | Phase 4 / 4b |
| `test_deferred.py` | documented, **skipped** placeholders for not-yet-built scope (storage tiering lifecycle; system-metrics path, issue #10) | Phase 5 deferrals |
| `web/e2e/smoke.spec.ts` (Playwright) | **Web UI** smoke against the real `/v1` API: auth gate → login, run view (live charts + audio panel, **waveform from `peaks.json`**, server spectrogram), compare / gallery / datasets surfaces, logout. Seeded by `web/e2e/seed.py`. Runs via `make e2e-web` / CI (`E2E_WEB=1`). | Phase 4b + Web UI |

## Interpreting a failure

`pytest` runs with `-v --tb=short -ra`, so the report names the failing test (hence the plane and
the assertion) and lists skips/reasons at the end. On CI, the backend service logs are uploaded as
the `e2e-service-logs` artifact. Locally, run with `KEEP_UP=1` and inspect `.run/*.log` or hit the
live services directly.

## Flakiness budget

- **Retries are allowed only for genuinely external waits** — stack readiness and async work — via
  `helpers.wait_until(...)`: the Go ingest sink's ~1s flush, and the derivation worker picking up a
  job. These poll a real condition with a timeout; they never sleep-and-hope.
- **No blanket test retries.** A flaky assertion is treated as a real race to fix, not masked with a
  rerun. The per-test `timeout` (240s) turns a hung service into a loud failure instead of a stall.
- Tests run **serially** (`-p no:randomly`, no `xdist`) so the shared `dev` org's per-minute rate
  budget and ordering are predictable. The rate-limit test uses its **own** org and aligns to a
  fresh window so its burst can't disturb (or be disturbed by) other tests.

## Extending it

1. Add a test to the plane's module (or a new `test_<plane>.py`) and tag it with the matching marker
   (`tracking` / `audio` / `tenancy`).
2. Use the fixtures: `org` / `org_a` / `org_b` (fresh isolated tenants), `make_org(...)` (custom
   quota), `dev_api` (dev-open). Reach for the helpers in `helpers.py` (HTTP/PG/ClickHouse/S3
   clients, WAV generation, the upload+register flow, `wait_until`).
3. Prefer asserting an **observable behaviour through a real interface** (the API, the gateway, the
   object store, ClickHouse, RLS) over inspecting internals.
4. When a deferred feature lands, delete its skip in `test_deferred.py` and flesh out the assertion.

## Making it a required gate

The `e2e` GitHub Actions workflow (`.github/workflows/e2e.yml`) runs on every PR. To enforce it as a
**merge gate**, a repo admin must add it to branch protection on `main`:

> Settings → Branches → `main` → Require status checks to pass → add **`e2e`**.

This is a GitHub setting and can't be committed in the repo.
