"""Routing Critic agent -- critiques actual routed boards, not intent.

Runs AFTER the C++ solver produces routed traces. Analyzes the ACTUAL result
against the original RoutingIntent constraints, checking impedance compliance,
via budgets, length matching, reference plane continuity, congestion,
clearance violations, and differential pair skew.

Uses task_type="routing_critic" for VRAM-aware model selection via LLMRouter.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result data classes
# ---------------------------------------------------------------------------


@dataclass
class CritiqueResult:
    """Result of a routing critique analysis."""

    findings: list[dict[str, Any]] = field(default_factory=list)
    # Each finding: {category, severity, net, layer, message, recommendation}
    score: float = 100.0  # 0-100 quality score
    critical_count: int = 0
    warning_count: int = 0
    info_count: int = 0
    passed: bool = True


# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

ROUTING_CRITIC_PROMPT = """You are a PCB routing quality critic for RouteAI EDA.

You have received the ACTUAL routed board output from the solver. Analyze it against the original RoutingIntent constraints.

Check for:
1. IMPEDANCE VIOLATIONS: Is trace width correct for the impedance target? Use the impedance_calc tool.
2. VIA BUDGET: Does any net exceed its max_vias_per_net limit?
3. LENGTH MATCHING: Is skew within max_skew_mm for each length group?
4. REFERENCE PLANE: Do any signals cross a split in their reference plane?
5. CONGESTION: Are there routing bottlenecks or tangled areas?
6. CLEARANCE: Do any traces violate minimum clearance to other nets?
7. DIFFERENTIAL PAIRS: Is intra-pair skew within tolerance?

For each finding, provide:
- category: impedance|via_budget|length_matching|reference_plane|congestion|clearance|diff_pair
- severity: critical|warning|info
- net: affected net name
- layer: affected layer
- message: what's wrong
- recommendation: how to fix it

