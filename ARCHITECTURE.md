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
  SDK. **Audio coordination lives here, off the ingest hot path** (audio is logged every N steps —
  low-frequency control-plane work, and it keeps Postgres + the S3 client in one service):
  `POST /v1/assets/prepare` (dedup + presigned PUT), `POST /v1/audio` (register asset + log), and
  `GET /v1/runs/{id}/audio` (presigned playback/derivation URLs).
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

## 7b. Long-form audio at scale (≥3 min clips × 1000s of clips) — requirements

**Requirement (recorded 2026-06-05):** generated/logged audio is **full-length, ≥3 minutes**, and a
project must comfortably hold **1000s of such clips** and support **A/B comparison across them**.

### Sizing assumptions
- One 3-min clip ≈ **16 MB** (mono 22.05 kHz float WAV) to **~30 MB** (stereo 44.1 kHz 16-bit).
- Cardinality: **1000s–100k clips** per project (many runs × per-step samples + references).
- Storage: 10k clips ≈ **0.3–0.5 TB**; 100k ≈ **multi-TB**; platform-wide **PB** (per the §2 target).

### What the current design already handles (no re-architecture needed)
- Object storage is effectively unbounded and bytes **never transit the API** (presigned direct
  upload + presigned playback) — clip length doesn't stress the control/ingest planes.
- **Content-addressed dedup** collapses re-logged references/datasets to one copy — at this
  cardinality (the same val set / reference logged across thousands of runs) this is the dominant
  storage saving.
- Metrics (ClickHouse) and metadata (Postgres) are independent of clip length.

### Hard constraint: comparison uses ORIGINAL quality
A/B comparison exists to judge **audio quality**, so the compare path must serve the **exact
uploaded bytes** (lossless, content-addressed original). A lossy rendition (Opus/AAC) would destroy
the very artifacts being compared and is therefore **never** the comparison source. Renditions, if
added, are a **preview/browse** optimization only (e.g. quick scrubbing in long lists) and must be
clearly labelled as not-for-quality-judgement. Originals are range-streamed and lazy-loaded.

### What this target makes REQUIRED (and reprioritizes from "later" to "core")
1. **Stream originals efficiently (no lossy rendition on the compare path).** A 3-min original is
   8–30 MB; we make playback usable via **HTTP range requests** (browsers issue them natively
   against presigned object-store URLs — MinIO/S3 support range) plus **lazy loading** (only fetch
   clips actually opened/compared). The Go **media gateway + CDN** add auth-scoped streaming and
   edge caching later (Phase 4/5). An optional compressed rendition may be added purely for fast
   *browsing* of long lists — but per the constraint above, comparison always plays the original.
2. **Multi-resolution derivations.** One 1000-bucket peaks file / 800-column spectrogram is too
   coarse to zoom into 3 min. → **mip-leveled waveform peaks** and **tiled spectrograms**; the UI
   fetches only the visible resolution/region.
3. **Resumable multipart upload** for large blobs (multipart presigned URLs + client retry) instead
   of a single PUT.
4. **Paginated listings + lazy presigning.** Never presign 1000s of URLs in one response —
   paginate `GET /runs/{id}/audio` and presign **on demand** (per item opened / per comparison
   slot), caching presigned URLs in Redis with a TTL.
5. **Comparison view streams on demand.** Synced A/B across many clips loads only what's on screen,
   uses range streaming of the rendition, and lazy-loads waveforms/spectrograms.
6. **Derivation throughput.** STFT + transcode of 3-min clips is CPU-heavy; 1000s of clips ⇒
   **horizontally scaled workers autoscaled on queue depth**. This is where the durable **Redpanda**
   queue earns its place over the current Postgres poll-queue, and where the **ffmpeg transcode**
   step lands.
7. **Storage lifecycle + CDN.** Hot (recent/active runs) on standard + CDN; tier originals to
   infrequent-access/archive by run age & access recency. Dedup + tiering are the cost levers.

