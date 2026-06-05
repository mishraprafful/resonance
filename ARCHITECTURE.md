# Resonance — Audio-First ML Experiment Tracking Platform

> Working codename: **Resonance**. A self-hosted, multi-tenant Weights & Biases replacement where
> **audio is a first-class logged artifact**. This is the living architecture + build-tracking doc.

---

## Why this exists

ML engineers training audio models (TTS, music-gen, source separation, enhancement, neural codecs)
need to log scalar metrics, params, configs and system stats **and** log generated audio per
training step — then **listen, scrub across steps, A/B compare, and view waveforms/spectrograms**
directly in a web UI. Today this is bolted onto W&B as opaque artifacts: poor playback, no dedup, no
precomputed waveform/spectrogram, ballooning storage cost.

### Non-negotiables
1. **Scalable audio storage** — content-addressed, deduplicated, tiered, PB-capable.
2. **Excellent ML-engineer UX** — non-blocking SDK, fast UI, audio-native interactions.

### Locked design constraints
- **Deploy:** self-hosted on Kubernetes; cloud-agnostic via S3-compatible object storage.
- **Build:** core from scratch (own SDK, ingestion, stores, UI).
- **Scale:** multi-tenant platform, PB-scale audio, hard tenant isolation + quotas.
- **Audio UX (all four):** per-step generated samples, waveform+spectrogram viz, A/B compare,
  large dataset references with no re-upload.

---

## 1. System overview — three decoupled data planes

The foundational decision: **split the system into three planes** that scale and fail
independently. Metrics are tiny + frequent, audio is huge + occasional, metadata is relational.
Conflating them is how W&B-style systems become slow and expensive.

```
                          ┌─────────────────────────────────────────────┐
   Python SDK             │                 Resonance                      │
  (training loop)         │                                              │
        │ metrics (batched, async)        ┌────────────────────────┐    │
        ├────────────────────────────────▶│ Ingestion Gateway (Go) │    │
        │ audio: 1) hash + "have you?"     └───────────┬────────────┘    │
        │        2) presigned PUT direct──────────────┐│                 │
        ▼                                              ▼▼                 │
  ┌───────────┐   ┌──────────────┐   ┌────────────┐  ┌──────────────┐   │
  │ Object    │   │ Stream queue │   │ ClickHouse │  │ Postgres     │   │
  │ store(CAS)│   │ (Redpanda)   │   │ (metrics)  │  │ (metadata)   │   │
  └─────┬─────┘   └──────┬───────┘   └─────┬──────┘  └──────┬───────┘   │
        │                │ async workers   │                │           │
        │         ┌──────▼─────────┐       │                │           │
        │         │ Audio workers  │       │                │           │
        │         │ transcode +    │       │                │           │
        │         │ waveform peaks +│      │                │           │
        │         │ mel-spectrogram │      │                │           │
        │         └──────┬─────────┘       │                │           │
        ▼                ▼                 ▼                ▼           │
  ┌──────────────────────────────────────────────────────────────┐    │
  │  Control/Query API (Python FastAPI)  ◀── Web UI (React/TS) ───┤    │
  │  Streaming/Media Gateway (Go)        ◀── CDN ─────────────────┘    │
  └──────────────────────────────────────────────────────────────┘    │
                          └─────────────────────────────────────────────┘
```

- **Metadata plane — Postgres:** orgs, projects, experiments, runs, users, API tokens, audio-asset
  records, dataset manifests. Strongly consistent, relational, row-level `org_id` tenancy.
- **Metrics plane — ClickHouse:** append-only time-series of scalars/system metrics. Columnar → fast
  cross-run scans, downsampling, sweep/parallel-coordinate queries at billions of points.
- **Blob/audio plane — S3-compatible object store** (MinIO self-hosted, or S3/GCS): content-
  addressed, immutable, tiered by lifecycle policy.

---

## 2. Audio storage subsystem (the non-negotiable core)

### 2.1 Content-addressed storage (CAS) + dedup
- Object key = `sha256(content)`; stored at `blobs/<hash[0:2]>/<hash[2:4]>/<hash>`.
- SDK hashes content **before** upload and calls `POST /assets/exists`. If present → skip upload,
  just link the run to the existing asset. Re-logging the same dataset/sample across 1000 runs
  stores it **once** → large dataset references are effectively free.
- Immutability → safe CDN caching (no invalidation), trivial reproducibility.

### 2.2 Direct-to-store upload (API never proxies bytes)
- For new blobs the API returns a **presigned multipart PUT URL**; the SDK uploads straight to
  object storage. The control plane only handles small metadata. Audio bytes never bottleneck API
  replicas — the key scalability lever.

