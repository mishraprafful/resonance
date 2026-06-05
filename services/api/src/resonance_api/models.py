"""Request/response models for the control plane. Mirror the SDK's wire types."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    slug: str
    name: str | None = None


class Project(BaseModel):
    id: str
    org_id: str
    slug: str
    name: str
    created_at: datetime


class RunCreate(BaseModel):
    project: str  # project slug (created on demand)
    name: str | None = None
    config: dict = Field(default_factory=dict)


class Run(BaseModel):
    id: str
    org_id: str
    project_id: str
    display_name: str | None
    state: str
    config: dict
    created_at: datetime
    finished_at: datetime | None = None


class RunUpdate(BaseModel):
    state: str  # finished | crashed | killed


class MetricSeries(BaseModel):
    run_id: str
    metric: str
    points: list[dict]  # [{step, value}]


# --- audio (first-class) ---
class AssetPrepareRequest(BaseModel):
    sha256: str
    media_type: str = "audio/wav"
    size_bytes: int = 0


class AssetPrepareResponse(BaseModel):
    exists: bool             # true => content already stored, skip upload (dedup)
    storage_key: str
    upload_url: str | None = None  # presigned PUT when exists is False


class AudioLogCreate(BaseModel):
    run_id: str
    key: str                 # logical key, e.g. "samples/val"
    asset_sha: str
    step: int | None = None
    reference_sha: str | None = None
    caption: str | None = None
    media_type: str = "audio/wav"
    size_bytes: int = 0
    sample_rate: int | None = None
    channels: int | None = None
    duration_s: float | None = None


class AudioLogEntry(BaseModel):
    id: str
    key: str
    step: int | None
    caption: str | None
    asset_sha: str
    reference_sha: str | None
    sample_rate: int | None = None
    duration_s: float | None = None
    derived: bool = False
    # No presigned URLs here — they're minted lazily via /v1/assets/{sha}/url (Redis-cached) so a
    # page of 1000s of clips doesn't sign thousands of URLs up front. These flags tell the UI what
    # is available to request.
    has_peaks: bool = False
    has_spectrogram: bool = False


class AudioPage(BaseModel):
    items: list[AudioLogEntry]
    next_cursor: str | None = None


class PresignResponse(BaseModel):
    sha256: str
    kind: str          # original | peaks | spectrogram
    url: str


# --- listening-test ratings (A/B compare) ---
class RatingCreate(BaseModel):
    test_id: str
    asset_sha: str
    score: int
    run_id: str | None = None
    label: str | None = None
    blind: bool = False


class Rating(BaseModel):
    id: str
    test_id: str
    asset_sha: str
    run_id: str | None
    label: str | None
    score: int
    blind: bool


# --- dataset versioning ---
class DatasetCreate(BaseModel):
    name: str
    version: str
    manifest: list[dict] = Field(default_factory=list)  # [{sha256, path, size_bytes}]
    project_id: str | None = None


class Dataset(BaseModel):
    id: str
    name: str
    version: str
    project_id: str | None = None
    item_count: int = 0
    created_at: datetime


class DatasetDetail(Dataset):
    items: list[dict] = Field(default_factory=list)


# --- multi-tenancy: orgs, tokens, members ---
class OrgCreate(BaseModel):
    slug: str
    name: str | None = None
    storage_quota_bytes: int | None = None


class Org(BaseModel):
    id: str
    slug: str
    name: str
    storage_quota_bytes: int | None = None
    storage_used_bytes: int = 0
    created_at: datetime


class TokenCreate(BaseModel):
    name: str
    role: str = "member"  # owner | admin | member


class TokenInfo(BaseModel):
    id: str
    name: str
    role: str
    prefix: str | None = None
    last_used_at: datetime | None = None
    created_at: datetime


class TokenCreated(TokenInfo):
    token: str  # the secret — shown exactly once


class OrgCreated(Org):
    owner_token: str  # bootstrap owner token, shown once


class MemberCreate(BaseModel):
    email: str
    role: str = "member"


class Member(BaseModel):
    user_id: str
    email: str
    role: str


# --- accounts / sessions (username+password auth) ---
class Credentials(BaseModel):
    username: str
    password: str


class SignupRequest(BaseModel):
    username: str
    password: str
    team_mode: str = "create"        # create | join
    team_slug: str | None = None     # for join, or slug of the new team
    team_name: str | None = None     # for create


class SwitchTeam(BaseModel):
    org_id: str


class TeamCreate(BaseModel):
    slug: str
    name: str | None = None
