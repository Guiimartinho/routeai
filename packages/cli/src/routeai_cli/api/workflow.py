"""Workflow API endpoints for the end-to-end design flow.

Endpoints:
  POST /api/workflow/{project_id}/ai-placement    - AI component placement
  POST /api/workflow/{project_id}/ai-review       - AI schematic + board review
  POST /api/workflow/{project_id}/ai-routing      - AI routing strategy
  GET  /api/workflow/{project_id}/cross-probe      - Cross-probe lookup
  POST /api/workflow/{project_id}/export/{format}  - Export in various formats
  GET  /api/workflow/{project_id}/status            - Get workflow status
"""

from __future__ import annotations

import io
import json
import logging
import math
import re
import tempfile
import traceback
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from routeai_cli.api.llm import ai_with_tools, detect_llm_provider
from routeai_cli.api.models import (
    PROJECTS,
    drc_to_dict,
    get_board_context,
    get_project_or_404,
)

logger = logging.getLogger("routeai.server")

router = APIRouter(prefix="/api/workflow", tags=["workflow"])


# ---------------------------------------------------------------------------
# Helper: require LLM
# ---------------------------------------------------------------------------

def _require_llm() -> None:
    """Raise HTTPException if no LLM provider is configured."""
    if not detect_llm_provider():
        raise HTTPException(400, "No LLM API key set. Configure Gemini or Anthropic key.")


