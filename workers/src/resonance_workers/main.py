"""Resonance audio derivation worker.

DB-backed work queue (Phase 2): scans `assets` for rows with `derived_at IS NULL`, downloads the
blob from object storage, computes derivations (waveform peaks, spectrogram, probes), uploads them
back (content-addressed), and marks the asset derived. The durable stream queue (Redpanda) replaces
this poll loop in the scale phase.
"""

from __future__ import annotations

import io
import os
import time

import boto3
import psycopg
import soundfile as sf
from botocore.client import Config
from psycopg.rows import dict_row
from psycopg.types.json import Json

from . import audio


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT", "http://localhost:9100"),
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY", "resonance"),
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY", "resonance-secret"),
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


BUCKET = os.environ.get("S3_BUCKET", "resonance-blobs")
DSN = os.environ.get("POSTGRES_DSN", "postgresql://resonance:resonance@localhost:5432/resonance")
POLL_S = float(os.environ.get("WORKER_POLL_S", "1.0"))
BATCH = int(os.environ.get("WORKER_BATCH", "16"))


def process_asset(s3, conn, row: dict) -> None:
    org_id, sha, key = str(row["org_id"]), row["sha256"], row["storage_key"]
    obj = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
    samples, sr = sf.read(io.BytesIO(obj), dtype="float32", always_2d=False)
    channels = 1 if samples.ndim == 1 else samples.shape[1]
    duration = len(samples) / float(sr) if sr else 0.0

    peaks = audio.compute_peaks(samples)
    spec = audio.spectrogram_png(samples, sr)
    peaks_key = audio.derived_key(org_id, sha, "peaks.json")
    spec_key = audio.derived_key(org_id, sha, "spectrogram.png")
    s3.put_object(Bucket=BUCKET, Key=peaks_key, Body=peaks, ContentType="application/json")
    s3.put_object(Bucket=BUCKET, Key=spec_key, Body=spec, ContentType="image/png")

    derivations = {"peaks_key": peaks_key, "spectrogram_key": spec_key}
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE assets SET derived_at = now(), derivations = %s, duration_s = %s, "
            "sample_rate = COALESCE(sample_rate, %s), channels = %s, peak_dbfs = %s "
            "WHERE org_id = %s AND sha256 = %s",
            (Json(derivations), duration, sr, channels, audio.peak_dbfs(samples), org_id, sha),
        )
    print(f"derived {sha[:12]} ({duration:.2f}s, {channels}ch, {sr}Hz)")


def run_once(s3, conn) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT org_id, sha256, storage_key FROM assets "
            "WHERE derived_at IS NULL ORDER BY created_at LIMIT %s FOR UPDATE SKIP LOCKED",
            (BATCH,),
        )
        rows = cur.fetchall()
    for row in rows:
        try:
            process_asset(s3, conn, row)
        except Exception as exc:  # leave derived_at NULL so it retries next pass
            print(f"derivation failed for {row['sha256'][:12]}: {exc!r}")
    return len(rows)


def main() -> None:  # pragma: no cover - process entrypoint
    s3 = _s3()
    print("resonance-workers: polling for assets needing derivation")
    with psycopg.connect(DSN, autocommit=True, row_factory=dict_row) as conn:
        while True:
            try:
                n = run_once(s3, conn)
            except Exception as exc:
                print(f"poll error: {exc!r}")
                n = 0
            if n == 0:
                time.sleep(POLL_S)


if __name__ == "__main__":  # pragma: no cover
    main()
