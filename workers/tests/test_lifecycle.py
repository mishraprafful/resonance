"""Tests for the storage-lifecycle tiering engine: pure tier logic + one sweep over fakes."""

from resonance_workers import lifecycle


# --- pure transition logic ---
def test_target_tier_thresholds():
    # default-ish policy: ia at 30d, archive at 90d
    assert lifecycle.target_tier(0.0, 30, 90) == "hot"
    assert lifecycle.target_tier(29.9, 30, 90) == "hot"
    assert lifecycle.target_tier(30.0, 30, 90) == "ia"      # boundary is inclusive
    assert lifecycle.target_tier(89.9, 30, 90) == "ia"
    assert lifecycle.target_tier(90.0, 30, 90) == "archive"  # archive wins over ia
    assert lifecycle.target_tier(1000.0, 30, 90) == "archive"


def test_policy_for_default_and_override():
    assert lifecycle.policy_for({"lifecycle_policy": None}, 30, 90) == (30, 90)
    assert lifecycle.policy_for({"lifecycle_policy": {}}, 30, 90) == (30, 90)
    # a partial override falls back to the default for the missing stage
    assert lifecycle.policy_for({"lifecycle_policy": {"ia_days": 5}}, 30, 90) == (5, 90)
    assert lifecycle.policy_for(
        {"lifecycle_policy": {"ia_days": 1, "archive_days": 7}}, 30, 90
    ) == (1, 7)


# --- sweep over fakes ---
class FakeCursor:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, sql, params=None):
        if sql.strip().upper().startswith("SELECT"):
            self._rows = self.conn.rows
        elif sql.strip().upper().startswith("UPDATE"):
            tier, org_id, sha = params
            self.conn.updates.append((sha, tier))
            self._rows = []

    def fetchall(self):
        return self._rows


class FakeConn:
    def __init__(self, rows):
        self.rows = rows
        self.updates = []

    def cursor(self):
        return FakeCursor(self)


class FakeS3:
    def __init__(self, tags=None):
        self.tags = dict(tags or {})  # key -> tier
        self.tag_writes = 0

    def get_object_tagging(self, Bucket, Key):
        if Key not in self.tags:
            return {"TagSet": []}
        return {"TagSet": [{"Key": lifecycle.TAG_KEY, "Value": self.tags[Key]}]}

    def put_object_tagging(self, Bucket, Key, Tagging):
        self.tag_writes += 1
        self.tags[Key] = Tagging["TagSet"][0]["Value"]


def _row(sha, tier, age_days, policy=None):
    return {
        "org_id": "11111111-1111-1111-1111-111111111111",
        "sha256": sha,
        "storage_key": f"org/blobs/{sha}",
        "storage_tier": tier,
        "age_days": age_days,
        "lifecycle_policy": policy,
    }


def test_sweep_transitions_and_tags():
    rows = [
        _row("fresh", "hot", 1.0),                              # stays hot, but untagged -> retag
        _row("old", "hot", 100.0),                             # hot -> archive (+ retag)
        _row("mid", "hot", 10.0, {"ia_days": 5, "archive_days": 50}),  # per-tenant -> ia (+ retag)
    ]
    conn = FakeConn(rows)
    s3 = FakeS3()  # nothing tagged yet

    stats = lifecycle.sweep_once(s3, conn)

    assert stats["scanned"] == 3
    assert stats["transitioned"] == 2  # old, mid (fresh stays hot)
    assert stats["retagged"] == 3      # all three start untagged
    assert dict(conn.updates) == {"old": "archive", "mid": "ia"}
    assert s3.tags == {
        "org/blobs/fresh": "hot",
        "org/blobs/old": "archive",
        "org/blobs/mid": "ia",
    }


def test_sweep_is_idempotent_at_steady_state():
    # DB tiers already correct and objects already tagged -> no writes.
    rows = [_row("a", "hot", 1.0), _row("b", "archive", 200.0)]
    conn = FakeConn(rows)
    s3 = FakeS3({"org/blobs/a": "hot", "org/blobs/b": "archive"})

    stats = lifecycle.sweep_once(s3, conn)

    assert stats == {"scanned": 2, "transitioned": 0, "retagged": 0}
    assert conn.updates == []
    assert s3.tag_writes == 0
