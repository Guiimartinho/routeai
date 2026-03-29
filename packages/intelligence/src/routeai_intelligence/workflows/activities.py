"""Temporal activity implementations for RouteAI workflows.

Each activity wraps a call to the appropriate service module, providing
structured inputs/outputs and proper error handling for the Temporal runtime.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from temporalio import activity

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes for activity inputs / outputs
# ---------------------------------------------------------------------------

@dataclass
class ParseProjectInput:
    project_id: str
    file_path: str
    file_format: str  # "kicad", "eagle", "altium"


@dataclass
class ParseProjectOutput:
    project_id: str
    board_outline: dict[str, Any]
    components: list[dict[str, Any]]
    nets: list[dict[str, Any]]
    layer_count: int


@dataclass
class DRCInput:
    project_id: str
    board_data: dict[str, Any]
    rule_set: str  # "default", "ipc_class_2", "ipc_class_3"


@dataclass
class DRCOutput:
    project_id: str
    violations: list[dict[str, Any]]
    warnings: list[dict[str, Any]]
    passed: bool
    summary: str


@dataclass
class LLMReviewInput:
    project_id: str
    board_data: dict[str, Any]
    drc_results: dict[str, Any]
    review_scope: list[str]  # e.g. ["power_integrity", "signal_integrity", "thermal"]


@dataclass
class LLMReviewOutput:
    project_id: str
    findings: list[dict[str, Any]]
    suggestions: list[dict[str, Any]]
    confidence_scores: dict[str, float]
    token_usage: dict[str, int]


@dataclass
class PhysicsChecksInput:
    project_id: str
    board_data: dict[str, Any]
    check_types: list[str]  # e.g. ["impedance", "thermal", "current_capacity"]


@dataclass
class PhysicsChecksOutput:
    project_id: str
    impedance_results: list[dict[str, Any]]
    thermal_results: list[dict[str, Any]]
    current_capacity_results: list[dict[str, Any]]
    all_passed: bool


@dataclass
class MergeReportsInput:
    project_id: str
    drc_results: dict[str, Any]
    llm_review: dict[str, Any]
    physics_results: dict[str, Any]


@dataclass
class MergeReportsOutput:
    project_id: str
    merged_report: dict[str, Any]
    overall_score: float
    critical_issues: int
    warnings: int


@dataclass
class GenerateStrategyInput:
    project_id: str
    board_data: dict[str, Any]
    constraints: dict[str, Any]
    previous_attempt: dict[str, Any] | None


@dataclass
class GenerateStrategyOutput:
    project_id: str
    strategy: dict[str, Any]
    estimated_completion_pct: float


@dataclass
class ExecuteRoutingInput:
    project_id: str
    board_data: dict[str, Any]
    strategy: dict[str, Any]


@dataclass
class ExecuteRoutingOutput:
    project_id: str
    routed_board: dict[str, Any]
    completion_pct: float
    unrouted_nets: list[str]


# ---------------------------------------------------------------------------
# Activity implementations
# ---------------------------------------------------------------------------

@activity.defn
async def parse_project(input: ParseProjectInput) -> ParseProjectOutput:
    """Parse a PCB project file into structured board data."""
    logger.info("Parsing project %s from %s (%s)", input.project_id, input.file_path, input.file_format)

    from routeai_intelligence.sync import kicad_parser  # type: ignore[import-untyped]

    parser_map = {
        "kicad": kicad_parser.parse_kicad,
    }
    parse_fn = parser_map.get(input.file_format)
    if parse_fn is None:
        raise ValueError(f"Unsupported file format: {input.file_format}")

    activity.heartbeat(f"Parsing {input.file_format} file")
    result = await parse_fn(input.file_path)

    return ParseProjectOutput(
        project_id=input.project_id,
        board_outline=result.get("board_outline", {}),
        components=result.get("components", []),
        nets=result.get("nets", []),
        layer_count=result.get("layer_count", 2),
    )


@activity.defn
async def run_drc(input: DRCInput) -> DRCOutput:
    """Run Design Rule Check on board data."""
    logger.info("Running DRC on project %s with rule set %s", input.project_id, input.rule_set)

    from routeai_intelligence.agent.tools import execute_tool  # type: ignore[import-untyped]

    activity.heartbeat("Running DRC checks")
    result = await execute_tool(
        "drc_check",
        board_data=input.board_data,
        rule_set=input.rule_set,
    )

    violations = result.get("violations", [])
    warnings = result.get("warnings", [])

    return DRCOutput(
        project_id=input.project_id,
        violations=violations,
        warnings=warnings,
        passed=len(violations) == 0,
        summary=f"{len(violations)} violations, {len(warnings)} warnings",
    )


@activity.defn
async def run_llm_review(input: LLMReviewInput) -> LLMReviewOutput:
    """Run LLM-powered design review."""
    logger.info("Running LLM review on project %s, scope: %s", input.project_id, input.review_scope)

    from routeai_intelligence.agent.core import RouteAIAgent  # type: ignore[import-untyped]
    from routeai_intelligence.agent.schematic_reviewer import SchematicReviewer  # type: ignore[import-untyped]

    activity.heartbeat("Initializing LLM reviewer")
    reviewer = SchematicReviewer()

    activity.heartbeat("Running LLM analysis")
    result = await reviewer.review(
        board_data=input.board_data,
        drc_results=input.drc_results,
        scope=input.review_scope,
    )

    return LLMReviewOutput(
        project_id=input.project_id,
        findings=result.get("findings", []),
        suggestions=result.get("suggestions", []),
        confidence_scores=result.get("confidence_scores", {}),
        token_usage=result.get("token_usage", {"prompt": 0, "completion": 0}),
    )


@activity.defn
async def run_physics_checks(input: PhysicsChecksInput) -> PhysicsChecksOutput:
    """Run physics/electrical checks (impedance, thermal, current capacity)."""
    logger.info("Running physics checks on project %s: %s", input.project_id, input.check_types)

    from routeai_intelligence.agent.tools import execute_tool  # type: ignore[import-untyped]

    impedance_results: list[dict[str, Any]] = []
    thermal_results: list[dict[str, Any]] = []
    current_results: list[dict[str, Any]] = []

    if "impedance" in input.check_types:
        activity.heartbeat("Calculating impedance")
        imp = await execute_tool("impedance_calc", board_data=input.board_data)
        impedance_results = imp.get("results", [])

    if "thermal" in input.check_types:
        activity.heartbeat("Running thermal analysis")
        therm = await execute_tool("thermal_check", board_data=input.board_data)
        thermal_results = therm.get("results", [])

    if "current_capacity" in input.check_types:
        activity.heartbeat("Checking current capacity")
        curr = await execute_tool("current_capacity", board_data=input.board_data)
        current_results = curr.get("results", [])

    all_passed = (
        all(r.get("passed", True) for r in impedance_results)
        and all(r.get("passed", True) for r in thermal_results)
        and all(r.get("passed", True) for r in current_results)
    )

    return PhysicsChecksOutput(
        project_id=input.project_id,
        impedance_results=impedance_results,
        thermal_results=thermal_results,
        current_capacity_results=current_results,
        all_passed=all_passed,
    )


@activity.defn
async def merge_reports(input: MergeReportsInput) -> MergeReportsOutput:
    """Merge DRC, LLM review, and physics check results into a unified report."""
    logger.info("Merging reports for project %s", input.project_id)

    activity.heartbeat("Merging reports")

    drc_violations = input.drc_results.get("violations", [])
    llm_findings = input.llm_review.get("findings", [])
    physics_impedance = input.physics_results.get("impedance_results", [])
    physics_thermal = input.physics_results.get("thermal_results", [])
    physics_current = input.physics_results.get("current_capacity_results", [])

    critical_issues = 0
    warning_count = 0

    for v in drc_violations:
        if v.get("severity") == "critical":
            critical_issues += 1
        else:
            warning_count += 1

    for f in llm_findings:
        if f.get("severity") == "critical":
            critical_issues += 1
        elif f.get("severity") == "warning":
            warning_count += 1

    for r in physics_impedance + physics_thermal + physics_current:
        if not r.get("passed", True):
            if r.get("severity") == "critical":
                critical_issues += 1
            else:
                warning_count += 1

    total_checks = max(len(drc_violations) + len(llm_findings) + len(physics_impedance) + len(physics_thermal) + len(physics_current), 1)
    passed_checks = total_checks - critical_issues - warning_count
    overall_score = round(max(0.0, min(100.0, (passed_checks / total_checks) * 100)), 1)

    merged_report = {
        "project_id": input.project_id,
        "sections": {
            "drc": input.drc_results,
            "llm_review": input.llm_review,
            "physics": input.physics_results,
        },
        "summary": {
            "overall_score": overall_score,
            "critical_issues": critical_issues,
            "warnings": warning_count,
            "total_checks": total_checks,
        },
    }

    return MergeReportsOutput(
        project_id=input.project_id,
        merged_report=merged_report,
        overall_score=overall_score,
        critical_issues=critical_issues,
        warnings=warning_count,
    )


@activity.defn
async def generate_strategy(input: GenerateStrategyInput) -> GenerateStrategyOutput:
    """Generate or adjust a routing strategy using the LLM routing director."""
    logger.info("Generating routing strategy for project %s", input.project_id)

    from routeai_intelligence.agent.routing_director import RoutingDirector  # type: ignore[import-untyped]

    activity.heartbeat("Generating routing strategy")
    director = RoutingDirector()

    if input.previous_attempt is not None:
        activity.heartbeat("Adjusting strategy based on previous attempt")
        result = await director.adjust_strategy(
            board_data=input.board_data,
            constraints=input.constraints,
            previous_attempt=input.previous_attempt,
        )
    else:
        result = await director.generate_strategy(
            board_data=input.board_data,
            constraints=input.constraints,
        )

    return GenerateStrategyOutput(
        project_id=input.project_id,
        strategy=result.get("strategy", {}),
        estimated_completion_pct=result.get("estimated_completion_pct", 0.0),
    )


@activity.defn
async def execute_routing(input: ExecuteRoutingInput) -> ExecuteRoutingOutput:
    """Execute routing using the C++ router via gRPC."""
    logger.info("Executing routing for project %s", input.project_id)

    from routeai_intelligence.agent.tools import execute_tool  # type: ignore[import-untyped]

    activity.heartbeat("Sending routing job to solver")
    result = await execute_tool(
        "execute_route",
        board_data=input.board_data,
        strategy=input.strategy,
    )

    return ExecuteRoutingOutput(
        project_id=input.project_id,
        routed_board=result.get("routed_board", {}),
        completion_pct=result.get("completion_pct", 0.0),
        unrouted_nets=result.get("unrouted_nets", []),
    )
