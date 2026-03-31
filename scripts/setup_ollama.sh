#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# RouteAI — Ollama Setup Script
# Detects GPU, pulls recommended models, and verifies inference.
# ═══════════════════════════════════════════════════════════════

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     RouteAI — Ollama Model Setup         ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# Check Ollama installed
if ! command -v ollama &> /dev/null; then
    echo -e "${RED}Ollama not installed.${NC}"
    echo -e "Install: ${BLUE}curl -fsSL https://ollama.ai/install.sh | sh${NC}"
    exit 1
fi

# Check Ollama running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo -e "${YELLOW}Starting Ollama...${NC}"
    ollama serve &
    sleep 3
fi

# Detect GPU
VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1)
GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)

if [ -z "$VRAM" ]; then
    echo -e "${YELLOW}No NVIDIA GPU detected. Using CPU defaults.${NC}"
    VRAM_GB=0
else
    VRAM_GB=$((VRAM / 1024))
    echo -e "${GREEN}GPU: $GPU_NAME (${VRAM_GB}GB VRAM)${NC}"
fi
echo ""

# Pull models based on VRAM
if [ "$VRAM_GB" -ge 24 ]; then
    echo -e "${BLUE}24GB+ GPU — Pulling T3 + T1/T2 models...${NC}"
    echo -e "  Pulling qwen2.5:7b (T3 — fast validation)..."
    ollama pull qwen2.5:7b
    echo -e "  Pulling qwen2.5:32b (T1/T2 — heavy reasoning + structured)..."
    ollama pull qwen2.5:32b
elif [ "$VRAM_GB" -ge 10 ]; then
    echo -e "${BLUE}10-16GB GPU — Pulling T3 + T2 models...${NC}"
    echo -e "  Pulling qwen2.5:7b (T3 — fast validation, chat)..."
    ollama pull qwen2.5:7b
    echo -e "  Pulling qwen2.5-coder:14b (T2 — structured output, DSL)..."
    ollama pull qwen2.5-coder:14b
elif [ "$VRAM_GB" -ge 8 ]; then
    echo -e "${BLUE}8GB GPU — Pulling minimal models...${NC}"
    echo -e "  Pulling phi3.5:3.8b (T3 — fast validation)..."
    ollama pull phi3.5:3.8b
    echo -e "  Pulling qwen2.5:7b (T2 — structured output)..."
    ollama pull qwen2.5:7b
elif [ "$VRAM_GB" -ge 6 ]; then
    echo -e "${BLUE}6GB GPU — Pulling minimal models...${NC}"
    echo -e "  Pulling phi3.5:3.8b (T3 — fast)..."
    ollama pull phi3.5:3.8b
    echo -e "  Pulling qwen2.5:7b (T2 — swap on demand)..."
    ollama pull qwen2.5:7b
else
    echo -e "${YELLOW}No GPU or <6GB — Pulling CPU-only model...${NC}"
    echo -e "  Pulling phi3.5:3.8b..."
    ollama pull phi3.5:3.8b
fi

echo ""

# Set recommended Ollama env vars
echo -e "${BLUE}Recommended environment variables:${NC}"
if [ "$VRAM_GB" -le 16 ]; then
    echo "  export OLLAMA_MAX_LOADED_MODELS=1"
else
    echo "  export OLLAMA_MAX_LOADED_MODELS=2"
fi
echo "  export OLLAMA_FLASH_ATTENTION=1"
echo "  export OLLAMA_KEEP_ALIVE=10m"
if [ "$VRAM_GB" -le 8 ]; then
    echo "  export OLLAMA_NUM_PARALLEL=1"
else
    echo "  export OLLAMA_NUM_PARALLEL=2"
fi
echo ""

# Quick inference test
echo -e "${BLUE}Testing inference...${NC}"
TEST_MODEL="qwen2.5:7b"
if [ "$VRAM_GB" -lt 10 ]; then
    TEST_MODEL="phi3.5:3.8b"
fi

RESULT=$(ollama run "$TEST_MODEL" "Respond ONLY with: OK" 2>/dev/null | head -1)
if echo "$RESULT" | grep -qi "ok"; then
    echo -e "  ${GREEN}Inference test passed${NC} ($TEST_MODEL)"
else
    echo -e "  ${YELLOW}Inference test returned: $RESULT${NC}"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Setup complete!                      ║${NC}"
echo -e "${GREEN}║     Run: ./start.sh                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
