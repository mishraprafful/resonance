-- Resonance metadata plane — dev bootstrap schema.
-- Multi-tenant: every domain row is scoped by org_id. This is the minimal Phase-0 skeleton;
-- migrations (alembic) own the real schema from Phase 1 onward.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS orgs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT UNIQUE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    slug        TEXT NOT NULL,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, slug)
);

CREATE TABLE IF NOT EXISTS runs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    display_name TEXT,
    state       TEXT NOT NULL DEFAULT 'running',  -- running | finished | crashed | killed
    config      JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS runs_project_idx ON runs (org_id, project_id, created_at DESC);

-- Content-addressed audio assets. Bytes live in object storage; this is metadata only.
CREATE TABLE IF NOT EXISTS assets (
    sha256      TEXT NOT NULL,
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    media_type  TEXT NOT NULL,           -- e.g. audio/wav
    size_bytes  BIGINT NOT NULL,
    storage_key TEXT NOT NULL,           -- content-addressed object key
    sample_rate INT,
    channels    INT,
    duration_s  DOUBLE PRECISION,
    lufs        DOUBLE PRECISION,        -- integrated loudness (probe)
    peak_dbfs   DOUBLE PRECISION,
    -- Async derivations (waveform peaks, spectrogram, streamable rendition) produced by workers.
    derived_at  TIMESTAMPTZ,             -- NULL => still needs derivation (DB-backed work queue)
    derivations JSONB NOT NULL DEFAULT '{}',  -- {peaks_key, spectrogram_key, rendition_key}
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, sha256)         -- dedup is per-tenant
);
-- Workers claim derivation work by scanning for rows where derived_at IS NULL.
CREATE INDEX IF NOT EXISTS assets_pending_derivation_idx
    ON assets (created_at) WHERE derived_at IS NULL;

-- Per-run audio log entries referencing an asset (the first-class audio primitive).
CREATE TABLE IF NOT EXISTS audio_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    run_id      UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,           -- logical key, e.g. "samples/val"
    step        BIGINT,
    asset_sha   TEXT NOT NULL,
    reference_sha TEXT,                   -- optional ground-truth asset for A/B
    caption     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audio_logs_run_key_idx ON audio_logs (org_id, run_id, key, step);

-- Cheap dataset versioning: a manifest of content-addressed asset refs.
CREATE TABLE IF NOT EXISTS dataset_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    version     TEXT NOT NULL,
    manifest    JSONB NOT NULL DEFAULT '[]',   -- [{sha256, path, ...}]
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, name, version)
);

-- Seed a dev org so the SDK can talk to a real tenant out of the box.
INSERT INTO orgs (slug, name) VALUES ('dev', 'Dev Org')
    ON CONFLICT (slug) DO NOTHING;
