"""RouteAI API routers -- modular FastAPI endpoints for the web server.

Provides ``create_app()`` which assembles a fully configured FastAPI
application with all routers, CORS middleware, and logging.
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# Router imports
# ---------------------------------------------------------------------------
from routeai_cli.api.ai import router as ai_router
from routeai_cli.api.analysis import router as analysis_router
from routeai_cli.api.auth_dev import router as auth_dev_router
from routeai_cli.api.components import router as components_router
from routeai_cli.api.health import router as health_router
from routeai_cli.api.ollama_api import router as ollama_router
from routeai_cli.api.ui import router as ui_router
from routeai_cli.api.upload import router as upload_router
from routeai_cli.api.workflow import router as workflow_router

__all__ = [
    "create_app",
    "ai_router",
    "analysis_router",
    "auth_dev_router",
    "components_router",
    "health_router",
    "ollama_router",
    "ui_router",
    "upload_router",
    "workflow_router",
]

logger = logging.getLogger("routeai.server")


def create_app() -> FastAPI:
    """Build and return the fully configured RouteAI FastAPI application.

    This is the single entry-point used by ``server.py`` (and test fixtures).
    It wires up:
      - Logging
      - CORS middleware (permissive for local dev)
      - Global exception handler
      - All API routers
      - React static-asset serving (when built)
    """

    # -- Logging -------------------------------------------------------------
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # -- App -----------------------------------------------------------------
    app = FastAPI(
        title="RouteAI",
        version="0.2.0",
        description="AI-Powered PCB Co-Engineer",
    )

    # -- CORS ----------------------------------------------------------------
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],          # permissive for dev; tighten in prod
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # -- Global exception handler --------------------------------------------
    @app.exception_handler(Exception)
    async def global_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        logger.error(
            "Unhandled error on %s %s: %s",
            request.method,
            request.url.path,
            exc,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": f"Internal server error: {exc}"},
        )

    # -- Mount routers -------------------------------------------------------
    # Order matters: auth first so /api/v1/auth/* is registered before
    # other /api/* catch-alls.
    app.include_router(health_router)       # /health, /api/info
    app.include_router(auth_dev_router)     # /api/v1/auth/*
    app.include_router(components_router)   # /api/components/*
    app.include_router(ollama_router)       # /api/ollama/*
    app.include_router(upload_router)       # /api/upload, etc.
    app.include_router(analysis_router)     # /api/analysis, etc.
    app.include_router(ai_router)           # /api/ai, etc.
    app.include_router(workflow_router)     # /api/workflow/*
    app.include_router(ui_router)           # / (HTML UI)

    # -- React static assets -------------------------------------------------
    # __file__ = .../packages/cli/src/routeai_cli/api/__init__.py
    # parents: [0]=api, [1]=routeai_cli, [2]=src, [3]=cli, [4]=packages, [5]=repo_root
    react_dist = Path(__file__).resolve().parents[5] / "app" / "dist"
    if react_dist.exists() and (react_dist / "assets").exists():
        app.mount(
            "/assets",
            StaticFiles(directory=str(react_dist / "assets")),
            name="react-assets",
        )

    logger.info("RouteAI application created -- %d routers mounted", 9)
    return app