**Net:** the three-plane + CAS architecture does **not** fundamentally change. This target
**reprioritizes** streaming (rendition + range/HLS + CDN), multi-resolution derivations, multipart
upload, and pagination/lazy-presign from "later" into the core path, and strengthens the case for
Redpanda-backed, autoscaled derivation workers.

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
- [x] **Phase 1 — Tracking MVP (W&B parity baseline):** SDK `init`/`log`/`finish` (online mode),
  Ingestion Gateway (buffered ClickHouse insert + load-shed backpressure), ClickHouse metrics path,
  Control API (projects/runs CRUD + downsampled metric query), web UI with polling live charts +
  config panel. *Exit met:* `examples/train_demo.py` logs scalars end-to-end (SDK → ingest →
  ClickHouse) and they read back through the API; verified 270k pts landed under a concurrent probe.
- [x] **Phase 2 — Audio first-class:** `log_audio` upload flow (dedup check → direct-to-store
  presigned PUT → register), CAS object store with per-tenant prefixes, async derivation worker
  (waveform peaks + spectrogram + probes via a DB-backed work queue), control-plane audio endpoints
  with presigned playback URLs, UI audio panel (per-step step slider, player, waveform,
  spectrogram, output-vs-reference). *Exit met:* `examples/train_demo.py` uploads per-step samples;
  identical content uploads zero bytes (verified: reference logged 8× stored once); derivations
  render; all presigned URLs serve. (Transcode-to-Opus rendition + a Go media gateway with
  range/HLS/CDN deferred to Phase 4/5; playback currently uses presigned GETs to the original WAV.)
- [x] **Phase 3 — Audio UX depth + long-clip scale (see §7b):** A/B synced compare + blind-test
  mode (plays **original quality** only, ratings logged via `/v1/ratings`), paginated
  `runs/{id}/audio` (keyset cursor) with **lazy/on-demand, Redis-cached presigned URLs**
  (`/v1/assets/{sha}/url`, originals range-streamed), `log_dataset` + content-addressed dataset
  versioning/manifests + dataset view. *Exit met:* paginated lazy-presigned listings verified;
  compare/datasets UIs build; dataset dedup verified (same content → one version); ratings
  round-trip. *Deferred within Phase 3+:* multi-resolution peaks/tiled spectrograms, resumable
  multipart upload, optional browse-only rendition, Go media gateway + CDN.
- [~] **Phase 4 — Multi-tenancy hardening:** orgs + hashed **API tokens** + **RBAC**
  (owner/admin/member, role-gated endpoints), **per-tenant isolation** (app-level org scoping +
  Postgres **RLS** with FORCE policies + least-privilege `resonance_app` DB role setting
  `app.current_org`), **storage quotas** (413 over limit) and **per-tenant rate limits** (Redis
  fixed-window, 429). *Exit met:* cross-tenant denial verified at both API and raw-DB (RLS) level;
  RBAC 403; quota 413; rate-limit 429. *Deferred:* SSO/OIDC (needs external IdP) and tiered
  lifecycle + CDN (cloud infra) — see Phase 5.
