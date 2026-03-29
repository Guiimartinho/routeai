"""LLM-powered routing and layout intelligence features (R1-R6).

Provides six major capabilities for PCB routing/layout:
  R1: IntentAwareRouter - Interface-specific constraint generation
  R2: DatasheetConstraintExtractor - Datasheet layout guideline extraction
  R3: SignalFlowFloorplanner - Signal-flow-based floorplan suggestions
  R4: ExplainedReturnPathAnalyzer - Physics-explained return path analysis
  R5: StackupAdvisor - Multi-layer stackup recommendation engine
  R6: BGAFanoutStrategist - BGA escape/fanout planning

All features use a dual-provider LLM pattern (primary: Anthropic Claude,
secondary: configurable fallback) for resilience.
"""

from __future__ import annotations

import json
import logging
import math
import os
from typing import Any

import anthropic
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Dual-provider LLM client
# ---------------------------------------------------------------------------

class _DualProviderLLM:
    """Dual-provider LLM client with automatic fallback.

    Primary provider: Anthropic Claude (structured JSON output).
    Secondary provider: any OpenAI-compatible endpoint (e.g. local vLLM,
    Azure OpenAI, OpenRouter).  When no secondary is configured the
    primary is retried once with a higher temperature.
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        secondary_base_url: str | None = None,
        secondary_api_key: str | None = None,
        secondary_model: str | None = None,
        max_tokens: int = 8192,
        temperature: float = 0.0,
    ) -> None:
        self._primary = anthropic.AsyncAnthropic(
            api_key=anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY"),
        )
        self._primary_model = anthropic_model
        self._max_tokens = max_tokens
        self._temperature = temperature

        # Secondary (OpenAI-compatible) provider
        self._secondary_base_url = secondary_base_url or os.environ.get(
            "ROUTEAI_SECONDARY_LLM_URL"
        )
        self._secondary_api_key = secondary_api_key or os.environ.get(
            "ROUTEAI_SECONDARY_LLM_KEY"
        )
        self._secondary_model = secondary_model or os.environ.get(
            "ROUTEAI_SECONDARY_LLM_MODEL", "gpt-4o"
        )
        self._secondary_client: Any | None = None

    def _ensure_secondary(self) -> Any | None:
        """Lazily initialize the secondary OpenAI-compatible client."""
        if self._secondary_client is not None:
            return self._secondary_client
        if not self._secondary_base_url and not self._secondary_api_key:
            return None
        try:
            import openai  # noqa: F811

            self._secondary_client = openai.AsyncOpenAI(
                api_key=self._secondary_api_key or "unused",
                base_url=self._secondary_base_url,
            )
            return self._secondary_client
        except ImportError:
            logger.debug("openai package not installed; secondary provider unavailable")
            return None

    async def generate(self, system: str, user: str) -> str:
        """Send a prompt and return the text response, with fallback."""
        try:
            return await self._call_primary(system, user)
        except Exception as exc:
            logger.warning("Primary LLM failed: %s – trying secondary", exc)
            return await self._call_secondary(system, user)

    async def _call_primary(self, system: str, user: str) -> str:
        response = await self._primary.messages.create(
            model=self._primary_model,
            max_tokens=self._max_tokens,
            temperature=self._temperature,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        parts: list[str] = []
        for block in response.content:
            if block.type == "text":
                parts.append(block.text)
        return "\n".join(parts)

    async def _call_secondary(self, system: str, user: str) -> str:
        client = self._ensure_secondary()
        if client is not None:
            try:
                resp = await client.chat.completions.create(
                    model=self._secondary_model,
                    max_tokens=self._max_tokens,
                    temperature=self._temperature,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                )
                return resp.choices[0].message.content or ""
            except Exception as exc:
                logger.warning("Secondary LLM also failed: %s – retrying primary", exc)

        # Last-resort: retry primary with slightly raised temperature
        return await self._call_primary(
            system, user
        )


def _parse_json(text: str) -> dict[str, Any]:
    """Extract a JSON object from LLM output, handling markdown fences."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        nl = cleaned.find("\n")
        if nl != -1:
            cleaned = cleaned[nl + 1:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()
    try:
        result = json.loads(cleaned)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            result = json.loads(cleaned[start: end + 1])
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass
    logger.warning("Failed to parse JSON from LLM output")
    return {"_raw_text": text, "_parse_error": "Could not extract valid JSON"}


# ===================================================================
# R1  IntentAwareRouter
# ===================================================================

class RoutingRule(BaseModel):
    rule_id: str = ""
    description: str = ""
    parameter: str = ""
    value: str = ""
    unit: str = ""
    applies_to: list[str] = Field(default_factory=list)
    priority: str = "required"
    citation: str = ""

class DiffPairDef(BaseModel):
    pair_name: str = ""
    positive_net: str = ""
    negative_net: str = ""
    impedance_ohm: float = 0.0
    max_skew_mm: float = 0.0
    max_skew_ps: float = 0.0
    spacing_mm: float = 0.0

class LengthGroupDef(BaseModel):
    group_name: str = ""
    nets: list[str] = Field(default_factory=list)
    tolerance_mm: float = 0.0
    tolerance_ps: float = 0.0
    reference_net: str = ""

class NetClassDef(BaseModel):
    name: str = ""
    nets: list[str] = Field(default_factory=list)
    trace_width_mm: float = 0.0
    clearance_mm: float = 0.0
    impedance_ohm: float = 0.0
    diff_impedance_ohm: float = 0.0

class LayerAssignment(BaseModel):
    net_pattern: str = ""
    layers: list[str] = Field(default_factory=list)
    reason: str = ""

class InterfaceConstraintSet(BaseModel):
    """Complete constraint set for a specific interface standard."""
    interface: str = ""
    standard_ref: str = ""
    net_classes: list[NetClassDef] = Field(default_factory=list)
    diff_pairs: list[DiffPairDef] = Field(default_factory=list)
    length_groups: list[LengthGroupDef] = Field(default_factory=list)
    routing_rules: list[RoutingRule] = Field(default_factory=list)
    layer_assignments: list[LayerAssignment] = Field(default_factory=list)


# -- Embedded spec knowledge used to seed the LLM prompt --

_INTERFACE_SPECS: dict[str, dict[str, Any]] = {
    "DDR4": {
        "standard_ref": "JEDEC JESD79-4C",
        "impedance_se": 40,
        "impedance_diff": 80,
        "clk_impedance_diff": 80,
        "topology": "fly-by (T-branch prohibited)",
        "byte_lane_match_ps": 5,
        "cmd_addr_match_ps": 25,
        "clk_to_dqs_match_ps": 2500,
        "vref_decouple": "100nF within 2mm of VREF pin",
        "dqs_to_dq_match_ps": 2.5,
        "addr_cmd_group": True,
        "fly_by_order": "DIMM0 closest to controller for single-rank",
        "odt_termination": True,
    },
    "DDR5": {
        "standard_ref": "JEDEC JESD79-5B",
        "impedance_se": 34,
        "impedance_diff": 68,
        "clk_impedance_diff": 68,
        "topology": "fly-by, dual-channel per DIMM",
        "byte_lane_match_ps": 3,
        "cmd_addr_match_ps": 20,
        "clk_to_dqs_match_ps": 2000,
        "dqs_to_dq_match_ps": 1.5,
    },
    "USB 3.2 Gen2": {
        "standard_ref": "USB-IF USB 3.2 Rev 1.0",
        "impedance_diff": 90,
        "impedance_se": 45,
        "max_skew_mil": 5,
        "max_skew_ps": 15,
        "ac_coupling_nf": 0.1,
        "ac_coupling_placement": "within 10mm of transmitter",
        "guard_traces": True,
        "guard_trace_gnd": True,
        "max_trace_length_mm": 150,
        "max_via_count": 2,
        "min_spacing_to_other_mm": 0.25,
    },
    "USB 2.0": {
        "standard_ref": "USB-IF USB 2.0 Specification",
        "impedance_diff": 90,
        "impedance_se": 45,
        "max_skew_mil": 5,
        "max_trace_length_mm": 200,
    },
    "USB4": {
        "standard_ref": "USB-IF USB4 Version 2.0",
        "impedance_diff": 85,
        "impedance_se": 42.5,
        "max_skew_mil": 3,
        "max_skew_ps": 5,
        "ac_coupling_nf": 0.1,
        "guard_traces": True,
        "max_via_count": 2,
        "retimer_spacing_mm": 100,
    },
    "PCIe Gen4": {
        "standard_ref": "PCI Express Base Spec 4.0",
        "impedance_diff": 85,
        "impedance_se": 42.5,
        "max_skew_mil": 5,
        "max_skew_ps": 8,
        "ac_coupling_nf": 0.1,
        "max_trace_length_mm": 200,
        "guard_traces": True,
        "refclk_impedance_diff": 85,
        "refclk_max_skew_ps": 5,
        "lane_to_lane_match_mm": 12.7,
    },
    "PCIe Gen5": {
        "standard_ref": "PCI Express Base Spec 5.0",
        "impedance_diff": 85,
        "impedance_se": 42.5,
        "max_skew_mil": 3,
        "max_skew_ps": 5,
        "ac_coupling_nf": 0.1,
        "max_trace_length_mm": 150,
        "guard_traces": True,
        "lane_to_lane_match_mm": 10,
    },
    "MIPI DSI": {
        "standard_ref": "MIPI Alliance DSI-2 v1.0",
        "impedance_diff": 100,
        "impedance_se": 50,
        "max_skew_ps": 15,
        "max_trace_length_mm": 100,
    },
    "MIPI CSI-2": {
        "standard_ref": "MIPI Alliance CSI-2 v3.0",
        "impedance_diff": 100,
        "impedance_se": 50,
        "max_skew_ps": 15,
        "max_trace_length_mm": 100,
    },
    "HDMI 2.1": {
        "standard_ref": "HDMI Forum HDMI 2.1 Specification",
        "impedance_diff": 100,
        "impedance_se": 50,
        "max_skew_mil": 5,
        "max_skew_ps": 20,
        "ac_coupling_nf": 0.1,
        "guard_traces": True,
        "max_trace_length_mm": 100,
        "lane_to_lane_match_mm": 5,
    },
    "RGMII": {
        "standard_ref": "Reduced Gigabit Media Independent Interface (RGMII) v2.0",
        "impedance_se": 50,
        "max_skew_ps": 50,
        "data_to_clk_skew_ps": 500,
        "max_trace_length_mm": 75,
    },
    "LVDS": {
        "standard_ref": "TIA/EIA-644-A",
        "impedance_diff": 100,
        "impedance_se": 50,
        "max_skew_ps": 50,
    },
    "QSPI": {
        "standard_ref": "JEDEC JESD251",
        "impedance_se": 50,
        "data_to_clk_match_mm": 5,
        "max_trace_length_mm": 50,
    },
}


class IntentAwareRouter:
    """R1: Generates comprehensive interface-specific constraint sets.

    Given an interface type (e.g. "DDR4", "USB 3.2 Gen2") and the
    relevant component list, produces 100-200+ formal constraints covering
    impedance, topology, length matching, layer assignment, and routing
    rules per the governing specification (JEDEC, USB-IF, PCIe, MIPI, etc.).
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        secondary_base_url: str | None = None,
        secondary_api_key: str | None = None,
        secondary_model: str | None = None,
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            anthropic_model=anthropic_model,
            secondary_base_url=secondary_base_url,
            secondary_api_key=secondary_api_key,
            secondary_model=secondary_model,
            max_tokens=16384,
            temperature=0.0,
        )

    async def generate_interface_constraints(
        self,
        interface_type: str,
        components: list,
        params: dict,
    ) -> InterfaceConstraintSet:
        """Generate a full constraint set for the given interface.

        Args:
            interface_type: Standard interface name, e.g. "DDR4",
                "USB 3.2 Gen2", "PCIe Gen4 x4", "HDMI 2.1", "MIPI CSI-2".
            components: List of component dicts with at minimum
                ``{"reference": "U1", "mpn": "...", "pins": [...]}``.
            params: Extra parameters such as ``{"layer_count": 6,
                "stackup": {...}, "net_prefix": "DDR_", ...}``.

        Returns:
            InterfaceConstraintSet with net_classes, diff_pairs,
            length_groups, routing_rules, and layer_assignments.
        """
        # Resolve the closest matching built-in spec
        spec_key = self._resolve_spec(interface_type)
        spec_data = _INTERFACE_SPECS.get(spec_key, {})

        system_prompt = self._build_system_prompt(interface_type, spec_data)
        user_prompt = self._build_user_prompt(
            interface_type, spec_data, components, params
        )

        raw = await self._llm.generate(system_prompt, user_prompt)
        parsed = _parse_json(raw)
        return self._build_constraint_set(parsed, interface_type, spec_data)

    # -- internal helpers ------------------------------------------------

    @staticmethod
    def _resolve_spec(interface_type: str) -> str:
        it_lower = interface_type.lower().strip()
        for key in _INTERFACE_SPECS:
            if key.lower() in it_lower or it_lower in key.lower():
                return key
        # Fuzzy: check for substrings
        for key in _INTERFACE_SPECS:
            for token in key.lower().split():
                if token in it_lower:
                    return key
        return interface_type

    def _build_system_prompt(
        self, interface_type: str, spec_data: dict[str, Any]
    ) -> str:
        return (
            "You are an expert PCB signal-integrity engineer specialising in "
            "high-speed interface routing.  Your task is to generate a COMPLETE "
            "set of routing constraints for a specific interface.\n\n"
            "Rules:\n"
            "1. Output ONLY a JSON object (no markdown, no commentary).\n"
            "2. Every constraint MUST cite the governing specification clause.\n"
            "3. Generate constraints for ALL of these categories:\n"
            "   - net_classes (trace width, clearance, impedance per signal group)\n"
            "   - diff_pairs (every differential pair with impedance, skew)\n"
            "   - length_groups (byte-lane matching, addr/cmd matching, clk groups)\n"
            "   - routing_rules (topology, via limits, guard traces, AC coupling, "
            "termination, decoupling placement, keepouts)\n"
            "   - layer_assignments (which signal groups go on which layers)\n"
            "4. For DDR interfaces, generate per-byte-lane length groups, per-DQS "
            "group rules, address/command bus rules, clock routing rules, "
            "VREF decoupling, ODT, write-leveling margin, read-leveling margin.\n"
            "5. Be exhaustive: a DDR4 interface should produce 200+ rules.\n"
            "6. Use mm for lengths, ohms for impedance, ps for timing.\n\n"
            f"Interface: {interface_type}\n"
            f"Known spec data: {json.dumps(spec_data, indent=2)}\n"
        )

    @staticmethod
    def _build_user_prompt(
        interface_type: str,
        spec_data: dict[str, Any],
        components: list,
        params: dict,
    ) -> str:
        return (
            f"Generate the complete constraint set for a {interface_type} interface "
            f"with these components and parameters.\n\n"
            f"## Components\n```json\n{json.dumps(components, indent=2, default=str)}\n```\n\n"
            f"## Parameters\n```json\n{json.dumps(params, indent=2, default=str)}\n```\n\n"
            "Respond with a JSON object having keys: net_classes, diff_pairs, "
            "length_groups, routing_rules, layer_assignments.  Each routing_rule "
            "must have: rule_id, description, parameter, value, unit, applies_to, "
            "priority, citation."
        )

    def _build_constraint_set(
        self,
        parsed: dict[str, Any],
        interface_type: str,
        spec_data: dict[str, Any],
    ) -> InterfaceConstraintSet:
        net_classes = [
            NetClassDef(**nc) for nc in parsed.get("net_classes", [])
            if isinstance(nc, dict)
        ]
        diff_pairs = [
            DiffPairDef(**dp) for dp in parsed.get("diff_pairs", [])
            if isinstance(dp, dict)
        ]
        length_groups = [
            LengthGroupDef(**lg) for lg in parsed.get("length_groups", [])
            if isinstance(lg, dict)
        ]
        routing_rules = [
            RoutingRule(**rr) for rr in parsed.get("routing_rules", [])
            if isinstance(rr, dict)
        ]
        layer_assignments = [
            LayerAssignment(
                net_pattern=la.get("net_pattern", la.get("signal_group", "")),
                layers=la.get("layers", la.get("signal_layers", [])),
                reason=la.get("reason", ""),
            )
            for la in parsed.get("layer_assignments", [])
            if isinstance(la, dict)
        ]

        # Ensure minimum spec-mandated constraints are present
        routing_rules = self._inject_mandatory_rules(
            routing_rules, interface_type, spec_data
        )

        return InterfaceConstraintSet(
            interface=interface_type,
            standard_ref=spec_data.get("standard_ref", interface_type),
            net_classes=net_classes,
            diff_pairs=diff_pairs,
            length_groups=length_groups,
            routing_rules=routing_rules,
            layer_assignments=layer_assignments,
        )

    @staticmethod
    def _inject_mandatory_rules(
        rules: list[RoutingRule],
        interface_type: str,
        spec_data: dict[str, Any],
    ) -> list[RoutingRule]:
        """Ensure minimum spec-mandated rules are present even if the LLM missed them."""
        existing_params = {(r.parameter, r.applies_to[0] if r.applies_to else "") for r in rules}
        idx = len(rules)

        def _add(param: str, value: str, unit: str, desc: str, citation: str, applies: str = "*") -> None:
            nonlocal idx
            if (param, applies) not in existing_params:
                idx += 1
                rules.append(RoutingRule(
                    rule_id=f"MANDATORY_{idx:03d}",
                    description=desc,
                    parameter=param,
                    value=value,
                    unit=unit,
                    applies_to=[applies],
                    priority="required",
                    citation=citation,
                ))

        std_ref = spec_data.get("standard_ref", interface_type)

        if spec_data.get("impedance_diff"):
            _add(
                "differential_impedance",
                str(spec_data["impedance_diff"]),
                "ohm",
                f"{interface_type} differential impedance target",
                std_ref,
            )
        if spec_data.get("impedance_se"):
            _add(
                "single_ended_impedance",
                str(spec_data["impedance_se"]),
                "ohm",
                f"{interface_type} single-ended impedance target",
                std_ref,
            )
        if spec_data.get("guard_traces"):
            _add(
                "guard_traces",
                "true",
                "",
                f"{interface_type} guard traces on both sides of diff pairs",
                std_ref,
            )
        if spec_data.get("ac_coupling_nf"):
            _add(
                "ac_coupling_capacitance",
                str(spec_data["ac_coupling_nf"]),
                "nF",
                f"{interface_type} AC coupling capacitor value",
                std_ref,
            )
        if spec_data.get("topology"):
            _add(
                "topology",
                str(spec_data["topology"]),
                "",
                f"{interface_type} required routing topology",
                std_ref,
            )

        return rules


# ===================================================================
# R2  DatasheetConstraintExtractor
# ===================================================================

class ExtractedRule(BaseModel):
    rule_text: str = Field(default="", description="Verbatim or near-verbatim text from datasheet")
    formal_constraint: dict[str, Any] = Field(default_factory=dict)
    page_ref: str = Field(default="", description="Page/section reference in the datasheet")
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)

class ExtractedConstraints(BaseModel):
    """Constraints extracted from a component datasheet."""
    component: str = ""
    constraints: list[ExtractedRule] = Field(default_factory=list)
    placement_rules: list[ExtractedRule] = Field(default_factory=list)
    routing_rules: list[ExtractedRule] = Field(default_factory=list)
    thermal_rules: list[ExtractedRule] = Field(default_factory=list)


class DatasheetConstraintExtractor:
    """R2: Extracts formal PCB constraints from component datasheets.

    Reads the layout-guidelines / PCB-design section of a datasheet and
    converts free-text recommendations into formal constraint objects
    with page references and confidence scores.

    Example conversions:
      "Place C21 within 5mm of pin 14"  -> spatial constraint
      "SW node trace min 40mil"         -> width constraint
      "Keep analog ground separate"     -> zone / split-plane constraint
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        secondary_base_url: str | None = None,
        secondary_api_key: str | None = None,
        secondary_model: str | None = None,
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            anthropic_model=anthropic_model,
            secondary_base_url=secondary_base_url,
            secondary_api_key=secondary_api_key,
            secondary_model=secondary_model,
            max_tokens=12288,
            temperature=0.0,
        )

    async def extract_from_datasheet(
        self,
        component_mpn: str,
        board_context: dict,
    ) -> ExtractedConstraints:
        """Extract layout constraints from a component's datasheet.

        Args:
            component_mpn: Manufacturer part number, e.g. "TPS54360B",
                "STM32H743ZI", "AS5600-ASOM".
            board_context: Dict with keys such as ``reference`` (e.g. "U3"),
                ``connected_nets``, ``schematic_block``, ``layer_count``,
                ``datasheet_text`` (optional raw text of the layout section).

        Returns:
            ExtractedConstraints with categorised rules.
        """
        system_prompt = (
            "You are an expert PCB layout engineer.  You will be given a "
            "component MPN and optional datasheet text.  Your job is to "
            "extract EVERY layout guideline and convert each into a formal "
            "constraint.\n\n"
            "Rules:\n"
            "1. Output ONLY a JSON object.\n"
            "2. Top-level keys: component, constraints, placement_rules, "
            "routing_rules, thermal_rules.\n"
            "3. Each rule object has: rule_text, formal_constraint, page_ref, "
            "confidence (0-1).\n"
            "4. formal_constraint is a dict with keys: type, parameter, "
            "value, unit, applies_to (list of references/nets).\n"
            "5. type is one of: spatial, width, clearance, impedance, "
            "thermal_via, copper_pour, keepout, decoupling, orientation, "
            "component_placement, trace_length, current_capacity.\n"
            "6. If you know the datasheet well, cite specific page numbers.  "
            "Otherwise use section names (e.g. 'Layout Guidelines').\n"
            "7. Set confidence lower (<0.7) when you are inferring rather "
            "than reading a specific datasheet statement.\n"
            "8. Always generate placement rules for decoupling capacitors, "
            "thermal pad connections, and power trace widths.\n"
        )

        datasheet_text = board_context.get("datasheet_text", "")
        reference = board_context.get("reference", "")
        connected_nets = board_context.get("connected_nets", [])

        user_prompt = (
            f"Component MPN: {component_mpn}\n"
            f"Board reference: {reference}\n"
            f"Connected nets: {json.dumps(connected_nets, default=str)}\n"
            f"Layer count: {board_context.get('layer_count', 'unknown')}\n\n"
        )

        if datasheet_text:
            user_prompt += (
                f"## Datasheet Layout Section\n```\n{datasheet_text}\n```\n\n"
            )
        else:
            user_prompt += (
                "No raw datasheet text provided.  Use your knowledge of "
                f"the {component_mpn} datasheet to extract layout guidelines.  "
                "Mark confidence accordingly.\n\n"
            )

        user_prompt += (
            "Extract ALL layout constraints as JSON.  Include placement, "
            "routing, and thermal rules."
        )

        raw = await self._llm.generate(system_prompt, user_prompt)
        parsed = _parse_json(raw)
        return self._build_result(parsed, component_mpn, reference)

    @staticmethod
    def _build_result(
        parsed: dict[str, Any],
        component_mpn: str,
        reference: str,
    ) -> ExtractedConstraints:
        def _rules(key: str) -> list[ExtractedRule]:
            items: list[ExtractedRule] = []
            for r in parsed.get(key, []):
                if not isinstance(r, dict):
                    continue
                items.append(ExtractedRule(
                    rule_text=r.get("rule_text", ""),
                    formal_constraint=r.get("formal_constraint", {}),
                    page_ref=r.get("page_ref", ""),
                    confidence=float(r.get("confidence", 0.7)),
                ))
            return items

        return ExtractedConstraints(
            component=parsed.get("component", component_mpn),
            constraints=_rules("constraints"),
            placement_rules=_rules("placement_rules"),
            routing_rules=_rules("routing_rules"),
            thermal_rules=_rules("thermal_rules"),
        )