OUTPUT: JSON object with "findings" array and "score" (0-100).
Score deductions: critical = -15 per finding, warning = -5, info = -1.
"""


# ---------------------------------------------------------------------------
# Routing Critic agent
# ---------------------------------------------------------------------------


class RoutingCritic:
    """Critiques a routed board against the original RoutingIntent.

    This agent runs AFTER the C++ solver has produced actual routed traces.
    It compares the solver output (trace widths, via counts, trace lengths,
    layer usage) against the intent constraints (impedance targets, via
    budgets, length matching groups) and produces a scored critique.

    Args:
        llm_router: LLMRouter instance for VRAM-aware model selection.
    """

    def __init__(self, llm_router: Any) -> None:
        self._router = llm_router

    async def critique(
        self,
        routed_board: dict[str, Any],
        routing_intent: dict[str, Any],
        tool_schemas: list[dict[str, Any]] | None = None,
    ) -> CritiqueResult:
        """Critique an actual routed board against the original intent.

        Args:
            routed_board: Serialized routed board from the solver. Expected
                keys: ``nets`` (list of net dicts with ``name``, ``traces``,
                ``vias``), ``layer_usage``, ``congestion_map``.
            routing_intent: Serialized RoutingIntent dict with net classes,
                length matching groups, via budgets, and layer assignments.
            tool_schemas: Optional tool schemas to pass to the LLM for
                impedance calculation. Defaults to impedance_calc + clearance.

        Returns:
            CritiqueResult with findings, quality score, and pass/fail.
        """
        context = self._build_context(routed_board, routing_intent)

        if tool_schemas is None:
            tool_schemas = self._default_tool_schemas()

        response = await self._router.generate(
            messages=[{"role": "user", "content": context}],
            system=ROUTING_CRITIC_PROMPT,
            tools=tool_schemas,
            task_type="routing_critic",
        )

        return self._parse_response(response.text)

    # ------------------------------------------------------------------
    # Context building
    # ------------------------------------------------------------------

    def _build_context(
        self,
        routed_board: dict[str, Any],
        routing_intent: dict[str, Any],
    ) -> str:
        """Build a concise context string from the routed board and intent.

        Extracts per-net trace lengths, via counts, layer usage, and trace
        widths from the routed board, plus impedance targets, length groups,
        via budgets, and clearance rules from the routing intent. Keeps the
        output under ~2000 tokens so the 14B model has room to reason.
        """
        parts: list[str] = []

        # -- ROUTED BOARD SUMMARY --
        parts.append("## ROUTED BOARD (actual solver output)")

        # Per-net summary: trace lengths, via counts, widths, layers
        nets = routed_board.get("nets", [])
        if nets:
            parts.append(f"Total nets: {len(nets)}")
            net_summaries: list[str] = []
            for net in nets[:60]:  # Cap at 60 nets for token budget
                name = net.get("name", net.get("net_name", "?"))
                traces = net.get("traces", [])
                vias = net.get("vias", [])

                # Aggregate trace length across all segments
                total_length_mm = 0.0
                widths: set[float] = set()
                layers_used: set[str] = set()
                for trace in traces:
                    segments = trace.get("segments", [])
                    layer = trace.get("layer", "?")
                    layers_used.add(layer)
                    for seg in segments:
                        length = seg.get("length_mm", 0.0)
                        if not length:
                            # Compute from start/end if length not provided
                            sx = seg.get("start_x", seg.get("x1", 0.0))
                            sy = seg.get("start_y", seg.get("y1", 0.0))
                            ex = seg.get("end_x", seg.get("x2", 0.0))
                            ey = seg.get("end_y", seg.get("y2", 0.0))
                            dx = ex - sx
                            dy = ey - sy
                            length = (dx * dx + dy * dy) ** 0.5
                        total_length_mm += length
                        w = seg.get("width", seg.get("width_mm", 0.0))
                        if w:
                            widths.add(round(w, 3))

                via_count = len(vias)
                width_str = "/".join(f"{w:.3f}" for w in sorted(widths)) if widths else "?"
                layer_str = ",".join(sorted(layers_used)) if layers_used else "?"
                net_summaries.append(
                    f"- {name}: length={total_length_mm:.2f}mm, "
                    f"vias={via_count}, widths=[{width_str}]mm, "
                    f"layers=[{layer_str}]"
                )

            parts.append("\n".join(net_summaries))
            if len(nets) > 60:
                parts.append(f"... and {len(nets) - 60} more nets")
        else:
            parts.append("No net data available in routed board.")

        # Global layer usage
        layer_usage = routed_board.get("layer_usage", {})
        if layer_usage:
            parts.append("\nLayer utilization:")
            for layer, pct in layer_usage.items():
                parts.append(f"  {layer}: {pct}%")

        # Congestion map
        congestion = routed_board.get("congestion_map", {})
        if congestion:
            hot_spots = {k: v for k, v in congestion.items() if v > 0.6}
            if hot_spots:
                parts.append(
                    f"\nCongestion hot spots (>60%): "
                    f"{json.dumps(hot_spots, default=str)}"
                )

        # -- ORIGINAL INTENT CONSTRAINTS --
        parts.append("\n## ORIGINAL ROUTING INTENT (constraints to check against)")

        # Net class impedance targets and clearances
        net_classes = routing_intent.get("net_classes", [])
        if net_classes:
            parts.append("### Net Classes")
            for nc in net_classes:
                nc_name = nc.get("name", "?")
                nc_nets = nc.get("nets", [])
                width = nc.get("width_mm", "?")
                clearance = nc.get("clearance_mm", "?")
                impedance = nc.get("impedance")
                via_strat = nc.get("via_strategy")
                diff_pair = nc.get("differential_pair")
                length_match = nc.get("length_matching")

                line = f"- {nc_name} (nets: {', '.join(nc_nets[:8])}): width={width}mm, clearance={clearance}mm"
                if impedance:
                    z_type = impedance.get("type", "?")
                    z_target = impedance.get("target_ohm", "?")
                    z_tol = impedance.get("tolerance_percent", 10)
                    line += f", Z={z_target}ohm({z_type}, +/-{z_tol}%)"
                if via_strat:
                    max_vias = via_strat.get("max_vias_per_net", "?")
                    line += f", max_vias={max_vias}"
                if diff_pair:
                    skew = diff_pair.get("max_intra_pair_skew_mm", "?")
                    line += f", diff_pair_skew<={skew}mm"
                if length_match:
                    group = length_match.get("group", "?")
                    max_skew = length_match.get("max_skew_mm", "?")
                    line += f", length_group={group}(skew<={max_skew}mm)"
                parts.append(line)

        # Layer assignments
        layer_assign = routing_intent.get("layer_assignment")
        if layer_assign:
            sig_layers = layer_assign.get("signal_layers", [])
            ref_planes = layer_assign.get("reference_planes", {})
            if sig_layers:
                parts.append(f"\nSignal layers: {', '.join(sig_layers)}")
            if ref_planes:
                parts.append(f"Reference planes: {json.dumps(ref_planes)}")

        # Voltage drop targets
        vd_targets = routing_intent.get("voltage_drop_targets", [])
        if vd_targets:
            parts.append("\n### Voltage Drop Targets")
            for vd in vd_targets:
                net = vd.get("net", "?")
                max_drop = vd.get("max_drop_mv", "?")
                min_width = vd.get("min_trace_width_mm", "?")
                parts.append(
                    f"- {net}: max_drop={max_drop}mV, min_width={min_width}mm"
                )

        parts.append(
            "\nAnalyze the routed board against these constraints. "
            "Report ALL violations found. Respond with ONLY a JSON object "
            "containing 'findings' array and 'score' (0-100)."
        )

        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Response parsing
    # ------------------------------------------------------------------

    def _parse_response(self, text: str) -> CritiqueResult:
        """Parse the LLM response text into a CritiqueResult.

        Handles markdown code fences and extracts the JSON object.
        Counts severities and computes the quality score based on findings.
        """
        parsed = self._extract_json(text)

        findings = parsed.get("findings", [])
        llm_score = parsed.get("score")

        # Normalize findings and count severities
        normalized: list[dict[str, Any]] = []
        critical_count = 0
        warning_count = 0
        info_count = 0

        valid_categories = {
            "impedance", "via_budget", "length_matching",
            "reference_plane", "congestion", "clearance", "diff_pair",
        }
        valid_severities = {"critical", "warning", "info"}

        for f in findings:
            if not isinstance(f, dict):
                continue

            category = f.get("category", "unknown")
            if category not in valid_categories:
                category = "unknown"

            severity = f.get("severity", "info")
            if severity not in valid_severities:
                severity = "info"

            if severity == "critical":
                critical_count += 1
            elif severity == "warning":
                warning_count += 1
            else:
                info_count += 1

            normalized.append({
                "category": category,
                "severity": severity,
                "net": f.get("net", ""),
                "layer": f.get("layer", ""),
                "message": f.get("message", ""),
                "recommendation": f.get("recommendation", ""),
            })

        # Compute score: start at 100, deduct per finding
        computed_score = 100.0 - (critical_count * 15) - (warning_count * 5) - (info_count * 1)
        computed_score = max(0.0, min(100.0, computed_score))

        # Use LLM-provided score if it seems reasonable, else use computed
        if llm_score is not None:
            try:
                llm_score = float(llm_score)
                if 0.0 <= llm_score <= 100.0:
                    # Average the LLM score with computed score for balance
                    final_score = (llm_score + computed_score) / 2.0
                else:
                    final_score = computed_score
            except (TypeError, ValueError):
                final_score = computed_score
        else:
            final_score = computed_score

        passed = critical_count == 0

        return CritiqueResult(
            findings=normalized,
            score=round(final_score, 1),
            critical_count=critical_count,
            warning_count=warning_count,
            info_count=info_count,
            passed=passed,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_json(text: str) -> dict[str, Any]:
        """Extract a JSON object from LLM text, handling markdown fences."""
        cleaned = text.strip()

        # Strip markdown code fences if present
        if cleaned.startswith("```"):
            first_newline = cleaned.find("\n")
            if first_newline != -1:
                cleaned = cleaned[first_newline + 1:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]

        cleaned = cleaned.strip()

        try:
            result = json.loads(cleaned)
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

        # Try to find JSON object boundaries
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                result = json.loads(cleaned[start:end + 1])
                if isinstance(result, dict):
                    return result
            except json.JSONDecodeError:
                pass

        logger.warning("RoutingCritic: Failed to parse JSON from LLM output")
        return {"findings": [], "score": 0, "_parse_error": text[:200]}

    @staticmethod
    def _default_tool_schemas() -> list[dict[str, Any]]:
        """Return minimal tool schemas for impedance_calc and clearance_lookup.

        These are the most relevant tools for routing critique. We define them
        inline to avoid circular imports with the tools module.
        """
        return [
            {
                "name": "impedance_calc",
                "description": (
                    "Calculate transmission line impedance for a given PCB stackup. "
                    "Returns Z0 for microstrip or stripline topologies."
                ),
                "input_schema": {
                    "type": "object",
                    "required": ["trace_width_mm", "dielectric_height_mm", "dielectric_constant"],
                    "properties": {
                        "trace_width_mm": {
                            "type": "number",
                            "description": "Trace width in mm",
                        },
                        "dielectric_height_mm": {
                            "type": "number",
                            "description": "Dielectric height to reference plane in mm",
                        },
                        "dielectric_constant": {
                            "type": "number",
                            "description": "Relative permittivity (Er)",
                        },
                        "topology": {
                            "type": "string",
                            "enum": ["microstrip", "stripline"],
                            "default": "microstrip",
                        },
                        "spacing_mm": {
                            "type": ["number", "null"],
                            "description": "Differential pair spacing in mm",
                        },
                    },
                },
            },
            {
                "name": "clearance_lookup",
                "description": (
                    "Look up IPC-2221B minimum clearance for a given voltage."
                ),
                "input_schema": {
                    "type": "object",
                    "required": ["voltage_v"],
                    "properties": {
                        "voltage_v": {
                            "type": "number",
                            "description": "Peak voltage between conductors in volts",
                        },
                        "condition": {
                            "type": "string",
                            "enum": ["B1", "B2", "B3", "B4"],
                            "default": "B1",
                        },
                    },
                },
            },
        ]
