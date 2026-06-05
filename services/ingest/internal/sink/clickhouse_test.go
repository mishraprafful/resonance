package sink

import (
	"strings"
	"testing"
)

func TestEncodeJSONEachRow(t *testing.T) {
	rows := []Row{
		{OrgID: "o", ProjectID: "p", RunID: "r", Metric: "loss", Step: 1, Value: 0.5},
		{OrgID: "o", ProjectID: "p", RunID: "r", Metric: "loss", Step: 2, Value: 0.25},
	}
	out, err := EncodeJSONEachRow(rows)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) != 2 {
		t.Fatalf("want 2 lines, got %d: %q", len(lines), out)
	}
	if !strings.Contains(lines[0], `"metric":"loss"`) || !strings.Contains(lines[0], `"value":0.5`) {
		t.Fatalf("unexpected encoding: %s", lines[0])
	}
	// ts must be omitted so ClickHouse fills the now64(3) default.
	if strings.Contains(lines[0], `"ts"`) {
		t.Fatalf("ts should be omitted: %s", lines[0])
	}
}

func TestEnqueueDoesNotBlockWhenFull(t *testing.T) {
	s := New(Config{BufferSize: 1})
	if !s.Enqueue(Row{Metric: "a"}) {
		t.Fatal("first enqueue should succeed")
	}
	if s.Enqueue(Row{Metric: "b"}) {
		t.Fatal("enqueue past capacity should return false, not block")
	}
}
