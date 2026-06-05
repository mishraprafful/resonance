-- Resonance metrics plane — dev bootstrap schema.
-- Append-only scalar time-series. One wide table, columnar, partitioned by month.
-- Cross-run scans, downsampling and sweep queries read this. org_id scopes every row.

CREATE DATABASE IF NOT EXISTS resonance;

CREATE TABLE IF NOT EXISTS resonance.metrics
(
    org_id      UUID,
    project_id  UUID,
    run_id      UUID,
    metric      LowCardinality(String),   -- e.g. "loss/mel"
    step        Int64,
    ts          DateTime64(3) DEFAULT now64(3),
    value       Float64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, run_id, metric, step)
TTL toDateTime(ts) + INTERVAL 2 YEAR;     -- retention placeholder; per-tenant policy later

-- System metrics (GPU/CPU/mem) kept separate so product metrics stay clean.
CREATE TABLE IF NOT EXISTS resonance.system_metrics
(
    org_id      UUID,
    run_id      UUID,
    metric      LowCardinality(String),   -- e.g. "gpu.0.util"
    ts          DateTime64(3) DEFAULT now64(3),
    value       Float64
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (org_id, run_id, metric, ts)
TTL toDateTime(ts) + INTERVAL 1 YEAR;
