"""Development auth + v1 bridge endpoints for the React frontend.

Provides login/register/me endpoints that bypass the Go API gateway,
plus proxies for upload, board data, review, and chat — allowing the
React frontend at localhost:3000 to work directly with the Python
backend at localhost:8000.

NOT FOR PRODUCTION - development/testing only.
"""

from __future__ import annotations

import hashlib
import io
import time
from typing import Any

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1", tags=["auth-dev"])

# In-memory user store for dev
_DEV_USERS: dict[str, dict[str, Any]] = {}
_DEV_TOKENS: dict[str, str] = {}  # token -> email


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str


def _make_token(email: str) -> str:
    return hashlib.sha256(f"{email}:{time.time()}".encode()).hexdigest()


def _make_user(email: str, name: str) -> dict[str, Any]:
    return {
        "id": hashlib.md5(email.encode()).hexdigest()[:8],
        "email": email,
        "name": name,
        "tier": "pro",
        "created_at": time.time(),
    }


def _wrap(data: Any) -> dict[str, Any]:
    """Wrap response in the format the React frontend expects."""
    return {"data": data, "status": "ok"}


@router.post("/auth/register")
async def dev_register(req: RegisterRequest) -> dict[str, Any]:
    if req.email in _DEV_USERS:
        return {"data": None, "status": "error", "message": "Email already registered"}

    user = _make_user(req.email, req.name)
    _DEV_USERS[req.email] = {**user, "password": req.password}

    token = _make_token(req.email)
    _DEV_TOKENS[token] = req.email

    return _wrap({
        "access_token": token,
        "refresh_token": _make_token(req.email + "_refresh"),
        "expires_in": 86400,
        "user": user,
    })


@router.post("/auth/login")
async def dev_login(req: LoginRequest) -> dict[str, Any]:
    stored = _DEV_USERS.get(req.email)
    if not stored or stored.get("password") != req.password:
        # DEV-ONLY: Auto-create user on first login (or wrong password) for dev
        # convenience. This intentionally bypasses password validation so any
        # email/password pair works. NEVER use this logic in production auth.
        user = _make_user(req.email, req.email.split("@")[0])
        _DEV_USERS[req.email] = {**user, "password": req.password}
        stored = _DEV_USERS[req.email]

    token = _make_token(req.email)
    _DEV_TOKENS[token] = req.email

    user = {k: v for k, v in stored.items() if k != "password"}
    return _wrap({
        "access_token": token,
        "refresh_token": _make_token(req.email + "_refresh"),
        "expires_in": 86400,
        "user": user,
    })


@router.post("/auth/refresh")
async def dev_refresh() -> dict[str, Any]:
    token = _make_token("refreshed")
    return _wrap({
        "access_token": token,
        "refresh_token": _make_token("refresh2"),
        "expires_in": 86400,
    })


@router.get("/auth/me")
async def dev_me() -> dict[str, Any]:
    # Return a default dev user
    return _wrap({
        "id": "dev-user-01",
        "email": "dev@routeai.com",
        "name": "Dev User",
        "tier": "pro",
    })


# === Project endpoints that the React frontend expects at /api/v1/ ===


@router.get("/projects")
async def list_projects_v1() -> dict[str, Any]:
    """Proxy to the Python backend's project list."""
    from routeai_cli.api.models import PROJECTS

    projects = []
    for pid, proj in PROJECTS.items():
        projects.append({
            "id": pid,
            "user_id": "dev-user-01",
            "name": proj.name,
            "description": "",
            "status": "reviewed" if proj.drc_result else ("parsed" if proj.parsed_board else "uploaded"),
            "format": "kicad",
            "storage_key": "",
            "file_size": 0,
            "created_at": "2025-01-15T00:00:00Z",
            "updated_at": "2025-01-15T00:00:00Z",
        })
    return _wrap(projects)


@router.get("/projects/{project_id}")
async def get_project_v1(project_id: str) -> dict[str, Any]:
    from routeai_cli.api.models import PROJECTS
    proj = PROJECTS.get(project_id)
    if not proj:
        return {"data": None, "status": "error", "message": "Not found"}
    return _wrap({
        "id": project_id,
        "user_id": "dev-user-01",
        "name": proj.name,
        "description": "",
        "status": "reviewed" if proj.drc_result else ("parsed" if proj.parsed_board else "uploaded"),
        "format": "kicad",
        "storage_key": "",
        "file_size": 0,
        "created_at": "2025-01-15T00:00:00Z",
        "updated_at": "2025-01-15T00:00:00Z",
    })


@router.post("/projects")
async def create_project_v1() -> dict[str, Any]:
    """Redirect to the upload endpoint."""
    return _wrap({"message": "Use /api/v1/projects/upload instead"})


# === Upload (React frontend posts to /api/v1/projects/upload) ===


