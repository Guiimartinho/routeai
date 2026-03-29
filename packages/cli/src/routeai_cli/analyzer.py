"""Core analysis logic for the RouteAI CLI.

Discovers KiCad files, parses them, converts between the parser and solver
data models, runs DRC, optionally runs LLM analysis, and aggregates results
into a single ``AnalysisResult``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from routeai_parsers import KiCadPcbParser, KiCadSchParser
from routeai_parsers.models import (
    BoardDesign as ParsedBoard,
    SchematicDesign as ParsedSchematic,
)
from routeai_solver import DRCEngine, DRCReport, DRCSeverity, DRCViolation
from routeai_solver.board_model import (
    BoardDesign as SolverBoard,
    CopperZone,
    DesignRules as SolverDesignRules,
    Layer,
    LayerType,
    Net as SolverNet,
    Pad as SolverPad,
    PadShape as SolverPadShape,
    StackupLayer as SolverStackupLayer,
    Trace,
    TraceSegment as SolverTraceSegment,
    Via as SolverVia,
)

logger = logging.getLogger(__name__)

# Maps from parsed pad-shape string enum to solver PadShape
_PAD_SHAPE_MAP = {
    "circle": SolverPadShape.CIRCLE,
    "rect": SolverPadShape.RECT,
    "oval": SolverPadShape.OVAL,
    "roundrect": SolverPadShape.ROUNDRECT,
    "custom": SolverPadShape.CUSTOM,
}

# Maps from parsed layer-type string to solver LayerType
_LAYER_TYPE_MAP = {
    "signal": LayerType.COPPER,
    "power": LayerType.COPPER,
    "mixed": LayerType.COPPER,
    "user": LayerType.SILK_SCREEN,
    "jumper": LayerType.COPPER,
}


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class AnalysisOptions:
    """Options controlling the analysis run."""

    project_dir: Path
    use_ai: bool = False
    min_severity: str = "info"  # "critical" | "warning" | "info"


@dataclass
class AnalysisResult:
    """Aggregated result of a full project analysis."""

    project_dir: Path = field(default_factory=lambda: Path("."))
    boards_parsed: int = 0
    schematics_parsed: int = 0
    drc_report: DRCReport | None = None
    filtered_violations: list[DRCViolation] = field(default_factory=list)
    design_score: int = 100
    impedance_warnings: list[str] = field(default_factory=list)
    thermal_warnings: list[str] = field(default_factory=list)
    manufacturing_warnings: list[str] = field(default_factory=list)
    ai_constraints: list[dict[str, Any]] = field(default_factory=list)
    ai_findings: list[dict[str, Any]] = field(default_factory=list)
    ai_enabled: bool = False
    elapsed_seconds: float = 0.0
    board_summary: dict[str, Any] = field(default_factory=dict)
    schematic_summary: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# File discovery
# ---------------------------------------------------------------------------


def discover_kicad_files(project_dir: Path) -> dict[str, list[Path]]:
    """Find .kicad_pcb and .kicad_sch files in the project directory.

    Only searches the top-level directory (non-recursive) to avoid picking up
    backup or library files in nested directories.

    Returns:
        Dict with keys ``"pcb"`` and ``"sch"``, each a list of Paths.
    """
    if not project_dir.is_dir():
        raise FileNotFoundError(f"Not a directory: {project_dir}")

    pcb_files = sorted(project_dir.glob("*.kicad_pcb"))
    sch_files = sorted(project_dir.glob("*.kicad_sch"))

    return {"pcb": pcb_files, "sch": sch_files}


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def parse_kicad_files(
    files: dict[str, list[Path]],
) -> dict[str, list[Any]]:
    """Parse all discovered KiCad files.

    Returns:
        Dict with keys ``"boards"`` (list of ParsedBoard) and
        ``"schematics"`` (list of ParsedSchematic).
    """
    pcb_parser = KiCadPcbParser()
    sch_parser = KiCadSchParser()

    boards: list[ParsedBoard] = []
    schematics: list[ParsedSchematic] = []

    for pcb_path in files.get("pcb", []):
        logger.info("Parsing PCB: %s", pcb_path)
        boards.append(pcb_parser.parse(pcb_path))

    for sch_path in files.get("sch", []):
        logger.info("Parsing schematic: %s", sch_path)
        schematics.append(sch_parser.parse(sch_path))

    return {"boards": boards, "schematics": schematics}


# ---------------------------------------------------------------------------
# Model conversion: parser -> solver
# ---------------------------------------------------------------------------


def convert_to_solver_board(parsed: ParsedBoard) -> SolverBoard:
    """Convert a parser BoardDesign (Pydantic) to a solver BoardDesign (dataclass).

    The parser and solver packages use distinct data models.  This function maps
    between them so the DRC engine can operate on parsed board data.
    """
    solver = SolverBoard()

    # -- Nets --
    net_map: dict[int, SolverNet] = {}
    for pnet in parsed.nets:
        sn = SolverNet(name=pnet.name, id=pnet.number)
        solver.nets.append(sn)
        net_map[pnet.number] = sn

    unconnected_net = SolverNet(name="<unconnected>", id=-1)

    def _get_net(num: int) -> SolverNet:
        return net_map.get(num, unconnected_net)

    # -- Layers --
    layer_map: dict[str, Layer] = {}
    for ldef in parsed.layers:
        lt = _LAYER_TYPE_MAP.get(ldef.layer_type, LayerType.SILK_SCREEN)
        layer = Layer(name=ldef.name, layer_type=lt, index=ldef.ordinal)
        solver.layers.append(layer)
        layer_map[ldef.name] = layer

    def _get_layer(name: str) -> Layer:
        if name in layer_map:
            return layer_map[name]
        # Create a placeholder layer
        placeholder = Layer(name=name, layer_type=LayerType.SILK_SCREEN)
        layer_map[name] = placeholder
        return placeholder

    # -- Design rules --
    pr = parsed.design_rules
    solver.design_rules = SolverDesignRules(
        min_trace_width=pr.min_trace_width,
        min_clearance=pr.min_clearance,
        min_via_diameter=pr.min_via_diameter,
        min_via_drill=pr.min_via_drill,
        board_edge_clearance=pr.copper_edge_clearance if pr.copper_edge_clearance > 0 else 0.25,
    )

    # -- Segments -> Traces --
    # Group segments by (net, layer) to form traces.
    trace_groups: dict[tuple[int, str], list[SolverTraceSegment]] = {}
    for seg in parsed.segments:
        key = (seg.net, seg.layer)
        ts = SolverTraceSegment(
            start_x=seg.start.x,
            start_y=seg.start.y,
            end_x=seg.end.x,
            end_y=seg.end.y,
            width=seg.width,
        )
        trace_groups.setdefault(key, []).append(ts)

    for (net_num, layer_name), segs in trace_groups.items():
        solver.traces.append(Trace(
            net=_get_net(net_num),
            layer=_get_layer(layer_name),
            segments=segs,
        ))

    # -- Vias --
    for pv in parsed.vias:
        start_layer = _get_layer(pv.layers[0]) if pv.layers else _get_layer("F.Cu")
        end_layer = _get_layer(pv.layers[-1]) if len(pv.layers) > 1 else _get_layer("B.Cu")
        solver.vias.append(SolverVia(
            net=_get_net(pv.net),
            x=pv.at.x,
            y=pv.at.y,
            drill=pv.drill,
            diameter=pv.size,
            start_layer=start_layer,
            end_layer=end_layer,
        ))

    # -- Pads (from footprints) --
    for fp in parsed.footprints:
        for pad in fp.pads:
            # Compute absolute pad position from footprint position + pad local position
            import math

            fx, fy = fp.at.x, fp.at.y
            px, py = pad.at.x, pad.at.y
            fp_angle_rad = math.radians(fp.angle)
            if fp.angle != 0.0:
                cos_a = math.cos(fp_angle_rad)
                sin_a = math.sin(fp_angle_rad)
                abs_x = fx + px * cos_a - py * sin_a
                abs_y = fy + px * sin_a + py * cos_a
            else:
                abs_x = fx + px
                abs_y = fy + py

            # Determine the primary layer for solver purposes
            primary_layer_name = pad.layers[0] if pad.layers else fp.layer
            # For through-hole pads with multiple layers pick the first copper
            for ln in pad.layers:
                if ln in layer_map and layer_map[ln].layer_type == LayerType.COPPER:
                    primary_layer_name = ln
                    break

            solver.pads.append(SolverPad(
                net=_get_net(pad.net_number),
                layer=_get_layer(primary_layer_name),
                x=abs_x,
                y=abs_y,
                shape=_PAD_SHAPE_MAP.get(pad.shape.value, SolverPadShape.RECT),
                width=pad.size_x,
                height=pad.size_y,
                drill=pad.drill,
                rotation=pad.angle + fp.angle,
                component_ref=fp.reference,
                pad_number=pad.number,
            ))

    # -- Stackup --
    for sl in parsed.stackup.layers:
        lt = LayerType.COPPER if sl.layer_type in ("copper", "signal", "power") else LayerType.DIELECTRIC
        layer_obj = _get_layer(sl.name) if sl.name in layer_map else Layer(name=sl.name, layer_type=lt)
        solver.stackup.append(SolverStackupLayer(
            layer=layer_obj,
            thickness_mm=sl.thickness,
            dielectric_constant=sl.epsilon_r if sl.epsilon_r else 1.0,
            loss_tangent=sl.loss_tangent,
            material=sl.material,
        ))

    # -- Board outline (from Edge.Cuts graphical items) --
    edge_cuts_lines = [gl for gl in parsed.gr_lines if gl.layer == "Edge.Cuts"]
    if edge_cuts_lines:
        from shapely.geometry import LineString, Polygon as ShapelyPolygon
        from shapely.ops import polygonize, unary_union

        lines = []
        for gl in edge_cuts_lines:
            lines.append(LineString([
                (gl.start.x, gl.start.y),
                (gl.end.x, gl.end.y),
            ]))

        # Also include Edge.Cuts arcs and rects
        for gr in parsed.gr_rects:
            if gr.layer == "Edge.Cuts":
                lines.append(LineString([
                    (gr.start.x, gr.start.y),
                    (gr.end.x, gr.start.y),
                    (gr.end.x, gr.end.y),
                    (gr.start.x, gr.end.y),
                    (gr.start.x, gr.start.y),
                ]))

        if lines:
            merged = unary_union(lines)
            polys = list(polygonize(merged))
            if polys:
                solver.outline = max(polys, key=lambda p: p.area)

    return solver


# ---------------------------------------------------------------------------
# Warning extraction
# ---------------------------------------------------------------------------


def _extract_warnings(drc_report: DRCReport) -> dict[str, list[str]]:
    """Categorize DRC violations into impedance / thermal / manufacturing warnings."""
    impedance: list[str] = []
    thermal: list[str] = []
    manufacturing: list[str] = []

    for v in drc_report.violations:
        msg = str(v)
        rule_lower = v.rule.lower()
        if "impedance" in rule_lower or "trace_width" in rule_lower:
            impedance.append(msg)
        elif "thermal" in rule_lower or "heat" in rule_lower:
            thermal.append(msg)
        elif any(kw in rule_lower for kw in (
            "drill", "solder_mask", "annular_ring", "manufacturing", "mask",
        )):
            manufacturing.append(msg)

    return {
        "impedance": impedance,
        "thermal": thermal,
        "manufacturing": manufacturing,
    }


# ---------------------------------------------------------------------------
# Design scoring
# ---------------------------------------------------------------------------


def _calculate_design_score(drc_report: DRCReport) -> int:
    """Compute a 0-100 design score based on DRC violations.

    Scoring:
    - Start at 100
    - Each ERROR costs 10 points
    - Each WARNING costs 3 points
    - Each INFO costs 1 point
    - Minimum score is 0
    """
    score = 100
    score -= drc_report.error_count * 10
    score -= drc_report.warning_count * 3
    score -= drc_report.info_count * 1
    return max(0, score)


# ---------------------------------------------------------------------------
# Severity filtering
# ---------------------------------------------------------------------------

_SEVERITY_ORDER = {
    "info": 0,
    "warning": 1,
    "critical": 2,
}

_DRC_SEVERITY_TO_LEVEL = {
    DRCSeverity.INFO: 0,
    DRCSeverity.WARNING: 1,
    DRCSeverity.ERROR: 2,
}


def _filter_violations(
    violations: list[DRCViolation],
    min_severity: str,
) -> list[DRCViolation]:
    """Filter violations to only those at or above the given severity level."""
    min_level = _SEVERITY_ORDER.get(min_severity, 0)
    return [
        v for v in violations
        if _DRC_SEVERITY_TO_LEVEL.get(v.severity, 0) >= min_level
    ]


# ---------------------------------------------------------------------------
# LLM analysis
# ---------------------------------------------------------------------------


def _run_ai_analysis(
    parsed_board: ParsedBoard | None,
    parsed_schematic: ParsedSchematic | None,
) -> dict[str, Any]:
    """Run LLM-powered design analysis via RouteAIAgent.

    Returns a dict with ``"constraints"`` and ``"findings"`` lists.
    """
    from routeai_intelligence import RouteAIAgent

    agent = RouteAIAgent(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    board_dict = parsed_board.model_dump(mode="json") if parsed_board else {}
    sch_dict = parsed_schematic.model_dump(mode="json") if parsed_schematic else {}

    async def _run() -> dict[str, Any]:
        result: dict[str, Any] = {"constraints": [], "findings": []}

        # Run design review if we have both board and schematic
        if board_dict and sch_dict:
            review = await agent.analyze_design(board=board_dict, schematic=sch_dict)
            result["findings"] = review.findings

        # Run constraint generation if we have a schematic
        if sch_dict:
            components = []
            if parsed_schematic:
                for sym in parsed_schematic.symbols:
                    components.append({
                        "reference": sym.reference,
                        "value": sym.value,
                        "lib_id": sym.lib_id,
                    })

            constraints = await agent.generate_constraints(
                schematic=sch_dict,
                components=components,
            )
            constraint_items: list[dict[str, Any]] = []
            for nc in constraints.net_classes:
                constraint_items.append({"type": "net_class", **nc})
            for dp in constraints.diff_pairs:
                constraint_items.append({"type": "diff_pair", **dp})
            for lg in constraints.length_groups:
                constraint_items.append({"type": "length_group", **lg})
            for sr in constraints.special_rules:
                constraint_items.append({"type": "special_rule", **sr})
            result["constraints"] = constraint_items

        return result

    return asyncio.run(_run())


# ---------------------------------------------------------------------------
# Main analysis orchestrator
# ---------------------------------------------------------------------------


def analyze_project(options: AnalysisOptions) -> AnalysisResult:
    """Run the full analysis pipeline on a KiCad project directory.

    Steps:
    1. Discover .kicad_pcb and .kicad_sch files
    2. Parse them using routeai_parsers
    3. Convert parsed board to solver format
    4. Run DRC using routeai_solver.DRCEngine
    5. Optionally run LLM analysis via routeai_intelligence
    6. Aggregate and return results
    """
    start_time = time.monotonic()
    result = AnalysisResult(project_dir=options.project_dir)

    # Step 1: Discover files
    files = discover_kicad_files(options.project_dir)
    if not files["pcb"] and not files["sch"]:
        raise FileNotFoundError(
            f"No KiCad files (.kicad_pcb or .kicad_sch) found in {options.project_dir}"
        )

    # Step 2: Parse
    parsed = parse_kicad_files(files)
    boards: list[ParsedBoard] = parsed["boards"]
    schematics: list[ParsedSchematic] = parsed["schematics"]

    result.boards_parsed = len(boards)
    result.schematics_parsed = len(schematics)

    # Collect summary info from the first board/schematic
    if boards:
        b = boards[0]
        copper_layers = [l for l in b.layers if l.layer_type in ("signal", "power")]
        result.board_summary = {
            "generator": b.generator,
            "version": b.version,
            "thickness_mm": b.thickness,
            "layer_count": len(b.layers),
            "copper_layer_count": len(copper_layers),
            "net_count": len(b.nets),
            "footprint_count": len(b.footprints),
            "segment_count": len(b.segments),
            "via_count": len(b.vias),
            "zone_count": len(b.zones),
        }

    if schematics:
        s = schematics[0]
        result.schematic_summary = {
            "title": s.title,
            "revision": s.revision,
            "symbol_count": len(s.symbols),
            "net_count": len(s.nets),
            "wire_count": len(s.wires),
            "label_count": len(s.labels),
            "hierarchical_sheet_count": len(s.hierarchical_sheets),
        }

    # Step 3 & 4: Convert and run DRC (only if we have a board)
    if boards:
        solver_board = convert_to_solver_board(boards[0])
        engine = DRCEngine(
            run_geometric=True,
            run_electrical=True,
            run_manufacturing=True,
        )
        drc_report = engine.run(solver_board)
        result.drc_report = drc_report
        result.filtered_violations = _filter_violations(
            drc_report.violations, options.min_severity
        )
        result.design_score = _calculate_design_score(drc_report)

        # Extract categorised warnings
        warnings = _extract_warnings(drc_report)
        result.impedance_warnings = warnings["impedance"]
        result.thermal_warnings = warnings["thermal"]
        result.manufacturing_warnings = warnings["manufacturing"]

    # Step 5: LLM analysis (optional)
    if options.use_ai:
        result.ai_enabled = True
        try:
            ai_result = _run_ai_analysis(
                boards[0] if boards else None,
                schematics[0] if schematics else None,
            )
            result.ai_constraints = ai_result.get("constraints", [])
            result.ai_findings = ai_result.get("findings", [])
        except Exception as exc:
            logger.error("AI analysis failed: %s", exc)
            result.errors.append(f"AI analysis failed: {exc}")

    result.elapsed_seconds = time.monotonic() - start_time
    return result
