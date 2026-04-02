#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# RouteAI EDA — One-Click Development Setup
# ═══════════════════════════════════════════════════════════════
#
# Run this after cloning:  ./scripts/setup-dev.sh
#
# Installs: Python deps, Node deps, Go deps, Ollama models
# Then starts all services.
#
# Safe to run multiple times (idempotent).
#
# Options:
#   --no-start    Install everything but don't start services
#   --no-ollama   Skip Ollama model setup (saves time/bandwidth)
#   --help        Show this help

set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# ─── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── Options ─────────────────────────────────────────────────
START_SERVICES=true
SETUP_OLLAMA=true

for arg in "$@"; do
    case "$arg" in
        --no-start)   START_SERVICES=false ;;
        --no-ollama)  SETUP_OLLAMA=false ;;
        --help|-h)
            echo "Usage: ./scripts/setup-dev.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --no-start    Install everything but don't start services"
            echo "  --no-ollama   Skip Ollama model setup"
            echo "  --help        Show this help"
            exit 0
            ;;
    esac
done

# ─── Banner ──────────────────────────────────────────────────
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  RouteAI EDA — Development Setup         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

ERRORS=0

# ─── Step 1: Check prerequisites ────────────────────────────
echo -e "${CYAN}[1/6] Checking prerequisites...${NC}"
MISSING=""
command -v python3 >/dev/null 2>&1 || MISSING="$MISSING python3"
command -v node    >/dev/null 2>&1 || MISSING="$MISSING node"
command -v npm     >/dev/null 2>&1 || MISSING="$MISSING npm"

if [ -n "$MISSING" ]; then
    echo -e "${RED}Missing required tools:$MISSING${NC}"
    echo ""
    echo "Install them first, then re-run this script."
    echo "  Python 3.11+: https://www.python.org/downloads/"
    echo "  Node 18+:     https://nodejs.org/"
    exit 1
fi

echo -e "  Python:  $(python3 --version 2>&1)"
echo -e "  Node:    $(node -v 2>&1)"
echo -e "  npm:     $(npm -v 2>&1)"

# Go is optional
if command -v go >/dev/null 2>&1; then
    echo -e "  Go:      $(go version 2>&1 | awk '{print $3}')"
    HAS_GO=true
else
    echo -e "  Go:      ${YELLOW}not found (optional — Go API won't build)${NC}"
    HAS_GO=false
fi

# Git check
if command -v git >/dev/null 2>&1; then
    echo -e "  Git:     $(git --version 2>&1 | awk '{print $3}')"
else
    echo -e "  Git:     ${YELLOW}not found${NC}"
fi

echo ""

# ─── Step 2: Install Python dependencies ────────────────────
echo -e "${CYAN}[2/6] Installing Python dependencies...${NC}"

# Install Poetry if needed
if python3 -m poetry --version >/dev/null 2>&1; then
    echo -e "  Poetry:  $(python3 -m poetry --version 2>&1)"
else
    echo -e "  ${YELLOW}Installing Poetry...${NC}"
    pip install poetry 2>/dev/null || pip3 install poetry 2>/dev/null || {
        echo -e "  ${RED}Failed to install Poetry. Try: pip install poetry${NC}"
        ERRORS=$((ERRORS + 1))
    }
fi

PYTHON_PACKAGES=(core parsers solver intelligence cli)

for pkg in "${PYTHON_PACKAGES[@]}"; do
    PKG_DIR="$ROOT_DIR/packages/$pkg"
    if [ -f "$PKG_DIR/pyproject.toml" ]; then
        echo -ne "  Installing packages/$pkg..."
        if (cd "$PKG_DIR" && python3 -m poetry install --no-interaction 2>&1 | tail -1); then
            echo -e " ${GREEN}done${NC}"
        else
            echo -e " ${RED}failed${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    else
        echo -e "  ${YELLOW}Skipping packages/$pkg (no pyproject.toml)${NC}"
    fi
done

echo ""

# ─── Step 3: Install Node dependencies ──────────────────────
echo -e "${CYAN}[3/6] Installing Node dependencies...${NC}"

if [ -f "$ROOT_DIR/app/package.json" ]; then
    cd "$ROOT_DIR/app"
    if [ -d "node_modules" ] && [ -f "node_modules/.package-lock.json" ]; then
        echo -e "  ${GREEN}node_modules already present${NC} (run 'npm install' in app/ to update)"
    else
        echo -ne "  Running npm install..."
        if npm install 2>&1 | tail -2; then
            echo -e "  ${GREEN}done${NC}"
        else
            echo -e "  ${RED}npm install failed${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    fi
    cd "$ROOT_DIR"
else
    echo -e "  ${YELLOW}No app/package.json found — skipping${NC}"
