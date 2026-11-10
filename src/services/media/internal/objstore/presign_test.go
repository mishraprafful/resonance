package objstore

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestAWSURIEncode(t *testing.T) {
	tests := []struct {
		in          string
		encodeSlash bool
		want        string
	}{
		{"abc-123_.~", true, "abc-123_.~"},  // unreserved pass through
		{"a/b/c", false, "a/b/c"},           // slash preserved for key paths
		{"a/b/c", true, "a%2Fb%2Fc"},        // slash encoded for query values
		{"a b", true, "a%20b"},              // space -> %20, never +
		{"k=v", true, "k%3Dv"},              // reserved chars encoded
		{"peaks.json", false, "peaks.json"}, // typical derived recipe
	}
	for _, tc := range tests {
		if got := awsURIEncode(tc.in, tc.encodeSlash); got != tc.want {
			t.Errorf("awsURIEncode(%q, %v) = %q, want %q", tc.in, tc.encodeSlash, got, tc.want)
		}
	}
}

func TestCanonicalQueryStringSorted(t *testing.T) {
	q := url.Values{}
	q.Set("X-Amz-SignedHeaders", "host")
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", "ak/20240101/us-east-1/s3/aws4_request")
	got := canonicalQueryString(q)
	// Keys must be sorted; the credential's slashes must be percent-encoded.
	if !strings.HasPrefix(got, "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=ak%2F20240101") {
		t.Fatalf("unexpected canonical query: %q", got)
	}
}

func TestPresignGetDeterministicAndWellFormed(t *testing.T) {
	c := &Client{
		Endpoint:  "http://localhost:9100",
		Region:    "us-east-1",
		AccessKey: "resonance",
		SecretKey: "resonance-secret",
		Bucket:    "resonance-blobs",
	}
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	key := "org-1/blobs/ab/cd/abcd1234"

	u1, err := c.PresignGet(key, time.Hour, now)
	if err != nil {
		t.Fatal(err)
	}
	u2, _ := c.PresignGet(key, time.Hour, now)
	if u1 != u2 {
		t.Fatal("presign not deterministic for a fixed clock")
	}
	parsed, err := url.Parse(u1)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Path != "/resonance-blobs/"+key {
		t.Errorf("path = %q, want bucket+key with slashes preserved", parsed.Path)
	}
	for _, p := range []string{"X-Amz-Algorithm", "X-Amz-Credential", "X-Amz-Date", "X-Amz-Expires", "X-Amz-Signature"} {
		if parsed.Query().Get(p) == "" {
			t.Errorf("missing presign param %s", p)
		}
	}
	if got := parsed.Query().Get("X-Amz-Expires"); got != "3600" {
		t.Errorf("X-Amz-Expires = %q, want 3600", got)
	}
	// A later clock must change the signature (date/credential rotate).
	u3, _ := c.PresignGet(key, time.Hour, now.Add(48*time.Hour))
	if u1 == u3 {
		t.Fatal("presign should differ across days")
	}
}
