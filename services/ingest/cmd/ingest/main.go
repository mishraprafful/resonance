// Resonance ingestion gateway (hot path).
//
//   - POST /v1/metrics   batched scalar ingest -> buffered -> ClickHouse (JSONEachRow)
//   - POST /v1/assets/prepare  dedup check + presigned upload URL (Phase 2 stub)
//
// Audio bytes never transit this service: PrepareAssetUpload returns a presigned URL and the
// client uploads directly to object storage.
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/resonance/services/ingest/internal/sink"
)

type runRef struct {
	OrgID     string `json:"org_id"`
	ProjectID string `json:"project_id"`
	RunID     string `json:"run_id"`
}

type metricPoint struct {
	Metric string  `json:"metric"`
	Step   int64   `json:"step"`
	Value  float64 `json:"value"`
}

type logMetricsRequest struct {
	Run    runRef        `json:"run"`
	Points []metricPoint `json:"points"`
}

type server struct {
	sink *sink.Sink
}

func main() {
	port := getenv("INGEST_HTTP_PORT", "8080")
	s := &server{sink: sink.New(sink.Config{
		URL:        getenv("CLICKHOUSE_URL", "http://localhost:8123"),
		Database:   getenv("CLICKHOUSE_DB", "resonance"),
		User:       getenv("CLICKHOUSE_USER", "resonance"),
		Password:   getenv("CLICKHOUSE_PASSWORD", "resonance"),
		FlushEvery: 1 * time.Second,
	})}
	s.sink.Start()
	defer s.sink.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", health)
	mux.HandleFunc("/v1/metrics", s.logMetrics)
	mux.HandleFunc("/v1/assets/prepare", prepareAsset)

	log.Printf("resonance-ingest listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatal(err)
	}
}

func health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "ingest"})
}

func (s *server) logMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req logMetricsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if req.Run.OrgID == "" || req.Run.RunID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "run.org_id and run.run_id required"})
		return
	}
	accepted := 0
	for _, p := range req.Points {
		ok := s.sink.Enqueue(sink.Row{
			OrgID:     req.Run.OrgID,
			ProjectID: req.Run.ProjectID,
			RunID:     req.Run.RunID,
			Metric:    p.Metric,
			Step:      p.Step,
			Value:     p.Value,
		})
		if !ok {
			break // buffer full: shed load
		}
		accepted++
	}
	code := http.StatusAccepted
	if accepted < len(req.Points) {
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, map[string]any{"accepted": strconv.Itoa(accepted)})
}

// prepareAsset: dedup check + presigned PUT URL. Phase-2 stub.
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