# ===================================================================
# R3  SignalFlowFloorplanner
# ===================================================================

class FloorplanZone(BaseModel):
    name: str = ""
    bounds: dict[str, float] = Field(
        default_factory=dict,
        description="Bounding box: x_min, y_min, x_max, y_max (mm)",
    )
    purpose: str = ""
    components: list[str] = Field(default_factory=list)
    signal_flow_direction: str = Field(
        default="",
        description="Primary signal flow direction, e.g. 'left_to_right', 'top_to_bottom'",
    )

class ComponentAssignment(BaseModel):
    reference: str = ""
    zone: str = ""
    reason: str = ""
    placement_priority: int = Field(default=5, ge=1, le=10)

class FloorplanSuggestion(BaseModel):
    """Suggested floorplan based on signal flow analysis."""
    zones: list[FloorplanZone] = Field(default_factory=list)
    component_assignments: list[ComponentAssignment] = Field(default_factory=list)
    reasoning: list[str] = Field(default_factory=list)
    estimated_wire_length: float = Field(
        default=0.0, description="Estimated total wire length (mm)"
    )


class SignalFlowFloorplanner:
    """R3: Suggests component floorplans based on signal flow analysis.

    Analyses functional blocks and signal flow direction in a schematic
    to suggest physical zones on the PCB with reasoning like:
    "USB connector left -> ESD -> Hub center -> downstream right"
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        secondary_base_url: str | None = None,
        secondary_api_key: str | None = None,
        secondary_model: str | None = None,
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            anthropic_model=anthropic_model,
            secondary_base_url=secondary_base_url,
            secondary_api_key=secondary_api_key,
            secondary_model=secondary_model,
            max_tokens=12288,
            temperature=0.1,
        )

    async def suggest_floorplan(
        self,
        schematic_context: dict,
        board_outline: dict,
    ) -> FloorplanSuggestion:
        """Suggest a component floorplan based on signal flow.

        Args:
            schematic_context: Dict with keys ``components`` (list of
                component dicts), ``nets`` (net list), ``blocks``
                (functional block groupings), ``connectors`` (edge
                connectors with board-edge info).
            board_outline: Dict with ``width_mm``, ``height_mm``,
                ``shape`` (rect/polygon), ``mounting_holes``,
                ``fixed_components`` (components already placed).

        Returns:
            FloorplanSuggestion with zones, assignments, and reasoning.
        """
        system_prompt = (
            "You are an expert PCB layout engineer specialising in component "
            "placement and floorplanning.  Analyze the schematic and board "
            "outline to suggest optimal component placement zones.\n\n"
            "Rules:\n"
            "1. Output ONLY a JSON object.\n"
            "2. Top-level keys: zones, component_assignments, reasoning, "
            "estimated_wire_length.\n"
            "3. Each zone: name, bounds {x_min, y_min, x_max, y_max} in mm, "
            "purpose, components (list of refs), signal_flow_direction.\n"
            "4. Each component_assignment: reference, zone, reason, "
            "placement_priority (1-10).\n"
            "5. reasoning is a list of strings explaining each placement decision.\n"
            "6. Follow these placement principles:\n"
            "   a. Connectors on board edges appropriate to their cable direction.\n"
            "   b. Power input near connector, then regulators, then loads.\n"
            "   c. High-speed ICs centered with short critical paths.\n"
            "   d. Analog sections separated from digital switching noise.\n"
            "   e. Thermal sources away from sensitive analog.\n"
            "   f. Decoupling caps adjacent to their IC.\n"
            "   g. Crystal/oscillator as close as possible to the IC.\n"
            "   h. Signal flow should be unidirectional (no crossing back).\n"
            "   i. Test points accessible on board edge.\n"
            "7. Estimate total wire length summing Manhattan distances between "
            "connected pads based on zone center positions.\n"
        )

        user_prompt = (
            f"## Schematic\n```json\n{json.dumps(schematic_context, indent=2, default=str)}\n```\n\n"
            f"## Board Outline\n```json\n{json.dumps(board_outline, indent=2, default=str)}\n```\n\n"
            "Suggest a floorplan. Place every component into a zone and explain why."
        )

        raw = await self._llm.generate(system_prompt, user_prompt)
        parsed = _parse_json(raw)
        return self._build_suggestion(parsed, board_outline)

    @staticmethod
    def _build_suggestion(
        parsed: dict[str, Any],
        board_outline: dict,
    ) -> FloorplanSuggestion:
        zones = []
        for z in parsed.get("zones", []):
            if not isinstance(z, dict):
                continue
            bounds = z.get("bounds", {})
            if not isinstance(bounds, dict):
                bounds = {}
            zones.append(FloorplanZone(
                name=z.get("name", ""),
                bounds=bounds,
                purpose=z.get("purpose", ""),
                components=z.get("components", []),
                signal_flow_direction=z.get("signal_flow_direction", ""),
            ))

        assignments = []
        for a in parsed.get("component_assignments", []):
            if not isinstance(a, dict):
                continue
            assignments.append(ComponentAssignment(
                reference=a.get("reference", ""),
                zone=a.get("zone", ""),
                reason=a.get("reason", ""),
                placement_priority=max(1, min(10, int(a.get("placement_priority", 5)))),
            ))

        reasoning = parsed.get("reasoning", [])
        if not isinstance(reasoning, list):
            reasoning = [str(reasoning)]

        wire_length = float(parsed.get("estimated_wire_length", 0.0))

        return FloorplanSuggestion(
            zones=zones,
            component_assignments=assignments,
            reasoning=reasoning,
            estimated_wire_length=wire_length,
        )


# ===================================================================
# R4  ExplainedReturnPathAnalyzer
# ===================================================================

class ReturnPathFix(BaseModel):
    description: str = ""
    effort: str = Field(default="medium", description="low, medium, or high")
    effectiveness: str = Field(default="", description="Qualitative effectiveness rating")
    implementation_steps: list[str] = Field(default_factory=list)

class ExplainedReturnPathIssue(BaseModel):
    geometric_data: dict[str, Any] = Field(default_factory=dict)
    frequency_context: dict[str, Any] = Field(default_factory=dict)
    physics_explanation: str = ""
    radiation_estimate: str = ""
    fixes: list[ReturnPathFix] = Field(default_factory=list)

class ExplainedReturnPathReport(BaseModel):
    """Return path analysis with LLM-generated physics explanations."""
    issues: list[ExplainedReturnPathIssue] = Field(default_factory=list)
    summary: str = ""
    overall_risk: str = Field(default="", description="low, medium, high, critical")


class ExplainedReturnPathAnalyzer:
    """R4: Adds physics explanations to solver return-path analysis.

    Takes raw return-path data from the solver's ReturnPathAnalyzer and
    enriches each issue with:
    - Frequency / wavelength context
    - Loop area and radiation estimates
    - EMC impact assessment
    - Ranked fix suggestions with effort/effectiveness
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        secondary_base_url: str | None = None,
        secondary_api_key: str | None = None,
        secondary_model: str | None = None,
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            anthropic_model=anthropic_model,
            secondary_base_url=secondary_base_url,
            secondary_api_key=secondary_api_key,
            secondary_model=secondary_model,
            max_tokens=12288,
            temperature=0.0,
        )

    async def analyze_with_explanation(
        self,
        return_path_data: dict,
        board_context: dict,
    ) -> ExplainedReturnPathReport:
        """Analyze return path issues and add physics explanations.

        Args:
            return_path_data: Serialized ReturnPathReport from the solver,
                containing plane_discontinuities, via_transition_issues,
                and stitching_suggestions.
            board_context: Dict with ``stackup``, ``max_frequency_ghz``,
                ``signal_rise_time_ps``, ``target_emc_class`` (e.g.
                "FCC Class B", "CISPR 32 Class A").

        Returns:
            ExplainedReturnPathReport with physics explanations and fixes.
        """
        # Pre-compute useful physics quantities
        max_freq_ghz = float(board_context.get("max_frequency_ghz", 1.0))
        rise_time_ps = float(board_context.get("signal_rise_time_ps", 500))
        knee_freq_ghz = 0.35 / (rise_time_ps * 1e-3)  # knee frequency in GHz
        wavelength_mm = 300.0 / max(max_freq_ghz, 0.001)  # wavelength in mm (free space)

        physics_context = {
            "max_signal_frequency_ghz": max_freq_ghz,
            "signal_rise_time_ps": rise_time_ps,
            "knee_frequency_ghz": round(knee_freq_ghz, 3),
            "wavelength_mm": round(wavelength_mm, 2),
            "tenth_wavelength_mm": round(wavelength_mm / 10, 2),
            "twentieth_wavelength_mm": round(wavelength_mm / 20, 2),
        }

        system_prompt = (
            "You are an expert EMC/SI engineer.  You will be given return-path "
            "analysis data from a PCB layout tool.  For each issue you must "
            "provide:\n"
            "1. A physics explanation accessible to a mid-level engineer.\n"
            "2. Radiation estimate (qualitative + approximate loop area).\n"
            "3. Multiple fix suggestions ranked by effort/effectiveness.\n\n"
            "Rules:\n"
            "- Output ONLY a JSON object with keys: issues, summary, overall_risk.\n"
            "- Each issue: geometric_data (copy from input), frequency_context "
            "(wavelength, knee freq), physics_explanation (paragraph), "
            "radiation_estimate (string), fixes (list).\n"
            "- Each fix: description, effort (low/medium/high), effectiveness "
            "(string), implementation_steps (list of strings).\n"
            "- overall_risk: low, medium, high, or critical.\n"
            "- Reference equations: loop radiation ~ (area * f^2), "
            "slot antenna resonance when slot_length ~ lambda/2.\n"
            "- Always calculate: loop area = gap_width * trace_to_plane_distance.\n"
            "- If a gap crosses a trace carrying signals with wavelength < 20x gap "
            "length, flag as high risk.\n"
        )

        user_prompt = (
            f"## Physics Context\n```json\n{json.dumps(physics_context, indent=2)}\n```\n\n"
            f"## Return Path Data\n```json\n{json.dumps(return_path_data, indent=2, default=str)}\n```\n\n"
            f"## Board Context\n```json\n{json.dumps(board_context, indent=2, default=str)}\n```\n\n"
            "Analyze every discontinuity and via-transition issue.  Explain the "
            "physics and suggest fixes."
        )

        raw = await self._llm.generate(system_prompt, user_prompt)
        parsed = _parse_json(raw)
        return self._build_report(parsed, physics_context)

    @staticmethod
    def _build_report(
        parsed: dict[str, Any],
        physics_context: dict[str, Any],
    ) -> ExplainedReturnPathReport:
        issues: list[ExplainedReturnPathIssue] = []
        for item in parsed.get("issues", []):
            if not isinstance(item, dict):
                continue
            fixes = []
            for f in item.get("fixes", []):
                if isinstance(f, dict):
                    fixes.append(ReturnPathFix(
                        description=f.get("description", ""),
                        effort=f.get("effort", "medium"),
                        effectiveness=f.get("effectiveness", ""),
                        implementation_steps=f.get("implementation_steps", []),
                    ))
            freq_ctx = item.get("frequency_context", {})
            if not isinstance(freq_ctx, dict):
                freq_ctx = physics_context
            issues.append(ExplainedReturnPathIssue(
                geometric_data=item.get("geometric_data", {}),
                frequency_context=freq_ctx,
                physics_explanation=item.get("physics_explanation", ""),
                radiation_estimate=item.get("radiation_estimate", ""),
                fixes=fixes,
            ))

        return ExplainedReturnPathReport(
            issues=issues,
            summary=parsed.get("summary", ""),
            overall_risk=parsed.get("overall_risk", "medium"),
        )


