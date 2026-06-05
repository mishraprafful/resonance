package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/resonance/services/ingest/internal/sink"
)

func TestHealth(t *testing.T) {
	rec := httptest.NewRecorder()
	health(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func TestLogMetricsRejectsGet(t *testing.T) {
	s := &server{sink: sink.New(sink.Config{})}
	rec := httptest.NewRecorder()
	s.logMetrics(rec, httptest.NewRequest(http.MethodGet, "/v1/metrics", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("want 405, got %d", rec.Code)
	}
}

func TestLogMetricsAcceptsBatch(t *testing.T) {
	s := &server{sink: sink.New(sink.Config{})} // not started: rows buffer in channel
	body := `{"run":{"org_id":"o","run_id":"r"},"points":[{"metric":"loss","step":1,"value":0.5}]}`
	rec := httptest.NewRecorder()
	s.logMetrics(rec, httptest.NewRequest(http.MethodPost, "/v1/metrics", strings.NewReader(body)))
	if rec.Code != http.StatusAccepted {
		t.Fatalf("want 202, got %d (%s)", rec.Code, rec.Body.String())
	}
}

func TestLogMetricsRequiresRunIDs(t *testing.T) {
	s := &server{sink: sink.New(sink.Config{})}
	rec := httptest.NewRecorder()
	s.logMetrics(rec, httptest.NewRequest(http.MethodPost, "/v1/metrics", strings.NewReader(`{"points":[]}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}
