#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# RouteAI EDA — Start All Services
# ═══════════════════════════════════════════════════════════════
#
# Usage:
#   ./start.sh          — Start everything
#   ./start.sh dev      — Same as above (dev mode)
#   ./start.sh stop     — Stop all services
#   ./start.sh status   — Check status of all services
#
# Architecture:
#   Ollama (:11434)  — LLM engine (must be installed separately)
#   Go API (:8080)   — PRIMARY backend (Gin framework)
#   Python ML (:8001) — ML-only service (intelligence package)
#   Frontend (:3000) — React app (Vite dev server, proxies to Go :8080)

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="/tmp/routeai-logs"
mkdir -p "$LOG_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─── Functions ────────────────────────────────────────────────

check_ollama() {
    curl -s http://localhost:11434/api/tags > /dev/null 2>&1
}

check_go_backend() {
    curl -s http://localhost:8080/health > /dev/null 2>&1
}

check_ml_service() {
    curl -s http://localhost:8001/health > /dev/null 2>&1
}

check_frontend() {
    curl -s http://localhost:3000 > /dev/null 2>&1
}

start_ollama() {
    echo -e "${CYAN}[1/4] Ollama LLM Engine${NC}"
    if check_ollama; then
        MODELS=$(curl -s http://localhost:11434/api/tags 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(', '.join([m['name'] for m in d.get('models',[])]))" 2>/dev/null || echo "unknown")
        echo -e "  ${GREEN}Already running${NC} — Models: $MODELS"
    else
        # Try to start Ollama automatically
        OLLAMA_BIN=$(which ollama 2>/dev/null)
        if [ -n "$OLLAMA_BIN" ]; then
            nohup "$OLLAMA_BIN" serve > "$LOG_DIR/ollama.log" 2>&1 &
            OLLAMA_PID=$!
            echo "$OLLAMA_PID" > "$LOG_DIR/ollama.pid"

            echo -ne "  Starting..."
            for i in $(seq 1 10); do
                if check_ollama; then
                    echo ""
                    MODELS=$(curl -s http://localhost:11434/api/tags 2>/dev/null | python3 -c "import sys,json;d=json.load(sys.stdin);print(', '.join([m['name'] for m in d.get('models',[])]))" 2>/dev/null || echo "none")
                    echo -e "  ${GREEN}Running${NC} (PID: $OLLAMA_PID) — Models: $MODELS"
                    if [ "$MODELS" = "none" ] || [ -z "$MODELS" ]; then
                        echo -e "  ${YELLOW}No models installed.${NC} Pull one:"
                        echo -e "  ${BLUE}ollama pull qwen2.5:7b${NC}"
                    fi
                    echo ""
                    return 0
                fi
                echo -n "."
                sleep 1
            done
            echo ""
            echo -e "  ${RED}Failed to start${NC} — Check $LOG_DIR/ollama.log"
        else
            echo -e "  ${YELLOW}Ollama not installed${NC}"
            echo -e "  Install: ${BLUE}curl -fsSL https://ollama.ai/install.sh | sh${NC}"
        fi
        echo -e "  ${YELLOW}AI features will be limited without Ollama${NC}"
    fi
    echo ""
}

start_go_backend() {
    echo -e "${CYAN}[2/4] Go API Backend (port 8080)${NC}"

    # Kill existing
    fuser -k 8080/tcp > /dev/null 2>&1 || true
    sleep 1

    # Export env vars for Go backend
    export KICAD_INDEX_PATH="$SCRIPT_DIR/data/component_library/kicad_index.json"
    export KICAD_SYMBOLS_PATH="$SCRIPT_DIR/data/component_library/kicad_symbols.json"
    export ML_SERVICE_URL="http://localhost:8001"
    export OLLAMA_BASE_URL="http://localhost:11434"
    export GIN_MODE=debug
    # No DB needed in dev mode

    cd "$SCRIPT_DIR/packages/api"

    # Build if binary doesn't exist or is older than source
    if [ ! -f "./routeai-api" ] || [ "$(find . -name '*.go' -newer ./routeai-api 2>/dev/null | head -1)" ]; then
        echo -e "  ${YELLOW}Building Go binary...${NC}"
        export PATH="$HOME/go-install/go/bin:$PATH"
        export GOPATH="$HOME/go"
        if ! go build -o routeai-api . 2>"$LOG_DIR/go-build.log"; then
            echo -e "  ${RED}Build failed${NC} — Check $LOG_DIR/go-build.log"
            return 1
        fi
    fi

    nohup ./routeai-api > "$LOG_DIR/go-api.log" 2>&1 &
    GO_PID=$!
    echo "$GO_PID" > "$LOG_DIR/go-api.pid"

    # Wait for it
    echo -ne "  Starting..."
    for i in $(seq 1 20); do
        if check_go_backend; then
            echo ""
            echo -e "  ${GREEN}Running${NC} (PID: $GO_PID)"
            echo -e "  API:    ${BLUE}http://localhost:8080${NC}"
            echo -e "  Health: ${BLUE}http://localhost:8080/health${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done

    echo ""
    echo -e "  ${RED}Failed to start${NC} — Check $LOG_DIR/go-api.log"
    tail -5 "$LOG_DIR/go-api.log" 2>/dev/null
    return 1
}

start_ml_service() {
    echo ""
    echo -e "${CYAN}[3/4] Python ML Service (port 8001)${NC}"

    # Kill existing
    fuser -k 8001/tcp > /dev/null 2>&1 || true
    sleep 1

    cd "$SCRIPT_DIR/packages/intelligence"

    # Resolve poetry virtualenv path
    POETRY_VENV=$(python3 -m poetry env info -p 2>/dev/null || true)
    if [ -z "$POETRY_VENV" ] || [ ! -f "$POETRY_VENV/bin/python" ]; then
        echo -e "  ${YELLOW}Setting up Python virtualenv...${NC}"
        python3 -m poetry env use python3 > /dev/null 2>&1
        python3 -m poetry install --no-interaction > /dev/null 2>&1
        POETRY_VENV=$(python3 -m poetry env info -p 2>/dev/null)
    fi

    VENV_PYTHON="$POETRY_VENV/bin/python"
    if ! "$VENV_PYTHON" -c "import fastapi" > /dev/null 2>&1; then
        echo -e "  ${YELLOW}Installing dependencies...${NC}"
        python3 -m poetry install --no-interaction > /dev/null 2>&1
    fi

    nohup "$VENV_PYTHON" -m uvicorn routeai_intelligence.ml_service:app --host 0.0.0.0 --port 8001 > "$LOG_DIR/ml.log" 2>&1 &
    ML_PID=$!
    echo "$ML_PID" > "$LOG_DIR/ml.pid"

    # Wait for it
    echo -ne "  Starting..."
    for i in $(seq 1 15); do
        if check_ml_service; then
            echo ""
            echo -e "  ${GREEN}Running${NC} (PID: $ML_PID)"
            echo -e "  ML API: ${BLUE}http://localhost:8001${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done

    echo ""
    echo -e "  ${YELLOW}ML service not ready${NC} — Check $LOG_DIR/ml.log"
    echo -e "  ${YELLOW}Go API will work without ML (AI features limited)${NC}"
    return 0
}

start_frontend() {
    echo ""
    echo -e "${CYAN}[4/4] React Frontend (port 3000)${NC}"

    # Kill existing
    fuser -k 3000/tcp > /dev/null 2>&1 || true
    sleep 1

    cd "$SCRIPT_DIR/app"

    # Check if node_modules exists
    if [ ! -d "node_modules" ]; then
        echo -e "  ${YELLOW}Installing npm dependencies...${NC}"
        npm install > /dev/null 2>&1
    fi

    # Clear Vite cache for clean start
    rm -rf node_modules/.vite

    # Start Vite (proxies to Go API :8080)
    nohup npx vite --host 0.0.0.0 --port 3000 --force > "$LOG_DIR/frontend.log" 2>&1 &
    FRONTEND_PID=$!
    echo "$FRONTEND_PID" > "$LOG_DIR/frontend.pid"

    # Wait for it
    echo -ne "  Starting..."
    for i in $(seq 1 15); do
        if check_frontend; then
            echo ""
            echo -e "  ${GREEN}Running${NC} (PID: $FRONTEND_PID)"
            echo -e "  App: ${BLUE}http://localhost:3000${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done

    echo ""
    echo -e "  ${RED}Failed to start${NC} — Check $LOG_DIR/frontend.log"
    return 1
}

stop_all() {
    echo -e "${CYAN}Stopping RouteAI services...${NC}"

    # Kill by PID files
    for svc in ollama go-api ml frontend; do
        if [ -f "$LOG_DIR/$svc.pid" ]; then
            PID=$(cat "$LOG_DIR/$svc.pid")
            kill -9 "$PID" 2>/dev/null && echo -e "  Stopped $svc (PID: $PID)" || true
            rm "$LOG_DIR/$svc.pid"
        fi
    done

    # Also kill legacy backend PID if present
    if [ -f "$LOG_DIR/backend.pid" ]; then
        PID=$(cat "$LOG_DIR/backend.pid")
        kill -9 "$PID" 2>/dev/null && echo -e "  Stopped legacy backend (PID: $PID)" || true
        rm "$LOG_DIR/backend.pid"
    fi

    # Kill by port
    fuser -k 11434/tcp > /dev/null 2>&1 || true
    fuser -k 8080/tcp > /dev/null 2>&1 || true
    fuser -k 8001/tcp > /dev/null 2>&1 || true
    fuser -k 8000/tcp > /dev/null 2>&1 || true
    fuser -k 3000/tcp > /dev/null 2>&1 || true

    echo -e "${GREEN}All services stopped.${NC}"
}

show_status() {
    echo -e "${CYAN}RouteAI EDA — Service Status${NC}"
    echo ""

    if check_ollama; then
        MODELS=$(curl -s http://localhost:11434/api/tags | python3 -c "import sys,json;d=json.load(sys.stdin);print(', '.join([m['name'] for m in d.get('models',[])]))" 2>/dev/null || echo "?")
        echo -e "  Ollama  (:11434)  ${GREEN}Running${NC} — $MODELS"
    else
        echo -e "  Ollama  (:11434)  ${RED}Stopped${NC}"
    fi

    if check_go_backend; then
        echo -e "  Go API  (:8080)   ${GREEN}Running${NC}"
    else
        echo -e "  Go API  (:8080)   ${RED}Stopped${NC}"
    fi

    if check_ml_service; then
        echo -e "  ML Svc  (:8001)   ${GREEN}Running${NC}"
    else
        echo -e "  ML Svc  (:8001)   ${RED}Stopped${NC}"
    fi

    if check_frontend; then
        echo -e "  Frontend (:3000)  ${GREEN}Running${NC}"
    else
        echo -e "  Frontend (:3000)  ${RED}Stopped${NC}"
    fi

    echo ""
}

# ─── Main ─────────────────────────────────────────────────────

case "${1:-dev}" in
    dev|start)
        echo ""
        echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║       RouteAI EDA — Starting...          ║${NC}"
        echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
        echo ""

        start_ollama
        start_go_backend
        start_ml_service
        start_frontend

        echo ""
        echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║       RouteAI EDA — Ready!               ║${NC}"
        echo -e "${GREEN}╠══════════════════════════════════════════╣${NC}"
        echo -e "${GREEN}║                                          ║${NC}"
        echo -e "${GREEN}║  App:     ${BLUE}http://localhost:3000${GREEN}          ║${NC}"
        echo -e "${GREEN}║  API:     ${BLUE}http://localhost:8080${GREEN}          ║${NC}"
        echo -e "${GREEN}║  ML:      ${BLUE}http://localhost:8001${GREEN}          ║${NC}"
        echo -e "${GREEN}║  Health:  ${BLUE}http://localhost:8080/health${GREEN}   ║${NC}"
        echo -e "${GREEN}║                                          ║${NC}"
        echo -e "${GREEN}║  Logs:    /tmp/routeai-logs/             ║${NC}"
        echo -e "${GREEN}║  Stop:    ./start.sh stop                ║${NC}"
        echo -e "${GREEN}║                                          ║${NC}"
        echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
        ;;

    stop)
        stop_all
        ;;

    status)
        show_status
        ;;

    *)
        echo "Usage: $0 {dev|start|stop|status}"
        exit 1
        ;;
esac