### 2.3 Async derivation pipeline (Python workers, ffmpeg/librosa)
A new blob emits a queue event; workers produce and cache derivations back into the object store
(content-addressed by source hash + recipe, idempotent, skip on cache hit):
- **Web-streamable rendition:** Opus/AAC (+ optional HLS segments) for instant playback.
- **Waveform peaks:** decimated min/max array (`peaks.json`) so the UI draws waveforms without
  downloading audio.
- **Mel-spectrogram:** precomputed image (PNG/WebP) + params, for inline display.
- **Quality probes:** LUFS, peak dBFS, duration, sample rate, channels (shown as badges).

### 2.4 Streaming & tiering
- **Streaming/Media Gateway (Go):** authorizes request (tenant/run scope), then serves via signed
  URL / HTTP range requests behind a **CDN**. Immutable keys = perfect edge caching.
- **Tiered lifecycle:** hot (standard) → infrequent-access → archive, by run age / access recency,
  per-tenant policy. PB-scale economics handled by object-store lifecycle rules, not by us.

### 2.5 Dataset versioning (cheap)
- A **dataset version = a manifest** (ordered content-addressed asset refs + per-item metadata).
  Versions are manifest diffs — no data duplication. Runs reference a dataset version by id →
  "which exact audio did this run train/eval on" reproducibility.

---

## 3. SDK — the UX anchor (Python first)

W&B-grade ergonomics; **must never block the training loop.**

```python
import resonance

run = resonance.init(project="vocoder", config={"lr": 3e-4, "model": "hifigan"})

for step in range(n):
    run.log({"loss/mel": mel_loss, "loss/adv": adv_loss}, step=step)   # batched, async
    if step % 1000 == 0:
        run.log_audio("samples/val", wav, sample_rate=22050, step=step, # first-class
                      caption=f"step {step}", reference=ref_wav)         # ref for A/B
run.log_dataset("valset-v3", manifest_or_dir)   # content-addressed, dedup
run.finish()
```

- **Non-blocking:** background thread/process batches metrics and flushes on interval/size; audio
  hashed + uploaded off the hot path; offline mode + local spool with resume on crash.
- **`log_audio`** is a typed primitive: sample rate, channels, step, optional `reference`
  (ground-truth for A/B), caption, tags. Grouped by key for timeline scrubbing.
- **`log_dataset`** registers a content-addressed manifest.
- Auto-captures system metrics (GPU/CPU/mem) and env/config.
- Later: Lightning / HF Trainer / Keras callback integrations.

---

## 4. Ingestion & query services

- **Ingestion Gateway (Go):** high-throughput metric ingest (gRPC + HTTP), validates tenant/token,
  batches to the stream (Redpanda/Kafka), issues presigned upload URLs + dedup checks. Stateless,
  HPA-scaled.
- **Stream → ClickHouse consumer:** batches metric events into ClickHouse (async inserts).
- **Control/Query API (Python FastAPI):** projects/runs CRUD, config, asset metadata, dataset
  manifests, chart queries (server-side downsampling), search, RBAC. Shares Pydantic models with the
  SDK.
- **Live updates:** SSE/WebSocket pushes new metric points to open run views.

> **Language split rationale:** Go for the two perf-critical, mostly-stateless network paths
> (ingestion, media streaming); Python for control plane + audio workers (FastAPI, ffmpeg, librosa,
> shared models with the SDK). A deliberate trade-off; can collapse to all-Python if uniformity is
> preferred over peak throughput.

---

## 5. Multi-tenancy, auth, quotas

- **Hierarchy:** Org → Project → Experiment → Run; assets & dataset versions scoped to org.
- **Isolation (defense in depth):** `org_id` on every Postgres row (row-level security) + per-tenant
  object-store key prefix (optionally per-tenant bucket) + per-tenant ClickHouse partitioning.
- **AuthN:** OIDC/SSO for humans; scoped API tokens for SDK/CI.
- **AuthZ:** RBAC (org owner/admin/member, project roles), enforced in Control API + Media Gateway.
- **Quotas & rate limits:** per-tenant storage quota, ingest rate limit, retention policy; surfaced
  in the UI to prevent noisy-neighbor and runaway cost.

---

## 6. Web UI (React + TypeScript) — audio-native

- **Run view:** live metric charts (SSE), config/params panel, system-metrics panel.
- **Audio panel:** per-key sample browser with a **timeline slider bound to training step** — scrub
  how generated audio evolves across training. Inline player, waveform (peaks via WaveSurfer.js),
  toggleable mel-spectrogram.
- **A/B / side-by-side compare:** synced multi-track player across runs/checkpoints, output-vs-
  reference, optional **blind listening-test mode** with ratings logged back.
- **Project view:** runs table, metric comparison, parallel coordinates, sweeps, grouping/filtering.
- **Dataset view:** browse a dataset version, listen to items, see which runs used it.

---

## 7. Scalability posture

