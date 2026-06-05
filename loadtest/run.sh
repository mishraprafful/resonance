#!/usr/bin/env bash
# Run the Resonance load-test suite and emit JSON summaries used to certify capacity.
#
# Requires k6 (https://k6.io). Results land in loadtest/results/<timestamp>/.
#   ./loadtest/run.sh [BASE_URL]
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="loadtest/results/${STAMP}"
mkdir -p "${OUT}"

echo "Target: ${BASE_URL}"
echo "Results: ${OUT}"

BASE_URL="${BASE_URL}" k6 run --summary-export "${OUT}/metrics_ingest.json" loadtest/metrics_ingest.js
BASE_URL="${BASE_URL}" k6 run --summary-export "${OUT}/audio_upload.json"   loadtest/audio_upload.js

echo
echo "Done. Update the 'Certified capacity' table in README.md from:"
echo "  ${OUT}/*.json"
