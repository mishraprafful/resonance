"""Resonance audio derivation worker.

Two paths feed the same idempotent derivation step:
  - **Stream (fast lane):** consume derivation jobs from Redpanda (pandaproxy REST). Event-driven,
    so the fleet scales on consumer-group lag (KEDA/HPA). Enabled when PANDAPROXY_URL is set.
  - **Postgres poll (backstop):** scan `assets` for rows with `derived_at IS NULL`. Guarantees every
    asset is eventually derived even if a message is dropped, the queue is down, or it is disabled.

Derivation downloads the blob, computes waveform peaks + spectrogram + probes, uploads them back
(content-addressed), and marks the asset derived. Processing is idempotent: an already-derived asset
is skipped, and re-deriving only overwrites identical content-addressed outputs.
"""

from __future__ import annotations

import io
import os
import signal
import threading

import boto3
import psycopg
import soundfile as sf
from botocore.client import Config
from psycopg.rows import dict_row
from psycopg.types.json import Json

from . import audio
from .queue import RestConsumer


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
PANDAPROXY_URL = os.environ.get("PANDAPROXY_URL", "")
DERIVATION_TOPIC = os.environ.get("DERIVATION_TOPIC", "audio.derivations")
CONSUMER_GROUP = os.environ.get("CONSUMER_GROUP", "resonance-derivers")


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


def derive_if_pending(s3, conn, org_id: str, sha: str) -> bool:
    """Derive a single asset addressed by a stream job, skipping if it is gone or already derived
    (idempotency — the same job may arrive via the queue and the poll backstop)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT org_id, sha256, storage_key, derived_at FROM assets "
            "WHERE org_id = %s AND sha256 = %s",
            (org_id, sha),
        )
        row = cur.fetchone()
    if not row or row["derived_at"] is not None:
        return False
    process_asset(s3, conn, row)
    return True


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


def consume_loop(stop: threading.Event) -> None:  # pragma: no cover - needs a live broker
    """Fast lane: consume derivation jobs from Redpanda. Recreates the consumer on transient errors;
    the Postgres backstop covers anything missed in between."""
    s3 = _s3()
    with psycopg.connect(DSN, autocommit=True, row_factory=dict_row) as conn:
        while not stop.is_set():
            consumer = RestConsumer(PANDAPROXY_URL, CONSUMER_GROUP, DERIVATION_TOPIC)
            try:
                consumer.start()
                print(f"consuming derivation jobs from '{DERIVATION_TOPIC}' (group {CONSUMER_GROUP})")
                while not stop.is_set():
                    jobs = consumer.poll(timeout_ms=1000)
                    for job in jobs:
                        try:
                            derive_if_pending(s3, conn, str(job["org_id"]), job["sha256"])
                        except Exception as exc:
                            print(f"stream derivation failed for {job.get('sha256', '?')[:12]}: {exc!r}")
                    consumer.commit()  # advance the group offset to last-seen + 1 after processing
            except Exception as exc:
                print(f"consumer error (retrying): {exc!r}")
                stop.wait(2.0)
            finally:
                consumer.close()  # deregister the instance so the group doesn't accumulate stragglers


def main() -> None:  # pragma: no cover - process entrypoint
    s3 = _s3()
    stop = threading.Event()
    consumer_thread: threading.Thread | None = None
    if PANDAPROXY_URL:
        consumer_thread = threading.Thread(target=consume_loop, args=(stop,))
        consumer_thread.start()
    else:
        print("PANDAPROXY_URL unset — derivation runs from the Postgres poll backstop only")

    # Stop cleanly on SIGTERM/SIGINT so the consumer thread can deregister its pandaproxy instance —
    # otherwise each restart leaves a dead member in the group, starving the live one of partitions.
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())

    print("resonance-workers: polling for assets needing derivation (backstop)")
    with psycopg.connect(DSN, autocommit=True, row_factory=dict_row) as conn:
        while not stop.is_set():
            try:
                n = run_once(s3, conn)
            except Exception as exc:
                print(f"poll error: {exc!r}")
                n = 0
            if n == 0:
                stop.wait(POLL_S)

    if consumer_thread:
        consumer_thread.join(timeout=10)


if __name__ == "__main__":  # pragma: no cover
    main()