| Concern | Mechanism |
|---|---|
| API/ingestion load | Stateless Go/Python replicas, k8s HPA, LB |
| Metric volume | ClickHouse sharded + replicated, async batch insert, downsampling |
| Audio bytes | Direct-to-store upload, CDN edge cache, immutable CAS keys |
| Storage cost @ PB | Dedup (CAS) + lifecycle tiering (hot→IA→archive) |
| Derivation spikes | Queue-backed workers autoscaled on queue depth |
| Metadata | Postgres + read replicas (Citus/partitioning if needed) |
| Tenant blast radius | Quotas, rate limits, partition/prefix isolation |

---

## 8. Tech stack

- **SDK:** Python (asyncio / background-thread batching). Optional Rust core later.
- **Ingestion + Media Gateway:** Go (gRPC + HTTP, range/HLS streaming).
- **Control/Query API + Audio workers:** Python (FastAPI; ffmpeg, librosa/torchaudio, soundfile).
- **Queue:** Redpanda (Kafka API) or NATS JetStream.
- **Metadata DB:** PostgreSQL. **Metrics DB:** ClickHouse. **Cache:** Redis.
- **Object store:** S3-compatible — MinIO / S3 / GCS, with a **CDN** in front for audio + viz.
- **Frontend:** React + TypeScript + Vite, WaveSurfer.js, uPlot/visx for charts.
- **Infra:** Kubernetes, Helm, Terraform, ArgoCD (GitOps), Prometheus/Grafana + OpenTelemetry.
- **Repo:** monorepo (`sdk/`, `services/ingest`, `services/api`, `services/media`, `workers/`,
  `web/`, `deploy/`, `loadtest/`, `docs/`).
- **Load testing / capacity certification:** k6 suite in `loadtest/` exercises the two hot paths
  (metric ingest, audio-upload coordination + direct-to-store PUT) with SLO gates. Each release is
  certified against a named reference deployment; certified numbers are published in `README.md`
  (design targets until a run passes on the reference rig). See `loadtest/README.md`.

---

## 9. Build roadmap (each phase shippable)

- [x] **Phase 0 — Scaffolding:** monorepo layout, `docker-compose` dev stack (Postgres, ClickHouse,
  MinIO, Redpanda, Redis), CI, shared schema/proto definitions, this doc + root `CLAUDE.md`,
  k6 load-test harness + capacity-certification process.
- [ ] **Phase 1 — Tracking MVP (W&B parity baseline):** SDK `init`/`log`/`finish`, Ingestion
  Gateway, ClickHouse metrics path, Control API (projects/runs CRUD + query), minimal UI with live
  charts + config panel. *Exit:* log scalars from a real script and watch them live.
- [ ] **Phase 2 — Audio first-class:** `log_audio`, CAS object store + dedup + presigned upload,
  audio worker (transcode + peaks + spectrogram), Media Gateway, UI audio panel with
  player/waveform/spectrogram. *Exit:* log per-step samples and play+inspect them in the UI.
- [ ] **Phase 3 — Audio UX depth:** per-step timeline scrubbing, A/B synced compare + blind-test
  mode, `log_dataset` + dataset versioning/manifests + dataset view.
- [ ] **Phase 4 — Multi-tenancy hardening:** orgs/RBAC/SSO, API tokens, per-tenant isolation,
  quotas, rate limits, tiered lifecycle + CDN.
- [ ] **Phase 5 — Scale & ops:** ClickHouse sharding, autoscaling, retention/lifecycle automation,
  observability (OTel/Prometheus/Grafana), Helm/Terraform/ArgoCD, load tests.

---

## 10. Verification (per phase, end-to-end)

- **Dev stack:** `docker compose up` brings up Postgres/ClickHouse/MinIO/Redpanda/Redis; health
  checks pass.
- **Phase 1:** sample training script → metrics appear live in UI; query API returns downsampled
  series; ClickHouse row counts match logged points.
- **Phase 2:** `log_audio` → asset deduped (identical re-log uploads 0 bytes), waveform+spectrogram
  render, audio plays via Media Gateway/CDN with range requests.
- **Phase 3:** scrub a sample key across steps; A/B compare two runs in synced player; re-logging a
  dataset stores it once (verify object count).
- **Phase 4/5:** tenant A cannot read tenant B's data; quota enforcement triggers; load test
  sustains target ingest rate with HPA scaling.

---

## Open decisions

- [ ] Codename **Resonance** — keep or rename?
- [ ] Single-language (all-Python) vs the Go+Python split in §4 (velocity vs peak perf).
- [ ] Starting phase after docs land (recommended: Phase 0 → Phase 1).

## Status log

- **2026-06-05:** Initial architecture drafted. Codename **Resonance** chosen. Go+Python service
  split confirmed.
- **2026-06-05:** Phase 0 scaffolding landed — monorepo, dev stack, proto, service skeletons (build
  green: Go tests pass, SDK offline smoke test passes), CI, k6 load-test harness + certification
  process. Git initialized on `main` (not yet committed).
