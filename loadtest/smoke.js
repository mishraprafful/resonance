// k6 SMOKE test — part of the e2e merge gate (see e2e/run.sh).
//
// This is NOT capacity certification. It exercises the two hot paths (metric ingest + audio-prepare
// coordination) under a little concurrent load and gates on *functional correctness*: requests
// succeed, error rate ~0. The strict latency SLOs (ingest p95 < 50ms, prepare p95 < 75ms) are the
// job of the full loadtest on the reference rig (loadtest/run.sh + README) — a shared CI runner
// can't meet them — so here the latency threshold is only a generous "nothing is grossly broken"
// ceiling.
//
// Run standalone:
//   API_URL=http://localhost:8000 INGEST_URL=http://localhost:18080 k6 run loadtest/smoke.js
//
// Tunables via env: VUS (default 5), DURATION (default 10s), BATCH (metric points/req, default 50).
import http from "k6/http";
import { check, sleep } from "k6";

const API_URL = __ENV.API_URL || "http://localhost:8000";
const INGEST_URL = __ENV.INGEST_URL || "http://localhost:18080";
const BATCH = parseInt(__ENV.BATCH || "50", 10);
const JSON_HDR = { headers: { "Content-Type": "application/json" } };

export const options = {
  scenarios: {
    smoke: {
      executor: "constant-vus",
      vus: parseInt(__ENV.VUS || "5", 10),
      duration: __ENV.DURATION || "10s",
    },
  },
  // Functional gate: no failed requests, all checks pass. Latency ceiling is intentionally loose.
  thresholds: {
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
    http_req_duration: ["p(95)<2000"],
  },
};

function hex(n) {
  let s = "";
  while (s.length < n) s += Math.floor(Math.random() * 16).toString(16);
  return s.slice(0, n);
}

// Provision a dedicated tenant (isolated rate budget) and a run with real UUID ids — the ingest
// gateway's ClickHouse columns are UUID-typed, so the hot path needs genuine ids from the API.
export function setup() {
  const slug = `k6-smoke-${hex(8)}`;
  const org = http.post(`${API_URL}/v1/orgs`, JSON.stringify({ slug, name: slug }), JSON_HDR);
  check(org, { "org created": (r) => r.status === 200 });
  const token = org.json("owner_token");
  const auth = { headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } };
  const run = http.post(
    `${API_URL}/v1/runs`,
    JSON.stringify({ project: "smoke", name: "smoke", config: {} }),
    auth
  );
  check(run, { "run created": (r) => r.status === 200 });
  return { token, org_id: run.json("org_id"), project_id: run.json("project_id"), run_id: run.json("id") };
}

export default function (data) {
  const auth = {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.token}` },
  };

  // Hot path 1: metric ingest → Go gateway (the SDK's batched log path).
  const points = [];
  const base = Math.floor(Math.random() * 100000);
  for (let i = 0; i < BATCH; i++) points.push({ metric: "loss", step: base + i, value: Math.random() });
  const m = http.post(
    `${INGEST_URL}/v1/metrics`,
    JSON.stringify({ run: { org_id: data.org_id, project_id: data.project_id, run_id: data.run_id }, points }),
    JSON_HDR
  );
  check(m, { "ingest accepted (202)": (r) => r.status === 202 });

  // Hot path 2: audio-prepare coordination → control API (dedup check + presigned URL). A random
  // sha is always "new", so this exercises the quota check + presign branch.
  const p = http.post(
    `${API_URL}/v1/assets/prepare`,
    JSON.stringify({ sha256: hex(64), media_type: "audio/wav", size_bytes: 1024 }),
    auth
  );
  check(p, { "prepare ok (200)": (r) => r.status === 200 });

  sleep(0.3); // keep the dedicated org well under its per-minute request budget
}
