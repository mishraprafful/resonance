"""Audio plane, end-to-end — the non-negotiable core.

Covers content-addressed dedup (re-logging identical audio uploads zero bytes), the async derivation
pipeline (waveform peaks + spectrogram + probes, with the Postgres poll backstop and idempotency),
lazy/paginated listing (no URLs signed up front), media-gateway range streaming + HMAC signature
enforcement, original-quality serving on the compare path (§7b), dataset version collapse, and
ratings round-trip.

Maps to ARCHITECTURE.md §10 Phase 2/3 and the §7b hard constraint.
"""

from __future__ import annotations

import time

import httpx
import pytest

import helpers
from helpers import (
    make_wav,
    media_url,
    parse_stream_url,
    register_audio,
    sha256_hex,
    upload_asset,
    wait_until,
)

pytestmark = pytest.mark.audio


def _wait_for_derivation(org_id: str, sha: str, timeout: float = 90) -> dict:
    """Wait for the worker to derive an asset; return its row (derivations parsed as a dict)."""
    def _check():
        rows = helpers.pg_super_query(
            "SELECT derived_at, derivations, duration_s, channels, sample_rate, peak_dbfs "
            "FROM assets WHERE org_id = %s AND sha256 = %s",
            (org_id, sha),
        )
        if rows and rows[0]["derived_at"] is not None:
            return rows[0]
        return None
    return wait_until(_check, timeout=timeout, interval=1.0,
                      message=f"asset {sha[:12]} was never derived")


def test_dedup_relog_uploads_zero_bytes(org):
    """Content-addressed dedup: identical content is stored exactly once (object count proves it)."""
    api = org.client()
    payload, _ = make_wav(seed=1)
    sha = sha256_hex(payload)
    blob_prefix = f"{org.org_id}/blobs/"

    base = helpers.s3_count(blob_prefix)

    # First log: prepare reports the asset is new, the SDK flow PUTs the bytes.
    prep1 = api.post("/v1/assets/prepare",
                     json={"sha256": sha, "media_type": "audio/wav", "size_bytes": len(payload)})
    assert prep1.json()["exists"] is False
    assert prep1.json()["upload_url"]
    upload_asset(api, payload)  # idempotent re-run of prepare+PUT
    register_audio(api, helpers.create_run(api, "dedup")["id"], "samples/val", sha,
                   step=0, size_bytes=len(payload), sample_rate=22050)
    assert helpers.s3_count(blob_prefix) == base + 1

    # Second log of the SAME content: prepare reports exists + no upload URL → zero bytes uploaded.
    prep2 = api.post("/v1/assets/prepare",
                     json={"sha256": sha, "media_type": "audio/wav", "size_bytes": len(payload)})
    assert prep2.json()["exists"] is True
    assert prep2.json().get("upload_url") is None
    upload_asset(api, payload)  # would PUT only if new; it isn't
    assert helpers.s3_count(blob_prefix) == base + 1, "re-logging identical content uploaded bytes"
    api.close()


def test_derivation_produces_peaks_spectrogram_and_probes(org):
    """Registering audio triggers derivation: waveform peaks (JSON), spectrogram (PNG), and probes
    (duration/channels/sr/peak) — all fetchable via lazily-minted presigned URLs."""
    api = org.client()
    payload, _ = make_wav(seconds=0.5, sample_rate=22050, seed=2)
    sha = upload_asset(api, payload)
    run = helpers.create_run(api, "derive")
    register_audio(api, run["id"], "samples/val", sha, step=0,
                   size_bytes=len(payload), sample_rate=22050)

    asset = _wait_for_derivation(org.org_id, sha)
    deriv = asset["derivations"]
    assert deriv.get("peaks_key") and deriv.get("spectrogram_key")
    # Probes extracted from the decoded audio.
    assert asset["duration_s"] == pytest.approx(0.5, abs=0.05)
    assert asset["channels"] == 1
    assert asset["sample_rate"] == 22050
    assert asset["peak_dbfs"] is not None

    # Peaks: lazily presigned, fetches JSON with decimated min/max buckets.
    peaks_url = api.get(f"/v1/assets/{sha}/url", params={"kind": "peaks"}).json()["url"]
    peaks = httpx.get(peaks_url, timeout=30).json()
    assert "buckets" in peaks and len(peaks["buckets"]) > 0

    # Spectrogram: a server-rendered PNG (UI never decodes audio to draw it).
    spec_url = api.get(f"/v1/assets/{sha}/url", params={"kind": "spectrogram"}).json()["url"]
    spec = httpx.get(spec_url, timeout=30).content
    assert spec[:8] == b"\x89PNG\r\n\x1a\n"

    # The listing reflects the available derivations.
    page = api.get(f"/v1/runs/{run['id']}/audio").json()
    entry = next(i for i in page["items"] if i["asset_sha"] == sha)
    assert entry["derived"] and entry["has_peaks"] and entry["has_spectrogram"]
    api.close()


