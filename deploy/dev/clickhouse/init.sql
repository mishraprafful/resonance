-- Resonance metrics plane — sharded cluster bootstrap schema.
-- Append-only scalar time-series, columnar, partitioned by month. Cross-run scans, downsampling and
-- sweep queries read this; org_id scopes every row.
--
-- Topology: a `resonance` cluster of 2 shards (1 replica each in dev) coordinated by ClickHouse
-- Keeper. Each shard holds a *_local ReplicatedMergeTree; a Distributed table fans reads/writes
-- across shards. Sharding key = cityHash64(run_id) so all of a run's points land on one shard (the
-- dominant per-run query path stays single-shard) while runs spread evenly across the cluster.
--
-- NOTE: applied by the `clickhouse-init` one-shot (not the per-node initdb) because ON CLUSTER DDL
-- needs every node + Keeper reachable. The control API and ingest gateway read/write the *unsuffixed*
-- Distributed tables (`metrics`, `system_metrics`), so application code is sharding-agnostic.

CREATE DATABASE IF NOT EXISTS resonance ON CLUSTER resonance;

CREATE TABLE IF NOT EXISTS resonance.metrics_local ON CLUSTER resonance
(
    org_id      UUID,
    project_id  UUID,
    run_id      UUID,
    metric      LowCardinality(String),   -- e.g. "loss/mel"
    step        Int64,
    ts          DateTime64(3) DEFAULT now64(3),
    value       Float64
)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/metrics_local', '{replica}')
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, run_id, metric, step)
TTL toDateTime(ts) + INTERVAL 2 YEAR;     -- retention placeholder; per-tenant policy later

CREATE TABLE IF NOT EXISTS resonance.metrics ON CLUSTER resonance
AS resonance.metrics_local
ENGINE = Distributed(resonance, resonance, metrics_local, cityHash64(run_id));

-- System metrics (GPU/CPU/mem) kept separate so product metrics stay clean. Same shard key as
-- `metrics` so a run's product + system series co-locate on one shard.
CREATE TABLE IF NOT EXISTS resonance.system_metrics_local ON CLUSTER resonance
(
    org_id      UUID,
    run_id      UUID,
    metric      LowCardinality(String),   -- e.g. "gpu.0.util"
    ts          DateTime64(3) DEFAULT now64(3),
    value       Float64
)
ENGINE = ReplicatedMergeTree('/clickhouse/tables/{shard}/system_metrics_local', '{replica}')
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, run_id, metric, ts)
TTL toDateTime(ts) + INTERVAL 1 YEAR;

CREATE TABLE IF NOT EXISTS resonance.system_metrics ON CLUSTER resonance
AS resonance.system_metrics_local
ENGINE = Distributed(resonance, resonance, system_metrics_local, cityHash64(run_id));
