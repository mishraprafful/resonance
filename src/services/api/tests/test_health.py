from fastapi.testclient import TestClient

from resonance_api.main import app

client = TestClient(app)


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["service"] == "api"