def test_derivation_poll_backstop_reprocesses(org):
    """The Postgres `derived_at IS NULL` poll is a correctness backstop: clearing derivation state
    (no queue message involved) is re-derived, and the result is idempotent across paths."""
    api = org.client()
    payload, _ = make_wav(seed=3)
    sha = upload_asset(api, payload)
    register_audio(api, helpers.create_run(api, "backstop")["id"], "k", sha,
                   step=0, size_bytes=len(payload), sample_rate=22050)
    _wait_for_derivation(org.org_id, sha)

    # Reset derivation state directly — only the poll backstop can pick this up (no publish).
    helpers.pg_super_query(
        "UPDATE assets SET derived_at = NULL, derivations = '{}'::jsonb "
        "WHERE org_id = %s AND sha256 = %s",
        (org.org_id, sha),
    )
    asset = _wait_for_derivation(org.org_id, sha)
    assert asset["derivations"].get("peaks_key") and asset["derivations"].get("spectrogram_key")
    api.close()


def test_audio_listing_is_paginated_and_lazily_presigned(org):
    """Listing audio is keyset-paginated and never embeds presigned URLs (those are minted on demand
    via /v1/assets/{sha}/url), so a page of thousands of clips signs zero URLs up front."""
    api = org.client()
    run = helpers.create_run(api, "listing")
    shas = []
    for step in range(5):
        payload, _ = make_wav(seed=100 + step)
        sha = upload_asset(api, payload)
        register_audio(api, run["id"], "samples/val", sha, step=step,
                       size_bytes=len(payload), sample_rate=22050)
        shas.append(sha)

    assert api.get(f"/v1/runs/{run['id']}/audio/keys").json()["keys"] == ["samples/val"]

    # Page through with a small limit; collect everything via the keyset cursor.
    collected, cursor, pages = [], None, 0
    url_fields = {"url", "upload_url", "presigned_url", "stream_url"}
    while True:
        params = {"limit": 2}
        if cursor:
            params["cursor"] = cursor
        page = api.get(f"/v1/runs/{run['id']}/audio", params=params).json()
        for item in page["items"]:
            assert not (url_fields & item.keys()), "listing must not embed presigned URLs"
            collected.append(item["asset_sha"])
        pages += 1
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert set(collected) == set(shas)
    assert pages >= 3, "small page size should require multiple pages"

    # URLs are available on demand, one asset at a time.
    assert api.get(f"/v1/assets/{shas[0]}/url").json()["url"].startswith("http")
    api.close()


