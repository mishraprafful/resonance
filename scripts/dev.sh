#!/usr/bin/env bash
# Local dev orchestration for Resonance: runs the app services (ingest, media, api, worker, ui) on
# the host against the docker dev stack. Managed via pid/log files under .run/.
#
#   scripts/dev.sh venv     # create .venv and install python deps + ui deps
#   scripts/dev.sh start     # start ingest + media + api + worker + ui (background)
#   scripts/dev.sh stop      # stop them
#   scripts/dev.sh status    # show what's running
#   scripts/dev.sh logs [svc]# tail logs (all, or one of: ingest api worker ui)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/.run"; mkdir -p "$RUN"
VENV="$ROOT/.venv"
PY="$VENV/bin/python"

# Ports (ingest defaults to 18080 because Docker Desktop often holds 8080).
# Resonance-specific ports, chosen to avoid common defaults (vite 5173, etc.). Override via env.
export INGEST_HTTP_PORT="${INGEST_HTTP_PORT:-18080}"
export API_PORT="${API_PORT:-8000}"
export UI_PORT="${UI_PORT:-5280}"
export MEDIA_PORT="${MEDIA_PORT:-8090}"

# Which app services to manage. Defaults to all; the e2e harness (and CI) set
# DEV_SERVICES="ingest media api worker" to skip the vite/ui bring-up (and its npm install).
SERVICES="${DEV_SERVICES:-ingest media api worker ui}"
_want() { case " $SERVICES " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# Service env — defaults line up with deploy/dev/docker-compose.yml.
export CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://localhost:8123}"
export CLICKHOUSE_DB="${CLICKHOUSE_DB:-resonance}"
export CLICKHOUSE_USER="${CLICKHOUSE_USER:-resonance}"
export CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-resonance}"
# Two DB roles: the API uses the least-privilege `resonance_app` (RLS-enforced, tenant-scoped);
# the worker uses the superuser (bypasses RLS to derive across all tenants).
export PG_SUPER_DSN="${PG_SUPER_DSN:-postgresql://resonance:resonance@localhost:5432/resonance}"
export PG_APP_DSN="${PG_APP_DSN:-postgresql://resonance_app:resonance_app@localhost:5432/resonance}"
export POSTGRES_DSN="$PG_APP_DSN"   # API picks this up
export S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9100}"
export S3_ACCESS_KEY="${S3_ACCESS_KEY:-resonance}"
export S3_SECRET_KEY="${S3_SECRET_KEY:-resonance-secret}"
export S3_BUCKET="${S3_BUCKET:-resonance-blobs}"
# Media gateway: the API mints HMAC-signed URLs (same secret) pointing at it; it range-streams
# originals from object storage. MEDIA_PUBLIC_URL being set is what makes the API use the gateway.
export MEDIA_SIGNING_SECRET="${MEDIA_SIGNING_SECRET:-resonance-dev-media-secret}"
export MEDIA_PUBLIC_URL="${MEDIA_PUBLIC_URL:-http://localhost:$MEDIA_PORT}"
# Redpanda stream queue (via HTTP proxy) for event-driven derivation; worker also polls as backstop.
export PANDAPROXY_URL="${PANDAPROXY_URL:-http://localhost:8082}"
export DERIVATION_TOPIC="${DERIVATION_TOPIC:-audio.derivations}"
export CONSUMER_GROUP="${CONSUMER_GROUP:-resonance-derivers}"
# Storage lifecycle tiering: the worker periodically tiers assets hot->ia->archive by access recency
# and tags the object (resonance-tier) for real S3 lifecycle rules. Short sweep locally so it's
# observable; defaults to a 30/90-day policy (per-tenant override via PUT /v1/orgs/{id}/lifecycle).
export LIFECYCLE_ENABLED="${LIFECYCLE_ENABLED:-true}"
export LIFECYCLE_SWEEP_S="${LIFECYCLE_SWEEP_S:-60}"
export LIFECYCLE_IA_DAYS="${LIFECYCLE_IA_DAYS:-30}"
export LIFECYCLE_ARCHIVE_DAYS="${LIFECYCLE_ARCHIVE_DAYS:-90}"
export PYTHONUNBUFFERED=1

_pid_file() { echo "$RUN/$1.pid"; }
_log_file() { echo "$RUN/$1.log"; }

