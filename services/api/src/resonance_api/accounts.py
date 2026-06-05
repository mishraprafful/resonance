"""Username/password accounts + server-side sessions (Redis-backed, httpOnly cookie).

This is a self-hosted, IdP-free auth path. Passwords are pbkdf2-hashed; the session cookie holds an
opaque random token whose sha256 keys a Redis entry → {user_id, current_org}.
"""

from __future__ import annotations

import functools
import hashlib
import hmac
import json
import os
import secrets

import redis
from fastapi import Cookie, HTTPException

from .settings import settings

COOKIE_NAME = "rsn_session"
SESSION_TTL_S = 7 * 24 * 3600
_PBKDF2_ITERS = 200_000


@functools.lru_cache(maxsize=1)
def _redis():
    return redis.from_url(settings.redis_url, decode_responses=True)


# --- passwords ---
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ITERS)
    return f"pbkdf2${_PBKDF2_ITERS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    try:
        _, iters, salt_hex, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), hash_hex)
    except Exception:
        return False


# --- sessions ---
def _skey(token: str) -> str:
    return f"session:{hashlib.sha256(token.encode()).hexdigest()}"


def create_session(user_id: str, current_org: str | None) -> str:
    token = secrets.token_urlsafe(32)
    _redis().set(_skey(token), json.dumps({"user_id": user_id, "current_org": current_org}),
                 ex=SESSION_TTL_S)
    return token


def read_session(token: str | None) -> dict | None:
    if not token:
        return None
    raw = _redis().get(_skey(token))
    return json.loads(raw) if raw else None


def update_session(token: str, **changes) -> None:
    data = read_session(token) or {}
    data.update(changes)
    _redis().set(_skey(token), json.dumps(data), ex=SESSION_TTL_S)


def delete_session(token: str | None) -> None:
    if token:
        _redis().delete(_skey(token))


# --- dependency ---
class CurrentUser:
    def __init__(self, user_id: str, current_org: str | None, token: str):
        self.user_id = user_id
        self.current_org = current_org
        self.token = token


def current_user(session: str | None = Cookie(default=None, alias=COOKIE_NAME)) -> CurrentUser:
    data = read_session(session)
    if not data:
        raise HTTPException(status_code=401, detail="not authenticated")
    return CurrentUser(user_id=data["user_id"], current_org=data.get("current_org"), token=session)