def test_media_gateway_range_streaming_and_signature(org):
    """The media gateway serves full (200) and ranged (206) responses for original bytes, and
    rejects tampered or expired HMAC signatures (403) — auth-scoped streaming without DB access."""
    api = org.client()
    payload, _ = make_wav(seconds=1.0, seed=4)
    sha = upload_asset(api, payload)
    register_audio(api, helpers.create_run(api, "stream")["id"], "k", sha,
                   step=0, size_bytes=len(payload), sample_rate=22050)

    signed = api.get(f"/v1/assets/{sha}/stream-url").json()["url"]
    assert "/v1/stream/" in signed, "expected a media-gateway URL (MEDIA_PUBLIC_URL is set in dev)"

    full = httpx.get(signed, timeout=30)
    assert full.status_code == 200
    assert sha256_hex(full.content) == sha, "gateway must serve the exact original bytes"

    ranged = httpx.get(signed, headers={"Range": "bytes=0-99"}, timeout=30)
    assert ranged.status_code == 206
    assert "Content-Range" in ranged.headers
    assert len(ranged.content) == 100

    key, exp, sig = parse_stream_url(signed)
    tampered = media_url(key, exp, sig=sig[:-1] + ("0" if sig[-1] != "0" else "1"))
    assert httpx.get(tampered, timeout=30).status_code == 403

    expired = media_url(key, int(time.time()) - 60)  # correctly signed, but in the past
    assert httpx.get(expired, timeout=30).status_code == 403
    api.close()


def test_compare_serves_original_quality(org):
    """The A/B compare path serves ORIGINAL quality only — never a lossy rendition (§7b hard
    constraint). `kind=original` returns the exact uploaded bytes."""
    api = org.client()
    payload, _ = make_wav(seconds=0.75, seed=5)
    sha = upload_asset(api, payload)
    register_audio(api, helpers.create_run(api, "compare")["id"], "k", sha,
                   step=0, size_bytes=len(payload), sample_rate=22050)

    presign = api.get(f"/v1/assets/{sha}/url", params={"kind": "original"}).json()
    assert presign["kind"] == "original"
    fetched = httpx.get(presign["url"], timeout=30).content
    assert sha256_hex(fetched) == sha
    assert len(fetched) == len(payload)
    api.close()


def test_dataset_versioning_collapses_identical_content(org):
    """Identical dataset content collapses to one version (idempotent on org+name+version); a
    different member set is a distinct version."""
    api = org.client()
    members = []
    for seed in (10, 11, 12):
        payload, _ = make_wav(seed=seed)
        sha = upload_asset(api, payload)
        members.append({"sha256": sha, "path": f"clip_{seed}.wav", "size_bytes": len(payload)})

    # Content-addressed version id (same scheme the SDK uses).
    version = sha256_hex("".join(sorted(m["sha256"] for m in members)).encode())[:12]

    first = api.post("/v1/datasets",
                     json={"name": "valset", "version": version, "manifest": members}).json()
    second = api.post("/v1/datasets",
                      json={"name": "valset", "version": version, "manifest": members}).json()
    assert first["id"] == second["id"], "identical dataset must collapse to one version"
    assert first["item_count"] == len(members)

    listed = api.get("/v1/datasets").json()
    valset_versions = [d for d in listed if d["name"] == "valset"]
    assert len(valset_versions) == 1

    # A different member set → a new version.
    smaller = members[:2]
    v2 = sha256_hex("".join(sorted(m["sha256"] for m in smaller)).encode())[:12]
    api.post("/v1/datasets", json={"name": "valset", "version": v2, "manifest": smaller})
    assert len([d for d in api.get("/v1/datasets").json() if d["name"] == "valset"]) == 2
    api.close()


def test_ratings_round_trip(org):
    """Listening-test ratings logged from the compare view round-trip through the API."""
    api = org.client()
    payload, _ = make_wav(seed=20)
    sha = upload_asset(api, payload)
    run = helpers.create_run(api, "ratings")
    register_audio(api, run["id"], "k", sha, step=0, size_bytes=len(payload), sample_rate=22050)

    test_id = "session-xyz"
    posted = api.post("/v1/ratings", json={
        "test_id": test_id, "asset_sha": sha, "run_id": run["id"],
        "label": "model-A", "score": 4, "blind": True,
    }).json()

    listed = api.get("/v1/ratings", params={"test_id": test_id}).json()
    assert len(listed) == 1
    assert listed[0]["id"] == posted["id"]
    assert listed[0]["score"] == 4
    assert listed[0]["blind"] is True
    assert listed[0]["label"] == "model-A"
    api.close()
