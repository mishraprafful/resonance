// Resonance media/streaming gateway.
//
// Responsibilities (built out in Phase 2):
//   - authorize a playback request against tenant/run scope (RBAC)
//   - serve audio + precomputed waveform/spectrogram via signed URLs / HTTP range requests
//   - sit behind a CDN; immutable content-addressed keys make edge caching trivial
//
// Phase 0: health + a stub streaming endpoint.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
)

func main() {
	port := getenv("MEDIA_PORT", "8090")
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "media"})
	})
	// /v1/stream/{sha256} will authorize then proxy/redirect to object storage with range support.
	mux.HandleFunc("/v1/stream/", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusNotImplemented, map[string]string{"note": "stub"})
	})

	log.Printf("resonance-media listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
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
