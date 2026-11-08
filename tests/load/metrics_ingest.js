// k6 load test — metric ingest hot path (POST /v1/metrics on the ingestion gateway).
//
// Run:
//   BASE_URL=http://localhost:8080 k6 run tests/load/metrics_ingest.js
//
// Tunables via env:
//   VUS         concurrent virtual users        (default 50)
//   DURATION    test duration                   (default 1m)
//   BATCH       metric points per request        (default 100)
//
// SLO gate (test fails if breached): p95 < 50ms, error rate < 0.1%.
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const BATCH = parseInt(__ENV.BATCH || "100", 10);
const pointsSent = new Counter("metric_points_sent");

export const options = {
  scenarios: {
    ingest: {
      executor: "constant-vus",
      vus: parseInt(__ENV.VUS || "50", 10),
      duration: __ENV.DURATION || "1m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<50"],
    http_req_failed: ["rate<0.001"],
  },
};

function batch() {
  const points = [];
  const step = Math.floor(Math.random() * 100000);
  for (let i = 0; i < BATCH; i++) {
    points.push({ metric: `loss/${i % 8}`, step, value: Math.random(), ts_ms: Date.now() });
  }
  return points;
}

export default function () {
  const body = JSON.stringify({
    run: { org_id: "dev", project_id: "p", run_id: `r-${__VU}` },
    points: batch(),
  });
  const res = http.post(`${BASE_URL}/v1/metrics`, body, {
    headers: { "Content-Type": "application/json" },
  });
  check(res, { "status is 2xx": (r) => r.status >= 200 && r.status < 300 });
  pointsSent.add(BATCH);
}