- [x] **Phase 4b — Browser auth (username/password):** first-run **admin bootstrap**, **signup**
  (create a team or request to join an existing one), **login/logout** with Redis-backed httpOnly
  sessions (pbkdf2 passwords), **team switching**, and **join-request approval** by team
  owners/admins. `principal()` accepts a session cookie (→ user's active team + role) alongside the
  Bearer API-token and dev-open paths, so the same RBAC/RLS/quota/rate-limit controls apply to
  browser users. Web: auth gate + bootstrap/login/signup screens + Account/Teams page. *Exit met:*
  bootstrap→admin, signup-create→owner, signup-join→pending→approve→member, session data scoped per
  active team (Acme sees 0 of Dev's projects), dev-open still serves the SDK.
- [~] **Phase 5 — Scale & ops (+ Phase 4 deferrals):** SSO/OIDC login, tiered storage lifecycle +
  CDN, ClickHouse sharding, autoscaling, retention/lifecycle automation,
  observability (OTel/Prometheus/Grafana), Helm/Terraform/ArgoCD, load tests.
  - [x] **Go media/streaming gateway + CDN-frontable playback** (closes the Phase 2/3/4 deferral):
    stateless Go gateway range-streams content-addressed originals from the object store; the control
    API mints short-lived **HMAC-signed** URLs (`/v1/assets/{sha}/stream-url`, shared secret) so
    streaming is auth-scoped without the gateway touching the DB, and **audio bytes never transit the
    Python control plane**. Immutable `Cache-Control` (keys are content-addressed) makes the path
    CDN-cacheable. Falls back to a direct presigned GET when `MEDIA_PUBLIC_URL` is unset. Always serves
    **original quality** on the compare path (§7b). Web compare/audio/datasets views use it.
  - [x] **Event-driven derivation queue** (foundation for lag-based worker autoscaling): the API
    publishes a job to **Redpanda** (via pandaproxy REST) on new-asset registration; workers consume
    a consumer group (KEDA/HPA can scale on group lag). **Best-effort** — the worker keeps the
    Postgres `derived_at IS NULL` poll as a correctness backstop, so a dropped/undelivered message
    never loses work, and derivation is idempotent across both paths.
  - [x] **ClickHouse sharding** (closes the §7 "ClickHouse sharded + replicated" lever): the metrics
    plane is now a `resonance` cluster of **2 shards** (1 replica each in dev) coordinated by
    **ClickHouse Keeper**. Each shard holds a `*_local` **ReplicatedMergeTree**; an unsuffixed
    **Distributed** table (`metrics`, `system_metrics`) fans reads/writes across shards, sharded by
    **`cityHash64(run_id)`** so a run's points co-locate on one shard (per-run queries stay
    single-shard) while runs spread evenly. **Application code is sharding-agnostic** — the API still
    queries `metrics`/`system_metrics` and the ingest gateway still inserts into `metrics` (now with
    `insert_distributed_sync` so a row lands on its owning shard synchronously); scaling out is a
    cluster-config + rebalance change, not an app change.
  - [ ] Remaining: SSO/OIDC, tiered storage lifecycle automation, the actual
    autoscaling manifests (HPA/KEDA), retention automation, observability (OTel/Prometheus/Grafana),
    Helm/Terraform/ArgoCD, load tests.

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
  process. Pushed to github.com/mishraprafful/resonance (private).
- **2026-06-05:** Phase 1 landed and verified end-to-end against the live dev stack: SDK online →
  ingest gateway → ClickHouse; Control API serves runs (Postgres) + downsampled metrics
  (ClickHouse); web UI builds + typechecks. Local single-replica throughput probe: ~640k metric
  points/sec accepted, 270k landed, load-shed (503) verified when the ingest buffer saturates. All
  unit suites green (Python + Go). NOTE: ClickHouse metric columns are typed `UUID`, so ingest
  requires valid UUID run/project/org ids (the SDK gets these from the control API).
- **2026-06-05:** Phase 2 (audio first-class) landed and verified end-to-end against the live stack:
  `log_audio` does dedup-check → direct-to-store presigned PUT → register; the derivation worker
  (DB-backed work queue) produced waveform peaks + spectrogram + probes (duration/channels/sr/
  peak_dbfs); the audio panel renders player + waveform + spectrogram + output-vs-reference.
  Verified dedup (reference logged 8× across runs → stored once; explicit prepare returns
  `exists:true`/no-URL), 9 assets all derived, and all presigned URLs serve (wav/json/png, HTTP
  200). DECISIONS: audio coordination runs on the control plane (§4); derivation uses a Postgres
  work queue (`assets.derived_at IS NULL` + `FOR UPDATE SKIP LOCKED`) instead of Redpanda for now;
  Opus rendition + Go media gateway (range/HLS/CDN) deferred to Phase 4/5 (playback uses presigned
  GETs to the original WAV). All unit suites green; web typechecks + builds.
- **2026-06-05:** Recorded the long-form-audio scale requirement (§7b): clips are **≥3 min** and a
  project must hold **1000s** of them with A/B comparison. Conclusion: no fundamental
  re-architecture (object storage + CAS dedup + tiering already scale), but streaming (Opus
  rendition + range/HLS + CDN), multi-resolution derivations, multipart upload, and
  pagination/lazy-presign are **promoted into Phase 3**, and derivation moves to Redpanda-backed
  autoscaled workers. Demo (`examples/train_demo.py`) now logs 3-min clips by default
  (`DEMO_AUDIO_SECONDS`, `DEMO_SAMPLES`).
- **2026-06-05:** Phase 3 landed + verified end-to-end. **Hard constraint recorded & honored:** A/B
  comparison serves **original uploaded quality** (a lossy rendition would defeat quality
  comparison) — `/v1/assets/{sha}/url?kind=original` returns the exact bytes. Added: keyset-paginated
  `runs/{id}/audio` with **lazy, Redis-cached** presigned URLs (no signing 1000s up front); audio
  panel rewritten to presign per selected step; **A/B synced compare + blind-test** UI (shuffle/
  hide/reveal, ratings → `/v1/ratings`); **content-addressed dataset versioning** (`log_dataset` →
  manifest; version id = hash of member set, so identical datasets collapse to one version) + dataset
  browser. Verified: pagination (`next_cursor`), Redis presign cache hit, dataset dedup (one
  version), ratings round-trip. All suites green; web builds.
- **2026-06-05:** Phase 4 (multi-tenancy hardening) core landed + verified. Orgs + hashed API tokens
  + RBAC (owner/admin/member); auth via `Principal` (Bearer token → org+role, dev-open fallback for
  local). **Isolation is two-layered:** mandatory app-level org scoping AND Postgres RLS (FORCE
  policies on all 6 data tables) enforced by running the API as a non-superuser `resonance_app` role
  that sets `app.current_org` per request (the worker keeps the superuser DSN to derive across
  tenants). Per-tenant **storage quota** (413) and **rate limit** (Redis fixed-window, 429).
  Verified: org B sees 0 of dev's projects (API and raw-DB/RLS), member→403/owner→200, quota→413,
  rate-limit allowed 3 / blocked 3. DEFERRED to Phase 5: SSO/OIDC (needs external IdP), tiered
  lifecycle + CDN. Dev: API connects as `resonance_app`, worker as superuser; seeded `dev` owner
  token; schema change ⇒ `make dev-reset`.
- **2026-06-05:** Phase 4b — browser auth (username/password) added. First-run admin bootstrap;
  signup (create team → owner / join existing → pending request); login/logout with Redis-backed
  httpOnly sessions (pbkdf2); team switcher; join-request approve/deny by team owner/admin. Session
  cookie feeds `principal()` (active team + role) so RBAC/RLS/quota/rate-limit apply to browser
  users too; dev-open still serves the SDK. Verified end-to-end (bootstrap→admin, create→owner,
  join→pending→approve→member, per-team data scoping: Acme 0 vs Dev 1). Web: auth gate +
  bootstrap/login/signup + Account/Teams page. Team = org; projects live under teams; users can
  belong to many teams and request to join more.
- **2026-06-05:** Web UI redesigned on the Epidemic Sound design system (from a Claude Design
  handoff bundle). Replaced the bare `system-ui` scaffold with a tokenized theme (`web/src/design/`:
  `theme.ts` light/dark/density/accent tokens, `icons.tsx`, `ui.tsx` atoms, `audioviz.tsx`,
  `tweaks.tsx`, `styles.css` + Inter/Roboto Serif fonts) and rebuilt every surface: top-nav/sidebar
  shell with team + project switchers and user menu; runs leaderboard (sortable table + cards, eval
  columns **derived from `eval/*` metric series**, trend sparklines, stat strip); run detail (eval
  tiles, live metric charts, config/system/dataset rails, audio panel with key tabs → step scrub →
  synced waveform+spectrogram → A/B output/reference); Compare (overlay charts + eval table, synced
  A/B blind-test → `/v1/ratings`, prompt/key grid); Gallery + full-screen spectrogram focus viewer
  (live colormap switch); Datasets; Account/Teams; split-screen Auth. **All wired to the real `/v1`
  API** — waveforms render from `peaks.json` (no client-side decode), spectrograms from the server
  PNG (recolored by luminance through the active colormap when pixels are CORS-readable, else shown
  as-is), audio plays from presigned **original**-quality URLs. A **Tweaks** panel (⌘.) persists
  theme/accent/colormap/chart-style/density/nav/runs-view to localStorage. Web typechecks (strict) +
  builds clean; dev server serves 200.
- **2026-06-06:** Phase 5 first slice landed + verified end-to-end against the live stack — **Go
  media/streaming gateway** and **event-driven derivation queue**. (1) Media gateway:
  `services/media` (`gateway` + stdlib SigV4 `objstore` packages), stateless, range-proxies
  content-addressed originals; the control API mints short-lived HMAC-signed URLs
  (`/v1/assets/{sha}/stream-url`) the gateway verifies (shared secret) — bytes never transit the
  Python plane, immutable `Cache-Control` makes it CDN-cacheable, direct-presign fallback when
  `MEDIA_PUBLIC_URL` is unset; web compare/audio/datasets use `streamUrl`. (2) Event-driven
  derivation: API publishes to Redpanda (pandaproxy REST) on new-asset registration; the worker runs
  a REST consumer (group `resonance-derivers`) **and** keeps the Postgres `derived_at IS NULL` poll
  as a correctness backstop — best-effort publish, idempotent derivation across both paths. Verified
  on a fresh stack: 3 `/v1/audio` → group offset 0→4, **LAG 0**, 4 assets derived; `stream-url`
  resolves to the gateway, full GET 200 (`audio/wav`, immutable, `Accept-Ranges`), ranged GET 206
  (`Content-Range bytes 0-99/176444`), tampered/expired sig → 403, streamed bytes a valid WAV. All
  Python (api 4, workers 7) + Go (gateway/objstore) suites green; web typechecks. GOTCHA fixed:
  pandaproxy produce does **not** auto-create topics and `rpk topic create` ignores the
  `-X brokers`/`RPK_BROKERS` override in the redpanda image (dials localhost) — the `redpanda-init`
  topic-create now runs in redpanda's network namespace (`network_mode: service:redpanda`) so the
  default localhost broker is the cluster. DEFERRED (rest of Phase 5): SSO/OIDC, tiered lifecycle
  automation, ClickHouse sharding, HPA/KEDA autoscaling manifests, retention automation, observability
  (OTel/Prometheus/Grafana), Helm/Terraform/ArgoCD, load tests.
- **2026-06-06:** Phase 5 — **ClickHouse sharding** landed. The metrics plane is now a 2-shard
  `resonance` cluster (1 replica/shard in dev) coordinated by **ClickHouse Keeper**: dev compose runs
  `clickhouse-keeper` + `clickhouse-01`/`clickhouse-02` + a `clickhouse-init` one-shot that applies
  the `ON CLUSTER` DDL once both nodes are reachable (initdb can't, since ON CLUSTER needs every node
  up). Each shard holds a `*_local` ReplicatedMergeTree (`/clickhouse/tables/{shard}/…`, macros per
  node); the unsuffixed `metrics`/`system_metrics` are **Distributed** over `cityHash64(run_id)` so a
  run co-locates on one shard. **No app changes** beyond the ingest sink adding
  `insert_distributed_sync=1` — the API still queries `metrics` and ingest still inserts into
  `metrics`. GOTCHAS: node 2's HTTP is on host **8124** (8123 = node 1, the API/ingest target); the
  Distributed/remote_servers entries carry the `resonance` user/password for inter-node queries;
  `make dev-reset` is required (new per-node data dirs + Keeper). Verified end-to-end on the live
  stack: `system.clusters` shows 2 shards; `make demo` (SDK → Go ingest → Distributed `metrics`)
  landed all 3 demo runs (400 rows each) on shard 2 while 8 ad-hoc test runs split 6/2 across shards;
  **every run's points co-locate on exactly one shard** (none span both), and the Distributed table
  returns the same per-run counts queried from either node. (GOTCHA found + fixed: the node/keeper
  healthchecks must hit `127.0.0.1`, not `localhost` — the container resolves `localhost` to `::1`
  but the server binds IPv4 only, so a `localhost` probe gets connection-refused and the node never
  goes healthy.) All Go (ingest) + Python suites green.
