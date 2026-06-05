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
