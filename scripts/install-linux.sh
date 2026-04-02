#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# RouteAI EDA — One-Line Linux Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/Guiimartinho/routeai/main/scripts/install-linux.sh | bash
# ═══════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

REPO="Guiimartinho/routeai"

echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║    RouteAI EDA — Linux Installer         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ─── Step 1: Detect distro ───────────────────────────────────
echo -e "${YELLOW}[1/5] Detecting system...${NC}"
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
    echo -e "${RED}Unsupported architecture: $ARCH (need x86_64)${NC}"
    exit 1
fi

IS_DEB=false
if command -v dpkg >/dev/null 2>&1; then
    IS_DEB=true
    echo "  Distro: Debian/Ubuntu (will use .deb)"
else
    echo "  Distro: Other (will use AppImage)"
fi

# ─── Step 2: Download RouteAI ────────────────────────────────
echo ""
echo -e "${YELLOW}[2/5] Downloading RouteAI EDA...${NC}"

# Get latest release URL
RELEASE_URL="https://api.github.com/repos/$REPO/releases/latest"
RELEASE_DATA=$(curl -s "$RELEASE_URL" 2>/dev/null)

if echo "$RELEASE_DATA" | grep -q "Not Found"; then
    echo -e "${YELLOW}  No release found yet. Installing from source instead...${NC}"
    echo ""

    # Fallback: install from source
    if ! command -v git >/dev/null 2>&1; then
        echo -e "${RED}  git not found. Install git first: sudo apt install git${NC}"
        exit 1
    fi

    INSTALL_DIR="$HOME/routeai"
    if [ -d "$INSTALL_DIR" ]; then
        echo "  Updating existing installation..."
        cd "$INSTALL_DIR" && git pull
    else
        echo "  Cloning repository..."
        git clone "https://github.com/$REPO.git" "$INSTALL_DIR"
    fi
    cd "$INSTALL_DIR"

    echo -e "  ${GREEN}Downloaded to $INSTALL_DIR${NC}"

    # Run dev setup
    echo ""
    echo -e "${YELLOW}[3/5] Installing dependencies...${NC}"
    if [ -f scripts/setup-dev.sh ]; then
        bash scripts/setup-dev.sh --no-start
    else
        echo -e "${YELLOW}  setup-dev.sh not found, installing manually...${NC}"
        # Python
        if command -v python3 >/dev/null 2>&1; then
            pip install poetry 2>/dev/null || pip3 install poetry 2>/dev/null || true
            for pkg in core parsers solver intelligence; do
                cd "$INSTALL_DIR/packages/$pkg"
                python3 -m poetry install --no-interaction 2>/dev/null || true
            done
            cd "$INSTALL_DIR"
        fi
        # Node
        if command -v npm >/dev/null 2>&1; then
            cd "$INSTALL_DIR/app" && npm install 2>/dev/null && cd "$INSTALL_DIR"
        fi
    fi

    SKIP_TO_OLLAMA=true
else
    SKIP_TO_OLLAMA=false

    if [ "$IS_DEB" = true ]; then
        DEB_URL=$(echo "$RELEASE_DATA" | grep -o '"browser_download_url": "[^"]*\.deb"' | head -1 | cut -d'"' -f4)
        if [ -n "$DEB_URL" ]; then
            echo "  Downloading .deb package..."
            curl -L -o /tmp/routeai-eda.deb "$DEB_URL"
            echo ""
            echo -e "${YELLOW}[3/5] Installing package...${NC}"
            sudo dpkg -i /tmp/routeai-eda.deb || sudo apt-get install -f -y
            rm -f /tmp/routeai-eda.deb
            echo -e "  ${GREEN}RouteAI EDA installed${NC}"
        fi
    else
        APPIMAGE_URL=$(echo "$RELEASE_DATA" | grep -o '"browser_download_url": "[^"]*\.AppImage"' | head -1 | cut -d'"' -f4)
        if [ -n "$APPIMAGE_URL" ]; then
            echo "  Downloading AppImage..."
            APPIMAGE_PATH="$HOME/Applications/RouteAI-EDA.AppImage"
            mkdir -p "$HOME/Applications"
            curl -L -o "$APPIMAGE_PATH" "$APPIMAGE_URL"
            chmod +x "$APPIMAGE_PATH"
            echo -e "  ${GREEN}RouteAI EDA installed at $APPIMAGE_PATH${NC}"
        fi
    fi
fi

# ─── Step 3: Install Ollama ──────────────────────────────────
echo ""
echo -e "${YELLOW}[4/5] Setting up Ollama (AI engine)...${NC}"

if command -v ollama >/dev/null 2>&1; then
    echo -e "  ${GREEN}Ollama already installed${NC}"
else
    echo "  Installing Ollama..."
    curl -fsSL https://ollama.ai/install.sh | sh
    echo -e "  ${GREEN}Ollama installed${NC}"
fi

# Start Ollama if not running
if ! curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
    echo "  Starting Ollama..."
    nohup ollama serve >/dev/null 2>&1 &
    sleep 3
fi

# ─── Step 4: Pull AI model ───────────────────────────────────
echo ""
echo -e "${YELLOW}[5/5] Pulling AI model (qwen2.5:7b, ~5GB)...${NC}"

if ollama list 2>/dev/null | grep -q "qwen2.5:7b"; then
    echo -e "  ${GREEN}Model already downloaded${NC}"
else
    echo "  This may take a few minutes on first run..."
    ollama pull qwen2.5:7b
    echo -e "  ${GREEN}Model ready${NC}"
fi

# ─── Done ─────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║    RouteAI EDA — Installation Complete!  ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════╣${NC}"
if [ "$SKIP_TO_OLLAMA" = true ]; then
    echo -e "${GREEN}║                                          ║${NC}"
    echo -e "${GREEN}║  Start:  cd ~/routeai && ./start.sh      ║${NC}"
    echo -e "${GREEN}║  Open:   ${BLUE}http://localhost:3000${GREEN}          ║${NC}"
else
    echo -e "${GREEN}║                                          ║${NC}"
    echo -e "${GREEN}║  Launch: routeai-eda (or Desktop icon)   ║${NC}"
fi
echo -e "${GREEN}║                                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
