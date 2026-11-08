// k6 load test — audio upload coordination path.
//
// Models the real SDK flow: (1) ask the gateway to prepare an upload (dedup check + presigned URL),
// (2) on a miss, PUT bytes directly to object storage. We measure the coordination call (the part
// that hits our service) and, when an upload URL is returned, the direct-to-store PUT separately —
// proving that audio bytes never transit the gateway.
//
// Run:
//   BASE_URL=http://localhost:8080 k6 run tests/load/audio_upload.js
//
// Tunables: VUS (default 20), DURATION (default 1m), CLIP_KB (default 256),
//           DEDUP_RATIO (default 0.7 -> 70% of logs reuse existing content).
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";
import { sha256 } from "k6/crypto";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const CLIP_KB = parseInt(__ENV.CLIP_KB || "256", 10);
const DEDUP_RATIO = parseFloat(__ENV.DEDUP_RATIO || "0.7");

const prepareLatency = new Trend("asset_prepare_ms", true);
const uploadLatency = new Trend("asset_put_ms", true);

export const options = {
  scenarios: {
    audio: {
      executor: "constant-vus",
      vus: parseInt(__ENV.VUS || "20", 10),
      duration: __ENV.DURATION || "1m",
    },
  },
  thresholds: {
    "asset_prepare_ms": ["p(95)<75"],
    http_req_failed: ["rate<0.001"],
  },
};

// A small pool of fixed clips models the dedup-heavy reality of ML logging (same val set, etc.).
const POOL = 32;

export default function () {
  const reuse = Math.random() < DEDUP_RATIO;
  const seed = reuse ? Math.floor(Math.random() * POOL) : `${__VU}-${Date.now()}-${Math.random()}`;
  const content = `clip-${seed}`.repeat(Math.ceil((CLIP_KB * 1024) / 8));
  const digest = sha256(content, "hex");

  const prep = http.post(
    `${BASE_URL}/v1/assets/prepare`,
    JSON.stringify({
      org_id: "dev",
      sha256: digest,
      media_type: "audio/wav",
      size_bytes: content.length,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
  prepareLatency.add(prep.timings.duration);
  check(prep, { "prepare 2xx": (r) => r.status >= 200 && r.status < 300 });

  const out = prep.json();
  if (out && out.exists === false && out.upload_url) {
    const put = http.put(out.upload_url, content, {
      headers: { "Content-Type": "audio/wav" },
    });
    uploadLatency.add(put.timings.duration);
  }
}
