# Resonance

**Audio-first, self-hosted ML experiment tracking** — a Weights & Biases replacement where audio is
a first-class logged artifact. Log metrics, params, configs and **per-step generated audio**, then
listen, scrub across training steps, A/B compare, and view waveforms/spectrograms in the browser.

> See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design and build roadmap, and
> [`CLAUDE.md`](./CLAUDE.md) for working conventions.

## Why

ML engineers training audio models (TTS, music-gen, source separation, enhancement, neural codecs)
need audio-native experiment tracking. Today they bolt audio onto W&B as opaque artifacts: poor
playback, no dedup, no precomputed waveform/spectrogram, ballooning storage cost. Resonance treats
audio as a typed primitive backed by content-addressed, deduplicated, tiered storage.

## Architecture at a glance — three decoupled data planes

| Plane | Store | Holds |
|---|---|---|
| Metadata | PostgreSQL | orgs, projects, runs, assets, dataset manifests |
| Metrics | ClickHouse | append-only scalar time-series |
| Audio/blobs | S3-compatible (MinIO/S3/GCS) | content-addressed, immutable, tiered |

Services: **ingest** (Go) · **api** (Python/FastAPI) · **media** (Go) · **workers** (Python) ·
**sdk** (Python) · **web** (React/TS). Queue: Redpanda. Cache: Redis.

## Repository layout

```
sdk/                Python client library  (import resonance)
services/ingest/    Go ingestion gateway (gRPC + HTTP, presigned uploads)
services/api/        Python FastAPI control + query plane
services/media/      Go streaming/media gateway (range/HLS + CDN)
workers/             Python audio derivation workers (transcode, peaks, spectrogram)
web/                 React + TypeScript UI (Vite)
proto/               shared protobuf definitions
deploy/dev/          docker-compose dev stack
docs/                additional design notes
```

## Quick start (dev)

```bash
make dev-up        # bring up Postgres, ClickHouse, MinIO, Redpanda, Redis
make dev-down      # tear it down
```

Service URLs once up: Postgres `:5432`, ClickHouse `:8123`/`:9000`, MinIO S3 `:9100`/console `:9001`,
Redpanda `:9092`, Redis `:6379`.

## Certified capacity

Capacity is certified per release by running the load-test suite ([`loadtest/`](./loadtest)) against
a named reference deployment and recording the load at which the SLO gates still hold. The harness
(k6) covers the two hot paths: **metric ingest** and **audio-upload coordination + direct-to-store
upload**.

| Dimension | Design target | Certified (measured) | SLO gate |
|---|---|---|---|
| Metric ingest | 1,000,000 points/sec sustained | _pending_ | p95 < 50 ms, err < 0.1% |
| Concurrent active runs | 50,000 | _pending_ | — |
| Audio-upload coordination | 5,000 prepare req/sec | _pending_ | prepare p95 < 75 ms |
| Audio ingest (post-dedup) | 2 GB/sec to object store | _pending_ | bytes bypass the gateway |
| Dedup effectiveness | ≥ 70% upload suppression on repeat logs | _pending_ | — |
| Stored audio | PB-scale (object store + tiering) | _pending_ | — |

> ⚠️ The **Design target** column states what the architecture is built to reach; the **Certified**
> column is populated only from a passing run on the reference rig (see
> [`loadtest/README.md`](./loadtest/README.md)). Unmeasured numbers are never published as certified.
> No reference-rig certification run has been performed yet.
>
> **Local dev sanity (not certified):** on a single ingest replica on a laptop, a concurrent probe
> sustained **~640k metric points/sec accepted** end-to-end into ClickHouse and exercised the
> load-shed path (gateway returns `503` once its in-memory buffer saturates). This validates the
> path, not the ceiling — formal numbers come from the k6 suite on the reference rig.

Reproduce: bring up the stack + ingest gateway, then `./loadtest/run.sh http://localhost:8080`.

## Testing

- **Per-component** unit/lint/typecheck: `make test` / `make lint` (CI: `.github/workflows/ci.yml`).
- **End-to-end** (the merge gate): `make e2e` boots the full stack + services and runs the
  [`e2e/`](./e2e) suite against the live system — SDK→ingest→ClickHouse round-trip + sharding, audio
  dedup/derivation/streaming, multi-tenant isolation (API + RLS), RBAC, quotas, rate limits, and
  browser auth. A passing run is the authoritative "everything works" signal
  (CI: `.github/workflows/e2e.yml`; see [`e2e/README.md`](./e2e/README.md)).
- **Capacity** certification: the k6 suite in [`loadtest/`](./loadtest) (see above).

## Status

**Phases 1–4 complete and verified end-to-end, plus Phase 4b (browser auth) and the first Phase 5
slices** (Go media/streaming gateway + CDN-frontable playback, event-driven Redpanda derivation
queue, ClickHouse sharding). Tracking, **audio first-class**, **audio UX depth** (A/B compare at
original quality, lazy-presigned pagination, dataset versioning), and **multi-tenancy hardening**
(orgs + hashed API tokens + RBAC, app-level org scoping **and** Postgres RLS, per-tenant storage
quotas + rate limits) are all in. The [`e2e/`](./e2e) suite gates merges as the source of truth.

**Next:** Phase 5 remainder + Phase 4 deferrals — SSO/OIDC, tiered storage lifecycle + CDN,
autoscaling (HPA/KEDA), retention automation, observability (OTel/Prometheus/Grafana),
Helm/Terraform/ArgoCD. Roadmap and per-phase exit criteria live in [`ARCHITECTURE.md`](./ARCHITECTURE.md).
