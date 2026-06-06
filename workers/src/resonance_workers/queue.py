"""Consume derivation jobs from Redpanda via its HTTP proxy (pandaproxy).

A minimal REST consumer-group client (no native Kafka dependency): create a consumer instance,
subscribe, long-poll records, commit offsets. Event-driven derivation lets the worker fleet scale on
consumer-group lag (KEDA/HPA). Correctness does not depend on the queue — `main.py` also polls
Postgres for any asset still needing derivation — so this path is the fast lane, not the source of
truth. (Pandaproxy requires manual offset commit; auto-commit is unsupported.)
"""

from __future__ import annotations

import httpx

_V2 = "application/vnd.kafka.v2+json"
_JSON_V2 = "application/vnd.kafka.json.v2+json"


class RestConsumer:
    def __init__(self, proxy_url: str, group: str, topic: str, client: httpx.Client | None = None):
        self.proxy = proxy_url.rstrip("/")
        self.group = group
        self.topic = topic
        self.base = ""  # set on start() from the proxy-assigned instance id
        self._positions: dict[tuple[str, int], int] = {}  # (topic, partition) -> last offset seen
        self._http = client or httpx.Client(timeout=30.0)

    def start(self) -> None:
        # Let the proxy assign an instance id (avoids name collisions across restarts). Pandaproxy
        # rejects auto-commit, so we commit explicitly after processing each batch.
        resp = self._http.post(
            f"{self.proxy}/consumers/{self.group}",
            headers={"Content-Type": _V2},
            json={"format": "json", "auto.offset.reset": "earliest", "auto.commit.enable": "false"},
        )
        resp.raise_for_status()
        instance = resp.json()["instance_id"]
        # Address the instance via our own proxy URL — the proxy-returned base_uri advertises the
        # container-internal host (0.0.0.0), which is unreachable from outside.
        self.base = f"{self.proxy}/consumers/{self.group}/instances/{instance}"
        self._http.post(
            f"{self.base}/subscription", headers={"Content-Type": _V2},
            json={"topics": [self.topic]},
        ).raise_for_status()

    def poll(self, timeout_ms: int = 1000) -> list[dict]:
        """Return decoded record values, or [] when idle. Each value is the published job dict.
        Tracks the latest offset per partition so commit() can advance the group position."""
        resp = self._http.get(
            f"{self.base}/records?timeout={timeout_ms}", headers={"Accept": _JSON_V2}
        )
        resp.raise_for_status()
        records = resp.json()
        for r in records:
            self._positions[(r["topic"], r["partition"])] = r["offset"]
        return [r["value"] for r in records]

    def commit(self) -> None:
        """Commit the group offset to last-seen + 1 per partition. Pandaproxy stores the committed
        value verbatim (an empty-body commit would land one short, leaving the tail forever lagging),
        and expects the partition list under the `partitions` key."""
        if not self._positions:
            return
        partitions = [
            {"topic": t, "partition": p, "offset": off + 1}
            for (t, p), off in self._positions.items()
        ]
        self._http.post(
            f"{self.base}/offsets", headers={"Content-Type": _V2}, json={"partitions": partitions}
        ).raise_for_status()
        self._positions.clear()  # committed; nothing pending until the next poll returns records

    def close(self) -> None:
        try:
            if self.base:
                self._http.delete(self.base)
        except Exception:
            pass
        self._http.close()