def _extract_json_object(text: str) -> dict[str, Any]:
    """Try to extract a JSON object from LLM response text."""
    json_match = re.search(r"```json\s*\n(\{.*?\})\s*\n```", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    # Fallback: find first { to last }
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass
    return {}


def _extract_json_array(text: str) -> list[dict[str, Any]]:
    """Try to extract a JSON array from LLM response text."""
    json_match = re.search(r"```json\s*\n(\[.*?\])\s*\n```", text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass
    for m in re.finditer(r"\[\s*\{", text):
        start = m.start()
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "[":
                depth += 1
            elif text[i] == "]":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        pass
                    break
    return []


def _tool_summary(tool_log: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return a brief summary of tool calls."""
    return [{"tool": t["tool"], "args": t["args"]} for t in tool_log]


# ---------------------------------------------------------------------------
# Pydantic models: Placement
# ---------------------------------------------------------------------------


class PlacementRequest(BaseModel):
    """Parameters for AI-powered component placement."""
    board_width_mm: float = 50.0
    board_height_mm: float = 50.0
    layer_count: int = 4
    constraints: dict[str, Any] | None = None


class PlacementZone(BaseModel):
    """A functional zone on the board."""
    name: str
    zone_type: str  # "power", "digital", "analog", "mixed", "io", "rf"
    x: float
    y: float
    width: float
    height: float
    layer: str = "F.Cu"
    reasoning: str = ""


class ComponentPlacement(BaseModel):
    """A single component placement recommendation."""
    reference: str
    x: float
    y: float
    rotation: float = 0.0
    layer: str = "F.Cu"
    zone: str = ""
    reasoning: str = ""


class CriticalPairResult(BaseModel):
    """A critical component pairing (e.g. decoupling cap near IC)."""
    component_a: str
    component_b: str
    max_distance_mm: float
    pair_type: str  # "decoupling", "termination", "bypass", "esd"
    reasoning: str = ""


class PlacementResponse(BaseModel):
    """Full AI placement result."""
    zones: list[PlacementZone]
    components: list[ComponentPlacement]
    critical_pairs: list[CriticalPairResult]
    ground_planes: list[str]
    power_planes: list[str]
    reasoning: str
    ipc_references: list[str]


# ---------------------------------------------------------------------------
# Pydantic models: Review
# ---------------------------------------------------------------------------


class ReviewFinding(BaseModel):
    """A single finding from AI design review."""
    category: str  # signal_integrity, thermal, drc, placement, manufacturing, power_integrity, constraints
    severity: str  # critical, warning, info
    message: str
    location: str = ""
    suggestion: str = ""
    source: str = ""  # "drc", "llm", "schematic"


class ReviewResponse(BaseModel):
    """Combined AI design review result."""
    score: float  # 0-100
    status: str  # "PASS", "PASS_WITH_WARNINGS", "FAIL"
    findings: list[ReviewFinding]
    summary: str
    ai_suggestion: str | None = None


# ---------------------------------------------------------------------------
# Pydantic models: Cross-probe
# ---------------------------------------------------------------------------


class CrossProbeResponse(BaseModel):
    """Cross-probe lookup result."""
    found: bool
    schematic_location: dict[str, Any] | None = None
    board_location: dict[str, Any] | None = None
    related_elements: list[dict[str, Any]] = Field(default_factory=list)
    highlight_nets: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Pydantic models: Workflow status
# ---------------------------------------------------------------------------


class StageStatus(BaseModel):
    """Status of a single workflow stage."""
    name: str
    status: str  # "pending", "complete", "error", "in_progress"
    detail: str = ""


class WorkflowStatus(BaseModel):
    """Current workflow status for a project."""
    current_stage: str
    stages: list[StageStatus]
    has_schematic: bool
    has_board: bool
    has_review: bool
    component_count: int
    net_count: int
    drc_violations: int
    ai_suggestion: str | None = None


# ===========================================================================
# AI Placement endpoint
# ===========================================================================


@router.post("/{project_id}/ai-placement")
async def ai_placement(project_id: str, request: PlacementRequest) -> PlacementResponse:
    """AI-powered component placement.

    Flow:
    1. Get schematic/board from project
    2. Analyze circuit zones (power, digital, analog, etc.)
    3. Identify critical pairs (decoupling caps near ICs, etc.)
    4. Call LLM to generate placement strategy
    5. Return placement with reasoning
    """
    _require_llm()
    p = get_project_or_404(project_id)
    if not p.parsed_board and not p.parsed_schematic:
        raise HTTPException(400, "No board or schematic data available for placement")

    ctx = get_board_context(p)
    ctx["placement_params"] = {
        "board_width_mm": request.board_width_mm,
        "board_height_mm": request.board_height_mm,
        "layer_count": request.layer_count,
        "constraints": request.constraints or {},
    }

    system_prompt = """You are RouteAI, an expert PCB placement engineer. Analyze the schematic
and board data to produce an AI-generated component placement strategy.

Your analysis should:
1. Identify functional zones (power supply, digital core, analog, I/O, RF)
2. Identify critical component pairs (decoupling caps near ICs, termination resistors near receivers)
3. Assign components to zones based on connectivity and signal type
4. Determine ground and power plane assignments
5. Follow IPC-7351 placement guidelines

Use tools to inspect specific components and nets when needed.

Output your placement as JSON:
```json
{
  "zones": [
    {"name": "Power Supply", "zone_type": "power", "x": 5, "y": 5, "width": 15, "height": 15, "layer": "F.Cu", "reasoning": "..."}
  ],
  "components": [
    {"reference": "U1", "x": 25, "y": 25, "rotation": 0, "layer": "F.Cu", "zone": "Digital Core", "reasoning": "..."}
  ],
  "critical_pairs": [
    {"component_a": "U1", "component_b": "C1", "max_distance_mm": 2.0, "pair_type": "decoupling", "reasoning": "..."}
  ],
  "ground_planes": ["In2.Cu"],
  "power_planes": ["In1.Cu"],
  "reasoning": "Overall placement strategy explanation",
  "ipc_references": ["IPC-7351B", "IPC-2221A Section 8"]
}
```"""

    prompt = f"""Generate a component placement strategy for this PCB design.

Board parameters: {request.board_width_mm}mm x {request.board_height_mm}mm, {request.layer_count} layers

Board context:
```json
{json.dumps(ctx, indent=2, default=str)}
```

Project ID: {project_id}

Analyze connectivity, identify zones, assign components to zones, and identify critical pairs.
Use get_component_info and get_net_info to investigate key components and nets."""

    try:
        response_text, tool_log = await ai_with_tools(
            prompt, system_prompt, project_id=project_id, max_rounds=4,
        )

        result = _extract_json_object(response_text)

        # Parse zones
        zones = []
        for z in result.get("zones", []):
            zones.append(PlacementZone(
                name=z.get("name", "Unknown"),
                zone_type=z.get("zone_type", "mixed"),
                x=float(z.get("x", 0)),
                y=float(z.get("y", 0)),
                width=float(z.get("width", 10)),
                height=float(z.get("height", 10)),
                layer=z.get("layer", "F.Cu"),
                reasoning=z.get("reasoning", ""),
            ))

        # Parse component placements
        components = []
        for c in result.get("components", []):
            components.append(ComponentPlacement(
                reference=c.get("reference", "?"),
                x=float(c.get("x", 0)),
                y=float(c.get("y", 0)),
                rotation=float(c.get("rotation", 0)),
                layer=c.get("layer", "F.Cu"),
                zone=c.get("zone", ""),
                reasoning=c.get("reasoning", ""),
            ))

        # Parse critical pairs
        critical_pairs = []
        for cp in result.get("critical_pairs", []):
            critical_pairs.append(CriticalPairResult(
                component_a=cp.get("component_a", "?"),
                component_b=cp.get("component_b", "?"),
                max_distance_mm=float(cp.get("max_distance_mm", 5.0)),
                pair_type=cp.get("pair_type", "decoupling"),
                reasoning=cp.get("reasoning", ""),
            ))

        return PlacementResponse(
            zones=zones,
            components=components,
            critical_pairs=critical_pairs,
            ground_planes=result.get("ground_planes", []),
            power_planes=result.get("power_planes", []),
            reasoning=result.get("reasoning", response_text[:500]),
            ipc_references=result.get("ipc_references", []),
        )

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("AI placement error: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(500, f"AI placement failed: {exc}")


# ===========================================================================
# AI Review endpoint
# ===========================================================================


@router.post("/{project_id}/ai-review")
async def ai_review(project_id: str) -> ReviewResponse:
    """AI-powered design review combining DRC + LLM analysis.

    Flow:
    1. Run DRC checks (geometric, electrical, manufacturing)
    2. Run LLM design review (7 categories)
    3. Run schematic review (pull-ups, decoupling, ESD, etc.)
    4. Merge results with deduplication
    5. Generate overall score and suggestion
    """
    _require_llm()
    p = get_project_or_404(project_id)
    if not p.parsed_board and not p.parsed_schematic:
        raise HTTPException(400, "No board or schematic data to review")

    findings: list[ReviewFinding] = []

    # --- Step 1: Run DRC if we have a board ---
    drc_findings: list[ReviewFinding] = []
    if p.parsed_board:
        try:
            from routeai_cli.analyzer import AnalysisOptions
            from routeai_cli.analyzer import analyze_project as run_analysis

            if not p.drc_result:
                options = AnalysisOptions(
                    project_dir=p.upload_dir, use_ai=False, min_severity="info",
                )
                p.drc_result = run_analysis(options)

            if p.drc_result and p.drc_result.filtered_violations:
                for v in p.drc_result.filtered_violations:
                    sev_map = {"error": "critical", "warning": "warning", "info": "info"}
                    drc_findings.append(ReviewFinding(
                        category="drc",
                        severity=sev_map.get(v.severity.value, "warning"),
                        message=v.message,
                        location=", ".join(v.affected_items[:3]) if v.affected_items else "",
                        suggestion=f"Fix {v.rule} violation",
                        source="drc",
                    ))
        except Exception as exc:
            logger.warning("DRC step failed during review: %s", exc)
            drc_findings.append(ReviewFinding(
                category="drc",
                severity="warning",
                message=f"DRC analysis could not be completed: {exc}",
                source="drc",
            ))

    findings.extend(drc_findings)

    # --- Step 2: LLM design review ---
    ctx = get_board_context(p)

    system_prompt = """You are RouteAI, an expert PCB co-engineer performing a thorough design review.
Use tools to run DRC, calculate impedances, check nets and components.

Review these 7 categories:
1. Signal Integrity - impedance matching, termination, crosstalk, return paths
2. Power Integrity - decoupling, plane splits, current capacity
3. Thermal - power dissipation, copper area, via stitching, thermal relief
4. DRC / Clearance - spacing, annular rings, via-to-pad, edge clearance
5. Placement - decoupling proximity, grouping, thermal separation
6. Manufacturing - minimum features, soldermask bridges, acid traps
7. Constraints - diff pairs, length matching, impedance targets

For schematic (if available): check pull-ups/pull-downs, decoupling caps per IC,
ESD protection on external interfaces, bypass caps on analog inputs.

After analysis, output your findings as a JSON array:
```json
[
  {
    "category": "signal_integrity",
    "severity": "critical"|"warning"|"info",
    "message": "Clear description",
    "location": "Net/component/area",
    "suggestion": "Actionable fix"
  }
]
```

Also include an overall summary line at the end."""

    prompt = f"""Perform a comprehensive design review of this PCB design.

Board context:
```json
{json.dumps(ctx, indent=2, default=str)}
```

Project ID for tool calls: {project_id}

Start by running DRC, then investigate signal integrity, thermal, and power issues using tools.
Produce your final review as a JSON array of findings."""

    try:
        response_text, tool_log = await ai_with_tools(
            prompt, system_prompt, project_id=project_id, max_rounds=5,
        )

        llm_findings_raw = _extract_json_array(response_text)
        for f in llm_findings_raw:
            findings.append(ReviewFinding(
                category=f.get("category", "constraints"),
                severity=f.get("severity", "info"),
                message=f.get("message", ""),
                location=f.get("location", ""),
                suggestion=f.get("suggestion", ""),
                source="llm",
            ))

        p.ai_review = {
            "findings": [fd.model_dump() for fd in findings],
            "raw": response_text,
            "tool_log": tool_log,
        }

    except Exception as exc:
        logger.error("LLM review step failed: %s\n%s", exc, traceback.format_exc())
        findings.append(ReviewFinding(
            category="constraints",
            severity="warning",
            message=f"LLM review could not be completed: {exc}",
            source="llm",
        ))

    # --- Step 3: Deduplicate ---
    seen_messages: set[str] = set()
    unique_findings: list[ReviewFinding] = []
    for f in findings:
        key = f"{f.category}:{f.message[:80]}"
        if key not in seen_messages:
            seen_messages.add(key)
            unique_findings.append(f)

    # --- Step 4: Score ---
    critical_count = sum(1 for f in unique_findings if f.severity == "critical")
    warning_count = sum(1 for f in unique_findings if f.severity == "warning")
    info_count = sum(1 for f in unique_findings if f.severity == "info")

    score = max(0.0, 100.0 - critical_count * 15.0 - warning_count * 3.0 - info_count * 0.5)

    if critical_count > 0:
        status = "FAIL"
    elif warning_count > 5:
        status = "PASS_WITH_WARNINGS"
    elif warning_count > 0:
        status = "PASS_WITH_WARNINGS"
    else:
        status = "PASS"

    # --- Step 5: Suggestion ---
    if status == "FAIL":
        ai_suggestion = "Address critical issues before proceeding to routing."
    elif status == "PASS_WITH_WARNINGS":
        ai_suggestion = "Review warnings before routing. Consider running AI placement optimization."
    else:
        ai_suggestion = "Design looks good. Proceed to AI routing strategy generation."

    summary = (
        f"Review complete: {critical_count} critical, {warning_count} warnings, "
        f"{info_count} informational findings. Score: {score:.0f}/100."
    )

    return ReviewResponse(
        score=round(score, 1),
        status=status,
        findings=unique_findings,
        summary=summary,
        ai_suggestion=ai_suggestion,
    )


# ===========================================================================
# AI Routing Strategy endpoint
# ===========================================================================


@router.post("/{project_id}/ai-routing")
async def ai_routing(project_id: str) -> dict[str, Any]:
    """AI-powered routing strategy generation.

    Uses the intelligence layer's RoutingDirector when Anthropic is configured,
    otherwise falls back to the generic LLM tool loop.
    """
    _require_llm()
    p = get_project_or_404(project_id)
    if not p.parsed_board:
        raise HTTPException(400, "No board data available for routing strategy")

    ctx = get_board_context(p)
    provider = detect_llm_provider()

    # Try the dedicated RoutingDirector for Anthropic
    if provider == "anthropic":
        try:
            from routeai_intelligence.agent.routing_director import RoutingDirector

            director = RoutingDirector()
            board_state = ctx.get("board_summary", {})
            board_state["nets"] = ctx.get("nets", [])
            board_state["components"] = ctx.get("components", [])
            board_state["trace_widths_mm"] = ctx.get("trace_widths_mm", {})

            schematic_info = ctx.get("schematic_summary", {})
            constraints = ctx.get("drc", {})

            strategy = await director.generate_strategy(
                board_state=board_state,
                schematic_info=schematic_info,
                constraints=constraints,
            )

            return {
                "status": "complete",
                "strategy": strategy.model_dump(),
                "validation_passed": strategy.validation_passed,
                "validation_errors": strategy.validation_errors,
                "provider": "anthropic",
                "engine": "routing_director",
            }
        except Exception as exc:
            logger.warning("RoutingDirector failed, falling back to generic LLM: %s", exc)

    # Fallback: generic LLM tool loop
    system_prompt = """You are RouteAI, an expert PCB routing engineer. Analyze the netlist and
produce a structured routing strategy. Use tools to get net details when needed.

Output your strategy as JSON:
```json
{
  "routing_order": [
    {"priority": 1, "nets": ["net1", "net2"], "reason": "why these first"}
  ],
  "layer_assignments": {
    "power": {"layers": ["In1.Cu"], "reason": "..."},
    "high_speed": {"layers": ["F.Cu", "In2.Cu"], "reason": "..."},
    "general": {"layers": ["F.Cu", "B.Cu"], "reason": "..."}
  },
  "cost_weights": {
    "via_cost": 10,
    "layer_change_cost": 5,
    "length_cost": 1,
    "congestion_cost": 3
  },
  "net_classes": [
    {"name": "Power", "nets": [], "min_width_mm": 0.5, "clearance_mm": 0.3},
    {"name": "HighSpeed", "nets": [], "min_width_mm": 0.15, "clearance_mm": 0.2}
  ],
  "critical_notes": ["note1", "note2"]
}
```"""

    prompt = f"""Analyze this PCB netlist and generate a routing strategy.

Board context:
```json
{json.dumps(ctx, indent=2, default=str)}
```

Project ID: {project_id}

Classify nets (power, high-speed, clock, analog, general), determine routing order,
assign layers, and set cost weights. Use get_net_info to investigate key nets."""

    try:
        response_text, tool_log = await ai_with_tools(
            prompt, system_prompt, project_id=project_id, max_rounds=4,
        )

        strategy = _extract_json_object(response_text)

        return {
            "status": "complete",
            "strategy": strategy,
            "tool_calls": _tool_summary(tool_log),
            "raw_text": response_text[:5000],
            "provider": provider,
            "engine": "llm_tool_loop",
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Routing strategy error: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(500, f"Routing strategy failed: {exc}")


# ===========================================================================
# Cross-probe endpoint
# ===========================================================================


@router.get("/{project_id}/cross-probe")
async def cross_probe(
    project_id: str,
    source: str = Query(..., description="'schematic' or 'board'"),
    element_type: str = Query(..., description="'component', 'net', or 'pin'"),
    element_id: str = Query(..., description="Reference designator or net name"),
) -> CrossProbeResponse:
    """Cross-probe between schematic and board views.

    Looks up the given element in both board and schematic data and returns
    its locations plus connected elements for highlighting.
    """
    p = get_project_or_404(project_id)

    board = p.parsed_board
    schematic = p.parsed_schematic

    if not board and not schematic:
        raise HTTPException(400, "No board or schematic data available")

    schematic_location: dict[str, Any] | None = None
    board_location: dict[str, Any] | None = None
    related_elements: list[dict[str, Any]] = []
    highlight_nets: list[str] = []
    found = False

    # Build net name map from board
    net_names: dict[int, str] = {}
    if board:
        net_names = {n.number: n.name for n in board.nets}

    if element_type == "component":
        # Look up component in board
        if board:
            for fp in board.footprints:
                if fp.reference == element_id:
                    found = True
                    board_location = {
                        "x": fp.at.x,
                        "y": fp.at.y,
                        "layer": fp.layer,
                        "rotation": fp.angle,
                    }
                    # Collect connected nets
                    for pad in fp.pads:
                        net_name = net_names.get(pad.net_number, "")
                        if net_name and net_name not in highlight_nets:
                            highlight_nets.append(net_name)
                        related_elements.append({
                            "type": "pad",
                            "id": f"{fp.reference}.{pad.number}",
                            "net": net_name,
                        })
                    break

        # Look up in schematic
        if schematic:
            for sym in schematic.symbols:
                ref_prop = ""
                for prop in sym.properties:
                    if prop.key == "Reference":
                        ref_prop = prop.value
                        break
                if ref_prop == element_id:
                    found = True
                    schematic_location = {
                        "x": sym.at.x,
                        "y": sym.at.y,
                        "sheet": 1,
                    }
                    break

    elif element_type == "net":
        if board:
            net_num = None
            for n in board.nets:
                if n.name == element_id:
                    net_num = n.number
                    found = True
                    highlight_nets.append(element_id)
                    break

            if net_num is not None:
                # Find connected components
                for fp in board.footprints:
                    for pad in fp.pads:
                        if pad.net_number == net_num:
                            related_elements.append({
                                "type": "pad",
                                "id": f"{fp.reference}.{pad.number}",
                                "component": fp.reference,
                            })
                            if not board_location:
                                board_location = {
                                    "x": fp.at.x + pad.at.x,
                                    "y": fp.at.y + pad.at.y,
                                    "layer": fp.layer,
                                }

        if schematic:
            for net in schematic.nets:
                if net.name == element_id:
                    found = True
                    break

    elif element_type == "pin":
        # element_id is "REF.PIN" format
        parts = element_id.rsplit(".", 1)
        if len(parts) == 2:
            ref, pin_num = parts
            if board:
                for fp in board.footprints:
                    if fp.reference == ref:
                        for pad in fp.pads:
                            if pad.number == pin_num:
                                found = True
                                fp_angle_rad = math.radians(fp.angle)
                                if fp.angle != 0.0:
                                    cos_a = math.cos(fp_angle_rad)
                                    sin_a = math.sin(fp_angle_rad)
                                    abs_x = fp.at.x + pad.at.x * cos_a - pad.at.y * sin_a
                                    abs_y = fp.at.y + pad.at.x * sin_a + pad.at.y * cos_a
                                else:
                                    abs_x = fp.at.x + pad.at.x
                                    abs_y = fp.at.y + pad.at.y

                                board_location = {
                                    "x": abs_x,
                                    "y": abs_y,
                                    "layer": pad.layers[0] if pad.layers else fp.layer,
                                }
                                net_name = net_names.get(pad.net_number, "")
                                if net_name:
                                    highlight_nets.append(net_name)
                                break
                        break

    return CrossProbeResponse(
        found=found,
        schematic_location=schematic_location,
        board_location=board_location,
        related_elements=related_elements[:50],
        highlight_nets=highlight_nets,
    )


# ===========================================================================
# Export endpoint
# ===========================================================================


@router.post("/{project_id}/export/{format}")
async def export_project(project_id: str, format: str) -> Response:
    """Export project in various formats.

    Supported formats:
    - kicad: .kicad_pcb + .kicad_sch in zip
    - eagle: .brd + .sch in zip
    - gerber: RS-274X Gerber files in zip
    - odb: ODB++ archive (.tgz)
    - bom: Bill of Materials CSV
    - pnp: Pick and Place CSV
    - ipc2581: IPC-2581 XML
    """
    p = get_project_or_404(project_id)

    if format == "kicad":
        return await _export_kicad(p)
    elif format == "eagle":
        return await _export_eagle(p)
    elif format == "gerber":
        return await _export_gerber(p)
    elif format == "odb":
        return await _export_odb(p)
    elif format == "bom":
        return await _export_bom(p)
    elif format == "pnp":
        return await _export_pnp(p)
    elif format == "ipc2581":
        return await _export_ipc2581(p)
    else:
        raise HTTPException(
            400,
            f"Unsupported export format: '{format}'. "
            f"Supported: kicad, eagle, gerber, odb, bom, pnp, ipc2581",
        )


def _get_solver_board(p: Any) -> Any:
    """Convert parsed board to solver BoardDesign format.

    The parsers produce routeai_parsers.models.BoardDesign; some exporters
    (gerber, odb, bom, pnp, ipc2581) expect routeai_solver.board_model.BoardDesign.
    """
    from routeai_cli.analyzer import convert_to_solver_board
    return convert_to_solver_board(p.parsed_board)


async def _export_kicad(p: Any) -> Response:
    """Export as KiCad .kicad_pcb + .kicad_sch in a zip archive."""
    if not p.parsed_board and not p.parsed_schematic:
        raise HTTPException(400, "No board or schematic data to export")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if p.parsed_board:
            from routeai_parsers.kicad.exporter import KiCadPcbExporter
            exporter = KiCadPcbExporter()
            pcb_text = exporter.export_text(p.parsed_board)
            zf.writestr(f"{p.name}.kicad_pcb", pcb_text)

        if p.parsed_schematic:
            from routeai_parsers.kicad.sch_exporter import KiCadSchExporter
            exporter = KiCadSchExporter()
            sch_text = exporter.export_text(p.parsed_schematic)
            zf.writestr(f"{p.name}.kicad_sch", sch_text)

    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{p.name}_kicad.zip"'},
    )


async def _export_eagle(p: Any) -> Response:
    """Export as Eagle .brd + .sch in a zip archive."""
    if not p.parsed_board and not p.parsed_schematic:
        raise HTTPException(400, "No board or schematic data to export")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        if p.parsed_board:
            from routeai_parsers.eagle.exporter import EagleBrdExporter
            exporter = EagleBrdExporter()
            brd_text = exporter.export_text(p.parsed_board)
            zf.writestr(f"{p.name}.brd", brd_text)

        if p.parsed_schematic:
            from routeai_parsers.eagle.sch_exporter import EagleSchExporter
            exporter = EagleSchExporter()
            sch_text = exporter.export_text(p.parsed_schematic)
            zf.writestr(f"{p.name}.sch", sch_text)

    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{p.name}_eagle.zip"'},
    )


async def _export_gerber(p: Any) -> Response:
    """Export as Gerber RS-274X files in a zip archive."""
    if not p.parsed_board:
        raise HTTPException(400, "No board data to export as Gerber")

    solver_board = _get_solver_board(p)

    with tempfile.TemporaryDirectory(prefix="routeai_gerber_") as tmpdir:
        from routeai_solver.manufacturing.gerber import GerberExporter
        exporter = GerberExporter()
        gerber_files = exporter.export(solver_board, tmpdir)

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for fpath in gerber_files:
                fpath = Path(fpath)
                zf.write(fpath, fpath.name)

    buf.seek(0)
    return Response(
        content=buf.read(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{p.name}_gerber.zip"'},
    )


async def _export_odb(p: Any) -> Response:
    """Export as ODB++ .tgz archive."""
    if not p.parsed_board:
        raise HTTPException(400, "No board data to export as ODB++")

    solver_board = _get_solver_board(p)

    with tempfile.TemporaryDirectory(prefix="routeai_odb_") as tmpdir:
        from routeai_solver.manufacturing.odb_export import ODBExporter
        exporter = ODBExporter(job_name=p.name)
        tgz_path = exporter.export(solver_board, tmpdir)

        content = Path(tgz_path).read_bytes()

    return Response(
        content=content,
        media_type="application/gzip",
        headers={"Content-Disposition": f'attachment; filename="{p.name}.odb.tgz"'},
    )


async def _export_bom(p: Any) -> Response:
    """Export Bill of Materials as CSV."""
    if not p.parsed_board:
        raise HTTPException(400, "No board data to export BOM")

    from routeai_solver.manufacturing.bom_export import BOM, BOMExporter, BOMItem

    # Build BOM from board footprints
    items: list[BOMItem] = []
    for fp in p.parsed_board.footprints:
        items.append(BOMItem(
            reference=fp.reference,
            value=fp.value,
            footprint=fp.library_link,
        ))

    bom = BOM(items=items, project_name=p.name)

    with tempfile.TemporaryDirectory(prefix="routeai_bom_") as tmpdir:
        filepath = str(Path(tmpdir) / f"{p.name}_bom.csv")
        BOMExporter.export_csv(bom, filepath)
        content = Path(filepath).read_bytes()

    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{p.name}_bom.csv"'},
    )


async def _export_pnp(p: Any) -> Response:
    """Export Pick and Place CSV."""
    if not p.parsed_board:
        raise HTTPException(400, "No board data to export Pick & Place")

    solver_board = _get_solver_board(p)

    with tempfile.TemporaryDirectory(prefix="routeai_pnp_") as tmpdir:
        from routeai_solver.manufacturing.pick_and_place import PickAndPlaceExporter
        exporter = PickAndPlaceExporter(board_name=p.name)
        filepath = exporter.export(solver_board, str(Path(tmpdir) / f"{p.name}_pnp.csv"))
        content = Path(filepath).read_bytes()

    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{p.name}_pnp.csv"'},
    )


async def _export_ipc2581(p: Any) -> Response:
    """Export IPC-2581 XML."""
    if not p.parsed_board:
        raise HTTPException(400, "No board data to export as IPC-2581")

    solver_board = _get_solver_board(p)

    with tempfile.TemporaryDirectory(prefix="routeai_ipc_") as tmpdir:
        from routeai_solver.manufacturing.ipc2581_export import IPC2581Exporter
        exporter = IPC2581Exporter()
        filepath = exporter.export(solver_board, str(Path(tmpdir) / f"{p.name}.xml"))
        content = Path(filepath).read_bytes()

    return Response(
        content=content,
        media_type="application/xml",
        headers={"Content-Disposition": f'attachment; filename="{p.name}_ipc2581.xml"'},
    )


# ===========================================================================
# Workflow status endpoint
# ===========================================================================


@router.get("/{project_id}/status")
async def workflow_status(project_id: str) -> WorkflowStatus:
    """Get current workflow status for the project.

    Returns the current stage, completion status of each stage, and
    an AI suggestion for next steps.
    """
    p = get_project_or_404(project_id)

    has_schematic = p.parsed_schematic is not None
    has_board = p.parsed_board is not None
    has_review = p.ai_review is not None

    # Count components and nets
    component_count = 0
    net_count = 0
    if p.parsed_board:
        component_count = len(p.parsed_board.footprints)
        net_count = len(p.parsed_board.nets)
    elif p.parsed_schematic:
        component_count = len(p.parsed_schematic.symbols)
        net_count = len(p.parsed_schematic.nets)

    # Count DRC violations
    drc_violations = 0
    if p.drc_result and p.drc_result.filtered_violations:
        drc_violations = len(p.drc_result.filtered_violations)

    # Build stage list
    stages: list[StageStatus] = []

    # Stage 1: Upload / Parse
    if has_board or has_schematic:
        stages.append(StageStatus(
            name="upload",
            status="complete",
            detail=f"{'Board' if has_board else ''}{' + ' if has_board and has_schematic else ''}{'Schematic' if has_schematic else ''} loaded",
        ))
    else:
        stages.append(StageStatus(name="upload", status="pending", detail="Upload a KiCad project"))

    # Stage 2: DRC Analysis
    if p.drc_result:
        stages.append(StageStatus(
            name="drc",
            status="complete",
            detail=f"{drc_violations} violations found, score: {p.drc_result.design_score:.0f}",
        ))
    elif has_board:
        stages.append(StageStatus(name="drc", status="pending", detail="Run DRC analysis"))
    else:
        stages.append(StageStatus(name="drc", status="pending", detail="Requires board data"))

    # Stage 3: AI Review
    if has_review:
        finding_count = len(p.ai_review.get("findings", []))
        stages.append(StageStatus(
            name="review",
            status="complete",
            detail=f"{finding_count} findings",
        ))
    elif has_board or has_schematic:
        stages.append(StageStatus(name="review", status="pending", detail="Run AI design review"))
    else:
        stages.append(StageStatus(name="review", status="pending", detail="Requires design data"))

    # Stage 4: Placement
    stages.append(StageStatus(
        name="placement",
        status="pending",
        detail="Run AI placement optimization" if has_board else "Requires board data",
    ))

    # Stage 5: Routing
    stages.append(StageStatus(
        name="routing",
        status="pending",
        detail="Generate AI routing strategy" if has_board else "Requires board data",
    ))

    # Stage 6: Export
    stages.append(StageStatus(
        name="export",
        status="pending",
        detail="Export to manufacturing formats",
    ))

    # Determine current stage
    if not (has_board or has_schematic):
        current_stage = "upload"
    elif not p.drc_result and has_board:
        current_stage = "drc"
    elif not has_review:
        current_stage = "review"
    else:
        current_stage = "placement"

    # AI suggestion
    ai_suggestion: str | None = None
    if current_stage == "upload":
        ai_suggestion = "Upload a KiCad .kicad_pcb or .zip to get started."
    elif current_stage == "drc":
        ai_suggestion = "Run DRC analysis to check for design rule violations."
    elif current_stage == "review":
        ai_suggestion = "Run AI design review for comprehensive analysis."
    elif current_stage == "placement":
        ai_suggestion = "Optimize component placement with AI, then proceed to routing."

    return WorkflowStatus(
        current_stage=current_stage,
        stages=stages,
        has_schematic=has_schematic,
        has_board=has_board,
        has_review=has_review,
        component_count=component_count,
        net_count=net_count,
        drc_violations=drc_violations,
        ai_suggestion=ai_suggestion,
    )
