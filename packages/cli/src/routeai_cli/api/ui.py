"""Web UI endpoint -- serves the built-in HTML template and React app fallback.

The HTML template is loaded either from ``html_template.py`` (if the extraction
script has been run) or lazily extracted at first request from the original
``server.py`` that lives at the repository root.
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

# Repo root: server.py lives at /mnt/f/5.LLM_EDA/server.py
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent.parent
REACT_DIST = _REPO_ROOT / "app" / "dist"

_html_cache: str | None = None


def _get_html_template() -> str:
    """Return the full HTML template string, loading lazily on first call."""
    global _html_cache
    if _html_cache is not None:
        return _html_cache

    # Try the extracted module first
    try:
        from routeai_cli.api.html_template import HTML_TEMPLATE  # type: ignore[import-not-found]
        _html_cache = HTML_TEMPLATE
        return _html_cache
    except ImportError:
        pass

    # Fallback: extract from original server.py at runtime
    server_py = _REPO_ROOT / "server.py"
    if server_py.exists():
        content = server_py.read_text(encoding="utf-8")
        match = re.search(r'HTML_TEMPLATE\s*=\s*r"""(.*?)"""', content, re.DOTALL)
        if match:
            _html_cache = match.group(1)
            return _html_cache

    _html_cache = (
        "<html><body><h1>RouteAI</h1>"
        "<p>UI template not found. Run the server from the repo root.</p>"
        "</body></html>"
    )
    return _html_cache


def get_html_template() -> str:
    """Public accessor for the HTML template (used by server.py)."""
    return _get_html_template()


@router.get("/simple", response_class=HTMLResponse)
async def simple_ui() -> str:
    """Serve the simple built-in web UI."""
    return _get_html_template()


@router.get("/", response_class=HTMLResponse)
async def index() -> str:
    """Serve React EDA editor if built, otherwise simple UI."""
    index_html = REACT_DIST / "index.html"
    if index_html.exists():
        return index_html.read_text()
    return _get_html_template()
