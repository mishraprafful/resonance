// Package sink batches metric rows and inserts them into ClickHouse over the HTTP interface.
// Stdlib-only: ClickHouse's HTTP endpoint accepts `INSERT ... FORMAT JSONEachRow` as a POST body.
package sink

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// Row is a single scalar metric observation. ts is omitted so ClickHouse fills now64(3).
type Row struct {
	OrgID     string  `json:"org_id"`
	ProjectID string  `json:"project_id"`
	RunID     string  `json:"run_id"`
	Metric    string  `json:"metric"`
	Step      int64   `json:"step"`
	Value     float64 `json:"value"`
}

// EncodeJSONEachRow renders rows in ClickHouse's JSONEachRow format (one JSON object per line).
func EncodeJSONEachRow(rows []Row) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	for _, r := range rows {
		if err := enc.Encode(r); err != nil {
			return nil, err
		}
	}
	return buf.Bytes(), nil
}

type Config struct {
	URL        string // e.g. http://localhost:8123
	Database   string
	User       string
	Password   string
	FlushEvery time.Duration
	MaxBatch   int
	BufferSize int
}

// Sink buffers rows and flushes them to ClickHouse on size or time, decoupling the request
// path from the database write. (The durable stream queue replaces this buffer in the scale phase.)
type Sink struct {
	cfg    Config
	client *http.Client
	ch     chan Row
	wg     sync.WaitGroup
	stop   chan struct{}
}

func New(cfg Config) *Sink {
	if cfg.FlushEvery == 0 {
		cfg.FlushEvery = time.Second
	}
	if cfg.MaxBatch == 0 {
		cfg.MaxBatch = 10000
	}
	if cfg.BufferSize == 0 {
		cfg.BufferSize = 100000
	}
	return &Sink{
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second},
		ch:     make(chan Row, cfg.BufferSize),
		stop:   make(chan struct{}),
	}
}

// Enqueue adds a row without blocking the request path. Returns false if the buffer is full
// (caller may shed load / return 503 under extreme pressure).
func (s *Sink) Enqueue(r Row) bool {
	select {
	case s.ch <- r:
		return true
	default:
		return false
	}
}

func (s *Sink) Start() {
	s.wg.Add(1)
	go s.loop()
}

func (s *Sink) Close() {
	close(s.stop)
	s.wg.Wait()
}

func (s *Sink) loop() {
	defer s.wg.Done()
	ticker := time.NewTicker(s.cfg.FlushEvery)
	defer ticker.Stop()
	batch := make([]Row, 0, s.cfg.MaxBatch)

	flush := func() {
		if len(batch) == 0 {
			return
		}
		if err := s.insert(batch); err != nil {
			// Phase 1: log and drop. The stream queue makes this durable in the scale phase.
			fmt.Printf("clickhouse insert error (%d rows dropped): %v\n", len(batch), err)
		}
		batch = batch[:0]
	}

	for {
		select {
		case <-s.stop:
			for {
				select {
				case r := <-s.ch:
					batch = append(batch, r)
				default:
					flush()
					return
				}
			}
		case r := <-s.ch:
			batch = append(batch, r)
			if len(batch) >= s.cfg.MaxBatch {
				flush()
			}
		case <-ticker.C:
			flush()
		}
	}
}

func (s *Sink) insert(rows []Row) error {
	body, err := EncodeJSONEachRow(rows)
	if err != nil {
		return err
	}
	q := url.Values{}
	q.Set("database", s.cfg.Database)
	q.Set("query", "INSERT INTO metrics FORMAT JSONEachRow")
	// `metrics` is a Distributed table: route rows to the owning shard synchronously so a read
	// immediately after an insert sees them on the right node (no-op on a single-node target).
	q.Set("insert_distributed_sync", "1")
	if s.cfg.User != "" {
		q.Set("user", s.cfg.User)
	}
	if s.cfg.Password != "" {
		q.Set("password", s.cfg.Password)
	}
	req, err := http.NewRequestWithContext(
		context.Background(), http.MethodPost, s.cfg.URL+"/?"+q.Encode(), bytes.NewReader(body),
	)
	if err != nil {
		return err
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("clickhouse status %d: %s", resp.StatusCode, msg)
	}
	return nil
}
