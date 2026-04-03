#!/bin/bash
# RouteAI EDA — Build Desktop Installer
# Usage:
#   ./scripts/build-installer.sh windows    # Build Windows .exe installer
#   ./scripts/build-installer.sh linux      # Build Linux AppImage + .deb
#   ./scripts/build-installer.sh all        # Build all platforms

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
APP_DIR="$ROOT_DIR/app"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  RouteAI EDA — Building Installer        ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

TARGET="${1:-all}"

# Validate target argument
case "$TARGET" in
    windows|win|linux|all) ;;
    *)
        echo -e "${RED}Usage: $0 {windows|linux|all}${NC}"
        exit 1
        ;;
esac

# ---------------------------------------------------------------------------
# Step 1: Check prerequisites
# ---------------------------------------------------------------------------
echo -e "${YELLOW}[1/5] Checking prerequisites...${NC}"
command -v node >/dev/null 2>&1 || { echo -e "${RED}Node.js not found. Install Node 18+${NC}"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo -e "${RED}npm not found${NC}"; exit 1; }

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
    echo -e "${RED}Node.js 18+ required (found v${NODE_VER})${NC}"
    exit 1
fi

echo "  Node.js: $(node -v)"
echo "  npm:     $(npm -v)"

if command -v go >/dev/null 2>&1; then
    echo "  Go:      $(go version | awk '{print $3}')"
else
    echo -e "  Go:      ${YELLOW}not found (API binary will be skipped)${NC}"
fi
echo ""

# ---------------------------------------------------------------------------
# Step 2: Install dependencies
# ---------------------------------------------------------------------------
echo -e "${YELLOW}[2/5] Installing dependencies...${NC}"
cd "$APP_DIR"
npm install
echo -e "  ${GREEN}Dependencies installed${NC}"
echo ""

# ---------------------------------------------------------------------------
# Step 3: Build Vite (React frontend)
# ---------------------------------------------------------------------------
echo -e "${YELLOW}[3/5] Building React frontend...${NC}"
cd "$APP_DIR"
npx vite build
echo -e "  ${GREEN}Frontend built -> app/dist/${NC}"
echo ""

# ---------------------------------------------------------------------------
# Step 4: Build Go API binary (optional)
# ---------------------------------------------------------------------------
echo -e "${YELLOW}[4/5] Building Go API...${NC}"
mkdir -p "$APP_DIR/resources"

if command -v go >/dev/null 2>&1; then
    API_SRC="$ROOT_DIR/packages/api"
    if [ -d "$API_SRC" ]; then
        cd "$API_SRC"
        case "$TARGET" in
            windows|win)
                GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o "$APP_DIR/resources/routeai-api.exe" .
                echo -e "  ${GREEN}Go API built (Windows x64)${NC}"
                ;;
            linux)
                GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o "$APP_DIR/resources/routeai-api" .
                echo -e "  ${GREEN}Go API built (Linux x64)${NC}"
                ;;
            all)
                GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o "$APP_DIR/resources/routeai-api.exe" .
                GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o "$APP_DIR/resources/routeai-api-linux" .
                echo -e "  ${GREEN}Go API built (Windows + Linux)${NC}"
                ;;
        esac
        cd "$APP_DIR"
    else
        echo -e "  ${YELLOW}packages/api/ not found — skipping Go API build${NC}"
    fi
else
    echo -e "  ${YELLOW}Go not found — skipping API binary (will need separate install)${NC}"
fi
echo ""

# ---------------------------------------------------------------------------
# Step 5: Build Electron installer
# ---------------------------------------------------------------------------
echo -e "${YELLOW}[5/5] Building Electron installer...${NC}"
cd "$APP_DIR"

case "$TARGET" in
    windows|win)
        npx electron-builder --win --config electron/build-config.cjs
        echo ""
        echo -e "${GREEN}Windows installer built:${NC}"
        ls -lh release/*.exe 2>/dev/null || echo "  Check app/release/ directory"
        ;;
    linux)
        npx electron-builder --linux --config electron/build-config.cjs
        echo ""
        echo -e "${GREEN}Linux packages built:${NC}"
        ls -lh release/*.AppImage release/*.deb 2>/dev/null || echo "  Check app/release/ directory"
        ;;
    all)
        npx electron-builder --win --linux --config electron/build-config.cjs
        echo ""
        echo -e "${GREEN}All installers built:${NC}"
        ls -lh release/*.exe release/*.AppImage release/*.deb 2>/dev/null || echo "  Check app/release/ directory"
        ;;
esac

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Build complete!                         ║${NC}"
echo -e "${GREEN}║  Output: app/release/                    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
