# CLAUDE.md — Resonance project instructions

Project meta-instructions for working in this repo. Read alongside the global preferences.
**`ARCHITECTURE.md` is the source of truth** for design and the build roadmap — read it before
making structural changes, and update its roadmap checkboxes + status log as work lands.

## What this is

**Resonance** — a self-hosted, multi-tenant Weights & Biases replacement where **audio is a
first-class logged artifact** for ML training. ML engineers log metrics/params/configs/system stats
*and* per-step generated audio, then listen, scrub across steps, A/B compare, and view
waveforms/spectrograms in a web UI.

## Two non-negotiables (never trade these away)

1. **Scalable audio storage** — content-addressed, deduplicated, tiered, PB-capable.
2. **Excellent ML-engineer UX** — the SDK must never block the training loop; the UI must be fast
   and audio-native.

## Core invariant: three separate data planes

Never conflate these — it is the central design rule:

- **Metadata → Postgres** (orgs/projects/runs/assets/manifests; relational, `org_id` on every row).
- **Metrics → ClickHouse** (append-only scalar time-series; columnar; downsample server-side).
- **Audio/blobs → S3-compatible object store** (content-addressed, immutable, tiered; **never**
  proxy audio bytes through the API — use presigned direct upload + Media Gateway + CDN).

Audio dedup is by `sha256(content)`; check existence before upload; re-logging identical content
must upload **zero** bytes.

## Stack & layout

- **SDK:** Python (async/background-thread batching, offline spool + resume).
- **Ingestion Gateway + Media/Streaming Gateway:** Go (perf-critical, stateless, HPA-scaled).
- **Control/Query API + Audio workers:** Python (FastAPI; ffmpeg, librosa/torchaudio, soundfile).
- **Queue:** Redpanda/NATS. **Cache:** Redis. **Object store:** MinIO/S3/GCS + CDN.
- **Frontend:** React + TypeScript + Vite, WaveSurfer.js, uPlot/visx.
- **Infra:** Kubernetes, Helm, Terraform, ArgoCD, Prometheus/Grafana + OpenTelemetry.

Monorepo:
```
sdk/                Python client library
services/ingest/    Go ingestion gateway
services/api/        Python FastAPI control + query plane
services/media/      Go streaming/media gateway
workers/             Python audio derivation workers (transcode, peaks, spectrogram)
web/                 React + TypeScript UI
deploy/              docker-compose (dev), Helm/Terraform/ArgoCD (prod)
docs/                additional design notes
```

## Conventions

- **Commits & PR titles:** Conventional Commits (`<type>(<scope>): <subject>`), imperative, no
  trailing period. PRs opened as **drafts**. No Claude attribution on commits or PRs.
- **Python:** type hints + Pydantic models; share request/response models between SDK and API; ruff +
  black; pytest.
- **Go:** standard layout, `golangci-lint`, table-driven tests; keep gateways stateless.
- **TypeScript:** strict mode; component tests; no audio decoded client-side just to draw waveforms
  (use precomputed `peaks.json`).
- **Multi-tenancy is not optional in new code:** every data-access path must scope by `org_id` and
  enforce RBAC. New stored objects go under the tenant's key prefix.
- **Audio is typed, not a blob:** keep `log_audio` / asset records carrying sample rate, channels,
  step, caption, optional reference. Don't degrade audio to a generic file artifact.

## Dev workflow

- **One command:** `make up` (docker stack + ingest/api/worker/web on the host) → UI on
  http://localhost:5280; `make demo` logs a sample run; `make down` stops it. `make dev-reset` wipes
  local data after a schema change.
- After any change, run that component's tests and lint. For features, verify end-to-end against the
  phase exit criteria in `ARCHITECTURE.md` §10.
- When you complete roadmap work, tick the box in `ARCHITECTURE.md` §9 and append to its status log.

## Capacity certification

Performance claims are earned, not asserted. The k6 suite in `loadtest/` gates the hot paths
(metric ingest p95 < 50 ms; audio-prepare p95 < 75 ms; errors < 0.1%). The **Certified capacity**
table in `README.md` has a *design target* column and a *measured* column — only populate the
measured column from a passing run on the reference rig described in `loadtest/README.md`. Never
publish an unmeasured number as certified. Re-certify when a hot path changes.

## Current status

**Phases 1–3 complete and verified end-to-end.** Tracking (SDK → ingest → ClickHouse; control plane
serves runs + downsampled metrics), **audio first-class** (`log_audio` dedup→presigned PUT→register,
CAS store, derivation worker for peaks/spectrogram/probes, audio panel), and **audio UX depth**:
keyset-paginated audio listings with **lazy Redis-cached presigned URLs**, **A/B synced compare +
blind-test** (original quality, ratings via `/v1/ratings`), and **content-addressed dataset
versioning** (`log_dataset` + dataset browser). Run `examples/train_demo.py` against `make up`.
**Next:** Phase 4 — multi-tenancy hardening (orgs/RBAC/SSO, quotas, isolation, tiered lifecycle +
CDN). See `ARCHITECTURE.md` §9.

Gotchas / current deviations from the target architecture (all documented in `ARCHITECTURE.md`):
- **A/B comparison serves ORIGINAL quality** (`/v1/assets/{sha}/url?kind=original`) — never a lossy
  rendition; that's a hard constraint (§7b). Renditions, if added, are browse-only.
- Audio listings are **paginated + lazily presigned** (Redis-cached); never sign 1000s of URLs up
  front. Lazy URLs via `GET /v1/assets/{sha}/url`.
- ClickHouse metric columns are `UUID`-typed; ingest only accepts valid UUID ids (SDK gets them from
  the control API at `init`).
- **Audio coordination runs on the control plane** (FastAPI), not the Go ingest gateway — audio is
  low-frequency vs metrics. `prepare`/`audio`/`runs/{id}/audio`/`assets/{sha}/url` endpoints.
- Derivation uses a **Postgres work queue** (`assets.derived_at IS NULL`), not Redpanda yet.
- Long-clip playback range-streams the **original** via presigned URLs (browser-native range); Go
  media gateway + CDN + multi-resolution derivations come in Phase 4/5.
- Dev stack uses **bind-mounted** data dirs, so a schema change needs `rm -rf deploy/dev/.data`
  before `make dev-up` (a `down -v` is not enough) to re-run the init SQL.
