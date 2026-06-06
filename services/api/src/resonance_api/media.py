"""Mint auth-scoped URLs for the Go media gateway.

The control API authorizes the request (tenant + RBAC), then hands the browser a short-lived
HMAC-signed URL pointing at the media gateway. The gateway verifies the signature (shared secret)
and range-streams the content-addressed blob — so streaming is auth-scoped without the gateway
needing database access, and audio bytes never transit this control plane.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from .settings import settings


def enabled() -> bool:
    return bool(settings.media_gateway_url)


def _sign(key: str, exp: int) -> str:
    return hmac.new(
        settings.media_signing_secret.encode(), f"{key}\n{exp}".encode(), hashlib.sha256
    ).hexdigest()


def stream_url(object_key: str) -> str:
    """Signed gateway URL for an object key. Key segments are content-addressed (uuid/hex/slashes),
    so they are already URL-path-safe and need no escaping; the signature covers key + expiry."""
    exp = int(time.time()) + settings.presign_ttl_s
    base = settings.media_gateway_url.rstrip("/")
    return f"{base}/v1/stream/{object_key}?exp={exp}&sig={_sign(object_key, exp)}"
