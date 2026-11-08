.DEFAULT_GOAL := help
COMPOSE := docker compose -f deploy/dev/docker-compose.yml

.PHONY: help site dev-up dev-down dev-logs dev-ps lint test e2e \
        sdk-install api-install workers-install ui-install \
        ingest-build media-build

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

## --- One-command local app (try it in the browser) ---
up: dev-up ## Bring up EVERYTHING (stack + services + ui) and print the URL
	@bash scripts/dev.sh wait
	@if ! .venv/bin/python -c "import resonance_api, resonance_workers, uvicorn" >/dev/null 2>&1 \
		|| [ ! -d src/ui/node_modules ]; then bash scripts/dev.sh venv; fi
	@bash scripts/dev.sh start
	@echo "\n  ▶ Open http://localhost:5280  —  run 'make demo' to populate a sample run\n"
down: ## Stop the app services AND the dev stack
	-@bash scripts/dev.sh stop
	$(COMPOSE) down
restart: down up ## Restart everything
demo: ## Log a sample training run (metrics + audio) so the UI has data
	@RESONANCE_MODE=online RESONANCE_API_URL=http://localhost:8000 \
	  RESONANCE_INGEST_URL=http://localhost:18080 \
	  .venv/bin/python examples/train_demo.py
app-install: ## Create the venv + install python/ui deps
	@bash scripts/dev.sh venv
app-status: ## Show which app services are running
	@bash scripts/dev.sh status
app-logs: ## Tail app service logs (make app-logs svc=api)
	@bash scripts/dev.sh logs $(svc)
open: ## Open the app in your browser (macOS)
	@open http://localhost:5173 2>/dev/null || echo "open http://localhost:5173"
site: ## Serve the project website on http://localhost:5290
	python3 -m http.server 5290 --directory site

## --- Dev stack only ---
dev-up: ## Start just the data stack (Postgres, ClickHouse, MinIO, Redpanda, Redis)
	$(COMPOSE) up -d --remove-orphans
dev-down: ## Stop the dev stack
	$(COMPOSE) down --remove-orphans
dev-logs: ## Tail dev stack logs
	$(COMPOSE) logs -f
dev-ps: ## Show dev stack status
	$(COMPOSE) ps
dev-reset: ## DESTROY local data (needed after a schema change) and restart the stack
	$(COMPOSE) down --remove-orphans
	rm -rf deploy/dev/.data
	$(COMPOSE) up -d --remove-orphans

## --- Install / build ---
sdk-install: ## Install the Python SDK (editable)
	cd sdk && pip install -e ".[dev]"
api-install: ## Install the control/query API (editable)
	cd services/api && pip install -e ".[dev]"
workers-install: ## Install the audio workers (editable)
	cd workers && pip install -e ".[dev]"
ui-install: ## Install ui deps
	cd src/ui && npm install
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
	cd src/ui && npm run lint || true
test: ## Run all tests
	cd sdk && pytest -q || true
	cd services/api && pytest -q || true
	cd services/ingest && go test ./... || true
	cd services/media && go test ./... || true

## --- End-to-end suite (merge gate) ---
e2e: ## Bring up the full stack, run the end-to-end suite against it, tear down (KEEP_UP=1 to keep)
	./e2e/run.sh

## --- Load testing / capacity certification ---
loadtest: ## Run the k6 load-test suite (requires k6); BASE_URL overridable
	./loadtest/run.sh $(or $(BASE_URL),http://localhost:8080)
