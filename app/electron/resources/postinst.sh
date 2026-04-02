#!/bin/bash
# RouteAI EDA - Post-installation script for .deb package
# Updates desktop database and MIME types for file associations

set -e

# Update desktop database for .desktop file
if command -v update-desktop-database > /dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi

# Update MIME database for file associations (.kicad_pcb, .kicad_sch)
if command -v update-mime-database > /dev/null 2>&1; then
  update-mime-database /usr/share/mime 2>/dev/null || true
fi

# Notify user about Ollama if not installed
if ! command -v ollama > /dev/null 2>&1; then
  echo ""
  echo "=== RouteAI EDA ==="
  echo "Optional: Install Ollama for local AI inference."
  echo "  curl -fsSL https://ollama.ai/install.sh | sh"
  echo "==================="
  echo ""
fi
