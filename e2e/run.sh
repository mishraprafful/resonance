#!/usr/bin/env bash
# End-to-end suite orchestration: bring up the full dev stack + the app services, wait for
# everything to be healthy, run the pytest E2E suite against the live system, then tear it all down.
#
# This is the single command behind `make e2e`. It runs the SAME stack `make up` uses (so dev and CI
# stay in sync and integration gotchas — healthchecks, topic creation, schema init — surface here).
#
#   e2e/run.sh                 # full cycle: up -> wait -> test -> down
#   KEEP_UP=1 e2e/run.sh       # leave the stack running afterwards (for debugging a failure)
#   E2E_NO_STACK=1 e2e/run.sh  # assume a stack is already up (e.g. `make up`); just run the suite
#   E2E_PYTEST_ARGS="-k audio -x" e2e/run.sh   # pass extra args to pytest
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose -f $ROOT/deploy/dev/docker-compose.yml"
VENV="$ROOT/.venv"
PY="$VENV/bin/python"

# E2E needs the backend services only — skip the ui/vite bring-up (and its npm install).
export DEV_SERVICES="${DEV_SERVICES:-ingest media api worker}"

# Pick a venv interpreter the scientific-stack wheels actually support. The newest CPython (e.g.
# 3.14) often has no prebuilt numpy/soundfile/numba wheels yet, so a bare `python3` venv fails to
# install. Prefer a known-good version if PYTHON isn't already set; CI pins 3.11 via setup-python.
if [ -z "${PYTHON:-}" ]; then
  for cand in python3.12 python3.11 python3.13 python3; do
    if command -v "$cand" >/dev/null 2>&1; then export PYTHON="$cand"; break; fi
  done
fi
echo "==> using python: ${PYTHON:-python3} ($(${PYTHON:-python3} --version 2>&1))"

# Service endpoints (match scripts/dev.sh defaults; the suite reads the E2E_* equivalents).
API_PORT="${API_PORT:-8000}"
INGEST_HTTP_PORT="${INGEST_HTTP_PORT:-18080}"
MEDIA_PORT="${MEDIA_PORT:-8090}"

KEEP_UP="${KEEP_UP:-}"
STARTED_STACK=""

teardown() {
  local code=$?
  if [ -n "$KEEP_UP" ]; then
    echo "==> KEEP_UP set — leaving the stack + services running"
    return
  fi
  # On failure, snapshot the docker stack logs before we tear the containers down, so the cause
  # (e.g. a service that crashed on boot) survives in .run/ for the CI artifact + inline dump.
  if [ "$code" -ne 0 ]; then
    echo "==> capturing docker stack logs to .run/docker-stack.log"
    mkdir -p "$ROOT/.run"
    $COMPOSE logs --no-color --timestamps > "$ROOT/.run/docker-stack.log" 2>&1 || true
  fi
  echo "==> tearing down app services + dev stack"
  DEV_SERVICES="ingest media api worker ui" bash "$ROOT/scripts/dev.sh" stop >/dev/null 2>&1 || true
  if [ -n "$STARTED_STACK" ]; then
    $COMPOSE down --remove-orphans >/dev/null 2>&1 || true
  fi
  exit $code
}
trap teardown EXIT INT TERM

# --- 1. dev stack (Postgres, sharded ClickHouse + Keeper, MinIO, Redpanda, Redis) ---
if [ -z "${E2E_NO_STACK:-}" ]; then
  echo "==> bringing up dev stack"
  $COMPOSE up -d --remove-orphans
  STARTED_STACK=1
fi
bash "$ROOT/scripts/dev.sh" wait

# --- 2. venv + deps (SDK/API/workers editable + the suite's own requirements) ---
if [ ! -x "$PY" ] || ! "$PY" -c "import resonance_api, resonance_workers, resonance" >/dev/null 2>&1; then
  bash "$ROOT/scripts/dev.sh" venv
fi
echo "==> installing e2e requirements"
"$VENV/bin/pip" install -q -r "$ROOT/e2e/requirements.txt"

# --- 3. app services (ingest, media, api, worker) on the host ---
echo "==> starting app services"
bash "$ROOT/scripts/dev.sh" start

# --- 4. wait for the app services to answer (the dev-stack wait covers the data planes only) ---
echo "==> waiting for app services"
ready() { curl -sf "$1" >/dev/null 2>&1; }
for _ in $(seq 1 60); do
  if ready "http://localhost:$API_PORT/healthz" \
     && ready "http://localhost:$INGEST_HTTP_PORT/healthz" \
     && ready "http://localhost:$MEDIA_PORT/healthz"; then
    echo "==> app services ready"; break
  fi
  sleep 1
done

# --- 5. run the suite (conftest's stack_ready fixture does the final convergence wait) ---
echo "==> running e2e suite"
set +e
( cd "$ROOT/e2e" && "$VENV/bin/python" -m pytest ${E2E_PYTEST_ARGS:-} )
RESULT=$?
set -e

if [ "$RESULT" -eq 0 ]; then
  echo "==> e2e suite PASSED"
else
  echo "!! e2e suite FAILED (exit $RESULT) — app logs are under .run/*.log"
fi
exit $RESULT
