"""Per-tenant rate limiting via a Redis fixed-window counter.

Best-effort: if Redis is unavailable we fail open (don't block the request), since rate limiting is
a protection, not a correctness requirement.
"""

from __future__ import annotations

import functools
import time

import redis
from fastapi import HTTPException

from .settings import settings


@functools.lru_cache(maxsize=1)
def _redis():
    return redis.from_url(settings.redis_url, decode_responses=True)


def check(org_id: str, limit: int | None = None) -> None:
    """Count this request against the org's per-minute budget; raise 429 when exceeded."""
    limit = limit or settings.default_rate_limit_per_min
    if limit <= 0:
        return
    try:
        r = _redis()
        window = int(time.time() // 60)
        key = f"rl:{org_id}:{window}"
        n = r.incr(key)
        if n == 1:
            r.expire(key, 60)
    except Exception:
        return  # fail open
    if n > limit:
        raise HTTPException(status_code=429, detail="rate limit exceeded")
