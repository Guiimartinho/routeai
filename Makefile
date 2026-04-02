.PHONY: dev dev-down test test-core test-parsers test-intelligence test-solver test-cli \
       test-cov lint lint-fix format benchmark clean setup

PYTHON_PACKAGES := core parsers intelligence solver cli

dev:
	docker-compose up -d
	@echo "Development environment started."
	@echo "  PostgreSQL: localhost:5432"
	@echo "  Redis:      localhost:6379"
	@echo "  MinIO:      localhost:9000 (console: localhost:9001)"

dev-down:
	docker-compose down

# ── Testing ──────────────────────────────────────────────────────────────────

test:
	@for pkg in $(PYTHON_PACKAGES); do \
		echo "=== Testing packages/$$pkg ==="; \
		cd packages/$$pkg && poetry run pytest -v --tb=short && cd ../..; \
	done

test-core:
	cd packages/core && poetry run pytest -v --tb=short

test-parsers:
	cd packages/parsers && poetry run pytest -v --tb=short

test-intelligence:
	cd packages/intelligence && poetry run pytest -v --tb=short

test-solver:
	cd packages/solver && poetry run pytest -v --tb=short

test-cli:
	cd packages/cli && poetry run pytest -v --tb=short

test-cov:
	@for pkg in $(PYTHON_PACKAGES); do \
		echo "=== Coverage packages/$$pkg ==="; \
		cd packages/$$pkg && poetry run pytest --cov --cov-report=term-missing --tb=short && cd ../..; \
	done

# ── Linting & Formatting ────────────────────────────────────────────────────

lint:
	@echo "=== Ruff Check ==="
	@for pkg in $(PYTHON_PACKAGES); do \
		echo "--- packages/$$pkg ---"; \
		cd packages/$$pkg && poetry run ruff check src/ tests/ && cd ../..; \
	done
	@echo "=== Mypy ==="
	@for pkg in $(PYTHON_PACKAGES); do \
		echo "--- packages/$$pkg ---"; \
		cd packages/$$pkg && poetry run mypy src/ && cd ../..; \
	done

lint-fix:
	@for pkg in $(PYTHON_PACKAGES); do \
		echo "=== Fixing packages/$$pkg ==="; \
		cd packages/$$pkg && poetry run ruff check --fix src/ tests/ && cd ../..; \
	done

format:
	@for pkg in $(PYTHON_PACKAGES); do \
		echo "=== Formatting packages/$$pkg ==="; \
		cd packages/$$pkg && poetry run ruff format src/ tests/ && cd ../..; \
	done

format-check:
	@for pkg in $(PYTHON_PACKAGES); do \
		echo "=== Checking format packages/$$pkg ==="; \
		cd packages/$$pkg && poetry run ruff format --check src/ tests/ && cd ../..; \
	done

# ── Benchmark ────────────────────────────────────────────────────────────────

benchmark:
	@echo "=== Running benchmarks ==="
	cd packages/solver && poetry run pytest benchmarks/ -v --benchmark-only 2>/dev/null || \
		echo "No benchmarks found. Add benchmark tests to packages/solver/benchmarks/"

# ── Cleanup ──────────────────────────────────────────────────────────────────

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".mypy_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	find . -type d -name "dist" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "build" -exec rm -rf {} + 2>/dev/null || true
	find . -name ".coverage" -delete 2>/dev/null || true
	find . -type d -name "htmlcov" -exec rm -rf {} + 2>/dev/null || true
	@echo "Build artifacts cleaned."

# ── Setup ───────────────────────────────────────────────────────────────────

setup:
	@bash scripts/setup-dev.sh

setup-no-start:
	@bash scripts/setup-dev.sh --no-start
