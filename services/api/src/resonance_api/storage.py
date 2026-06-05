"""Object-store access (audio/blob plane) over the S3 API.

Content-addressed: the object key is derived from the sha256 so identical content collapses to one
object (dedup) and immutable keys are safe to cache at the CDN. Per-tenant key prefix isolates orgs.
"""

from __future__ import annotations

import functools

import boto3
from botocore.client import Config

from .settings import settings


@functools.lru_cache(maxsize=1)
def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def blob_key(org_id: str, sha256: str) -> str:
    """Content-addressed key for an original blob, scoped to the tenant."""
    return f"{org_id}/blobs/{sha256[:2]}/{sha256[2:4]}/{sha256}"


def derived_key(org_id: str, sha256: str, recipe: str) -> str:
    """Deterministic key for a derivation of a source asset (e.g. 'peaks.json')."""
    return f"{org_id}/derived/{sha256}/{recipe}"


def exists(key: str) -> bool:
    try:
        _client().head_object(Bucket=settings.s3_bucket, Key=key)
        return True
    except Exception:
        return False


def presign_put(key: str, content_type: str) -> str:
    return _client().generate_presigned_url(
        "put_object",
        Params={"Bucket": settings.s3_bucket, "Key": key, "ContentType": content_type},
        ExpiresIn=settings.presign_ttl_s,
    )


def presign_get(key: str) -> str:
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": key},
        ExpiresIn=settings.presign_ttl_s,
    )
