# Load testing & capacity certification

Resonance certifies the capacity of each release by running this suite against a fixed **reference
deployment** and recording the numbers that pass the SLO gates. The harness uses
[k6](https://k6.io).

## What it exercises

| Script | Hot path | SLO gate |
|---|---|---|
| `metrics_ingest.js` | `POST /v1/metrics` (batched scalar ingest) | p95 < 50 ms, errors < 0.1% |
| `audio_upload.js` | `POST /v1/assets/prepare` (dedup + presigned URL) then direct-to-store `PUT` | prepare p95 < 75 ms, errors < 0.1% |

`audio_upload.js` deliberately separates the **coordination** latency (our gateway) from the
**direct-to-store PUT** latency, proving audio bytes never transit the gateway and that dedup
suppresses uploads (`DEDUP_RATIO`, default 0.7).

## Run

```bash
# bring the stack + ingest gateway up first, then:
./loadtest/run.sh http://localhost:8080
# or a single scenario:
VUS=200 DURATION=3m BASE_URL=http://localhost:8080 k6 run tests/load/metrics_ingest.js
```

Summaries are written to `tests/load/results/<timestamp>/*.json`. Promote a passing run's numbers into
the **Certified capacity** table in the root `README.md`.

## Reference deployment (the spec numbers are certified against)

> Fill in for your release. Capacity claims are only meaningful against a named reference rig.

- ingest gateway: 3 replicas × 2 vCPU / 2 GiB (k8s HPA)
- ClickHouse: 3-node cluster, NVMe
- object store: S3-compatible, 10 GbE
- Redpanda: 3 brokers

## Methodology

1. Warm the stack; run each scenario for ≥ 3 min at steady state.
2. A scenario **passes** only if its SLO thresholds hold (k6 exits non-zero otherwise).
3. Ramp VUs until a threshold breaks; the **last passing** load is the certified figure.
4. Record: sustained metric points/sec, audio-prepare req/sec, dedup hit ratio, p50/p95/p99,
   error rate, and the reference rig + commit SHA.

Until a release is run on the reference rig, the README table shows **design targets**, clearly
labelled — never publish an unmeasured number as "certified".
