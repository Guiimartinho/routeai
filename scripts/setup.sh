#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

PYTHON_PACKAGES=(core parsers intelligence solver)

# ── Check Python version ──────────────────────────────────────────────
info "Checking Python version..."
if ! command -v python3 &>/dev/null; then
    error "Python 3 is not installed. Please install Python 3.11 or later."
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
PYTHON_MAJOR=$(echo "$PYTHON_VERSION" | cut -d. -f1)
PYTHON_MINOR=$(echo "$PYTHON_VERSION" | cut -d. -f2)

if [ "$PYTHON_MAJOR" -lt 3 ] || { [ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 11 ]; }; then
    error "Python 3.11+ is required. Found Python $PYTHON_VERSION."
fi
info "Python $PYTHON_VERSION detected."

# ── Install Poetry ────────────────────────────────────────────────────
info "Checking for Poetry..."
if ! command -v poetry &>/dev/null; then
    warn "Poetry not found. Installing..."
    curl -sSL https://install.python-poetry.org | python3 -
    export PATH="$HOME/.local/bin:$PATH"
    if ! command -v poetry &>/dev/null; then
        error "Poetry installation failed. Please install manually: https://python-poetry.org/docs/#installation"
    fi
    info "Poetry installed successfully."
else
    POETRY_VER=$(poetry --version | grep -oP '\d+\.\d+\.\d+')
    info "Poetry $POETRY_VER detected."
fi

poetry config virtualenvs.in-project true

# ── Install Python package dependencies ───────────────────────────────
for pkg in "${PYTHON_PACKAGES[@]}"; do
    pkg_dir="packages/$pkg"
    if [ -f "$pkg_dir/pyproject.toml" ]; then
        info "Installing dependencies for $pkg..."
        (cd "$pkg_dir" && poetry install --no-interaction)
    else
        warn "No pyproject.toml found in $pkg_dir, skipping."
    fi
done

# ── Setup pre-commit hooks ────────────────────────────────────────────
info "Setting up pre-commit hooks..."
if [ -f ".pre-commit-config.yaml" ]; then
    if command -v pre-commit &>/dev/null; then
        pre-commit install
        info "Pre-commit hooks installed."
    else
        warn "pre-commit not found. Installing via pip..."
        pip3 install --user pre-commit
        pre-commit install
        info "Pre-commit hooks installed."
    fi
else
    warn "No .pre-commit-config.yaml found. Skipping pre-commit setup."
fi

# ── Start Docker services ────────────────────────────────────────────
info "Starting Docker services..."
if ! command -v docker &>/dev/null; then
    warn "Docker is not installed. Skipping service startup."
    warn "Install Docker to run PostgreSQL, Redis, and MinIO locally."
else
    if ! docker info &>/dev/null 2>&1; then
        warn "Docker daemon is not running. Skipping service startup."
    else
        docker-compose up -d
        info "Waiting for PostgreSQL to be ready..."
        retries=0
        max_retries=30
        until docker-compose exec -T postgres pg_isready -U routeai -d routeai &>/dev/null || [ $retries -ge $max_retries ]; do
            retries=$((retries + 1))
            sleep 1
        done
        if [ $retries -ge $max_retries ]; then
            warn "PostgreSQL did not become ready in time. You may need to run migrations manually."
        else
            info "PostgreSQL is ready."
        fi
    fi
fi

# ── Create DB schema ─────────────────────────────────────────────────
info "Setting up database schema..."
if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    if docker-compose exec -T postgres pg_isready -U routeai -d routeai &>/dev/null; then
        docker-compose exec -T postgres psql -U routeai -d routeai -c "CREATE EXTENSION IF NOT EXISTS postgis;" 2>/dev/null || true
        docker-compose exec -T postgres psql -U routeai -d routeai -c "CREATE EXTENSION IF NOT EXISTS vector;" 2>/dev/null || true
        docker-compose exec -T postgres psql -U routeai -d routeai -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";" 2>/dev/null || true

        if [ -f "scripts/init-db.sql" ]; then
            docker-compose exec -T postgres psql -U routeai -d routeai < scripts/init-db.sql 2>/dev/null || true
            info "Database schema applied from scripts/init-db.sql."
        else
            info "No init-db.sql found. Extensions enabled; add schema migrations as needed."
        fi
    else
        warn "PostgreSQL is not reachable. Skipping schema setup."
    fi
else
    warn "Docker not available. Skipping database schema setup."
fi

# ── Done ──────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  RouteAI development environment is ready  ${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "  Services:"
echo "    PostgreSQL : localhost:5432  (user: routeai / pass: routeai_dev)"
echo "    Redis      : localhost:6379"
echo "    MinIO      : localhost:9000  (console: localhost:9001)"
echo "               : user: routeai / pass: routeai_dev"
echo ""
echo "  Quick start:"
echo "    make test       - Run all tests"
echo "    make lint       - Run linting"
echo "    make dev        - Restart Docker services"
echo "    make dev-down   - Stop Docker services"
echo ""