# ===================================================================
# R5  StackupAdvisor
# ===================================================================

class StackupLayerDetail(BaseModel):
    layer_number: int = 0
    name: str = ""
    type: str = Field(default="", description="signal, ground, power, mixed")
    material: str = ""
    thickness_mm: float = 0.0
    copper_weight_oz: float = 1.0

class StackupOption(BaseModel):
    layer_count: int = 0
    stackup_detail: list[StackupLayerDetail] = Field(default_factory=list)
    achievable_impedances: dict[str, float] = Field(
        default_factory=dict,
        description="Impedance target -> achievable value, e.g. {'50ohm_SE': 49.8, '100ohm_diff': 99.5}",
    )
    estimated_cost_per_board: float = Field(default=0.0, description="USD estimate")
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)

class StackupRecommendation(BaseModel):
    """Stackup recommendation with alternatives and comparison."""
    recommended: StackupOption = Field(default_factory=StackupOption)
    alternatives: list[StackupOption] = Field(default_factory=list)
    comparison_table: list[dict[str, Any]] = Field(default_factory=list)
    reasoning: str = ""


# -- Standard stackup templates --

_STACKUP_TEMPLATES: dict[int, list[dict[str, str]]] = {
    2: [
        {"name": "F.Cu", "type": "signal", "material": "copper"},
        {"name": "core", "type": "dielectric", "material": "FR-4"},
        {"name": "B.Cu", "type": "signal", "material": "copper"},
    ],
    4: [
        {"name": "F.Cu", "type": "signal", "material": "copper"},
        {"name": "prepreg1", "type": "dielectric", "material": "FR-4 prepreg"},
        {"name": "In1.Cu", "type": "ground", "material": "copper"},
        {"name": "core", "type": "dielectric", "material": "FR-4 core"},
        {"name": "In2.Cu", "type": "power", "material": "copper"},
        {"name": "prepreg2", "type": "dielectric", "material": "FR-4 prepreg"},
        {"name": "B.Cu", "type": "signal", "material": "copper"},
    ],
    6: [
        {"name": "F.Cu", "type": "signal", "material": "copper"},
        {"name": "prepreg1", "type": "dielectric", "material": "FR-4 prepreg"},
        {"name": "In1.Cu", "type": "ground", "material": "copper"},
        {"name": "core1", "type": "dielectric", "material": "FR-4 core"},
        {"name": "In2.Cu", "type": "signal", "material": "copper"},
        {"name": "prepreg2", "type": "dielectric", "material": "FR-4 prepreg"},
        {"name": "In3.Cu", "type": "signal", "material": "copper"},
        {"name": "core2", "type": "dielectric", "material": "FR-4 core"},
        {"name": "In4.Cu", "type": "power", "material": "copper"},
        {"name": "prepreg3", "type": "dielectric", "material": "FR-4 prepreg"},
        {"name": "B.Cu", "type": "signal", "material": "copper"},
    ],
    8: [
        {"name": "F.Cu", "type": "signal", "material": "copper"},
        {"name": "prepreg1", "type": "dielectric", "material": "FR-4 prepreg"},
        {"name": "In1.Cu", "type": "ground", "material": "copper"},
        {"name": "core1", "type": "dielectric", "material": "FR-4 core"},
        {"name": "In2.Cu", "type": "signal", "material": "copper"},
        {"name": "prepreg2", "type": "dielectric", "material": "FR-4 prepreg"},
        {"name": "In3.Cu", "type": "power", "material": "copper"},
        {"name": "core2", "type": "dielectric", "material": "FR-4 core"},
        {"name": "In4.Cu", "type": "signal", "material": "copper"},
        {"name": "prepreg3", "type": "dielectric", "material": "FR-4 prepreg"},
        {"name": "In5.Cu", "type": "ground", "material": "copper"},
        {"name": "core3", "type": "dielectric", "material": "FR-4 core"},
        {"name": "In6.Cu", "type": "signal", "material": "copper"},
        {"name": "prepreg4", "type": "dielectric", "material": "FR-4 prepreg"},
        {"name": "B.Cu", "type": "signal", "material": "copper"},
    ],
}

