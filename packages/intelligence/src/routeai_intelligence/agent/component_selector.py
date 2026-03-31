"""Component Selector - LLM-powered component search, comparison, and circuit suggestion.

Provides intelligent component selection with trade-off analysis, parametric search,
supplier integration, and LLM-assisted circuit topology suggestions.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


class ComponentSuggestion(BaseModel):
    """A suggested component with full specifications."""
    mpn: str = Field(description="Manufacturer part number")
    manufacturer: str = Field(description="Component manufacturer")
    description: str = Field(description="Component description")
    specs: dict[str, Any] = Field(
        default_factory=dict,
        description="Key specifications (voltage, current, tolerance, etc.)",
    )
    footprint: str = Field(description="Recommended footprint")
    package: str = Field(default="", description="Package type (e.g., 0402, SOT-23)")
    price: float | None = Field(default=None, description="Unit price in USD")
    availability: str = Field(
        default="unknown",
        description="Stock status: in_stock, limited, out_of_stock, unknown",
    )
    supplier_links: dict[str, str] = Field(
        default_factory=dict,
        description="Supplier name -> product URL",
    )
    trade_offs: list[str] = Field(
        default_factory=list,
        description="Trade-off notes for this component choice",
    )
    score: float = Field(
        default=0.0,
        description="Relevance/fitness score (0-1)",
    )


class ComparisonResult(BaseModel):
    """Result of comparing multiple components."""
    table: list[dict[str, Any]] = Field(
        description="Comparison table with one row per component",
    )
    parameters_compared: list[str] = Field(
        description="Parameter names used in comparison",
    )
    recommendation: str = Field(
        description="Recommended component MPN",
    )
    rationale: str = Field(
        description="Explanation for the recommendation",
    )
    trade_off_summary: str = Field(
        description="Summary of trade-offs between the compared components",
    )


class CircuitConnection(BaseModel):
    """A connection between components in a suggested circuit."""
    from_component: str = Field(description="Source component reference")
    from_pin: str = Field(description="Source pin name/number")
    to_component: str = Field(description="Destination component reference")
    to_pin: str = Field(description="Destination pin name/number")
    net_name: str = Field(default="", description="Net name for this connection")


class CircuitComponent(BaseModel):
    """A component in a suggested circuit."""
    reference: str = Field(description="Reference designator (e.g., R1, C1)")
    mpn: str = Field(default="", description="Suggested MPN")
    value: str = Field(description="Component value")
    footprint: str = Field(default="", description="Footprint")
    description: str = Field(default="")


class CircuitSuggestion(BaseModel):
    """A complete circuit suggestion with components and connections."""
    name: str = Field(description="Circuit name/title")
    description: str = Field(description="What this circuit does")
    components: list[CircuitComponent] = Field(description="Components in the circuit")
    connections: list[CircuitConnection] = Field(description="Connections between components")
    constraints: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Design constraints for this circuit",
    )
    explanation: str = Field(
        description="Detailed explanation of the circuit design and component selection rationale",
    )
    references: list[str] = Field(
        default_factory=list,
        description="Datasheet and application note references",
    )


# ---------------------------------------------------------------------------
# Built-in component knowledge base
# ---------------------------------------------------------------------------

_KNOWN_COMPONENTS: list[dict[str, Any]] = [
    # Voltage regulators
    {
        "mpn": "AMS1117-3.3",
        "manufacturer": "Advanced Monolithic Systems",
        "category": "voltage_regulator",
        "subcategory": "ldo",
        "description": "3.3V 1A LDO voltage regulator",
        "specs": {"output_voltage": 3.3, "max_current_a": 1.0, "dropout_v": 1.1, "vin_max": 15, "quiescent_ua": 5000},
        "footprint": "SOT-223",
        "package": "SOT-223",
        "price": 0.08,
        "tags": ["ldo", "3.3v", "regulator", "linear"],
    },
    {
        "mpn": "AP2112K-3.3TRG1",
        "manufacturer": "Diodes Inc",
        "category": "voltage_regulator",
        "subcategory": "ldo",
        "description": "3.3V 600mA LDO with low quiescent current",
        "specs": {"output_voltage": 3.3, "max_current_a": 0.6, "dropout_v": 0.25, "vin_max": 6, "quiescent_ua": 55},
        "footprint": "SOT-23-5",
        "package": "SOT-23-5",
        "price": 0.15,
        "tags": ["ldo", "3.3v", "low-dropout", "low-iq"],
    },
    {
        "mpn": "TPS54331",
        "manufacturer": "Texas Instruments",
        "category": "voltage_regulator",
        "subcategory": "buck",
        "description": "3A 28V input step-down converter",
        "specs": {"max_current_a": 3.0, "vin_max": 28, "vin_min": 3.5, "frequency_khz": 570, "efficiency_pct": 95},
        "footprint": "SOIC-8",
        "package": "SOIC-8",
        "price": 1.20,
        "tags": ["buck", "switching", "regulator", "high-current"],
    },
    {
        "mpn": "MP2315",
        "manufacturer": "Monolithic Power Systems",
        "category": "voltage_regulator",
        "subcategory": "buck",
        "description": "1.5A 24V high-efficiency synchronous buck",
        "specs": {"max_current_a": 1.5, "vin_max": 24, "vin_min": 4.5, "frequency_khz": 500, "efficiency_pct": 96},
        "footprint": "SOT-23-8",
        "package": "SOT-23-8",
        "price": 0.80,
        "tags": ["buck", "synchronous", "compact", "high-efficiency"],
    },
    # Capacitors
    {
        "mpn": "CL05B104KO5NNNC",
        "manufacturer": "Samsung",
        "category": "capacitor",
        "subcategory": "mlcc",
        "description": "100nF 16V X5R 0402 MLCC",
        "specs": {"capacitance_nf": 100, "voltage_rating_v": 16, "dielectric": "X5R", "tolerance_pct": 10},
        "footprint": "0402",
        "package": "0402",
        "price": 0.005,
        "tags": ["capacitor", "mlcc", "decoupling", "bypass", "0402"],
    },
    {
        "mpn": "GRM155R61A105KE15D",
        "manufacturer": "Murata",
        "category": "capacitor",
        "subcategory": "mlcc",
        "description": "1uF 10V X5R 0402 MLCC",
        "specs": {"capacitance_nf": 1000, "voltage_rating_v": 10, "dielectric": "X5R", "tolerance_pct": 10},
        "footprint": "0402",
        "package": "0402",
        "price": 0.01,
        "tags": ["capacitor", "mlcc", "bulk", "0402"],
    },
    {
        "mpn": "CL10A106MQ8NNNC",
        "manufacturer": "Samsung",
        "category": "capacitor",
        "subcategory": "mlcc",
        "description": "10uF 6.3V X5R 0603 MLCC",
        "specs": {"capacitance_nf": 10000, "voltage_rating_v": 6.3, "dielectric": "X5R", "tolerance_pct": 20},
        "footprint": "0603",
        "package": "0603",
        "price": 0.02,
        "tags": ["capacitor", "mlcc", "bulk", "input", "output", "0603"],
    },
    # ESD protection
    {
        "mpn": "USBLC6-2SC6",
        "manufacturer": "STMicroelectronics",
        "category": "protection",
        "subcategory": "esd",
        "description": "USB ESD protection, SOT-23-6",
        "specs": {"channels": 2, "vbr_v": 6, "capacitance_pf": 1.0, "ipp_a": 3},
        "footprint": "SOT-23-6",
        "package": "SOT-23-6",
        "price": 0.10,
        "tags": ["esd", "usb", "protection", "tvs"],
    },
    # Resistors
    {
        "mpn": "RC0402FR-0710KL",
        "manufacturer": "Yageo",
        "category": "resistor",
        "subcategory": "chip",
        "description": "10k ohm 1% 0402 thick film resistor",
        "specs": {"resistance_ohm": 10000, "tolerance_pct": 1, "power_w": 0.0625, "temp_coeff_ppm": 100},
        "footprint": "0402",
        "package": "0402",
        "price": 0.003,
        "tags": ["resistor", "10k", "pull-up", "pull-down", "0402"],
    },
    # MCUs
    {
        "mpn": "STM32F103C8T6",
        "manufacturer": "STMicroelectronics",
        "category": "mcu",
        "subcategory": "arm",
        "description": "ARM Cortex-M3 72MHz 64KB Flash MCU",
        "specs": {"core": "Cortex-M3", "flash_kb": 64, "ram_kb": 20, "freq_mhz": 72, "gpio_count": 37, "adc_channels": 10},
        "footprint": "LQFP-48",
        "package": "LQFP-48",
        "price": 2.50,
        "tags": ["mcu", "stm32", "arm", "cortex-m3"],
    },
    {
        "mpn": "ESP32-WROOM-32E",
        "manufacturer": "Espressif",
        "category": "mcu",
        "subcategory": "wireless",
        "description": "Wi-Fi + Bluetooth dual-core MCU module",
        "specs": {"core": "Xtensa LX6", "flash_kb": 4096, "ram_kb": 520, "freq_mhz": 240, "wifi": True, "bluetooth": True},
        "footprint": "ESP32-WROOM-32E",
        "package": "Module",
        "price": 2.80,
        "tags": ["mcu", "esp32", "wifi", "bluetooth", "iot"],
    },
]


# ---------------------------------------------------------------------------
# Main class
# ---------------------------------------------------------------------------


class ComponentSelector:
    """LLM-enhanced component search and selection engine.

    Combines a local knowledge base of common components with optional LLM-powered
    search for detailed parametric queries, trade-off analysis, and circuit suggestions.

    Args:
        agent: Optional RouteAIAgent for LLM-powered deep search and analysis.
    """

    def __init__(self, agent: Any | None = None) -> None:
        self._agent = agent
        self._components = list(_KNOWN_COMPONENTS)

    def register_components(self, components: list[dict[str, Any]]) -> None:
        """Add components to the local knowledge base."""
        self._components.extend(components)

    async def search(
        self,
        query: str,
        category: str | None = None,
        max_results: int = 10,
        filters: dict[str, Any] | None = None,
    ) -> list[ComponentSuggestion]:
        """Search for components matching a query.

        Performs text matching against the local knowledge base, then optionally
        enhances results with LLM analysis for complex queries.

        Args:
            query: Natural language search query (e.g., "low-noise LDO 3.3V 500mA")
            category: Optional category filter
            max_results: Maximum number of results to return
            filters: Additional parametric filters

        Returns:
            List of ComponentSuggestion objects ranked by relevance.
        """
        query_lower = query.lower()
        query_terms = set(re.findall(r'\w+', query_lower))
        results: list[tuple[float, dict[str, Any]]] = []

        for comp in self._components:
            # Category filter
            if category and comp.get("category") != category:
                continue

            # Parametric filters
            if filters:
                skip = False
                specs = comp.get("specs", {})
                for key, value in filters.items():
                    if key in specs:
                        if isinstance(value, (int, float)) and isinstance(specs[key], (int, float)):
                            if specs[key] < value:
                                skip = True
                                break
                    elif key == "package" and comp.get("package", "").lower() != str(value).lower():
                        skip = True
                        break
                if skip:
                    continue

            # Score based on text matching
            score = 0.0
            searchable = (
                comp.get("mpn", "").lower() + " " +
                comp.get("description", "").lower() + " " +
                " ".join(comp.get("tags", []))
            )

            for term in query_terms:
                if term in searchable:
                    score += 1.0
                    # Bonus for MPN match
                    if term in comp.get("mpn", "").lower():
                        score += 2.0

            # Normalize
            if query_terms:
                score = score / (len(query_terms) * 3)

            if score > 0:
                results.append((score, comp))

        # Sort by score descending
        results.sort(key=lambda x: x[0], reverse=True)

        suggestions: list[ComponentSuggestion] = []
        for score, comp in results[:max_results]:
            suggestions.append(ComponentSuggestion(
                mpn=comp.get("mpn", ""),
                manufacturer=comp.get("manufacturer", ""),
                description=comp.get("description", ""),
                specs=comp.get("specs", {}),
                footprint=comp.get("footprint", ""),
                package=comp.get("package", ""),
                price=comp.get("price"),
                availability="in_stock",
                trade_offs=_generate_trade_offs(comp),
                score=round(score, 3),
            ))

        # LLM enhancement for complex queries
        if self._agent is not None and (len(suggestions) < 3 or len(query_terms) > 4):
            suggestions = await self._llm_enhanced_search(query, suggestions, category, filters)

        return suggestions

    async def compare(
        self,
        component_mpns: list[str],
    ) -> ComparisonResult:
        """Compare multiple components side by side.

        Builds a comparison table of key parameters and provides a recommendation
        with trade-off analysis.

        Args:
            component_mpns: List of MPNs to compare.

        Returns:
            ComparisonResult with table, recommendation, and rationale.
        """
        components_data: list[dict[str, Any]] = []
        for mpn in component_mpns:
            for comp in self._components:
                if comp.get("mpn", "").lower() == mpn.lower():
                    components_data.append(comp)
                    break
            else:
                components_data.append({"mpn": mpn, "description": "Not found in local database"})

        if not components_data:
            return ComparisonResult(
                table=[],
                parameters_compared=[],
                recommendation="",
                rationale="No components found for comparison",
                trade_off_summary="No data available",
            )

        # Collect all parameter keys
        all_params: set[str] = set()
        for comp in components_data:
            all_params.update(comp.get("specs", {}).keys())
        all_params_list = sorted(all_params)

        # Build comparison table
        table: list[dict[str, Any]] = []
        for comp in components_data:
            row: dict[str, Any] = {
                "mpn": comp.get("mpn", ""),
                "manufacturer": comp.get("manufacturer", ""),
                "description": comp.get("description", ""),
                "price": comp.get("price"),
                "package": comp.get("package", ""),
            }
            specs = comp.get("specs", {})
            for param in all_params_list:
                row[param] = specs.get(param, "-")
            table.append(row)

        # Determine recommendation using scoring heuristics
        best_mpn = ""
        best_score = -1.0
        scores: dict[str, float] = {}

        for comp in components_data:
            s = 0.0
            specs = comp.get("specs", {})

            # Prefer lower price
            price = comp.get("price")
            if isinstance(price, (int, float)):
                s += max(0, 1.0 - price / 10.0)

            # Prefer higher efficiency
            eff = specs.get("efficiency_pct")
            if isinstance(eff, (int, float)):
                s += eff / 100.0

            # Prefer lower dropout
            dropout = specs.get("dropout_v")
            if isinstance(dropout, (int, float)):
                s += max(0, 1.0 - dropout)

            # Prefer lower quiescent current
            iq = specs.get("quiescent_ua")
            if isinstance(iq, (int, float)):
                s += max(0, 1.0 - iq / 10000.0)

            mpn = comp.get("mpn", "")
            scores[mpn] = s
            if s > best_score:
                best_score = s
                best_mpn = mpn

        # Generate rationale
        if len(components_data) >= 2 and best_mpn:
            rationale_parts: list[str] = [f"{best_mpn} is recommended based on the following:"]
            best_comp = next((c for c in components_data if c.get("mpn") == best_mpn), None)
            if best_comp:
                specs = best_comp.get("specs", {})
                price = best_comp.get("price")
                if price is not None:
                    rationale_parts.append(f"- Competitive price point (${price:.2f})")
                if "efficiency_pct" in specs:
                    rationale_parts.append(f"- Efficiency: {specs['efficiency_pct']}%")
                if "dropout_v" in specs:
                    rationale_parts.append(f"- Low dropout voltage: {specs['dropout_v']}V")
                if "quiescent_ua" in specs:
                    rationale_parts.append(f"- Quiescent current: {specs['quiescent_ua']}uA")

            rationale = "\n".join(rationale_parts)
        else:
            rationale = "Insufficient data for detailed comparison"

        # Trade-off summary
        trade_off_parts: list[str] = []
        for comp in components_data:
            mpn = comp.get("mpn", "")
            toffs = _generate_trade_offs(comp)
            if toffs:
                trade_off_parts.append(f"{mpn}: {'; '.join(toffs)}")

        trade_off_summary = "\n".join(trade_off_parts) if trade_off_parts else "No significant trade-offs identified"

        # LLM-enhanced comparison
        if self._agent is not None:
            try:
                response = await self._agent.chat(
                    f"Compare these components and provide a recommendation:\n"
                    f"{json.dumps(table, indent=2, default=str)}\n\n"
                    f"Consider: cost, availability, electrical performance, footprint compatibility, "
                    f"and thermal characteristics."
                )
                rationale = response.message
            except Exception as e:
                logger.warning("LLM comparison failed: %s", e)

        return ComparisonResult(
            table=table,
            parameters_compared=["mpn", "manufacturer", "description", "price", "package"] + all_params_list,
            recommendation=best_mpn,
            rationale=rationale,
            trade_off_summary=trade_off_summary,
        )

    async def suggest_circuit(
        self,
        description: str,
    ) -> CircuitSuggestion:
        """Suggest a complete circuit for a given functional description.

        Generates a circuit topology with components, connections, and constraints
        based on the description. Uses LLM for complex requests and falls back to
        template-based generation for common circuits.

        Args:
            description: Natural language description of the desired circuit
                (e.g., "3.3V power supply from USB", "LED indicator with current limiting")

        Returns:
            CircuitSuggestion with components, connections, and constraints.
        """
        desc_lower = description.lower()

        # Template matching for common circuits
        if any(kw in desc_lower for kw in ("3.3v", "3v3", "ldo", "linear regulator")):
            return self._suggest_ldo_circuit(description)

        if any(kw in desc_lower for kw in ("buck", "step-down", "switching regulator")):
            return self._suggest_buck_circuit(description)

        if any(kw in desc_lower for kw in ("led", "indicator")):
            return self._suggest_led_circuit(description)

        if any(kw in desc_lower for kw in ("usb", "usb-c", "type-c")):
            return self._suggest_usb_circuit(description)

        if any(kw in desc_lower for kw in ("pull-up", "pullup", "i2c")):
            return self._suggest_i2c_pullup_circuit(description)

        # LLM-based suggestion for unknown circuits
        if self._agent is not None:
            return await self._llm_suggest_circuit(description)

        # Fallback
        return CircuitSuggestion(
            name="Custom Circuit",
            description=description,
            components=[],
            connections=[],
            constraints=[],
            explanation=f"Unable to generate a template for: {description}. Please use the AI assistant for complex circuit suggestions.",
            references=[],
        )

    # ------------------------------------------------------------------
    # Template circuit generators
    # ------------------------------------------------------------------

    def _suggest_ldo_circuit(self, description: str) -> CircuitSuggestion:
        """Generate an LDO voltage regulator circuit."""
        return CircuitSuggestion(
            name="3.3V LDO Power Supply",
            description="Linear voltage regulator with input/output filtering",
            components=[
                CircuitComponent(reference="U1", mpn="AP2112K-3.3TRG1", value="AP2112K-3.3", footprint="SOT-23-5", description="3.3V 600mA LDO"),
                CircuitComponent(reference="C1", mpn="CL10A106MQ8NNNC", value="10uF", footprint="0603", description="Input capacitor"),
                CircuitComponent(reference="C2", mpn="CL10A106MQ8NNNC", value="10uF", footprint="0603", description="Output capacitor"),
                CircuitComponent(reference="C3", mpn="CL05B104KO5NNNC", value="100nF", footprint="0402", description="Output bypass capacitor"),
            ],
            connections=[
                CircuitConnection(from_component="C1", from_pin="1", to_component="U1", to_pin="IN", net_name="VIN"),
                CircuitConnection(from_component="U1", from_pin="OUT", to_component="C2", to_pin="1", net_name="3V3"),
                CircuitConnection(from_component="U1", from_pin="OUT", to_component="C3", to_pin="1", net_name="3V3"),
                CircuitConnection(from_component="U1", from_pin="EN", to_component="U1", to_pin="IN", net_name="VIN"),
                CircuitConnection(from_component="C1", from_pin="2", to_component="U1", to_pin="GND", net_name="GND"),
                CircuitConnection(from_component="C2", from_pin="2", to_component="U1", to_pin="GND", net_name="GND"),
                CircuitConnection(from_component="C3", from_pin="2", to_component="U1", to_pin="GND", net_name="GND"),
            ],
            constraints=[
                {"type": "placement", "description": "Place C1 within 5mm of U1 VIN pin", "priority": "required"},
                {"type": "placement", "description": "Place C2 and C3 within 3mm of U1 VOUT pin", "priority": "required"},
                {"type": "width", "parameter": "VIN trace width", "value": "0.5mm minimum", "priority": "required"},
                {"type": "width", "parameter": "3V3 trace width", "value": "0.3mm minimum", "priority": "required"},
                {"type": "thermal", "description": "Ensure adequate ground copper for thermal dissipation", "priority": "recommended"},
            ],
            explanation=(
                "This circuit uses the AP2112K-3.3 LDO regulator, chosen for its low dropout voltage (250mV), "
                "low quiescent current (55uA), and small SOT-23-5 package. The 10uF input capacitor (C1) filters "
                "input supply noise. The 10uF output capacitor (C2) is required for regulator stability per the "
                "datasheet. An additional 100nF bypass capacitor (C3) provides high-frequency decoupling. "
                "The EN pin is tied to VIN for always-on operation. All capacitors use X5R dielectric for "
                "stable capacitance across temperature."
            ),
            references=[
                "AP2112K Datasheet - Diodes Incorporated",
                "Application Note AN-1148: Linear Regulator Layout Guidelines",
            ],
        )

    def _suggest_buck_circuit(self, description: str) -> CircuitSuggestion:
        """Generate a buck converter circuit."""
        return CircuitSuggestion(
            name="Buck Converter Power Supply",
            description="Synchronous step-down converter with input/output filtering",
            components=[
                CircuitComponent(reference="U1", mpn="MP2315", value="MP2315", footprint="SOT-23-8", description="1.5A synchronous buck converter"),
                CircuitComponent(reference="L1", value="4.7uH", footprint="1008", description="Power inductor"),
                CircuitComponent(reference="C1", mpn="CL10A106MQ8NNNC", value="10uF", footprint="0603", description="Input capacitor"),
                CircuitComponent(reference="C2", mpn="CL10A106MQ8NNNC", value="10uF", footprint="0603", description="Output capacitor"),
                CircuitComponent(reference="C3", mpn="CL10A106MQ8NNNC", value="10uF", footprint="0603", description="Output capacitor 2"),
                CircuitComponent(reference="C4", mpn="CL05B104KO5NNNC", value="100nF", footprint="0402", description="Bootstrap capacitor"),
                CircuitComponent(reference="R1", value="100k", footprint="0402", description="Feedback upper resistor"),
                CircuitComponent(reference="R2", value="47k", footprint="0402", description="Feedback lower resistor"),
                CircuitComponent(reference="C5", mpn="CL05B104KO5NNNC", value="100nF", footprint="0402", description="Soft-start capacitor"),
            ],
            connections=[
                CircuitConnection(from_component="C1", from_pin="1", to_component="U1", to_pin="VIN", net_name="VIN"),
                CircuitConnection(from_component="U1", from_pin="SW", to_component="L1", to_pin="1", net_name="SW"),
                CircuitConnection(from_component="L1", from_pin="2", to_component="C2", to_pin="1", net_name="VOUT"),
                CircuitConnection(from_component="L1", from_pin="2", to_component="C3", to_pin="1", net_name="VOUT"),
                CircuitConnection(from_component="R1", from_pin="1", to_component="L1", to_pin="2", net_name="VOUT"),
                CircuitConnection(from_component="R1", from_pin="2", to_component="U1", to_pin="FB", net_name="FB"),
                CircuitConnection(from_component="R2", from_pin="1", to_component="U1", to_pin="FB", net_name="FB"),
                CircuitConnection(from_component="U1", from_pin="BST", to_component="C4", to_pin="1", net_name="BST"),
                CircuitConnection(from_component="C4", from_pin="2", to_component="U1", to_pin="SW", net_name="SW"),
                CircuitConnection(from_component="C5", from_pin="1", to_component="U1", to_pin="EN", net_name="EN"),
            ],
            constraints=[
                {"type": "layout", "description": "Minimize input loop area: C1 -> VIN pin -> GND pin -> C1", "priority": "required"},
                {"type": "layout", "description": "Minimize switching loop: SW pin -> L1 -> output caps -> GND -> U1 GND", "priority": "required"},
                {"type": "placement", "description": "Place C1 within 3mm of VIN pin", "priority": "required"},
                {"type": "placement", "description": "Place L1 adjacent to SW pin", "priority": "required"},
                {"type": "copper", "description": "Use copper pour for VOUT plane", "priority": "recommended"},
                {"type": "thermal", "description": "Thermal pad must connect to ground plane with thermal vias", "priority": "required"},
            ],
            explanation=(
                "This buck converter uses the MP2315 synchronous regulator for high efficiency (96%). "
                "The 4.7uH inductor is sized for the switching frequency (500kHz) and output current. "
                "Input capacitor C1 handles the pulsed input current and must be ceramic (X5R or X7R). "
                "Two output capacitors (C2, C3) reduce output ripple. The feedback resistor divider "
                "(R1/R2) sets the output voltage: VOUT = 0.6V * (1 + R1/R2). Bootstrap capacitor C4 "
                "drives the high-side FET gate. Layout is critical: minimize the hot loop area to "
                "reduce EMI emissions."
            ),
            references=[
                "MP2315 Datasheet - Monolithic Power Systems",
                "AN-1149: Practical Layout Guidelines for Switching Power Supplies",
            ],
        )

    def _suggest_led_circuit(self, description: str) -> CircuitSuggestion:
        """Generate an LED indicator circuit."""
        return CircuitSuggestion(
            name="LED Indicator",
            description="LED with current-limiting resistor",
            components=[
                CircuitComponent(reference="D1", value="Green", footprint="0603", description="Green LED"),
                CircuitComponent(reference="R1", mpn="RC0402FR-071KL", value="1k", footprint="0402", description="Current limiting resistor (I = (3.3V - 2V) / 1k = 1.3mA)"),
            ],
            connections=[
                CircuitConnection(from_component="R1", from_pin="1", to_component="", to_pin="", net_name="GPIO"),
                CircuitConnection(from_component="R1", from_pin="2", to_component="D1", to_pin="A", net_name="LED_A"),
                CircuitConnection(from_component="D1", from_pin="K", to_component="", to_pin="", net_name="GND"),
            ],
            constraints=[],
            explanation=(
                "Simple LED indicator driven from a GPIO pin. The 1k resistor limits current to ~1.3mA "
                "assuming a 3.3V supply and 2V LED forward voltage. Adjust R1 for desired brightness: "
                "lower resistance = brighter (max ~20mA for typical 0603 LEDs). GPIO drives high to turn on."
            ),
            references=["LED manufacturer datasheet for forward voltage and maximum current"],
        )

    def _suggest_usb_circuit(self, description: str) -> CircuitSuggestion:
        """Generate a USB Type-C interface circuit."""
        return CircuitSuggestion(
            name="USB Type-C Interface",
            description="USB 2.0 Type-C receptacle with ESD protection and CC resistors",
            components=[
                CircuitComponent(reference="J1", value="USB-C", footprint="USB_C_Receptacle", description="USB Type-C receptacle"),
                CircuitComponent(reference="U1", mpn="USBLC6-2SC6", value="USBLC6-2SC6", footprint="SOT-23-6", description="USB ESD protection"),
                CircuitComponent(reference="R1", value="5.1k", footprint="0402", description="CC1 pull-down (UFP identification)"),
                CircuitComponent(reference="R2", value="5.1k", footprint="0402", description="CC2 pull-down (UFP identification)"),
                CircuitComponent(reference="C1", mpn="CL05B104KO5NNNC", value="100nF", footprint="0402", description="VBUS decoupling"),
            ],
            connections=[
                CircuitConnection(from_component="J1", from_pin="VBUS", to_component="C1", to_pin="1", net_name="VBUS"),
                CircuitConnection(from_component="J1", from_pin="D+", to_component="U1", to_pin="IO1", net_name="USB_DP"),
                CircuitConnection(from_component="J1", from_pin="D-", to_component="U1", to_pin="IO2", net_name="USB_DM"),
                CircuitConnection(from_component="J1", from_pin="CC1", to_component="R1", to_pin="1", net_name="CC1"),
                CircuitConnection(from_component="J1", from_pin="CC2", to_component="R2", to_pin="1", net_name="CC2"),
                CircuitConnection(from_component="R1", from_pin="2", to_component="", to_pin="", net_name="GND"),
                CircuitConnection(from_component="R2", from_pin="2", to_component="", to_pin="", net_name="GND"),
            ],
            constraints=[
                {"type": "impedance", "parameter": "USB D+/D- differential impedance", "value": "90 ohm", "priority": "required"},
                {"type": "length_match", "parameter": "D+/D- intra-pair skew", "value": "< 150 mil", "priority": "required"},
                {"type": "placement", "description": "Place U1 (ESD) as close to J1 as possible", "priority": "required"},
                {"type": "placement", "description": "Place R1, R2 near CC pins of J1", "priority": "required"},
            ],
            explanation=(
                "USB 2.0 Type-C device (UFP) interface. The 5.1k pull-down resistors on CC1 and CC2 "
                "identify this as a USB device (Upstream Facing Port) per USB Type-C specification. "
                "USBLC6-2SC6 provides ESD protection on the data lines with low capacitance (1pF) "
                "to maintain signal integrity at USB 2.0 speeds. The VBUS decoupling capacitor "
                "filters connector noise. Data lines require 90 ohm differential impedance routing."
            ),
            references=[
                "USB Type-C Cable and Connector Specification Rev 2.0",
                "USBLC6-2SC6 Datasheet - STMicroelectronics",
                "USB 2.0 Specification - USB-IF",
            ],
        )

    def _suggest_i2c_pullup_circuit(self, description: str) -> CircuitSuggestion:
        """Generate I2C pull-up resistor circuit."""
        return CircuitSuggestion(
            name="I2C Pull-Up Resistors",
            description="Standard I2C bus pull-up resistors for SDA and SCL",
            components=[
                CircuitComponent(reference="R1", value="4.7k", footprint="0402", description="SCL pull-up resistor"),
                CircuitComponent(reference="R2", value="4.7k", footprint="0402", description="SDA pull-up resistor"),
            ],
            connections=[
                CircuitConnection(from_component="R1", from_pin="1", to_component="", to_pin="", net_name="VCC_I2C"),
                CircuitConnection(from_component="R1", from_pin="2", to_component="", to_pin="", net_name="SCL"),
                CircuitConnection(from_component="R2", from_pin="1", to_component="", to_pin="", net_name="VCC_I2C"),
                CircuitConnection(from_component="R2", from_pin="2", to_component="", to_pin="", net_name="SDA"),
            ],
            constraints=[
                {"type": "capacitance", "parameter": "Max bus capacitance", "value": "400pF (standard mode)", "priority": "required"},
            ],
            explanation=(
                "I2C requires pull-up resistors on both SDA and SCL because the bus uses open-drain drivers. "
                "4.7k is a standard value for 3.3V I2C at 100/400 kHz. For faster modes or longer buses, "
                "lower values (2.2k or 1k) may be needed. For 1.8V I2C, use 2.2k. Only one set of pull-ups "
                "should be present per bus segment. Rise time must be < 1us for standard mode, < 300ns for fast mode."
            ),
            references=[
                "NXP UM10204 - I2C-bus specification and user manual",
                "Application Note AN10216 - I2C pull-up resistor calculation",
            ],
        )

    # ------------------------------------------------------------------
    # LLM enhancement
    # ------------------------------------------------------------------

    async def _llm_enhanced_search(
        self,
        query: str,
        existing_results: list[ComponentSuggestion],
        category: str | None,
        filters: dict[str, Any] | None,
    ) -> list[ComponentSuggestion]:
        """Use LLM to find additional components beyond the local database."""
        if self._agent is None:
            return existing_results

        try:
            response = await self._agent.chat(
                f"I'm searching for electronic components matching: {query}\n"
                f"Category: {category or 'any'}\n"
                f"Filters: {json.dumps(filters, default=str) if filters else 'none'}\n\n"
                f"I already found these: {[s.mpn for s in existing_results]}\n"
                f"Suggest additional components with MPN, specs, and trade-offs. "
                f"Return as JSON array of objects with keys: mpn, manufacturer, description, specs, footprint, package, price, trade_offs."
            )
            additional = json.loads(response.message)
            if isinstance(additional, list):
                for comp_data in additional:
                    if isinstance(comp_data, dict):
                        existing_results.append(ComponentSuggestion(
                            mpn=comp_data.get("mpn", ""),
                            manufacturer=comp_data.get("manufacturer", ""),
                            description=comp_data.get("description", ""),
                            specs=comp_data.get("specs", {}),
                            footprint=comp_data.get("footprint", ""),
                            package=comp_data.get("package", ""),
                            price=comp_data.get("price"),
                            availability="unknown",
                            trade_offs=comp_data.get("trade_offs", []),
                            score=0.5,
                        ))
        except Exception as e:
            logger.warning("LLM component search enhancement failed: %s", e)

        return existing_results

    async def _llm_suggest_circuit(self, description: str) -> CircuitSuggestion:
        """Use LLM to suggest a circuit for a complex description."""
        if self._agent is None:
            return CircuitSuggestion(
                name="Custom Circuit",
                description=description,
                components=[],
                connections=[],
                explanation="LLM agent required for complex circuit suggestions",
                references=[],
            )

        try:
            response = await self._agent.chat(
                f"Design a circuit for: {description}\n\n"
                f"Provide a complete circuit with:\n"
                f"1. Component list with reference designators, MPNs, values, footprints\n"
                f"2. Connections between components\n"
                f"3. Design constraints and layout guidelines\n"
                f"4. Explanation of the design choices\n"
                f"5. Datasheet references\n\n"
                f"Return as JSON with keys: name, description, components, connections, constraints, explanation, references."
            )
            data = json.loads(response.message)
            return CircuitSuggestion(**data)
        except Exception as e:
            logger.warning("LLM circuit suggestion failed: %s", e)
            return CircuitSuggestion(
                name="Custom Circuit",
                description=description,
                components=[],
                connections=[],
                explanation=f"LLM circuit generation failed: {e}",
                references=[],
            )


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


def _generate_trade_offs(comp: dict[str, Any]) -> list[str]:
    """Generate trade-off notes for a component."""
    trade_offs: list[str] = []
    specs = comp.get("specs", {})
    category = comp.get("subcategory", "")

    if category == "ldo":
        dropout = specs.get("dropout_v", 0)
        if dropout > 0.5:
            trade_offs.append(f"Higher dropout ({dropout}V) - needs more VIN headroom")
        iq = specs.get("quiescent_ua", 0)
        if iq > 1000:
            trade_offs.append(f"Higher quiescent current ({iq}uA) - not ideal for battery applications")
        elif iq < 100:
            trade_offs.append(f"Low quiescent current ({iq}uA) - good for battery applications")

    if category == "buck":
        eff = specs.get("efficiency_pct", 0)
        if eff >= 95:
            trade_offs.append(f"High efficiency ({eff}%) but requires inductor and external components")
        trade_offs.append("Switching noise - may need EMI filtering for sensitive circuits")

    if category == "mlcc":
        dielectric = specs.get("dielectric", "")
        if dielectric in ("Y5V", "Z5U"):
            trade_offs.append(f"{dielectric} dielectric - capacitance varies significantly with temperature and voltage")
        vrating = specs.get("voltage_rating_v", 0)
        cap = specs.get("capacitance_nf", 0)
        if cap >= 1000 and vrating <= 10:
            trade_offs.append("Effective capacitance decreases under DC bias - derate by 30-50%")

    return trade_offs
