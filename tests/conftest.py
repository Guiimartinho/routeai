"""Root conftest for integration tests.

Adds package src directories to sys.path so tests can import
routeai_core, routeai_intelligence, and routeai_solver without
a full Poetry install.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent

for pkg in ("core", "intelligence", "solver"):
    src = _ROOT / "packages" / pkg / "src"
    if src.is_dir() and str(src) not in sys.path:
        sys.path.insert(0, str(src))
