# Proto definitions

Shared wire contracts for Resonance, consumed by the Python SDK and the Go ingestion gateway.

- `resonance/v1/common.proto` — shared messages (`MetricPoint`, `RunRef`).
- `resonance/v1/ingest.proto` — the `Ingest` hot-path service (metrics + presigned audio uploads).

## Design rule

Audio bytes never traverse a service defined here. `PrepareAssetUpload` returns a **presigned URL**;
the client uploads directly to object storage. Services only exchange small metadata.

## Codegen (added in Phase 1)

```bash
# Go
buf generate   # or protoc --go_out / --go-grpc_out
# Python
python -m grpc_tools.protoc -I proto --python_out --grpc_python_out ...
```
A `buf.yaml` / `buf.gen.yaml` will be added when codegen is wired into CI.
