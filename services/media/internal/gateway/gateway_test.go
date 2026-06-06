package gateway

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/resonance/services/media/internal/objstore"
)

var fixedNow = time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)

func newGateway(upstream string) *Gateway {
	return &Gateway{
		Secret:      []byte("test-secret"),
		Store:       &objstore.Client{Endpoint: upstream, Region: "us-east-1", AccessKey: "ak", SecretKey: "sk", Bucket: "blobs"},
		HTTP:        &http.Client{Timeout: 5 * time.Second},
		UpstreamTTL: time.Minute,
		CacheMaxAge: 31536000,
		Now:         func() time.Time { return fixedNow },
	}
}

func signedURL(g *Gateway, key string, exp int64) string {
	e := strconv.FormatInt(exp, 10)
	return "/v1/stream/" + key + "?exp=" + e + "&sig=" + Sign(g.Secret, key, e)
}

func TestVerifyRejects(t *testing.T) {
	g := newGateway("")
	key, exp := "org/blobs/x", strconv.FormatInt(fixedNow.Add(time.Hour).Unix(), 10)
	good := Sign(g.Secret, key, exp)

	tests := []struct {
		name          string
		key, exp, sig string
		want          bool
	}{
		{"valid", key, exp, good, true},
		{"expired", key, strconv.FormatInt(fixedNow.Add(-time.Hour).Unix(), 10), good, false},
		{"tampered key", "org/blobs/evil", exp, good, false},
		{"bad sig", key, exp, "deadbeef", false},
		{"missing sig", key, exp, "", false},
		{"non-numeric exp", key, "soon", good, false},
	}
	for _, tc := range tests {
		if got := g.verify(tc.key, tc.exp, tc.sig); got != tc.want {
			t.Errorf("%s: verify = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestStreamForbiddenOnBadSignature(t *testing.T) {
	g := newGateway("http://unused")
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/stream/org/blobs/x?exp=9999999999&sig=nope", nil)
	g.Stream(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestStreamProxiesAndForwardsRange(t *testing.T) {
	const body = "0123456789"
	var gotRange string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotRange = r.Header.Get("Range")
		if !strings.HasPrefix(r.URL.Path, "/blobs/") {
			t.Errorf("upstream path = %q, want bucket-prefixed", r.URL.Path)
		}
		if r.Header.Get("Range") != "" { // emulate object store honoring a range
			w.Header().Set("Content-Range", "bytes 0-3/10")
			w.Header().Set("Accept-Ranges", "bytes")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, body[0:4])
			return
		}
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = io.WriteString(w, body)
	}))
	defer upstream.Close()
	g := newGateway(upstream.URL)

	// full GET: 200 + immutable cache header relayed
	rec := httptest.NewRecorder()
	g.Stream(rec, httptest.NewRequest(http.MethodGet, signedURL(g, "org/blobs/abc", fixedNow.Add(time.Hour).Unix()), nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("full GET status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != body {
		t.Fatalf("body = %q, want %q", rec.Body.String(), body)
	}
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Errorf("missing immutable Cache-Control: %q", rec.Header().Get("Cache-Control"))
	}

	// ranged GET: forwarded + 206 relayed
	rec = httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, signedURL(g, "org/blobs/abc", fixedNow.Add(time.Hour).Unix()), nil)
	req.Header.Set("Range", "bytes=0-3")
	g.Stream(rec, req)
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("ranged GET status = %d, want 206", rec.Code)
	}
	if gotRange != "bytes=0-3" {
		t.Errorf("upstream Range = %q, want bytes=0-3", gotRange)
	}
	if rec.Body.String() != "0123" {
		t.Errorf("ranged body = %q, want 0123", rec.Body.String())
	}
	if rec.Header().Get("Content-Range") != "bytes 0-3/10" {
		t.Errorf("Content-Range not relayed: %q", rec.Header().Get("Content-Range"))
	}
}
