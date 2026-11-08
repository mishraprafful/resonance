"""Unit tests for media-gateway URL signing and best-effort derivation publishing.

The signing scheme must stay byte-compatible with the Go gateway's verify (HMAC-SHA256 over
"<key>\\n<exp>"); this test pins that contract.
"""

import hashlib
import hmac
from urllib.parse import urlparse, parse_qs

from resonance_api import media, queue
from resonance_api.settings import settings


def test_stream_url_signature_matches_gateway_contract(monkeypatch):
    monkeypatch.setattr(settings, "media_gateway_url", "http://media:8090")
    monkeypatch.setattr(settings, "media_signing_secret", "s3cr3t")
    key = "org-1/blobs/ab/cd/abcd"

    url = media.stream_url(key)
    parsed = urlparse(url)
    assert parsed.path == f"/v1/stream/{key}"  # key slashes preserved in the path
    q = parse_qs(parsed.query)
    exp, sig = q["exp"][0], q["sig"][0]

    expected = hmac.new(b"s3cr3t", f"{key}\n{exp}".encode(), hashlib.sha256).hexdigest()
    assert sig == expected


def test_media_enabled_reflects_config(monkeypatch):
    monkeypatch.setattr(settings, "media_gateway_url", "")
    assert media.enabled() is False
    monkeypatch.setattr(settings, "media_gateway_url", "http://media:8090")
    assert media.enabled() is True


def test_publish_derivation_noop_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "pandaproxy_url", "")
    # Must not attempt any network call and must report False (backstop will derive).
    assert queue.publish_derivation("o1", "abc", "o1/blobs/abc") is False
