"""Publish derivation jobs to the durable stream (Redpanda) via its HTTP proxy (pandaproxy).

Triggering derivation off an event — instead of only a Postgres poll — lets the audio workers scale
on queue depth (KEDA/HPA on consumer-group lag). Publishing is **best-effort**: the worker keeps a
Postgres poll as a correctness backstop, so a dropped or undelivered message never loses work. Uses
the HTTP proxy (httpx, already a dependency) so we need no native Kafka client.
"""

from __future__ import annotations

import httpx

from .settings import settings

_KAFKA_JSON = "application/vnd.kafka.json.v2+json"


def enabled() -> bool:
    return bool(settings.pandaproxy_url)


def publish_derivation(org_id: str, sha256: str, storage_key: str) -> bool:
    """Enqueue a derivation job for a newly registered asset. Returns False (swallowing errors) if
    the queue is unconfigured or unreachable — the worker's DB backstop will still pick the asset up."""
    if not enabled():
        return False
    url = f"{settings.pandaproxy_url.rstrip('/')}/topics/{settings.derivation_topic}"
    payload = {"records": [{"value": {"org_id": org_id, "sha256": sha256, "storage_key": storage_key}}]}
    try:
        resp = httpx.post(url, json=payload, headers={"Content-Type": _KAFKA_JSON}, timeout=2.0)
        return resp.status_code < 300
    except Exception:
        return False  # best-effort; the Postgres poll backstop guarantees the asset is derived