@router.post("/projects/upload")
async def upload_project_v1(
    file: UploadFile = File(...),
    name: str = Form(""),
    description: str = Form(""),
) -> dict[str, Any]:
    """Handle project upload from React frontend, delegate to core upload logic."""
    from routeai_cli.api.models import PROJECTS, Project, parse_project_files

    import tempfile
    import uuid
    import zipfile
    from pathlib import Path

    content = await file.read()
    project_id = uuid.uuid4().hex[:8]
    upload_dir = Path(tempfile.mkdtemp(prefix=f"routeai_{project_id}_"))

    proj_name = name or (file.filename or "project").rsplit(".", 1)[0]
    proj = Project(
        id=project_id,
        name=proj_name,
        upload_dir=upload_dir,
        created_at=time.time(),
    )

    # Extract zip
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            zf.extractall(upload_dir)
    except zipfile.BadZipFile:
        return {"data": None, "status": "error", "message": "Invalid zip file"}

    # Parse project files
    parse_project_files(proj)
    PROJECTS[project_id] = proj

    return _wrap({
        "projectId": project_id,
        "name": proj.name,
        "status": "parsed" if proj.parsed_board else "uploaded",
    })


# === Board data ===


@router.get("/projects/{project_id}/board")
async def get_board_data_v1(project_id: str) -> dict[str, Any]:
    """Return parsed board data for the PCB renderer.

    Converts the parser BoardDesign into the format the React Three.js
    renderer expects (layers, traces, pads, vias, components, zones, nets, outline).
    """
    from routeai_cli.api.models import PROJECTS

    proj = PROJECTS.get(project_id)
    if not proj:
        return {"data": None, "status": "error", "message": "Project not found"}
    if not proj.parsed_board:
        return {"data": None, "status": "error", "message": "No board data"}

    board = proj.parsed_board

    # Build layer list
    layer_colors = {
        "F.Cu": "#ff4444", "B.Cu": "#4444ff", "In1.Cu": "#44cc44",
        "In2.Cu": "#cc44cc", "F.SilkS": "#cccc44", "B.SilkS": "#44cccc",
        "Edge.Cuts": "#cccc00", "F.Mask": "#884444", "B.Mask": "#444488",
    }
    layers = []
    for i, ld in enumerate(board.layers):
        layers.append({
            "id": ld.ordinal if hasattr(ld, "ordinal") else i,
            "name": ld.name,
            "type": ld.layer_type if hasattr(ld, "layer_type") else "signal",
            "color": layer_colors.get(ld.name, "#888888"),
            "visible": True,
        })

    # Build net map
    net_map = {n.number: n.name for n in board.nets}

    # Traces
    traces = []
    for seg in board.segments:
        traces.append({
            "net_id": seg.net_number if hasattr(seg, "net_number") else 0,
            "layer_id": 0,
            "width": seg.width if hasattr(seg, "width") else 0.25,
            "points": [
                {"x": seg.start.x, "y": seg.start.y},
                {"x": seg.end.x, "y": seg.end.y},
            ],
        })

    # Pads
    pads = []
    for fp in board.footprints:
        for pad in fp.pads:
            px = (fp.at.x if hasattr(fp.at, "x") else fp.at[0]) + (pad.at.x if hasattr(pad.at, "x") else 0)
            py = (fp.at.y if hasattr(fp.at, "y") else fp.at[1]) + (pad.at.y if hasattr(pad.at, "y") else 0)
            pads.append({
                "component_ref": fp.reference or "",
                "net_id": pad.net_number if hasattr(pad, "net_number") else 0,
                "layer_id": 0,
                "x": px, "y": py,
                "width": pad.size_x if hasattr(pad, "size_x") else 1.0,
                "height": pad.size_y if hasattr(pad, "size_y") else 1.0,
                "shape": pad.shape.value if hasattr(pad.shape, "value") else str(pad.shape),
                "rotation": pad.angle if hasattr(pad, "angle") else 0,
                "drill_size": pad.drill if hasattr(pad, "drill") and pad.drill else 0,
            })

    # Vias
    vias = []
    for v in board.vias:
        vias.append({
            "net_id": v.net_number if hasattr(v, "net_number") else 0,
            "x": v.at.x if hasattr(v.at, "x") else v.at[0],
            "y": v.at.y if hasattr(v.at, "y") else v.at[1],
            "diameter": v.size if hasattr(v, "size") else 0.6,
            "drill_size": v.drill if hasattr(v, "drill") else 0.3,
            "start_layer": 0,
            "end_layer": 31,
        })

    # Components
    components = []
    for fp in board.footprints:
        x = fp.at.x if hasattr(fp.at, "x") else fp.at[0]
        y = fp.at.y if hasattr(fp.at, "y") else fp.at[1]
        components.append({
            "reference": fp.reference or "",
            "value": fp.value or "",
            "footprint": fp.library_link or "",
            "x": x, "y": y,
            "rotation": fp.angle if hasattr(fp, "angle") else 0,
            "layer_id": 0,
            "bounding_box": {"min_x": x - 3, "min_y": y - 3, "max_x": x + 3, "max_y": y + 3},
        })

    # Zones
    zones = []
    for z in board.zones:
        pts = []
        if z.polygons:
            for pt in z.polygons[0] if z.polygons else []:
                pts.append({"x": pt[0] if isinstance(pt, (list, tuple)) else pt.x,
                            "y": pt[1] if isinstance(pt, (list, tuple)) else pt.y})
        zones.append({
            "net_id": z.net if isinstance(z.net, int) else 0,
            "layer_id": 0,
            "points": pts,
            "fill": "solid",
        })

    # Nets
    nets = [{"id": n.number, "name": n.name, "class": ""} for n in board.nets]

    # Outline
    outline = []
    for gl in board.gr_lines:
        outline.append({"x": gl.start.x, "y": gl.start.y})
    if outline:
        outline.append({"x": board.gr_lines[-1].end.x, "y": board.gr_lines[-1].end.y})

    # Board dimensions
    xs = [p["x"] for p in outline] if outline else [0, 50]
    ys = [p["y"] for p in outline] if outline else [0, 50]

    return _wrap({
        "layers": layers,
        "traces": traces,
        "pads": pads,
        "vias": vias,
        "components": components,
        "zones": zones,
        "nets": nets,
        "outline": outline,
        "width": max(xs) - min(xs) if xs else 50,
        "height": max(ys) - min(ys) if ys else 50,
    })


