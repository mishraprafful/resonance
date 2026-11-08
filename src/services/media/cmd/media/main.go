// Resonance media/streaming gateway.
//
// Auth-scoped, stateless audio streamer (HPA-scaled in prod). It verifies an HMAC signature minted
// by the control API, then range-proxies the content-addressed blob from the object store behind a
// CDN. Immutable keys make edge caching trivial. Audio bytes flow through here — never through the
// Python control plane.
//
//   - GET  /healthz                         liveness
//   - GET  /v1/stream/<key>?exp=&sig=       auth-scoped range streaming of an object-store blob
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/resonance/services/media/internal/gateway"
	"github.com/resonance/services/media/internal/objstore"
)

func main() {
	port := getenv("MEDIA_PORT", "8090")
	g := &gateway.Gateway{
		Secret: []byte(getenv("MEDIA_SIGNING_SECRET", "resonance-dev-media-secret")),
		Store: &objstore.Client{
			Endpoint:  getenv("S3_ENDPOINT", "http://localhost:9100"),
			Region:    getenv("S3_REGION", "us-east-1"),
			AccessKey: getenv("S3_ACCESS_KEY", "resonance"),
			SecretKey: getenv("S3_SECRET_KEY", "resonance-secret"),
			Bucket:    getenv("S3_BUCKET", "resonance-blobs"),
		},
		HTTP:        &http.Client{Timeout: 60 * time.Second},
		UpstreamTTL: 5 * time.Minute,
		CacheMaxAge: getenvInt("MEDIA_CACHE_MAX_AGE", 31536000), // 1y; safe because keys are immutable
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "media"})
	})
	mux.HandleFunc("/v1/stream/", g.Stream)

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

func getenvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
