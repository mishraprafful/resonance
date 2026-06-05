// Resonance ingestion gateway (hot path).
//
// Responsibilities (built out in Phase 1):
//   - accept batched scalar metrics (HTTP + gRPC) and produce them to the stream queue
//   - dedup-check content-addressed assets and hand back presigned upload URLs
//   - never proxy audio bytes — uploads go client -> object storage directly
//
// Phase 0: a stateless HTTP server exposing health + stub endpoints so the dev stack and CI
// have something real to build and probe.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

func main() {
	port := getenv("INGEST_HTTP_PORT", "8080")
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", health)
	mux.HandleFunc("/v1/metrics", logMetrics)            // stub
	mux.HandleFunc("/v1/assets/prepare", prepareAsset)   // stub

	log.Printf("resonance-ingest listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "ingest"})
}

// logMetrics will batch points onto the stream queue. Phase-0 stub acknowledges receipt.
func logMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"accepted": 0, "note": "stub"})
}

// prepareAsset will perform the dedup check and return a presigned PUT URL. Phase-0 stub.
func prepareAsset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"exists": false, "upload_url": "", "note": "stub"})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
