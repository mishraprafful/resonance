.DEFAULT_GOAL := help
COMPOSE := docker compose -f deploy/dev/docker-compose.yml

.PHONY: help dev-up dev-down dev-logs dev-ps lint test \
        sdk-install api-install workers-install web-install \
        ingest-build media-build

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## --- Dev stack ---
dev-up: ## Start the local dev stack (Postgres, ClickHouse, MinIO, Redpanda, Redis)
	$(COMPOSE) up -d
dev-down: ## Stop the local dev stack
	$(COMPOSE) down
dev-logs: ## Tail dev stack logs
	$(COMPOSE) logs -f
dev-ps: ## Show dev stack status
	$(COMPOSE) ps

## --- Install / build ---
sdk-install: ## Install the Python SDK (editable)
	cd sdk && pip install -e ".[dev]"
api-install: ## Install the control/query API (editable)
	cd services/api && pip install -e ".[dev]"
workers-install: ## Install the audio workers (editable)
	cd workers && pip install -e ".[dev]"
web-install: ## Install web deps
	cd web && npm install
ingest-build: ## Build the Go ingestion gateway
	cd services/ingest && go build ./...
media-build: ## Build the Go media gateway
	cd services/media && go build ./...

## --- Quality ---
lint: ## Lint everything
	cd sdk && ruff check . || true
	cd services/api && ruff check . || true
	cd workers && ruff check . || true
	cd services/ingest && go vet ./... || true
	cd services/media && go vet ./... || true
	cd web && npm run lint || true
test: ## Run all tests
	cd sdk && pytest -q || true
	cd services/api && pytest -q || true
	cd services/ingest && go test ./... || true
	cd services/media && go test ./... || true

## --- Load testing / capacity certification ---
loadtest: ## Run the k6 load-test suite (requires k6); BASE_URL overridable
	./loadtest/run.sh $(or $(BASE_URL),http://localhost:8080)