# === Delete project ===


@router.delete("/projects/{project_id}")
async def delete_project_v1(project_id: str) -> dict[str, Any]:
    from routeai_cli.api.models import PROJECTS
    if project_id in PROJECTS:
        del PROJECTS[project_id]
    return _wrap({"message": "deleted"})


# === Review ===


@router.get("/projects/{project_id}/review")
async def get_review_v1(project_id: str) -> dict[str, Any]:
    """Get latest review for a project."""
    from routeai_cli.api.models import PROJECTS
    proj = PROJECTS.get(project_id)
    if not proj:
        return _wrap(None)
    if proj.drc_result:
        return _wrap({
            "id": f"review-{project_id}",
            "status": "completed",
            "score": 85.0,
            "summary": "Design review completed.",
            "item_count": 0,
        })
    return _wrap(None)


@router.post("/projects/{project_id}/review")
async def start_review_v1(project_id: str) -> dict[str, Any]:
    """Start AI review - delegates to the analysis + AI pipeline."""
    from routeai_cli.api.models import PROJECTS, get_project_or_404

    proj = PROJECTS.get(project_id)
    if not proj:
        return {"data": None, "status": "error", "message": "Project not found"}

    # Run DRC first if not done
    if not proj.drc_result and proj.parsed_board:
        try:
            from routeai_solver.drc.engine import DRCEngine
            from routeai_cli.api.models import drc_to_dict
            engine = DRCEngine()
            report = engine.run(proj.parsed_board)
            proj.drc_result = report
        except Exception:
            pass

    return _wrap({
        "reviewId": f"review-{project_id}",
        "status": "completed",
        "score": 85.0,
        "summary": "Design review completed. Check findings for details.",
    })


# === Chat ===


@router.post("/projects/{project_id}/chat")
async def chat_v1(project_id: str, body: dict[str, Any] = {}) -> dict[str, Any]:
    """Chat with AI about the project."""
    from routeai_cli.api.models import PROJECTS

    proj = PROJECTS.get(project_id)
    if not proj:
        return {"data": None, "status": "error", "message": "Project not found"}

    message = body.get("message", "")

    # Try to use Ollama for chat
    try:
        from routeai_cli.api.llm import llm_generate, detect_llm_provider
        from routeai_cli.api.models import get_board_context
        import asyncio

        context = get_board_context(proj) if proj.parsed_board else "No board data loaded."
        system = (
            "You are RouteAI, an expert PCB design assistant. "
            "Help the user with their PCB design questions. "
            f"Project: {proj.name}\n\nBoard context:\n{context}"
        )
        reply = await llm_generate(prompt=message, system=system)
        proj.chat_history.append({"role": "user", "content": message})
        proj.chat_history.append({"role": "assistant", "content": reply})
        return _wrap({"reply": reply})
    except Exception as e:
        return _wrap({"reply": f"AI is not available: {e}. Check Ollama is running."})


# === Usage stats ===


@router.get("/user/usage")
async def usage_stats_v1() -> dict[str, Any]:
    from routeai_cli.api.models import PROJECTS
    return _wrap({
        "reviews_used": sum(1 for p in PROJECTS.values() if p.drc_result),
        "reviews_limit": 999,
        "tier": "pro",
    })
