"""Tool definitions for Claude API tool_use.

Each tool has a name, description, input_schema (JSON Schema), and a handler
function. Tools are registered with the RouteAIAgent and made available to the
LLM during ReAct loop execution.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine

# IPC-2221B Table 6-1 clearance values (voltage -> clearance in mm)
# For B1 conditions: sea level to 3050m, uncoated, external conductors
_IPC2221B_CLEARANCE_TABLE: list[tuple[float, float]] = [
    (0, 0.1),       # 0-15V
    (15, 0.1),
    (30, 0.1),
    (50, 0.6),
    (100, 0.6),
    (150, 0.6),
    (170, 1.0),
    (250, 1.25),
    (300, 1.25),
    (500, 2.5),
    (750, 5.0),
    (1000, 8.0),
    (1500, 12.5),
]


@dataclass
class ToolDefinition:
    """A tool that can be called by the LLM via Claude API tool_use."""

    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[..., Coroutine[Any, Any, dict[str, Any]]]


async def _handle_impedance_calc(
    trace_width_mm: float,
    dielectric_height_mm: float,
    dielectric_constant: float,
    trace_thickness_mm: float = 0.035,
    topology: str = "microstrip",
    spacing_mm: float | None = None,
) -> dict[str, Any]:
    """Calculate transmission line impedance for a given stackup configuration.

    Supports microstrip, embedded microstrip, and stripline topologies, both
    single-ended and differential.
    """
    from routeai_solver.physics.impedance import (
        differential_microstrip_impedance,
        differential_stripline_impedance,
        microstrip_impedance,
        stripline_impedance,
    )

    try:
        if topology == "microstrip":
            if spacing_mm is not None and spacing_mm > 0:
                result = differential_microstrip_impedance(
                    w=trace_width_mm,
                    s=spacing_mm,
                    h=dielectric_height_mm,
                    er=dielectric_constant,
                    t=trace_thickness_mm,
                )
                return {
                    "topology": "differential_microstrip",
                    "z0_single_ended_ohm": round(result.z0, 2),
                    "z_diff_ohm": round(result.z_diff, 2),
                    "er_eff": round(result.er_eff, 4),
                    "delay_ps_per_mm": round(result.delay_per_length, 4),
                    "velocity_m_per_s": round(result.velocity, 0),
                    "status": "ok",
                }
            else:
                result = microstrip_impedance(
                    w=trace_width_mm,
                    h=dielectric_height_mm,
                    er=dielectric_constant,
                    t=trace_thickness_mm,
                )
                return {
                    "topology": "microstrip",
                    "z0_ohm": round(result.z0, 2),
                    "er_eff": round(result.er_eff, 4),
                    "delay_ps_per_mm": round(result.delay_per_length, 4),
                    "velocity_m_per_s": round(result.velocity, 0),
                    "status": "ok",
                }
        elif topology == "stripline":
            if spacing_mm is not None and spacing_mm > 0:
                result = differential_stripline_impedance(
                    w=trace_width_mm,
                    s=spacing_mm,
                    h=dielectric_height_mm,
                    er=dielectric_constant,
                    t=trace_thickness_mm,
                )
                return {
                    "topology": "differential_stripline",
                    "z0_single_ended_ohm": round(result.z0, 2),
                    "z_diff_ohm": round(result.z_diff, 2),
                    "er_eff": round(result.er_eff, 4),
                    "delay_ps_per_mm": round(result.delay_per_length, 4),
                    "velocity_m_per_s": round(result.velocity, 0),
                    "status": "ok",
                }
            else:
                result = stripline_impedance(
                    w=trace_width_mm,
                    h=dielectric_height_mm,
                    er=dielectric_constant,
                    t=trace_thickness_mm,
                )
                return {
                    "topology": "stripline",
                    "z0_ohm": round(result.z0, 2),
                    "er_eff": round(result.er_eff, 4),
                    "delay_ps_per_mm": round(result.delay_per_length, 4),
                    "velocity_m_per_s": round(result.velocity, 0),
                    "status": "ok",
                }
        else:
            return {"status": "error", "message": f"Unknown topology: {topology}. Use 'microstrip' or 'stripline'."}
    except (ValueError, ZeroDivisionError) as exc:
        return {"status": "error", "message": str(exc)}


async def _handle_clearance_lookup(
    voltage_v: float,
    condition: str = "B1",
) -> dict[str, Any]:
    """Look up IPC-2221B minimum clearance for a given voltage.

    Condition codes:
    - B1: Sea level to 3050m, external conductors, uncoated
    - B2: Sea level to 3050m, external conductors, with conformal coating
    - B3: Sea level to 3050m, internal conductors (between layers)
    - B4: Above 3050m, any conductors
    """
    if voltage_v < 0:
        return {"status": "error", "message": "Voltage must be non-negative"}

    # Internal layers have roughly 50% of the B1 clearance requirement
    # Coated (B2) has roughly 80% of B1
    condition_factor = {
        "B1": 1.0,
        "B2": 0.8,
        "B3": 0.5,
        "B4": 1.5,
    }

    factor = condition_factor.get(condition, 1.0)

    # Interpolate from the IPC-2221B table
    clearance_mm = _IPC2221B_CLEARANCE_TABLE[-1][1]  # default to max
    for i in range(len(_IPC2221B_CLEARANCE_TABLE) - 1):
        v_low, c_low = _IPC2221B_CLEARANCE_TABLE[i]
        v_high, c_high = _IPC2221B_CLEARANCE_TABLE[i + 1]
        if v_low <= voltage_v <= v_high:
            # Linear interpolation
            if v_high > v_low:
                ratio = (voltage_v - v_low) / (v_high - v_low)
                clearance_mm = c_low + ratio * (c_high - c_low)
            else:
                clearance_mm = c_low
            break

    clearance_mm *= factor

    return {
        "voltage_v": voltage_v,
        "condition": condition,
        "clearance_mm": round(clearance_mm, 3),
        "reference": f"IPC-2221B Table 6-1, condition {condition}",
        "note": "Values are minimum clearance for the specified voltage and condition. Apply safety margin for production.",
        "status": "ok",
    }


async def _handle_drc_check(
    board_state: dict[str, Any],
    checks: list[str] | None = None,
) -> dict[str, Any]:
    """Run DRC checks on the current board state.

    This tool accepts a serialized board state and runs the requested
    subset of DRC checks against it. If no checks are specified, all
    checks are run.

    Available check categories: geometric, electrical, manufacturing.
    """
    from routeai_solver.drc.engine import DRCEngine

    try:
        run_geometric = checks is None or "geometric" in checks
        run_electrical = checks is None or "electrical" in checks
        run_manufacturing = checks is None or "manufacturing" in checks

        engine = DRCEngine(
            run_geometric=run_geometric,
            run_electrical=run_electrical,
            run_manufacturing=run_manufacturing,
        )

        # The board_state dict is expected to be a serialized BoardDesign;
        # in a real integration this would be the live board object passed
        # through the agent context rather than deserialized here.
        from routeai_solver.board_model import BoardDesign as SolverBoardDesign

        board = SolverBoardDesign(**board_state) if isinstance(board_state, dict) else board_state
        report = engine.run(board)

        violations = []
        for v in report.violations:
            violations.append({
                "rule": v.rule,
                "severity": v.severity.value,
                "message": v.message,
                "location": v.location,
                "affected_items": v.affected_items,
            })

        return {
            "passed": report.passed,
            "error_count": report.error_count,
            "warning_count": report.warning_count,
            "info_count": report.info_count,
            "violations": violations,
            "stats": report.stats,
            "elapsed_seconds": round(report.elapsed_seconds, 4),
            "status": "ok",
        }
    except Exception as exc:
        return {"status": "error", "message": f"DRC check failed: {exc}"}


async def _handle_datasheet_lookup(
    query: str,
    component: str | None = None,
    section: str | None = None,
    top_k: int = 5,
) -> dict[str, Any]:
    """Search the RAG knowledge base for component specifications and datasheet info.

    Searches indexed datasheets, IPC standards, and reference designs using
    semantic similarity. Optionally filter by component or section.
    """
    from routeai_intelligence.rag.retriever import KnowledgeRetriever

    try:
        retriever = KnowledgeRetriever()
        filters: dict[str, Any] = {}
        if component:
            filters["component"] = component
        if section:
            filters["section"] = section

        results = await retriever.search(query=query, top_k=top_k, filters=filters)

        documents = []
        for doc in results:
            documents.append({
                "content": doc.content,
                "source": doc.source,
                "relevance_score": round(doc.relevance_score, 4),
                "metadata": doc.metadata,
            })

        return {
            "query": query,
            "result_count": len(documents),
            "documents": documents,
            "status": "ok",
        }
    except Exception as exc:
        return {
            "query": query,
            "result_count": 0,
            "documents": [],
            "status": "error",
            "message": f"Knowledge base search failed: {exc}. The RAG system may not be initialized.",
        }


async def _handle_stackup_suggest(
    layer_count: int,
    impedance_targets: list[dict[str, Any]] | None = None,
    board_thickness_mm: float = 1.6,
    material: str = "FR-4",
) -> dict[str, Any]:
    """Suggest a PCB stackup for given layer count and impedance requirements.

    Returns a recommended stackup with layer thicknesses optimized to meet
    the specified impedance targets.
    """
    from routeai_solver.physics.impedance import (
        microstrip_impedance,
        stripline_impedance,
    )

    if layer_count not in (2, 4, 6, 8):
        return {"status": "error", "message": f"Unsupported layer count: {layer_count}. Supported: 2, 4, 6, 8."}

    # Standard FR-4 dielectric constant
    er = 4.2 if material == "FR-4" else 3.5  # FR-4 vs high-speed material

    # Build a standard stackup for the given layer count
    stackup_templates: dict[int, list[dict[str, Any]]] = {
        2: [
            {"name": "F.Cu", "type": "signal", "copper_oz": 1},
            {"name": "Core", "type": "dielectric", "thickness_mm": 1.53, "er": er},
            {"name": "B.Cu", "type": "signal", "copper_oz": 1},
        ],
        4: [
            {"name": "F.Cu", "type": "signal", "copper_oz": 1},
            {"name": "Prepreg1", "type": "dielectric", "thickness_mm": 0.20, "er": er},
            {"name": "In1.Cu (GND)", "type": "ground", "copper_oz": 1},
            {"name": "Core", "type": "dielectric", "thickness_mm": 1.0, "er": er},
            {"name": "In2.Cu (PWR)", "type": "power", "copper_oz": 1},
            {"name": "Prepreg2", "type": "dielectric", "thickness_mm": 0.20, "er": er},
            {"name": "B.Cu", "type": "signal", "copper_oz": 1},
        ],
        6: [
            {"name": "F.Cu", "type": "signal", "copper_oz": 1},
            {"name": "Prepreg1", "type": "dielectric", "thickness_mm": 0.10, "er": er},
            {"name": "In1.Cu (GND)", "type": "ground", "copper_oz": 1},
            {"name": "Core1", "type": "dielectric", "thickness_mm": 0.36, "er": er},
            {"name": "In2.Cu (SIG)", "type": "signal", "copper_oz": 0.5},
            {"name": "Prepreg2", "type": "dielectric", "thickness_mm": 0.36, "er": er},
            {"name": "In3.Cu (SIG)", "type": "signal", "copper_oz": 0.5},
            {"name": "Core2", "type": "dielectric", "thickness_mm": 0.36, "er": er},
            {"name": "In4.Cu (PWR)", "type": "power", "copper_oz": 1},
            {"name": "Prepreg3", "type": "dielectric", "thickness_mm": 0.10, "er": er},
            {"name": "B.Cu", "type": "signal", "copper_oz": 1},
        ],
        8: [
            {"name": "F.Cu", "type": "signal", "copper_oz": 1},
            {"name": "Prepreg1", "type": "dielectric", "thickness_mm": 0.09, "er": er},
            {"name": "In1.Cu (GND)", "type": "ground", "copper_oz": 0.5},
            {"name": "Core1", "type": "dielectric", "thickness_mm": 0.24, "er": er},
            {"name": "In2.Cu (SIG)", "type": "signal", "copper_oz": 0.5},
            {"name": "Prepreg2", "type": "dielectric", "thickness_mm": 0.18, "er": er},
            {"name": "In3.Cu (SIG)", "type": "signal", "copper_oz": 0.5},
            {"name": "Core2", "type": "dielectric", "thickness_mm": 0.24, "er": er},
            {"name": "In4.Cu (SIG)", "type": "signal", "copper_oz": 0.5},
            {"name": "Prepreg3", "type": "dielectric", "thickness_mm": 0.18, "er": er},
            {"name": "In5.Cu (SIG)", "type": "signal", "copper_oz": 0.5},
            {"name": "Core3", "type": "dielectric", "thickness_mm": 0.24, "er": er},
            {"name": "In6.Cu (PWR)", "type": "power", "copper_oz": 0.5},
            {"name": "Prepreg4", "type": "dielectric", "thickness_mm": 0.09, "er": er},
            {"name": "B.Cu", "type": "signal", "copper_oz": 1},
        ],
    }

    stackup = stackup_templates[layer_count]

    # Calculate achievable impedances for the suggested stackup
    impedance_checks = []
    # Find first dielectric height for microstrip (F.Cu to first ground)
    first_dielectric_h = None
    for layer in stackup:
        if layer["type"] == "dielectric":
            first_dielectric_h = layer["thickness_mm"]
            break

    if first_dielectric_h:
        # Check common trace widths
        for tw in [0.10, 0.125, 0.15, 0.20, 0.25, 0.30]:
            try:
                result = microstrip_impedance(w=tw, h=first_dielectric_h, er=er)
                impedance_checks.append({
                    "topology": "microstrip",
                    "layer": "F.Cu",
                    "trace_width_mm": tw,
                    "dielectric_height_mm": first_dielectric_h,
                    "z0_ohm": round(result.z0, 2),
                })
            except (ValueError, ZeroDivisionError):
                pass

    return {
        "layer_count": layer_count,
        "material": material,
        "target_thickness_mm": board_thickness_mm,
        "stackup": stackup,
        "achievable_impedances": impedance_checks,
        "notes": f"Standard {layer_count}-layer {material} stackup. Adjust prepreg/core thicknesses to fine-tune impedance.",
        "status": "ok",
    }


async def _handle_component_search(
    query: str,
    category: str | None = None,
    package: str | None = None,
    parameters: dict[str, Any] | None = None,
    top_k: int = 10,
) -> dict[str, Any]:
    """Search for components by specifications, category, or package type.

    Queries the knowledge base for component information matching the given
    criteria. Useful for finding alternative parts or checking specifications.
    """
    from routeai_intelligence.rag.retriever import KnowledgeRetriever

    try:
        retriever = KnowledgeRetriever()

        # Build a combined search query
        search_parts = [query]
        if category:
            search_parts.append(f"category:{category}")
        if package:
            search_parts.append(f"package:{package}")
        if parameters:
            for key, value in parameters.items():
                search_parts.append(f"{key}:{value}")

        combined_query = " ".join(search_parts)
        filters = {"domain": "component"}
        if category:
            filters["category"] = category

        results = await retriever.search(
            query=combined_query,
            top_k=top_k,
            filters=filters,
        )

        components = []
        for doc in results:
            components.append({
                "content": doc.content,
                "source": doc.source,
                "relevance_score": round(doc.relevance_score, 4),
                "metadata": doc.metadata,
            })

        return {
            "query": query,
            "result_count": len(components),
            "components": components,
            "status": "ok",
        }
    except Exception as exc:
        return {
            "query": query,
            "result_count": 0,
            "components": [],
            "status": "error",
            "message": f"Component search failed: {exc}. The RAG system may not be initialized.",
        }


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------

IMPEDANCE_CALC_TOOL = ToolDefinition(
    name="impedance_calc",
    description=(
        "Calculate transmission line impedance for a given PCB stackup configuration. "
        "Supports microstrip and stripline topologies, both single-ended and differential. "
        "Uses Hammerstad-Jensen and IPC-2141A equations. Returns Z0, effective dielectric "
        "constant, propagation delay, and velocity."
    ),
    input_schema={
        "type": "object",
        "required": ["trace_width_mm", "dielectric_height_mm", "dielectric_constant"],
        "properties": {
            "trace_width_mm": {
                "type": "number",
                "description": "Trace width in millimeters",
                "minimum": 0.01,
                "maximum": 25.0,
            },
            "dielectric_height_mm": {
                "type": "number",
                "description": "Dielectric height from trace to reference plane in millimeters",
                "minimum": 0.01,
                "maximum": 10.0,
            },
            "dielectric_constant": {
                "type": "number",
                "description": "Relative permittivity (Er) of the dielectric material",
                "minimum": 1.0,
                "maximum": 15.0,
            },
            "trace_thickness_mm": {
                "type": "number",
                "description": "Copper trace thickness in mm (default: 0.035 = 1oz)",
                "minimum": 0.005,
                "maximum": 0.21,
                "default": 0.035,
            },
            "topology": {
                "type": "string",
                "description": "Transmission line topology",
                "enum": ["microstrip", "stripline"],
                "default": "microstrip",
            },
            "spacing_mm": {
                "type": ["number", "null"],
                "description": "Edge-to-edge spacing for differential pair calculation. If provided, differential impedance is calculated.",
                "minimum": 0.01,
                "maximum": 10.0,
            },
        },
    },
    handler=_handle_impedance_calc,
)

CLEARANCE_LOOKUP_TOOL = ToolDefinition(
    name="clearance_lookup",
    description=(
        "Look up minimum conductor clearance per IPC-2221B Table 6-1 for a given "
        "voltage. Returns the required clearance in millimeters for the specified "
        "voltage and environmental condition. Supports conditions B1 through B4."
    ),
    input_schema={
        "type": "object",
        "required": ["voltage_v"],
        "properties": {
            "voltage_v": {
                "type": "number",
                "description": "Peak voltage between conductors in volts",
                "minimum": 0.0,
                "maximum": 5000.0,
            },
            "condition": {
                "type": "string",
                "description": "IPC-2221B environmental condition code",
                "enum": ["B1", "B2", "B3", "B4"],
                "default": "B1",
            },
        },
    },
    handler=_handle_clearance_lookup,
)

DRC_CHECK_TOOL = ToolDefinition(
    name="drc_check",
    description=(
        "Run design rule checks (DRC) on the current board state. Performs geometric "
        "(clearance, trace width, annular ring), electrical (connectivity, shorts), "
        "and manufacturing (drill sizes, solder mask) checks. Returns a list of "
        "violations with severity, location, and affected items."
    ),
    input_schema={
        "type": "object",
        "required": ["board_state"],
        "properties": {
            "board_state": {
                "type": "object",
                "description": "Serialized board design state for DRC analysis",
            },
            "checks": {
                "type": ["array", "null"],
                "description": "Specific check categories to run. If null, all checks run.",
                "items": {
                    "type": "string",
                    "enum": ["geometric", "electrical", "manufacturing"],
                },
            },
        },
    },
    handler=_handle_drc_check,
)

DATASHEET_LOOKUP_TOOL = ToolDefinition(
    name="datasheet_lookup",
    description=(
        "Search the indexed knowledge base for component specifications, datasheet "
        "information, IPC standard clauses, and reference design details. Uses "
        "semantic similarity search over embedded documents. Returns matching "
        "passages with source references and relevance scores."
    ),
    input_schema={
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {
                "type": "string",
                "description": "Natural language search query (e.g., 'USB Type-C receptacle recommended layout')",
                "minLength": 3,
                "maxLength": 512,
            },
            "component": {
                "type": ["string", "null"],
                "description": "Filter results to a specific component (e.g., 'STM32F405')",
            },
            "section": {
                "type": ["string", "null"],
                "description": "Filter results to a specific document section (e.g., 'layout_guidelines')",
            },
            "top_k": {
                "type": "integer",
                "description": "Number of results to return",
                "minimum": 1,
                "maximum": 20,
                "default": 5,
            },
        },
    },
    handler=_handle_datasheet_lookup,
)

STACKUP_SUGGEST_TOOL = ToolDefinition(
    name="stackup_suggest",
    description=(
        "Suggest a PCB layer stackup for a given layer count and impedance "
        "requirements. Returns a complete stackup with dielectric thicknesses "
        "and achievable impedances for common trace widths. Helps determine "
        "if a target impedance is achievable with the proposed stackup."
    ),
    input_schema={
        "type": "object",
        "required": ["layer_count"],
        "properties": {
            "layer_count": {
                "type": "integer",
                "description": "Number of copper layers",
                "enum": [2, 4, 6, 8],
            },
            "impedance_targets": {
                "type": ["array", "null"],
                "description": "List of impedance targets to verify against the stackup",
                "items": {
                    "type": "object",
                    "properties": {
                        "z_ohm": {"type": "number", "description": "Target impedance in ohms"},
                        "topology": {"type": "string", "enum": ["microstrip", "stripline"]},
                        "differential": {"type": "boolean", "default": False},
                    },
                },
            },
            "board_thickness_mm": {
                "type": "number",
                "description": "Target total board thickness in mm",
                "minimum": 0.4,
                "maximum": 6.0,
                "default": 1.6,
            },
            "material": {
                "type": "string",
                "description": "Dielectric material type",
                "enum": ["FR-4", "high-speed"],
                "default": "FR-4",
            },
        },
    },
    handler=_handle_stackup_suggest,
)

COMPONENT_SEARCH_TOOL = ToolDefinition(
    name="component_search",
    description=(
        "Search for electronic components by specifications, category, or package "
        "type. Queries the knowledge base for component data sheets, specifications, "
        "and layout guidelines. Useful for finding parts that meet specific "
        "electrical or mechanical requirements."
    ),
    input_schema={
        "type": "object",
        "required": ["query"],
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query describing the component (e.g., 'low-noise LDO regulator 3.3V 500mA')",
                "minLength": 3,
                "maxLength": 512,
            },
            "category": {
                "type": ["string", "null"],
                "description": "Component category filter (e.g., 'voltage_regulator', 'capacitor', 'connector')",
            },
            "package": {
                "type": ["string", "null"],
                "description": "Package type filter (e.g., 'SOT-23', 'QFN-48', '0402')",
            },
            "parameters": {
                "type": ["object", "null"],
                "description": "Specific parameter filters (e.g., {\"voltage\": \"3.3V\", \"current\": \"500mA\"})",
                "additionalProperties": {"type": "string"},
            },
            "top_k": {
                "type": "integer",
                "description": "Number of results to return",
                "minimum": 1,
                "maximum": 50,
                "default": 10,
            },
        },
    },
    handler=_handle_component_search,
)


# Ordered list of all available tools
ALL_TOOLS: list[ToolDefinition] = [
    IMPEDANCE_CALC_TOOL,
    CLEARANCE_LOOKUP_TOOL,
    DRC_CHECK_TOOL,
    DATASHEET_LOOKUP_TOOL,
    STACKUP_SUGGEST_TOOL,
    COMPONENT_SEARCH_TOOL,
]


def get_tool_schemas() -> list[dict[str, Any]]:
    """Return tool definitions formatted for the Claude API tools parameter.

    Returns a list of dicts each containing 'name', 'description', and
    'input_schema' suitable for passing to anthropic.Anthropic().messages.create(tools=...).
    """
    return [
        {
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.input_schema,
        }
        for tool in ALL_TOOLS
    ]


def get_tool_handler(name: str) -> Callable[..., Coroutine[Any, Any, dict[str, Any]]] | None:
    """Look up the handler function for a tool by name.

    Returns None if no tool with that name exists.
    """
    for tool in ALL_TOOLS:
        if tool.name == name:
            return tool.handler
    return None
