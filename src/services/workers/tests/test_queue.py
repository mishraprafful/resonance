"""Tests for the Redpanda (pandaproxy) REST consumer and the idempotent derivation guard."""

import httpx

from resonance_workers import main
from resonance_workers.queue import RestConsumer


def _mock_proxy(commits=None):
    """A fake pandaproxy: assigns an instance id on create, accepts subscribe, serves one batch of
    records at offset 4 then idles, and records the body of any offset commit."""
    state = {"polls": 0}

    def handler(req: httpx.Request) -> httpx.Response:
        path = req.url.path
        if path == "/consumers/g" and req.method == "POST":
            return httpx.Response(200, json={"instance_id": "ci-1", "base_uri": "http://0.0.0.0:8082/x"})
        if path.endswith("/subscription"):
            return httpx.Response(204)
        if path.endswith("/records"):
            state["polls"] += 1
            if state["polls"] == 1:
                return httpx.Response(200, json=[
                    {"topic": "audio.derivations", "key": None, "partition": 0, "offset": 4,
                     "value": {"org_id": "o1", "sha256": "abc", "storage_key": "o1/blobs/abc"}},
                ])
            return httpx.Response(200, json=[])
        if path.endswith("/offsets"):
            if commits is not None:
                import json as _json
                commits.append(_json.loads(req.content))
            return httpx.Response(204)
        if req.method == "DELETE":
            return httpx.Response(204)
        return httpx.Response(404)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_rest_consumer_subscribes_decodes_and_commits_next_offset():
    commits: list = []
    c = RestConsumer("http://proxy", "g", "audio.derivations", client=_mock_proxy(commits))
    c.start()
    # Addresses the instance via our own proxy URL, not the (unreachable) advertised base_uri.
    assert c.base == "http://proxy/consumers/g/instances/ci-1"
    first = c.poll()
    assert first == [{"org_id": "o1", "sha256": "abc", "storage_key": "o1/blobs/abc"}]
    c.commit()
    # Commits last-seen offset + 1 (4 -> 5) so the tail does not lag forever.
    assert commits == [{"partitions": [{"topic": "audio.derivations", "partition": 0, "offset": 5}]}]
    assert c.poll() == []  # idle thereafter
    c.commit()  # nothing new fetched -> no extra commit
    assert len(commits) == 1
    c.close()


class _FakeCursor:
    def __init__(self, row):
        self._row = row
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchone(self):
        return self._row


class _FakeConn:
    def __init__(self, row):
        self.cur = _FakeCursor(row)

    def cursor(self):
        return self.cur


def test_derive_if_pending_skips_missing_or_already_derived(monkeypatch):
    called = []
    monkeypatch.setattr(main, "process_asset", lambda s3, conn, row: called.append(row["sha256"]))

    # missing asset -> skip
    assert main.derive_if_pending(None, _FakeConn(None), "o1", "abc") is False
    # already derived -> skip
    derived = {"org_id": "o1", "sha256": "abc", "storage_key": "k", "derived_at": "2026-01-01"}
    assert main.derive_if_pending(None, _FakeConn(derived), "o1", "abc") is False
    # pending -> process
    pending = {"org_id": "o1", "sha256": "abc", "storage_key": "k", "derived_at": None}
    assert main.derive_if_pending(None, _FakeConn(pending), "o1", "abc") is True
    assert called == ["abc"]
