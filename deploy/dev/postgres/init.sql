-- Resonance metadata plane — dev bootstrap schema.
-- Multi-tenant: every domain row is scoped by org_id. This is the minimal Phase-0 skeleton;
-- migrations (alembic) own the real schema from Phase 1 onward.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS orgs (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug               TEXT UNIQUE NOT NULL,
    name               TEXT NOT NULL,
    storage_quota_bytes BIGINT,            -- NULL = unlimited
    rate_limit_per_min  INT,               -- NULL = unlimited
    -- Per-tenant storage-lifecycle policy {ia_days, archive_days}; NULL => platform defaults.
    lifecycle_policy   JSONB,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      TEXT UNIQUE,             -- login id (username/password auth)
    email         TEXT UNIQUE,
    password_hash TEXT,                     -- pbkdf2$iter$salt$hash
    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,  -- platform admin (first-run bootstrap user)
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Requests to join a team (org). Created at signup ("join existing") or later; an org owner/admin
-- (or a platform admin) approves. Not under RLS: a requester isn't a member yet.
CREATE TABLE IF NOT EXISTS membership_requests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'member',
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at  TIMESTAMPTZ,
    UNIQUE (user_id, org_id)
);

CREATE TABLE IF NOT EXISTS api_tokens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,    -- sha256(token); the token itself is shown once
    prefix       TEXT,                    -- non-secret display prefix, e.g. rsn_ab12…
    role         TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member
    last_used_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Org membership (humans). Roles mirror token roles for now.
CREATE TABLE IF NOT EXISTS org_members (
    org_id   UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role     TEXT NOT NULL DEFAULT 'member',
    PRIMARY KEY (org_id, user_id)
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
    -- Storage lifecycle tiering (Phase 5). The worker's lifecycle sweep transitions hot -> ia ->
    -- archive by age since last activity (per-tenant policy) and applies the tier as an S3 object
    -- tag (real S3/GCS lifecycle rules key off it); access warms an asset back to hot. Non-destructive
    -- — bytes are never deleted, only their storage class/cost changes.
    storage_tier     TEXT NOT NULL DEFAULT 'hot',  -- hot | ia | archive
    last_accessed_at TIMESTAMPTZ,                   -- recency signal; bumped when a URL is minted
    tiered_at        TIMESTAMPTZ,                   -- when storage_tier last changed
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, sha256)         -- dedup is per-tenant
);
-- Workers claim derivation work by scanning for rows where derived_at IS NULL.
CREATE INDEX IF NOT EXISTS assets_pending_derivation_idx
    ON assets (created_at) WHERE derived_at IS NULL;
-- Lifecycle sweep + per-tenant tier breakdowns scan by (org, tier).
CREATE INDEX IF NOT EXISTS assets_tier_idx ON assets (org_id, storage_tier);

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

-- Blind/sighted listening-test ratings, logged back from the A/B compare view.
CREATE TABLE IF NOT EXISTS ratings (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    test_id     TEXT NOT NULL,           -- groups one comparison session
    asset_sha   TEXT NOT NULL,
    run_id      UUID,
    label       TEXT,                    -- human label of the track (run/step), for results
    score       INT NOT NULL,            -- e.g. 1..5
    blind       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ratings_test_idx ON ratings (org_id, test_id);

-- ── Tenant isolation: Row-Level Security on data tables (defense-in-depth) ──────────────────────
-- The API connects as the least-privilege role `resonance_app` and runs every request with
-- `SET LOCAL app.current_org = <org>`. RLS then filters every row to that org even if an app-level
-- WHERE clause is ever forgotten. Auth tables (orgs/api_tokens/org_members/users) are intentionally
-- NOT under RLS so the auth bootstrap (resolve a token -> its org) can run before any org is set.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','runs','assets','audio_logs','dataset_versions','ratings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY org_isolation ON %I USING '
      '(org_id = current_setting(''app.current_org'', true)::uuid) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true)::uuid)', t);
  END LOOP;
END $$;

-- Least-privilege application role (non-superuser, so RLS actually applies to it).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'resonance_app') THEN
    CREATE ROLE resonance_app LOGIN PASSWORD 'resonance_app';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO resonance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO resonance_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO resonance_app;

-- Seed a dev org + an owner token so local dev works out of the box.
INSERT INTO orgs (slug, name) VALUES ('dev', 'Dev Org')
    ON CONFLICT (slug) DO NOTHING;
INSERT INTO api_tokens (org_id, name, token_hash, prefix, role)
SELECT id, 'dev-owner', encode(digest('rsn_dev_token', 'sha256'), 'hex'), 'rsn_dev', 'owner'
FROM orgs WHERE slug = 'dev'
ON CONFLICT (token_hash) DO NOTHING;
