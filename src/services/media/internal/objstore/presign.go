// Package objstore presigns S3 GET URLs (SigV4, query-string auth) so the media gateway can fetch
// content-addressed blobs from the object store without baking long-lived credentials into the URL.
//
// Stdlib-only: implements just the slice of SigV4 needed for a presigned GET against a path-style
// S3 endpoint (MinIO in dev). The Range header is deliberately NOT signed — for presigned URLs the
// client may add Range at request time, which is exactly how the gateway range-streams originals.
package objstore

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Client holds the object-store endpoint + credentials used to presign GETs.
type Client struct {
	Endpoint  string // e.g. http://localhost:9100 (path-style)
	Region    string
	AccessKey string
	SecretKey string
	Bucket    string
}

// PresignGet returns a presigned URL for an object key, valid for `expires`.
// `now` is injectable for deterministic tests; pass time.Now().UTC() in production.
func (c *Client) PresignGet(key string, expires time.Duration, now time.Time) (string, error) {
	u, err := url.Parse(c.Endpoint)
	if err != nil {
		return "", err
	}
	now = now.UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	credScope := dateStamp + "/" + c.Region + "/s3/aws4_request"

	// Path-style: /<bucket>/<key>. Encode each but preserve the key's slashes.
	canonicalURI := "/" + awsURIEncode(c.Bucket, true) + "/" + awsURIEncode(key, false)

	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", c.AccessKey+"/"+credScope)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", strconv.Itoa(int(expires.Seconds())))
	q.Set("X-Amz-SignedHeaders", "host")

	canonicalRequest := strings.Join([]string{
		"GET",
		canonicalURI,
		canonicalQueryString(q),
		"host:" + u.Host + "\n",
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")

	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credScope,
		hexSHA256([]byte(canonicalRequest)),
	}, "\n")

	signingKey := hmacSum(
		hmacSum(hmacSum(hmacSum([]byte("AWS4"+c.SecretKey), dateStamp), c.Region), "s3"),
		"aws4_request",
	)
	q.Set("X-Amz-Signature", hex.EncodeToString(hmacSum(signingKey, stringToSign)))

	return u.Scheme + "://" + u.Host + canonicalURI + "?" + canonicalQueryString(q), nil
}

// canonicalQueryString renders query params the AWS way: sorted, RFC3986-encoded keys and values.
func canonicalQueryString(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		ek := awsURIEncode(k, true)
		for _, v := range q[k] {
			parts = append(parts, ek+"="+awsURIEncode(v, true))
		}
	}
	return strings.Join(parts, "&")
}

// awsURIEncode applies RFC3986 percent-encoding per the SigV4 spec (space -> %20, uppercase hex).
// When encodeSlash is false, '/' is preserved (used for object key paths).
func awsURIEncode(s string, encodeSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~':
			b.WriteByte(c)
		case c == '/' && !encodeSlash:
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func hexSHA256(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func hmacSum(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}