fi

echo ""

# ─── Step 4: Build Go API ───────────────────────────────────
echo -e "${CYAN}[4/6] Building Go API gateway...${NC}"

if [ "$HAS_GO" = true ] && [ -f "$ROOT_DIR/packages/api/go.mod" ]; then
    cd "$ROOT_DIR/packages/api"
    if [ -f "./routeai-api" ]; then
        # Check if binary is up-to-date
        STALE=$(find . -name '*.go' -newer ./routeai-api 2>/dev/null | head -1)
        if [ -z "$STALE" ]; then
            echo -e "  ${GREEN}Binary up to date${NC}"
        else
            echo -ne "  Rebuilding (source changed)..."
            if go build -o routeai-api . 2>&1; then
                echo -e " ${GREEN}done${NC}"
            else
                echo -e " ${RED}build failed${NC}"
                ERRORS=$((ERRORS + 1))
            fi
        fi
    else
        echo -ne "  Building..."
        if go build -o routeai-api . 2>&1; then
            echo -e " ${GREEN}done${NC}"
        else
            echo -e " ${RED}build failed${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    fi
    cd "$ROOT_DIR"
else
    if [ "$HAS_GO" = false ]; then
        echo -e "  ${YELLOW}Skipping (Go not installed)${NC}"
        echo -e "  Install Go 1.22+: ${BLUE}https://go.dev/dl/${NC}"
    else
        echo -e "  ${YELLOW}No packages/api/go.mod found — skipping${NC}"
    fi
fi

echo ""

# ─── Step 5: Setup Ollama ───────────────────────────────────
echo -e "${CYAN}[5/6] Setting up Ollama (AI models)...${NC}"

if [ "$SETUP_OLLAMA" = false ]; then
    echo -e "  ${YELLOW}Skipped (--no-ollama flag)${NC}"
elif command -v ollama >/dev/null 2>&1; then
    echo -e "  Ollama found. Running model setup..."
    if bash "$ROOT_DIR/scripts/setup_ollama.sh"; then
        echo -e "  ${GREEN}Ollama models ready${NC}"
    else
        echo -e "  ${YELLOW}Ollama setup had issues (non-fatal)${NC}"
    fi
else
    echo -e "  ${YELLOW}Ollama not installed${NC}"
    echo -e "  Install: ${BLUE}curl -fsSL https://ollama.ai/install.sh | sh${NC}"
    echo -e "  Then run: ${BLUE}./scripts/setup_ollama.sh${NC}"
    echo -e "  ${YELLOW}AI features will be limited without Ollama${NC}"
fi

echo ""

# ─── Step 6: Create local env file if missing ───────────────
echo -e "${CYAN}[6/6] Environment configuration...${NC}"

if [ ! -f "$ROOT_DIR/.env" ]; then
    cat > "$ROOT_DIR/.env" <<'ENVEOF'
# RouteAI EDA — Local Environment
# Copy to .env and customize as needed.

# Ollama (local LLM)
OLLAMA_BASE_URL=http://localhost:11434

# Go API
GIN_MODE=debug
ML_SERVICE_URL=http://localhost:8001

# Component library paths
KICAD_INDEX_PATH=data/component_library/kicad_index.json
KICAD_SYMBOLS_PATH=data/component_library/kicad_symbols.json

# Optional: Anthropic API key (for Claude-powered features)
# ANTHROPIC_API_KEY=sk-ant-...
ENVEOF
    echo -e "  ${GREEN}Created .env with defaults${NC}"
else
    echo -e "  ${GREEN}.env already exists${NC}"
fi

echo ""

# ─── Summary ─────────────────────────────────────────────────
if [ "$ERRORS" -gt 0 ]; then
    echo -e "${YELLOW}╔══════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║  Setup finished with $ERRORS warning(s)       ║${NC}"
    echo -e "${YELLOW}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Some components may not work. Check output above."
else
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  All dependencies installed!             ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
fi

echo ""

# ─── Start services ──────────────────────────────────────────
if [ "$START_SERVICES" = true ]; then
    echo -e "Starting all services..."
    echo ""
    bash "$ROOT_DIR/start.sh" dev
else
    echo -e "To start services, run:"
    echo -e "  ${BLUE}./start.sh${NC}"
    echo ""
    echo -e "Or use Make targets:"
    echo -e "  ${BLUE}make dev${NC}       — Start Docker services (PostgreSQL, Redis, MinIO)"
    echo -e "  ${BLUE}make test${NC}      — Run all tests"
    echo -e "  ${BLUE}make lint${NC}      — Run linting"
fi

echo ""
echo -e "Open ${BLUE}http://localhost:3000${NC} in your browser when services are up."
