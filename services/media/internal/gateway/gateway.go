// Package gateway is the auth-scoped audio streaming handler.
//
// Flow per request:
//  1. Verify the HMAC `sig`+`exp` minted by the control API (shared secret) — this is what makes
//     streaming *auth-scoped*: a caller can only stream a key the API authorized, briefly.
//  2. Presign an upstream GET against the object store and proxy it, forwarding the client's Range
//     header so the browser range-streams long originals natively (206 Partial Content relayed).
//  3. Tag the response immutable — keys are content-addressed, so a CDN can cache forever.
//
// Bytes flow through the gateway (not the Python control plane): that is the point of a stateless,
// HPA-scaled Go streamer. The signature is verified over the object key + expiry only, so a CDN can
// safely cache on the path and ignore the rotating query string.
package gateway

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/resonance/services/media/internal/objstore"
)

// Gateway streams object-store blobs after verifying an API-minted signature.
type Gateway struct {
	Secret      []byte
	Store       *objstore.Client
	HTTP        *http.Client
	UpstreamTTL time.Duration // validity of the internal presigned URL to the object store
	CacheMaxAge int           // Cache-Control max-age for immutable content-addressed responses
	Now         func() time.Time
}

// Sign computes the token the API embeds in a stream URL: HMAC-SHA256(secret, key + "\n" + exp).
func Sign(secret []byte, key, exp string) string {
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(key + "\n" + exp))
	return hex.EncodeToString(m.Sum(nil))
}

func (g *Gateway) now() time.Time {
	if g.Now != nil {
		return g.Now()
	}
	return time.Now()
}

// verify checks the signature and that the URL has not expired (constant-time compare).
func (g *Gateway) verify(key, exp, sig string) bool {
	if key == "" || exp == "" || sig == "" {
		return false
	}
	ts, err := strconv.ParseInt(exp, 10, 64)
	if err != nil || g.now().Unix() > ts {
		return false
	}
	return hmac.Equal([]byte(Sign(g.Secret, key, exp)), []byte(sig))
}

// Stream handles GET/HEAD /v1/stream/<object-key>?exp=&sig=.
func (g *Gateway) Stream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	key := strings.TrimPrefix(r.URL.Path, "/v1/stream/")
	q := r.URL.Query()
	if !g.verify(key, q.Get("exp"), q.Get("sig")) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	signedURL, err := g.Store.PresignGet(key, g.UpstreamTTL, g.now())
	if err != nil {
		http.Error(w, "bad gateway", http.StatusBadGateway)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, signedURL, nil)
	if err != nil {
		http.Error(w, "bad gateway", http.StatusBadGateway)
		return
	}
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", rng) // forward range; presigned URLs don't sign it
	}
	resp, err := g.HTTP.Do(req)
	if err != nil {
		http.Error(w, "bad gateway", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	relay(w.Header(), resp.Header,
		"Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified")
	if resp.StatusCode < 300 {
		// Content-addressed key => the bytes for this URL never change.
		w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d, immutable", g.CacheMaxAge))
		w.Header().Set("Access-Control-Allow-Origin", "*")
	}
	w.WriteHeader(resp.StatusCode)
	if r.Method == http.MethodGet {
		_, _ = io.Copy(w, resp.Body)
	}
}

func relay(dst, src http.Header, keys ...string) {
	for _, k := range keys {
		if v := src.Get(k); v != "" {
			dst.Set(k, v)
		}
	}
}