_alive() { local p; p="$(cat "$(_pid_file "$1")" 2>/dev/null || true)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

_spawn() { # name, command...   (pass the server binary directly — no cd/subshell wrapper — so
  local name="$1"; shift        #  nohup execs it in place and the tracked pid IS the real process)
  if _alive "$name"; then echo "  $name already running"; return; fi
  nohup "$@" >"$(_log_file "$name")" 2>&1 &
  echo $! >"$(_pid_file "$name")"
  echo "  started $name (pid $!)"
}

# Note the trailing `|| true`: lsof exits non-zero when a port is FREE (no matches), which would
# trip `set -e`/`pipefail` and kill the script during preflight.
_port_holder() { lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1" (pid "$2")"}' || true; }

_preflight() { # port, label
  local holder; holder="$(_port_holder "$1")"
  if [ -n "$holder" ]; then
    echo "!! port $1 (needed for $2) is already in use by: $holder"
    echo "   stop that process, or override the port, e.g.:  ${3}=<port> make up"
    exit 1
  fi
}

venv() {
  echo "==> creating venv + installing deps (first run takes a minute)"
  # A venv bakes in absolute paths, so it breaks if the project dir is moved/renamed. Detect a
  # broken venv (pip no longer runnable) and recreate it.
  if [ -d "$VENV" ] && ! "$VENV/bin/pip" --version >/dev/null 2>&1; then
    echo "==> existing venv is broken (project dir moved?) — recreating"
    rm -rf "$VENV"
  fi
  # Interpreter for the venv. Override with PYTHON=... (e.g. when the system python3 is too new for
  # the scientific-stack wheels — numpy/soundfile/numba — which lag the newest CPython release).
  [ -d "$VENV" ] || "${PYTHON:-python3}" -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q -e "$ROOT/sdk[audio]" -e "$ROOT/services/api" -e "$ROOT/workers" "uvicorn[standard]"
  if _want ui && [ ! -d "$ROOT/src/ui/node_modules" ]; then
    echo "==> installing ui deps"
    (cd "$ROOT/src/ui" && npm install --no-audit --no-fund)
  fi
  echo "==> deps ready"
}

start() {
  [ -x "$PY" ] || { echo "venv missing — run: make app-install"; exit 1; }
  # Idempotent: only preflight a port for a service we're actually about to start (so re-running
  # `make up` while it's already up is a no-op, not an error).
  _want ingest && { _alive ingest || _preflight "$INGEST_HTTP_PORT" ingest INGEST_HTTP_PORT; }
  _want api    && { _alive api    || _preflight "$API_PORT" api API_PORT; }
  _want media  && { _alive media  || _preflight "$MEDIA_PORT" media MEDIA_PORT; }
  _want ui     && { _alive ui     || _preflight "$UI_PORT" ui UI_PORT; }

  if _want ingest && ! _alive ingest; then
    echo "==> building ingest gateway"
    ( cd "$ROOT/services/ingest" && go build -o "$RUN/ingest-bin" ./cmd/ingest )
  fi
  if _want media && ! _alive media; then
    echo "==> building media gateway"
    ( cd "$ROOT/services/media" && go build -o "$RUN/media-bin" ./cmd/media )
  fi

  echo "==> starting app services ($SERVICES)"
  _want ingest && _spawn ingest "$RUN/ingest-bin"
  _want media  && _spawn media  "$RUN/media-bin"
  _want api    && _spawn api    "$VENV/bin/uvicorn" resonance_api.main:app --host 127.0.0.1 --port "$API_PORT"
  _want worker && _spawn worker env POSTGRES_DSN="$PG_SUPER_DSN" "$PY" -m resonance_workers.main
  _want ui     && _spawn ui     "$ROOT/src/ui/node_modules/.bin/vite" "$ROOT/src/ui" --port "$UI_PORT" --strictPort
  echo
  echo "==> Resonance is up. Open: http://localhost:$UI_PORT"
  echo "    (api :$API_PORT, ingest :$INGEST_HTTP_PORT)  —  'make demo' to log a sample run"
}

stop() {
  echo "==> stopping app services"
  for name in ingest media api worker ui; do
    local f; f="$(_pid_file "$name")"
    if [ -f "$f" ]; then
      local p; p="$(cat "$f")"
      kill "$p" 2>/dev/null && echo "  stopped $name (pid $p)" || echo "  $name not running"
      # reap any direct children (e.g. uvicorn reload workers)
      pkill -P "$p" 2>/dev/null || true
      rm -f "$f"
    fi
  done
  rm -f "$RUN/ingest-bin" "$RUN/media-bin"
}

status() {
  for name in ingest media api worker ui; do
    if _alive "$name"; then echo "  $name: UP (pid $(cat "$(_pid_file "$name")"))"; else echo "  $name: down"; fi
  done
}

logs() {
  if [ -n "${1:-}" ]; then tail -f "$(_log_file "$1")"; else tail -n +1 -f "$RUN"/*.log; fi
}

wait_stack() {
  echo "==> waiting for dev stack (postgres, clickhouse, minio)"
  for _ in $(seq 1 60); do
    if pg_ready && curl -sf "$CLICKHOUSE_URL/ping" >/dev/null 2>&1 && curl -sf "$S3_ENDPOINT/minio/health/ready" >/dev/null 2>&1; then
      echo "==> stack ready"; return 0
    fi
    sleep 2
  done
  echo "!! stack did not become ready in time (check: docker compose ps)"; exit 1
}
pg_ready() { docker exec resonance-dev-postgres-1 pg_isready -U resonance >/dev/null 2>&1; }

cmd="${1:-}"; shift || true
case "$cmd" in
  venv|install) venv ;;
  wait) wait_stack ;;
  start) start ;;
  stop) stop ;;
  status) status ;;
  logs) logs "${1:-}" ;;
  *) echo "usage: dev.sh {venv|wait|start|stop|status|logs [svc]}"; exit 1 ;;
esac