# Rough cost multipliers relative to 2-layer (for 100mm x 100mm, qty 10)
_COST_MULTIPLIERS: dict[int, float] = {
    2: 1.0,
    4: 2.2,
    6: 3.8,
    8: 5.5,
}

_BASE_COST_USD = 5.0  # base price for 2-layer 100x100mm qty 10


class StackupAdvisor:
    """R5: Recommends PCB stackups based on design requirements.

    Evaluates 2/4/6/8 layer options against the design's signal-integrity,
    EMC, power-delivery, and manufacturing requirements.  Calculates
    achievable impedances per candidate and estimates per-board cost.
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        secondary_base_url: str | None = None,
        secondary_api_key: str | None = None,
        secondary_model: str | None = None,
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            anthropic_model=anthropic_model,
            secondary_base_url=secondary_base_url,
            secondary_api_key=secondary_api_key,
            secondary_model=secondary_model,
            max_tokens=12288,
            temperature=0.0,
        )

    async def recommend_stackup(
        self,
        design_requirements: dict,
        budget_constraint: str | None = None,
    ) -> StackupRecommendation:
        """Recommend an optimal stackup for the design.

        Args:
            design_requirements: Dict with keys such as:
                - interfaces: list of interface names ("DDR4", "USB3", ...)
                - max_frequency_ghz: highest signal frequency
                - impedance_targets: {"50ohm_SE": 50, "90ohm_diff": 90, ...}
                - power_rail_count: number of distinct power rails
                - board_area_mm2: total board area
                - component_density: "low", "medium", "high"
                - emc_class: "FCC Class B", etc.
                - controlled_impedance: bool
                - high_speed_net_count: int
                - diff_pair_count: int
            budget_constraint: Optional string like "< $10/board",
                "prototype", "production volume 10k".

        Returns:
            StackupRecommendation with recommended option and alternatives.
        """
        # Pre-compute impedance estimates for each layer count
        candidates = self._build_candidates(design_requirements)

        system_prompt = (
            "You are an expert PCB stackup engineer.  Evaluate stackup "
            "candidates for a design and recommend the best option.\n\n"
            "Rules:\n"
            "1. Output ONLY a JSON object with keys: recommended, alternatives, "
            "comparison_table, reasoning.\n"
            "2. recommended and each alternative: layer_count, stackup_detail "
            "(list of layer dicts), achievable_impedances (dict), "
            "estimated_cost_per_board (float USD), pros (list), cons (list).\n"
            "3. Each stackup_detail layer: layer_number, name, type "
            "(signal/ground/power/mixed), material, thickness_mm, copper_weight_oz.\n"
            "4. comparison_table: list of dicts, one per candidate, with "
            "layer_count, meets_impedance (bool), meets_emc (bool), "
            "routing_capacity (low/medium/high), cost_usd, recommendation.\n"
            "5. Impedance calculations: use IPC-2141 Hammerstad-Jensen.  "
            "For FR-4 er=4.2-4.5.  Standard prepreg ~0.1mm, core ~0.2-0.3mm.\n"
            "6. Consider: signal-to-ground adjacency for impedance control, "
            "symmetric stackup for warp prevention, return path continuity.\n"
            "7. For DDR4/DDR5, minimum 4 layers; for multi-GHz, minimum 6.\n"
            "8. For >4 diff pairs or >2 GHz, prefer 6+ layers.\n"
        )

        user_prompt = (
            f"## Design Requirements\n```json\n"
            f"{json.dumps(design_requirements, indent=2, default=str)}\n```\n\n"
            f"## Pre-computed Candidates\n```json\n"
            f"{json.dumps(candidates, indent=2, default=str)}\n```\n\n"
        )
        if budget_constraint:
            user_prompt += f"## Budget Constraint\n{budget_constraint}\n\n"

        user_prompt += (
            "Evaluate each candidate.  Select the best and explain why.  "
            "Provide full stackup_detail with realistic thicknesses."
        )

        raw = await self._llm.generate(system_prompt, user_prompt)
        parsed = _parse_json(raw)
        return self._build_recommendation(parsed)

    @staticmethod
    def _build_candidates(requirements: dict) -> list[dict[str, Any]]:
        """Build preliminary stackup candidates with estimated impedances."""
        candidates = []
        er = 4.3  # typical FR-4

        for layer_count in (2, 4, 6, 8):
            template = _STACKUP_TEMPLATES.get(layer_count, [])
            cost = _BASE_COST_USD * _COST_MULTIPLIERS.get(layer_count, 1.0)

            # Rough impedance estimates
            # For microstrip (outer layers): Z0 ~ 87/sqrt(er+1.41) * ln(5.98*h / (0.8*w+t))
            # Simplified: with h=0.1mm prepreg, w=0.15mm, t=0.035mm -> ~50 ohm
            if layer_count == 2:
                h_outer = 0.8  # single core
                h_inner = 0.0
            elif layer_count == 4:
                h_outer = 0.1  # prepreg
                h_inner = 0.2  # core
            elif layer_count == 6:
                h_outer = 0.1
                h_inner = 0.15
            else:  # 8
                h_outer = 0.09
                h_inner = 0.12

            # Microstrip Z0 estimate (outer layer)
            w_50 = 0.15  # mm, typical trace width for ~50 ohm
            if h_outer > 0:
                u = w_50 / h_outer
                f_u = 6.0 + (2.0 * math.pi - 6.0) * math.exp(-(30.666 / max(u, 0.01)) ** 0.7528)
                z0_air = (376.73 / (2.0 * math.pi)) * math.log(
                    f_u / max(u, 0.01) + math.sqrt(1.0 + (2.0 / max(u, 0.01)) ** 2)
                )
                er_eff = (er + 1.0) / 2.0 + ((er - 1.0) / 2.0) * (1.0 + 10.0 / max(u, 0.01)) ** -0.555
                z0_se = z0_air / math.sqrt(max(er_eff, 1.0))
            else:
                z0_se = 50.0

            z0_diff = 2.0 * z0_se * (1.0 - 0.48 * math.exp(-0.96 * 0.15 / max(h_outer, 0.01)))

            achievable = {
                "50ohm_SE_outer": round(z0_se, 1),
                "100ohm_diff_outer": round(z0_diff, 1),
            }

            if h_inner > 0:
                # Stripline estimate for inner layers
                b = 2.0 * h_inner
                w_inner = 0.1  # mm
                ratio = 4.0 * b / (math.pi * w_inner) if w_inner > 0 else 100
                z0_strip = (60.0 / math.sqrt(er)) * math.log(max(ratio, 1.01))
                z0_diff_strip = 2.0 * z0_strip * (1.0 - 0.347 * math.exp(-2.90 * 0.15 / b))
                achievable["50ohm_SE_inner"] = round(z0_strip, 1)
                achievable["100ohm_diff_inner"] = round(z0_diff_strip, 1)

            candidates.append({
                "layer_count": layer_count,
                "template": template,
                "estimated_cost_usd": round(cost, 2),
                "achievable_impedances": achievable,
                "signal_layers": sum(1 for l in template if l.get("type") == "signal"),
                "ground_planes": sum(1 for l in template if l.get("type") == "ground"),
                "power_planes": sum(1 for l in template if l.get("type") == "power"),
            })

        return candidates

    @staticmethod
    def _build_recommendation(parsed: dict[str, Any]) -> StackupRecommendation:
        def _parse_option(d: dict[str, Any]) -> StackupOption:
            if not isinstance(d, dict):
                return StackupOption()
            detail = []
            for layer in d.get("stackup_detail", []):
                if isinstance(layer, dict):
                    detail.append(StackupLayerDetail(
                        layer_number=int(layer.get("layer_number", 0)),
                        name=layer.get("name", ""),
                        type=layer.get("type", ""),
                        material=layer.get("material", ""),
                        thickness_mm=float(layer.get("thickness_mm", 0.0)),
                        copper_weight_oz=float(layer.get("copper_weight_oz", 1.0)),
                    ))
            return StackupOption(
                layer_count=int(d.get("layer_count", 0)),
                stackup_detail=detail,
                achievable_impedances=d.get("achievable_impedances", {}),
                estimated_cost_per_board=float(d.get("estimated_cost_per_board", 0.0)),
                pros=d.get("pros", []),
                cons=d.get("cons", []),
            )

        recommended = _parse_option(parsed.get("recommended", {}))
        alternatives = [
            _parse_option(alt)
            for alt in parsed.get("alternatives", [])
            if isinstance(alt, dict)
        ]

        return StackupRecommendation(
            recommended=recommended,
            alternatives=alternatives,
            comparison_table=parsed.get("comparison_table", []),
            reasoning=parsed.get("reasoning", ""),
        )


# ===================================================================
# R6  BGAFanoutStrategist
# ===================================================================

class BallPlan(BaseModel):
    ball_id: str = ""
    net: str = ""
    signal_type: str = Field(
        default="",
        description="power, high_speed_diff, high_speed_se, general_io, nc",
    )
    escape_method: str = Field(
        default="",
        description="via_in_pad, dog_bone, direct, neck_down, skip",
    )
    escape_direction: str = Field(
        default="",
        description="north, south, east, west, down (vertical via only)",
    )
    via_type: str = Field(
        default="",
        description="through, blind, microvia, via_in_pad, none",
    )
    layer_target: str = Field(
        default="",
        description="Target routing layer after escape",
    )

class FanoutPlan(BaseModel):
    """BGA escape / fanout plan."""
    strategy_summary: str = ""
    ball_plans: list[BallPlan] = Field(default_factory=list)
    layer_usage: dict[str, int] = Field(
        default_factory=dict,
        description="Layer name -> number of nets routed on that layer",
    )
    via_count_estimate: int = 0


class BGAFanoutStrategist:
    """R6: Plans BGA escape routing / fanout strategies.

    Classifies each ball by signal type and plans an escape method:
    - Power balls: via-in-pad to internal power/ground planes
    - High-speed differential: matched escape with controlled impedance
    - General I/O: dog-bone fanout
    - NC (no-connect): skip

    Plans escape direction per ball based on board geometry and
    available routing channels.
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        secondary_base_url: str | None = None,
        secondary_api_key: str | None = None,
        secondary_model: str | None = None,
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            anthropic_model=anthropic_model,
            secondary_base_url=secondary_base_url,
            secondary_api_key=secondary_api_key,
            secondary_model=secondary_model,
            max_tokens=16384,
            temperature=0.0,
        )

    async def plan_fanout(
        self,
        component_ref: str,
        ball_map: dict,
        net_types: dict,
        stackup: dict,
    ) -> FanoutPlan:
        """Plan the BGA fanout / escape strategy.

        Args:
            component_ref: Reference designator, e.g. "U1".
            ball_map: Dict mapping ball ID to net name, e.g.
                ``{"A1": "GND", "A2": "VCC", "B1": "DDR_DQ0", ...}``.
                May also include ball position info:
                ``{"A1": {"net": "GND", "x": 0.0, "y": 0.0}}``.
            net_types: Dict classifying nets, e.g.
                ``{"DDR_DQ0": "high_speed_diff", "GND": "power", ...}``.
                Supported types: power, ground, high_speed_diff,
                high_speed_se, general_io, nc.
            stackup: Dict describing available layers, e.g.
                ``{"layers": ["F.Cu", "In1.Cu", ...], "via_types": ["through", "microvia"]}``.

        Returns:
            FanoutPlan with per-ball escape plans and layer usage stats.
        """
        # Pre-classify balls to give the LLM structured input
        classified_balls = self._classify_balls(ball_map, net_types)

        system_prompt = (
            "You are an expert BGA fanout/escape routing engineer.  Plan the "
            "escape strategy for every ball in the BGA.\n\n"
            "Rules:\n"
            "1. Output ONLY a JSON object with keys: strategy_summary, "
            "ball_plans, layer_usage, via_count_estimate.\n"
            "2. Each ball_plan: ball_id, net, signal_type, escape_method, "
            "escape_direction, via_type, layer_target.\n"
            "3. escape_method options: via_in_pad, dog_bone, direct, "
            "neck_down, skip.\n"
            "4. escape_direction: north, south, east, west, down.\n"
            "5. via_type: through, blind, microvia, via_in_pad, none.\n"
            "6. Escape strategy rules:\n"
            "   a. Power/ground balls on outer 2 rows: via_in_pad to internal "
            "plane. Inner power balls: also via_in_pad.\n"
            "   b. Outer ring (rows 1-2): can escape directly on surface layer "
            "using dog-bone or direct trace.\n"
            "   c. Rows 3-4: dog-bone fanout, escape between pads on surface "
            "or use blind via to layer 2.\n"
            "   d. Inner rows (5+): must use via (through/blind/microvia) to "
            "reach inner signal layers.\n"
            "   e. High-speed differential pairs: escape as pair, maintain "
            "spacing, use matched via structures.\n"
            "   f. NC balls: escape_method='skip', via_type='none'.\n"
            "   g. Escape direction should route AWAY from BGA center toward "
            "the nearest board edge or routing channel.\n"
            "7. Distribute signal routing across available layers to avoid "
            "congestion.  Track layer_usage counts.\n"
            "8. Minimize via count while ensuring all balls can escape.\n"
            "9. For 0.8mm pitch BGAs, prefer microvia for inner balls.  "
            "For 1.0mm+, through-hole or blind vias are acceptable.\n"
        )

        user_prompt = (
            f"Component: {component_ref}\n\n"
            f"## Classified Balls\n```json\n"
            f"{json.dumps(classified_balls, indent=2, default=str)}\n```\n\n"
            f"## Stackup\n```json\n"
            f"{json.dumps(stackup, indent=2, default=str)}\n```\n\n"
            f"Total balls: {len(classified_balls)}\n"
            f"Plan the fanout for every ball."
        )

        raw = await self._llm.generate(system_prompt, user_prompt)
        parsed = _parse_json(raw)
        return self._build_plan(parsed, classified_balls)

    @staticmethod
    def _classify_balls(
        ball_map: dict,
        net_types: dict,
    ) -> list[dict[str, Any]]:
        """Pre-classify balls by signal type and position ring."""
        classified: list[dict[str, Any]] = []

        for ball_id, ball_info in ball_map.items():
            if isinstance(ball_info, dict):
                net = ball_info.get("net", "")
                x = ball_info.get("x", 0.0)
                y = ball_info.get("y", 0.0)
            else:
                net = str(ball_info)
                x, y = 0.0, 0.0

            # Determine signal type
            signal_type = net_types.get(net, "")
            if not signal_type:
                net_lower = net.lower()
                if net_lower in ("gnd", "vss", "gnd_d", "agnd", "dgnd"):
                    signal_type = "ground"
                elif any(net_lower.startswith(p) for p in ("vcc", "vdd", "+", "pwr", "v1.", "v3.", "v5.")):
                    signal_type = "power"
                elif net_lower in ("nc", "no_connect", ""):
                    signal_type = "nc"
                else:
                    signal_type = "general_io"

            # Determine BGA ring from ball ID (A=row 1, B=row 2, etc.)
            row_letter = ""
            col_num = 0
            for ch in ball_id:
                if ch.isalpha():
                    row_letter += ch
                elif ch.isdigit():
                    col_num = col_num * 10 + int(ch)

            # Convert row letter to number (A=1, B=2, ..., AA=27)
            row_num = 0
            for ch in row_letter.upper():
                row_num = row_num * 26 + (ord(ch) - ord('A') + 1)

            classified.append({
                "ball_id": ball_id,
                "net": net,
                "signal_type": signal_type,
                "row": row_num,
                "col": col_num,
                "x": x,
                "y": y,
            })

        return classified

    @staticmethod
    def _build_plan(
        parsed: dict[str, Any],
        classified_balls: list[dict[str, Any]],
    ) -> FanoutPlan:
        ball_plans: list[BallPlan] = []
        for bp in parsed.get("ball_plans", []):
            if not isinstance(bp, dict):
                continue
            ball_plans.append(BallPlan(
                ball_id=bp.get("ball_id", ""),
                net=bp.get("net", ""),
                signal_type=bp.get("signal_type", ""),
                escape_method=bp.get("escape_method", ""),
                escape_direction=bp.get("escape_direction", ""),
                via_type=bp.get("via_type", ""),
                layer_target=bp.get("layer_target", ""),
            ))

        # If LLM missed some balls, add defaults
        planned_ids = {bp.ball_id for bp in ball_plans}
        for cb in classified_balls:
            if cb["ball_id"] not in planned_ids:
                sig = cb["signal_type"]
                if sig == "nc":
                    method, via = "skip", "none"
                elif sig in ("power", "ground"):
                    method, via = "via_in_pad", "via_in_pad"
                elif sig in ("high_speed_diff", "high_speed_se"):
                    method = "dog_bone" if cb.get("row", 0) <= 2 else "neck_down"
                    via = "blind" if cb.get("row", 0) > 2 else "none"
                else:
                    method = "dog_bone" if cb.get("row", 0) <= 3 else "dog_bone"
                    via = "through" if cb.get("row", 0) > 2 else "none"

                ball_plans.append(BallPlan(
                    ball_id=cb["ball_id"],
                    net=cb["net"],
                    signal_type=sig,
                    escape_method=method,
                    escape_direction="down" if via != "none" else "east",
                    via_type=via,
                    layer_target="",
                ))

        layer_usage = parsed.get("layer_usage", {})
        if not isinstance(layer_usage, dict):
            layer_usage = {}

        via_count = int(parsed.get("via_count_estimate", 0))
        if via_count == 0:
            via_count = sum(
                1 for bp in ball_plans if bp.via_type not in ("none", "")
            )

        return FanoutPlan(
            strategy_summary=parsed.get("strategy_summary", ""),
            ball_plans=ball_plans,
            layer_usage=layer_usage,
            via_count_estimate=via_count,
        )


# ===================================================================
# Module exports
# ===================================================================

__all__ = [
    # R1
    "IntentAwareRouter",
    "InterfaceConstraintSet",
    "NetClassDef",
    "DiffPairDef",
    "LengthGroupDef",
    "RoutingRule",
    "LayerAssignment",
    # R2
    "DatasheetConstraintExtractor",
    "ExtractedConstraints",
    "ExtractedRule",
    # R3
    "SignalFlowFloorplanner",
    "FloorplanSuggestion",
    "FloorplanZone",
    "ComponentAssignment",
    # R4
    "ExplainedReturnPathAnalyzer",
    "ExplainedReturnPathReport",
    "ExplainedReturnPathIssue",
    "ReturnPathFix",
    # R5
    "StackupAdvisor",
    "StackupRecommendation",
    "StackupOption",
    "StackupLayerDetail",
    # R6
    "BGAFanoutStrategist",
    "FanoutPlan",
    "BallPlan",
]
