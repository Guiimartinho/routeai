"""Advanced LLM-powered routing features R7-R11.

Provides five major features for intelligent PCB routing:
  R7:  PDNDesigner           - Multi-tier decoupling strategy with target impedance
  R8:  ThermalAwarePlacementAdvisor - Thermal analysis with proximity conflict detection
  R9:  ManufacturingAwareRouter     - Fab-specific design rule optimization
  R10: StyleMatchingRouter   - Learn and replay human routing style
  R11: RouteCritique         - Post-routing engineering review with EMC/SI analysis

All features use the dual-provider LLM pattern: a primary Claude provider for
deep engineering analysis and an OpenAI fallback for structured extraction.
Outputs are fully typed Pydantic models. No stubs.
"""

from __future__ import annotations

import json
import logging
import math
import statistics
from collections import Counter, defaultdict
from typing import Any

import anthropic
import openai
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _try_parse_json(text: str) -> dict[str, Any]:
    """Extract JSON from LLM output, handling markdown fences."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        first_nl = cleaned.index("\n") if "\n" in cleaned else len(cleaned)
        cleaned = cleaned[first_nl + 1:]
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
            result = json.loads(cleaned[start : end + 1])
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

    logger.warning("Failed to parse JSON from LLM output")
    return {"_raw_text": text, "_parse_error": "Could not extract valid JSON"}


def _format_capacitance(value: float) -> str:
    """Format a capacitance value to a human-readable string."""
    if value >= 1e-6:
        return f"{value * 1e6:.1f}uF"
    elif value >= 1e-9:
        return f"{value * 1e9:.0f}nF"
    elif value >= 1e-12:
        return f"{value * 1e12:.0f}pF"
    return f"{value:.2e}F"


class _DualProviderLLM:
    """Dual-provider LLM client: Claude primary, OpenAI fallback.

    Encapsulates retry logic so every feature class can call a single
    method and get back parsed JSON regardless of which provider answered.
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        openai_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        openai_model: str = "gpt-4o",
        max_tokens: int = 8192,
        temperature: float = 0.0,
    ) -> None:
        self._anthropic = anthropic.AsyncAnthropic(api_key=anthropic_api_key)
        self._openai = openai.AsyncOpenAI(api_key=openai_api_key)
        self._anthropic_model = anthropic_model
        self._openai_model = openai_model
        self._max_tokens = max_tokens
        self._temperature = temperature

    async def query(
        self,
        system_prompt: str,
        user_message: str,
    ) -> dict[str, Any]:
        """Send a prompt to Claude; fall back to OpenAI on failure."""
        # --- Primary: Anthropic Claude ---
        try:
            response = await self._anthropic.messages.create(
                model=self._anthropic_model,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
            text_parts: list[str] = []
            for block in response.content:
                if block.type == "text":
                    text_parts.append(block.text)
            raw = "\n".join(text_parts)
            parsed = _try_parse_json(raw)
            if "_parse_error" not in parsed:
                return parsed
            logger.warning("Claude returned unparseable JSON, falling back to OpenAI")
        except anthropic.APIError as exc:
            logger.warning("Anthropic API error (%s), falling back to OpenAI", exc)

        # --- Fallback: OpenAI ---
        try:
            oai_response = await self._openai.chat.completions.create(
                model=self._openai_model,
                max_tokens=self._max_tokens,
                temperature=self._temperature,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
            )
            raw = oai_response.choices[0].message.content or "{}"
            parsed = _try_parse_json(raw)
            if "_parse_error" not in parsed:
                return parsed
        except Exception as exc:
            logger.error("OpenAI fallback also failed: %s", exc)

        return {"_error": "Both LLM providers failed to return valid JSON"}


# ============================================================================
# R7: PDN Designer
# ============================================================================

# Decoupling capacitor knowledge base with real MPNs, ESR, ESL
DECAP_KNOWLEDGE_BASE: list[dict[str, Any]] = [
    # Bulk tier (22uF)
    {"mpn": "GRM188R60J226MEA0D", "manufacturer": "Murata", "capacitance": 22e-6,
     "voltage": 6.3, "package": "0603", "dielectric": "X5R",
     "esr_ohm": 0.003, "esl_nh": 0.7, "price": 0.03,
     "tier": "bulk", "description": "22uF 6.3V X5R 0603"},
    {"mpn": "CL10A226MQ8NRNC", "manufacturer": "Samsung", "capacitance": 22e-6,
     "voltage": 6.3, "package": "0603", "dielectric": "X5R",
     "esr_ohm": 0.004, "esl_nh": 0.7, "price": 0.025,
     "tier": "bulk", "description": "22uF 6.3V X5R 0603"},
    {"mpn": "GRM21BR60J226ME39L", "manufacturer": "Murata", "capacitance": 22e-6,
     "voltage": 6.3, "package": "0805", "dielectric": "X5R",
     "esr_ohm": 0.002, "esl_nh": 0.9, "price": 0.04,
     "tier": "bulk", "description": "22uF 6.3V X5R 0805"},
    {"mpn": "C3216X5R0J226M160AC", "manufacturer": "TDK", "capacitance": 22e-6,
     "voltage": 6.3, "package": "1206", "dielectric": "X5R",
     "esr_ohm": 0.002, "esl_nh": 1.1, "price": 0.05,
     "tier": "bulk", "description": "22uF 6.3V X5R 1206"},
    # Mid-tier (100nF)
    {"mpn": "CL05B104KO5NNNC", "manufacturer": "Samsung", "capacitance": 100e-9,
     "voltage": 16, "package": "0402", "dielectric": "X5R",
     "esr_ohm": 0.03, "esl_nh": 0.5, "price": 0.005,
     "tier": "mid", "description": "100nF 16V X5R 0402"},
    {"mpn": "GRM155R71C104KA88D", "manufacturer": "Murata", "capacitance": 100e-9,
     "voltage": 16, "package": "0402", "dielectric": "X7R",
     "esr_ohm": 0.025, "esl_nh": 0.5, "price": 0.006,
     "tier": "mid", "description": "100nF 16V X7R 0402"},
    {"mpn": "C0402C104K4RACTU", "manufacturer": "KEMET", "capacitance": 100e-9,
     "voltage": 16, "package": "0402", "dielectric": "X5R",
     "esr_ohm": 0.03, "esl_nh": 0.5, "price": 0.005,
     "tier": "mid", "description": "100nF 16V X5R 0402"},
    # High-frequency tier (1nF)
    {"mpn": "GRM0335C1H102JA01D", "manufacturer": "Murata", "capacitance": 1e-9,
     "voltage": 50, "package": "0201", "dielectric": "C0G",
     "esr_ohm": 0.05, "esl_nh": 0.3, "price": 0.008,
     "tier": "hf", "description": "1nF 50V C0G 0201"},
    {"mpn": "GRM0335C1E102JA01D", "manufacturer": "Murata", "capacitance": 1e-9,
     "voltage": 25, "package": "0201", "dielectric": "C0G",
     "esr_ohm": 0.05, "esl_nh": 0.3, "price": 0.007,
     "tier": "hf", "description": "1nF 25V C0G 0201"},
    {"mpn": "CL03C102JB3NNNC", "manufacturer": "Samsung", "capacitance": 1e-9,
     "voltage": 25, "package": "0201", "dielectric": "C0G",
     "esr_ohm": 0.06, "esl_nh": 0.3, "price": 0.006,
     "tier": "hf", "description": "1nF 25V C0G 0201"},
    # Extra: 10nF mid-high
    {"mpn": "GRM155R71C103KA01D", "manufacturer": "Murata", "capacitance": 10e-9,
     "voltage": 16, "package": "0402", "dielectric": "X7R",
     "esr_ohm": 0.03, "esl_nh": 0.5, "price": 0.005,
     "tier": "mid_hf", "description": "10nF 16V X7R 0402"},
]


class DecapStrategy(BaseModel):
    """A single decoupling capacitor placement strategy."""
    tier: str = Field(description="Tier: bulk, mid, hf, mid_hf")
    mpn: str = Field(description="Manufacturer part number")
    manufacturer: str = Field(default="")
    capacitance_f: float = Field(description="Capacitance in farads")
    capacitance_display: str = Field(description="Human-readable capacitance")
    package: str = Field(description="Package size (0201, 0402, 0603, ...)")
    esr_ohm: float = Field(description="Equivalent series resistance in ohms")
    esl_nh: float = Field(description="Equivalent series inductance in nH")
    quantity: int = Field(description="Number of capacitors to place")
    resonant_freq_hz: float = Field(description="Series resonant frequency")
    placement_hint: str = Field(description="Where to place relative to IC")
    rationale: str = Field(default="")


class TraceWidthRequirement(BaseModel):
    """Required trace width for a power rail segment."""
    segment: str = Field(description="Segment description (e.g. VRM-to-IC)")
    min_width_mm: float = Field(description="Minimum trace width in mm")
    recommended_width_mm: float = Field(description="Recommended trace width")
    current_a: float = Field(description="Expected current in amps")
    notes: str = Field(default="")


class ImpedanceProfilePoint(BaseModel):
    """Single point in a frequency-domain impedance profile."""
    frequency_hz: float
    impedance_ohms: float
    phase_degrees: float
    target_z_ohms: float
    within_target: bool


class PlacementSuggestion(BaseModel):
    """Suggested placement position or guideline for a decoupling cap."""
    component: str = Field(description="Reference or MPN of the cap")
    guideline: str = Field(description="Placement guideline text")
    max_distance_mm: float | None = Field(default=None)
    priority: str = Field(default="required")


class RailDesign(BaseModel):
    """Complete PDN design for a single power rail."""
    net_name: str
    voltage: float
    max_current: float
    ripple_percent: float
    ic_transient_current: float
    target_impedance_ohm: float
    decap_strategy: list[DecapStrategy] = Field(default_factory=list)
    placement_suggestions: list[PlacementSuggestion] = Field(default_factory=list)
    trace_width_requirements: list[TraceWidthRequirement] = Field(default_factory=list)
    impedance_profile_data: list[ImpedanceProfilePoint] = Field(default_factory=list)


class PDNDesignResult(BaseModel):
    """Complete PDN design result across all rails."""
    per_rail: list[RailDesign] = Field(default_factory=list)
    overall_summary: str = Field(default="")
    llm_analysis: str = Field(default="", description="Raw engineering analysis from LLM")


PDN_DESIGNER_SYSTEM_PROMPT = """\
You are an expert power distribution network (PDN) design engineer specializing in \
multi-layer PCB power integrity. You design decoupling strategies following the \
methodology of Larry Smith and Istvan Novak.

Given power rail requirements and a board stackup, you must:
1. Validate the target impedance calculation: Z_target = V * ripple% / I_transient
2. Design a multi-tier decoupling strategy:
   - Bulk tier (~22uF): low-frequency stability, placed near VRM output
   - Mid tier (~100nF): mid-frequency decoupling, placed within 2-3mm of IC power pins
   - HF tier (~1nF): high-frequency decoupling, placed directly at IC power pins
3. Select specific capacitor MPNs considering ESR, ESL, and resonant frequency coverage
4. Recommend trace widths based on IPC-2152 for the current levels
5. Identify any frequency gaps in the impedance profile

Respond with a JSON object with keys:
{
  "rails": [
    {
      "net_name": "...",
      "analysis": "...(detailed engineering analysis)...",
      "decap_recommendations": [
        {"tier": "bulk|mid|hf", "capacitance": "22uF|100nF|1nF",
         "quantity": N, "placement": "description", "rationale": "..."}
      ],
      "trace_width_recommendations": [
        {"segment": "...", "min_width_mm": N, "recommended_width_mm": N, "current_a": N}
      ],
      "placement_guidelines": [
        {"component": "...", "guideline": "...", "max_distance_mm": N, "priority": "required|recommended"}
      ],
      "concerns": ["..."]
    }
  ],
  "overall_summary": "..."
}
"""


class PDNDesigner:
    """R7: LLM-powered PDN design with multi-tier decoupling strategy.

    Calculates target impedance, selects capacitor MPNs from a knowledge
    base (with ESR/ESL data), designs a multi-tier decoupling approach,
    and generates impedance profiles.
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        openai_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        openai_model: str = "gpt-4o",
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            openai_api_key=openai_api_key,
            anthropic_model=anthropic_model,
            openai_model=openai_model,
        )

    @staticmethod
    def _calculate_target_impedance(
        voltage: float, ripple_pct: float, i_transient: float
    ) -> float:
        """Z_target = V * ripple% / I_transient."""
        if i_transient <= 0:
            return float("inf")
        return voltage * (ripple_pct / 100.0) / i_transient

    @staticmethod
    def _resonant_frequency(capacitance: float, esl_nh: float) -> float:
        """Series resonant frequency: f_r = 1 / (2*pi*sqrt(L*C))."""
        esl_h = esl_nh * 1e-9
        if capacitance > 0 and esl_h > 0:
            return 1.0 / (2.0 * math.pi * math.sqrt(esl_h * capacitance))
        return 0.0

    @staticmethod
    def _impedance_at_freq(
        capacitance: float, esr: float, esl_nh: float, freq: float
    ) -> float:
        """Impedance magnitude of a capacitor at a given frequency."""
        if freq <= 0:
            return esr
        omega = 2.0 * math.pi * freq
        esl_h = esl_nh * 1e-9
        z_c = -1.0 / (omega * capacitance) if capacitance > 0 else -1e12
        z_l = omega * esl_h
        return math.sqrt(esr**2 + (z_l + z_c) ** 2)

    def _select_caps_for_tier(
        self, tier: str, rail_voltage: float, quantity: int
    ) -> list[dict[str, Any]]:
        """Select the best capacitor MPN from the knowledge base for a tier."""
        candidates = [
            c for c in DECAP_KNOWLEDGE_BASE
            if c["tier"] == tier and c["voltage"] >= rail_voltage
        ]
        if not candidates:
            candidates = [c for c in DECAP_KNOWLEDGE_BASE if c["tier"] == tier]
        if not candidates:
            return []
        # Prefer lowest ESR * ESL product for best impedance coverage
        candidates.sort(key=lambda c: c["esr_ohm"] * c["esl_nh"])
        best = candidates[0]
        return [{"cap": best, "quantity": quantity}]

    def _compute_impedance_profile(
        self, decaps: list[DecapStrategy], target_z: float
    ) -> list[ImpedanceProfilePoint]:
        """Generate a frequency-domain impedance profile from 1kHz to 5GHz."""
        points: list[ImpedanceProfilePoint] = []
        num_points = 200
        log_min, log_max = 3.0, 9.7  # 1kHz to 5GHz
        for i in range(num_points):
            freq = 10 ** (log_min + (log_max - log_min) * i / (num_points - 1))
            omega = 2.0 * math.pi * freq
            # Parallel impedance of all decaps
            y_total = complex(0, 0)
            for d in decaps:
                esl_h = d.esl_nh * 1e-9
                z_c = -1.0 / (omega * d.capacitance_f) if d.capacitance_f > 0 else -1e12
                z_l = omega * esl_h
                z_cap = complex(d.esr_ohm, z_l + z_c)
                if abs(z_cap) > 0:
                    y_total += d.quantity / z_cap
            if abs(y_total) > 0:
                z_total = 1.0 / y_total
            else:
                z_total = complex(1e6, 0)
            mag = abs(z_total)
            phase = math.degrees(math.atan2(z_total.imag, z_total.real))
            points.append(ImpedanceProfilePoint(
                frequency_hz=freq,
                impedance_ohms=round(mag, 6),
                phase_degrees=round(phase, 2),
                target_z_ohms=target_z,
                within_target=mag <= target_z,
            ))
        return points

    @staticmethod
    def _trace_width_for_current(
        current_a: float, copper_oz: float = 1.0, temp_rise_c: float = 10.0
    ) -> float:
        """IPC-2152 empirical trace width for a given current (external layer).

        I = k * dT^b * A^c  =>  A = (I / (k * dT^b))^(1/c)
        A is in mil^2, convert back to mm width for a given copper thickness.
        """
        k = 0.048
        b = 0.44
        c = 0.725
        if current_a <= 0:
            return 0.1  # minimum
        area_mil2 = (current_a / (k * temp_rise_c**b)) ** (1.0 / c)
        thickness_mm = copper_oz * 0.035
        thickness_mil = thickness_mm / 0.0254
        width_mil = area_mil2 / thickness_mil if thickness_mil > 0 else 100
        width_mm = width_mil * 0.0254
        return max(0.1, round(width_mm, 3))

    async def design_pdn(
        self,
        power_requirements: list[dict],
        stackup: dict,
        board_context: dict,
    ) -> PDNDesignResult:
        """Design a complete PDN with multi-tier decoupling for all power rails.

        Args:
            power_requirements: List of dicts, each with:
                net_name, voltage, max_current, ripple_percent, ic_transient_current
            stackup: Board stackup description (layers, thicknesses, materials).
            board_context: Board dimensions, component placements, etc.

        Returns:
            PDNDesignResult with per-rail decoupling strategies, trace widths,
            placement suggestions, and impedance profiles.
        """
        result = PDNDesignResult()

        # --- Phase 1: Physics-based calculations ---
        rails_for_llm: list[dict[str, Any]] = []

        for req in power_requirements:
            net_name = req.get("net_name", "UNKNOWN")
            voltage = float(req.get("voltage", 3.3))
            max_current = float(req.get("max_current", 1.0))
            ripple_pct = float(req.get("ripple_percent", 5.0))
            i_transient = float(req.get("ic_transient_current", max_current))

            target_z = self._calculate_target_impedance(voltage, ripple_pct, i_transient)

            # Select caps for each tier
            decap_strategies: list[DecapStrategy] = []

            # Bulk tier: 22uF
            bulk_qty = max(1, math.ceil(max_current / 3.0))
            for sel in self._select_caps_for_tier("bulk", voltage, bulk_qty):
                cap = sel["cap"]
                fres = self._resonant_frequency(cap["capacitance"], cap["esl_nh"])
                decap_strategies.append(DecapStrategy(
                    tier="bulk",
                    mpn=cap["mpn"],
                    manufacturer=cap["manufacturer"],
                    capacitance_f=cap["capacitance"],
                    capacitance_display=_format_capacitance(cap["capacitance"]),
                    package=cap["package"],
                    esr_ohm=cap["esr_ohm"],
                    esl_nh=cap["esl_nh"],
                    quantity=sel["quantity"],
                    resonant_freq_hz=round(fres, 0),
                    placement_hint="Near VRM output, within 10mm",
                    rationale=(
                        f"Bulk decoupling for low-frequency stability. "
                        f"SRF={fres / 1e6:.1f}MHz covers sub-MHz range."
                    ),
                ))

            # Mid tier: 100nF near IC
            mid_qty = max(2, math.ceil(max_current / 0.5))
            for sel in self._select_caps_for_tier("mid", voltage, mid_qty):
                cap = sel["cap"]
                fres = self._resonant_frequency(cap["capacitance"], cap["esl_nh"])
                decap_strategies.append(DecapStrategy(
                    tier="mid",
                    mpn=cap["mpn"],
                    manufacturer=cap["manufacturer"],
                    capacitance_f=cap["capacitance"],
                    capacitance_display=_format_capacitance(cap["capacitance"]),
                    package=cap["package"],
                    esr_ohm=cap["esr_ohm"],
                    esl_nh=cap["esl_nh"],
                    quantity=sel["quantity"],
                    resonant_freq_hz=round(fres, 0),
                    placement_hint="Within 2-3mm of IC power pins",
                    rationale=(
                        f"Mid-frequency decoupling near IC. "
                        f"SRF={fres / 1e6:.1f}MHz covers MHz range."
                    ),
                ))

            # HF tier: 1nF at pins
            hf_qty = max(1, math.ceil(max_current / 1.0))
            for sel in self._select_caps_for_tier("hf", voltage, hf_qty):
                cap = sel["cap"]
                fres = self._resonant_frequency(cap["capacitance"], cap["esl_nh"])
                decap_strategies.append(DecapStrategy(
                    tier="hf",
                    mpn=cap["mpn"],
                    manufacturer=cap["manufacturer"],
                    capacitance_f=cap["capacitance"],
                    capacitance_display=_format_capacitance(cap["capacitance"]),
                    package=cap["package"],
                    esr_ohm=cap["esr_ohm"],
                    esl_nh=cap["esl_nh"],
                    quantity=sel["quantity"],
                    resonant_freq_hz=round(fres, 0),
                    placement_hint="Directly at IC power pins, shortest via path",
                    rationale=(
                        f"High-frequency decoupling at pin level. "
                        f"SRF={fres / 1e6:.0f}MHz covers 100MHz+ range. "
                        f"C0G dielectric ensures stable capacitance."
                    ),
                ))

            # Trace width requirements
            min_w = self._trace_width_for_current(max_current)
            rec_w = self._trace_width_for_current(max_current * 1.3)
            trace_reqs = [
                TraceWidthRequirement(
                    segment=f"VRM to bulk decap ({net_name})",
                    min_width_mm=min_w,
                    recommended_width_mm=rec_w,
                    current_a=max_current,
                    notes="Full rail current flows through this segment",
                ),
                TraceWidthRequirement(
                    segment=f"Bulk decap to IC ({net_name})",
                    min_width_mm=min_w,
                    recommended_width_mm=rec_w,
                    current_a=max_current,
                    notes="Use copper pour where possible to reduce impedance",
                ),
            ]

            # Impedance profile
            impedance_profile = self._compute_impedance_profile(
                decap_strategies, target_z
            )

            # Placement suggestions
            placement_suggestions = [
                PlacementSuggestion(
                    component=f"Bulk {_format_capacitance(22e-6)}",
                    guideline=(
                        f"Place {bulk_qty}x 22uF bulk caps near VRM output within 10mm. "
                        f"Distribute evenly if multiple ICs share the rail."
                    ),
                    max_distance_mm=10.0,
                    priority="required",
                ),
                PlacementSuggestion(
                    component=f"Mid {_format_capacitance(100e-9)}",
                    guideline=(
                        f"Place {mid_qty}x 100nF caps within 2-3mm of each IC power/ground "
                        f"pin pair. Use via-in-pad or adjacent via for lowest inductance."
                    ),
                    max_distance_mm=3.0,
                    priority="required",
                ),
                PlacementSuggestion(
                    component=f"HF {_format_capacitance(1e-9)}",
                    guideline=(
                        f"Place {hf_qty}x 1nF C0G caps directly at IC power pins. "
                        f"Minimize via stub length. Back-side placement preferred "
                        f"with via directly under IC pad."
                    ),
                    max_distance_mm=1.0,
                    priority="required",
                ),
            ]

            rail = RailDesign(
                net_name=net_name,
                voltage=voltage,
                max_current=max_current,
                ripple_percent=ripple_pct,
                ic_transient_current=i_transient,
                target_impedance_ohm=round(target_z, 6),
                decap_strategy=decap_strategies,
                placement_suggestions=placement_suggestions,
                trace_width_requirements=trace_reqs,
                impedance_profile_data=impedance_profile,
            )
            result.per_rail.append(rail)

            rails_for_llm.append({
                "net_name": net_name,
                "voltage": voltage,
                "max_current": max_current,
                "ripple_percent": ripple_pct,
                "ic_transient_current": i_transient,
                "target_impedance_ohm": round(target_z, 6),
                "decap_tiers": [
                    {"tier": d.tier, "capacitance": d.capacitance_display,
                     "mpn": d.mpn, "quantity": d.quantity, "srf_mhz": round(d.resonant_freq_hz / 1e6, 1)}
                    for d in decap_strategies
                ],
                "impedance_violations": sum(
                    1 for p in impedance_profile if not p.within_target
                ),
            })

        # --- Phase 2: LLM engineering review ---
        user_msg = (
            "Review and refine this PDN design.\n\n"
            f"## Power Rails\n```json\n{json.dumps(rails_for_llm, indent=2)}\n```\n\n"
            f"## Stackup\n```json\n{json.dumps(stackup, indent=2, default=str)}\n```\n\n"
            f"## Board Context\n```json\n{json.dumps(board_context, indent=2, default=str)}\n```\n\n"
            "Analyze the decoupling strategy, identify frequency coverage gaps, "
            "recommend placement adjustments, and flag any concerns."
        )

        llm_result = await self._llm.query(
            system_prompt=PDN_DESIGNER_SYSTEM_PROMPT,
            user_message=user_msg,
        )

        result.overall_summary = llm_result.get(
            "overall_summary",
            f"PDN design for {len(power_requirements)} rail(s) with multi-tier decoupling."
        )
        result.llm_analysis = json.dumps(llm_result.get("rails", []), indent=2, default=str)

        # Integrate LLM placement refinements back into result
        for llm_rail in llm_result.get("rails", []):
            rail_name = llm_rail.get("net_name", "")
            for rail in result.per_rail:
                if rail.net_name == rail_name:
                    for pg in llm_rail.get("placement_guidelines", []):
                        rail.placement_suggestions.append(PlacementSuggestion(
                            component=pg.get("component", ""),
                            guideline=pg.get("guideline", ""),
                            max_distance_mm=pg.get("max_distance_mm"),
                            priority=pg.get("priority", "recommended"),
                        ))

        return result


# ============================================================================
# R8: Thermal-Aware Placement Advisor
# ============================================================================

# Component thermal data
THERMAL_COMPONENT_DB: dict[str, dict[str, Any]] = {
    "voltage_regulator": {"typical_pdiss_w": 1.0, "theta_ja_default": 50.0, "is_heat_source": True},
    "ldo": {"typical_pdiss_w": 0.8, "theta_ja_default": 70.0, "is_heat_source": True},
    "buck_converter": {"typical_pdiss_w": 0.5, "theta_ja_default": 40.0, "is_heat_source": True},
    "mosfet": {"typical_pdiss_w": 2.0, "theta_ja_default": 40.0, "is_heat_source": True},
    "power_mosfet": {"typical_pdiss_w": 5.0, "theta_ja_default": 30.0, "is_heat_source": True},
    "mcu": {"typical_pdiss_w": 0.3, "theta_ja_default": 45.0, "is_heat_source": True},
    "fpga": {"typical_pdiss_w": 2.0, "theta_ja_default": 25.0, "is_heat_source": True},
    "crystal": {"max_temp_c": 85.0, "is_thermal_sensitive": True, "sensitivity": "high"},
    "tcxo": {"max_temp_c": 85.0, "is_thermal_sensitive": True, "sensitivity": "very_high"},
    "adc": {"max_temp_c": 125.0, "is_thermal_sensitive": True, "sensitivity": "high"},
    "voltage_reference": {"max_temp_c": 125.0, "is_thermal_sensitive": True, "sensitivity": "very_high"},
    "sensor": {"max_temp_c": 85.0, "is_thermal_sensitive": True, "sensitivity": "medium"},
    "op_amp": {"max_temp_c": 125.0, "is_thermal_sensitive": True, "sensitivity": "medium"},
}

THERMAL_SENSITIVITY_KEYWORDS: dict[str, str] = {
    "crystal": "crystal", "xtal": "crystal", "osc": "crystal",
    "tcxo": "tcxo", "vctcxo": "tcxo",
    "adc": "adc", "a/d": "adc",
    "vref": "voltage_reference", "ref": "voltage_reference",
    "sensor": "sensor", "temp": "sensor",
    "op-amp": "op_amp", "opamp": "op_amp",
}

HEAT_SOURCE_KEYWORDS: dict[str, str] = {
    "regulator": "voltage_regulator", "ldo": "ldo", "vreg": "voltage_regulator",
    "buck": "buck_converter", "boost": "buck_converter", "dcdc": "buck_converter",
    "mosfet": "mosfet", "fet": "mosfet",
    "mcu": "mcu", "processor": "mcu", "cpu": "mcu",
    "fpga": "fpga",
}


class ThermalHotspot(BaseModel):
    """Identified thermal hotspot on the board."""
    component_ref: str
    component_type: str
    power_dissipation_w: float
    theta_ja: float = Field(description="Junction-to-ambient thermal resistance (C/W)")
    junction_temp_c: float = Field(description="Estimated junction temperature")
    ambient_temp_c: float
    location: tuple[float, float] | None = Field(default=None)
    severity: str = Field(description="low, medium, high, critical")
    mitigation: str = Field(default="")


class ThermalConflict(BaseModel):
    """Proximity conflict between a heat source and a thermal-sensitive component."""
    hot_component: str
    sensitive_component: str
    distance_mm: float
    estimated_temp_at_sensitive: float
    max_allowed_temp: float
    severity: str = Field(description="low, medium, high, critical")
    fix_suggestion: str


class ThermalSuggestion(BaseModel):
    """A placement or design suggestion for thermal management."""
    category: str = Field(description="placement, copper, airflow, component_swap")
    description: str
    affected_components: list[str] = Field(default_factory=list)
    priority: str = Field(default="recommended")


class ThermalMapPoint(BaseModel):
    """A point in the board thermal map."""
    x: float
    y: float
    estimated_temp_c: float
    contributing_sources: list[str] = Field(default_factory=list)


class ThermalPlacementReport(BaseModel):
    """Complete thermal placement analysis report."""
    hotspots: list[ThermalHotspot] = Field(default_factory=list)
    conflicts: list[ThermalConflict] = Field(default_factory=list)
    suggestions: list[ThermalSuggestion] = Field(default_factory=list)
    thermal_map_data: list[ThermalMapPoint] = Field(default_factory=list)
    ambient_temp_c: float = Field(default=25.0)
    overall_assessment: str = Field(default="")
    llm_analysis: str = Field(default="")


THERMAL_ADVISOR_SYSTEM_PROMPT = """\
You are an expert PCB thermal management engineer. You analyze component placement \
for thermal conflicts and provide actionable improvement suggestions.

Given a list of components with their power dissipation, thermal resistance, and \
board positions, you must:
1. Identify all thermal hotspots and their junction temperatures (Tj = Ta + P * theta_JA)
2. Check proximity between heat sources and thermal-sensitive components
3. Estimate temperature at sensitive component locations using simplified thermal spreading
4. Suggest placement improvements, copper pours, and thermal relief strategies
5. Flag critical conflicts that could cause functional failures

Respond with a JSON object:
{
  "hotspot_analysis": [
    {"component": "...", "tj_c": N, "severity": "low|medium|high|critical",
     "mitigation": "..."}
  ],
  "conflict_analysis": [
    {"hot": "...", "sensitive": "...", "distance_mm": N,
     "est_temp_at_sensitive_c": N, "max_allowed_c": N,
     "severity": "...", "fix": "..."}
  ],
  "suggestions": [
    {"category": "placement|copper|airflow|component_swap",
     "description": "...", "affected": ["..."], "priority": "required|recommended"}
  ],
  "overall_assessment": "..."
}
"""


class ThermalAwarePlacementAdvisor:
    """R8: Thermal analysis identifying hotspots, conflicts, and placement improvements.

    Combines physics-based thermal calculations (Tj = Ta + P * theta_JA) with
    LLM analysis for contextual placement suggestions and conflict resolution.
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        openai_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        openai_model: str = "gpt-4o",
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            openai_api_key=openai_api_key,
            anthropic_model=anthropic_model,
            openai_model=openai_model,
        )

    @staticmethod
    def _classify_component(comp: dict) -> tuple[bool, bool, str]:
        """Classify a component as heat source, thermal sensitive, or neither.

        Returns: (is_heat_source, is_sensitive, component_type_key)
        """
        desc = (
            comp.get("description", "") + " " +
            comp.get("type", "") + " " +
            comp.get("value", "")
        ).lower()

        for kw, ctype in HEAT_SOURCE_KEYWORDS.items():
            if kw in desc:
                return True, False, ctype

        for kw, ctype in THERMAL_SENSITIVITY_KEYWORDS.items():
            if kw in desc:
                return False, True, ctype

        return False, False, "generic"

    @staticmethod
    def _estimate_temp_at_distance(
        source_power_w: float,
        distance_mm: float,
        board_thickness_mm: float = 1.6,
        copper_layers: int = 4,
    ) -> float:
        """Estimate temperature rise at a distance from a heat source.

        Uses a simplified thermal spreading model for PCB:
        dT ~ P / (2 * pi * k_eff * t * ln(r_outer/r_source))
        where k_eff is the effective board thermal conductivity.
        """
        if distance_mm <= 0 or source_power_w <= 0:
            return 0.0

        # Effective thermal conductivity depends on copper fill
        # FR4: ~0.3 W/(m*K), Copper: 385 W/(m*K)
        # For 4-layer 1oz, effective in-plane ~15-25 W/(m*K)
        copper_fraction = min(0.3, copper_layers * 0.035 / board_thickness_mm)
        k_eff = 0.3 * (1 - copper_fraction) + 385 * copper_fraction  # W/(m*K)
        k_eff_mm = k_eff * 1e-3  # W/(mm*K)

        r_source = 3.0  # approximate source radius in mm
        r_outer = max(r_source + 0.1, distance_mm)

        if r_outer <= r_source:
            return source_power_w * 50  # very close, high temp

        denom = 2.0 * math.pi * k_eff_mm * board_thickness_mm
        if denom <= 0:
            return 0.0

        dt = source_power_w / denom * math.log(r_outer / r_source)
        return max(0.0, dt)

    async def analyze_thermal(
        self,
        components: list[dict],
        board_context: dict,
    ) -> ThermalPlacementReport:
        """Analyze thermal placement for all components.

        Args:
            components: List of component dicts with keys:
                reference, type/description, x, y, power_dissipation_w (optional),
                theta_ja (optional), max_temp_c (optional)
            board_context: Board info including dimensions, stackup, ambient_temp.

        Returns:
            ThermalPlacementReport with hotspots, conflicts, suggestions, and thermal map.
        """
        ambient = float(board_context.get("ambient_temp_c", 25.0))
        board_thickness = float(board_context.get("board_thickness_mm", 1.6))
        copper_layers = int(board_context.get("copper_layer_count", 4))

        report = ThermalPlacementReport(ambient_temp_c=ambient)

        # Phase 1: Classify and calculate
        heat_sources: list[dict[str, Any]] = []
        sensitive_comps: list[dict[str, Any]] = []

        for comp in components:
            is_hot, is_sens, ctype = self._classify_component(comp)
            ref = comp.get("reference", comp.get("ref", "?"))
            x = float(comp.get("x", 0))
            y = float(comp.get("y", 0))

            if is_hot:
                db_entry = THERMAL_COMPONENT_DB.get(ctype, {})
                pdiss = float(comp.get(
                    "power_dissipation_w",
                    db_entry.get("typical_pdiss_w", 0.5)
                ))
                theta_ja = float(comp.get(
                    "theta_ja",
                    db_entry.get("theta_ja_default", 50.0)
                ))
                tj = ambient + pdiss * theta_ja

                severity = "low"
                if tj > 125:
                    severity = "critical"
                elif tj > 100:
                    severity = "high"
                elif tj > 80:
                    severity = "medium"

                hotspot = ThermalHotspot(
                    component_ref=ref,
                    component_type=ctype,
                    power_dissipation_w=pdiss,
                    theta_ja=theta_ja,
                    junction_temp_c=round(tj, 1),
                    ambient_temp_c=ambient,
                    location=(x, y),
                    severity=severity,
                    mitigation="" if severity == "low" else (
                        f"Tj={tj:.0f}C. Add thermal vias under pad, "
                        f"increase copper pour area, consider heatsink."
                    ),
                )
                report.hotspots.append(hotspot)
                heat_sources.append({
                    "ref": ref, "type": ctype, "x": x, "y": y,
                    "pdiss": pdiss, "theta_ja": theta_ja, "tj": tj,
                })

            if is_sens:
                db_entry = THERMAL_COMPONENT_DB.get(ctype, {})
                max_temp = float(comp.get(
                    "max_temp_c",
                    db_entry.get("max_temp_c", 85.0)
                ))
                sensitivity = db_entry.get("sensitivity", "medium")
                sensitive_comps.append({
                    "ref": ref, "type": ctype, "x": x, "y": y,
                    "max_temp": max_temp, "sensitivity": sensitivity,
                })

        # Phase 2: Check proximity conflicts
        for hs in heat_sources:
            for sc in sensitive_comps:
                dx = hs["x"] - sc["x"]
                dy = hs["y"] - sc["y"]
                dist = math.sqrt(dx**2 + dy**2)

                dt_at_sensitive = self._estimate_temp_at_distance(
                    hs["pdiss"], dist, board_thickness, copper_layers
                )
                temp_at_sensitive = ambient + dt_at_sensitive

                if temp_at_sensitive > sc["max_temp"] * 0.8:
                    severity = "critical" if temp_at_sensitive > sc["max_temp"] else "high"
                    if temp_at_sensitive > sc["max_temp"] * 0.9:
                        severity = "critical" if temp_at_sensitive > sc["max_temp"] else "high"
                    elif temp_at_sensitive > sc["max_temp"] * 0.8:
                        severity = "medium"
                    else:
                        severity = "low"

                    min_safe_dist = dist * 1.5 if dist > 0 else 20.0
                    report.conflicts.append(ThermalConflict(
                        hot_component=hs["ref"],
                        sensitive_component=sc["ref"],
                        distance_mm=round(dist, 2),
                        estimated_temp_at_sensitive=round(temp_at_sensitive, 1),
                        max_allowed_temp=sc["max_temp"],
                        severity=severity,
                        fix_suggestion=(
                            f"Move {sc['ref']} ({sc['type']}) at least "
                            f"{min_safe_dist:.0f}mm from {hs['ref']} ({hs['type']}). "
                            f"Current distance: {dist:.1f}mm. "
                            f"Add thermal barrier (copper-free keepout) between them, "
                            f"or add thermal vias under {hs['ref']} to sink heat to inner planes."
                        ),
                    ))

        # Phase 3: Generate thermal map
        board_w = float(board_context.get("board_width_mm", 100))
        board_h = float(board_context.get("board_height_mm", 80))
        grid_step = max(5.0, min(board_w, board_h) / 15.0)

        x = 0.0
        while x <= board_w:
            y = 0.0
            while y <= board_h:
                total_dt = 0.0
                sources: list[str] = []
                for hs in heat_sources:
                    dx = x - hs["x"]
                    dy = y - hs["y"]
                    dist = math.sqrt(dx**2 + dy**2)
                    dt = self._estimate_temp_at_distance(
                        hs["pdiss"], max(dist, 1.0), board_thickness, copper_layers
                    )
                    if dt > 0.5:
                        total_dt += dt
                        sources.append(hs["ref"])
                report.thermal_map_data.append(ThermalMapPoint(
                    x=round(x, 1), y=round(y, 1),
                    estimated_temp_c=round(ambient + total_dt, 1),
                    contributing_sources=sources,
                ))
                y += grid_step
            x += grid_step

        # Phase 4: LLM contextual analysis
        llm_input = {
            "hotspots": [
                {"ref": hs["ref"], "type": hs["type"], "pdiss_w": hs["pdiss"],
                 "tj_c": round(hs["tj"], 1), "x": hs["x"], "y": hs["y"]}
                for hs in heat_sources
            ],
            "sensitive_components": [
                {"ref": sc["ref"], "type": sc["type"], "max_temp_c": sc["max_temp"],
                 "sensitivity": sc["sensitivity"], "x": sc["x"], "y": sc["y"]}
                for sc in sensitive_comps
            ],
            "conflicts_found": len(report.conflicts),
            "board": {
                "width_mm": board_w, "height_mm": board_h,
                "thickness_mm": board_thickness, "copper_layers": copper_layers,
            },
        }

        user_msg = (
            "Analyze this thermal placement and provide improvement suggestions.\n\n"
            f"```json\n{json.dumps(llm_input, indent=2)}\n```\n\n"
            "Focus on:\n"
            "1. Critical hotspots requiring mitigation\n"
            "2. Proximity conflicts between hot and sensitive components\n"
            "3. Copper pour and thermal via recommendations\n"
            "4. Optimal placement rearrangements"
        )

        llm_result = await self._llm.query(
            system_prompt=THERMAL_ADVISOR_SYSTEM_PROMPT,
            user_message=user_msg,
        )

        report.overall_assessment = llm_result.get("overall_assessment", "")
        report.llm_analysis = json.dumps(llm_result, indent=2, default=str)

        # Integrate LLM suggestions
        for s in llm_result.get("suggestions", []):
            report.suggestions.append(ThermalSuggestion(
                category=s.get("category", "placement"),
                description=s.get("description", ""),
                affected_components=s.get("affected", []),
                priority=s.get("priority", "recommended"),
            ))

        # Add default suggestions if LLM didn't provide any
        if not report.suggestions and report.hotspots:
            for hs in report.hotspots:
                if hs.severity in ("high", "critical"):
                    report.suggestions.append(ThermalSuggestion(
                        category="copper",
                        description=(
                            f"Add thermal vias (0.3mm drill, 0.6mm pad) in a 3x3 grid "
                            f"under {hs.component_ref} thermal pad. Connect to internal "
                            f"ground plane for heat spreading."
                        ),
                        affected_components=[hs.component_ref],
                        priority="required",
                    ))

        return report


# ============================================================================
# R9: Manufacturing-Aware Router
# ============================================================================

# Fab profiles with extended data for cost estimation and yield margin
FAB_PROFILES_EXTENDED: dict[str, dict[str, Any]] = {
    "jlcpcb_standard": {
        "fab_name": "JLCPCB (Standard)",
        "design_rules": {
            "min_trace_width_mm": 0.09,
            "min_trace_spacing_mm": 0.09,
            "min_via_drill_mm": 0.3,
            "min_via_pad_mm": 0.6,
            "min_annular_ring_mm": 0.13,
            "min_hole_to_hole_mm": 0.254,
            "min_hole_to_edge_mm": 0.3,
            "min_solder_mask_bridge_mm": 0.1,
            "min_silkscreen_width_mm": 0.15,
            "max_layers": 2,
            "board_thickness_mm": [0.8, 1.0, 1.2, 1.6],
            "copper_weight_oz": [1.0, 2.0],
        },
        "yield_margins": {
            "trace_width_margin": 0.04,
            "spacing_margin": 0.04,
            "drill_margin": 0.05,
            "annular_ring_margin": 0.03,
        },
        "base_cost_usd": 2.0,
        "per_sqcm": 0.01,
        "feature_costs": {},
        "surface_finishes": ["HASL", "HASL-LF"],
        "notes": "Cheapest option, 1-2 layer boards, fast turnaround",
    },
    "jlcpcb_advanced": {
        "fab_name": "JLCPCB (Advanced)",
        "design_rules": {
            "min_trace_width_mm": 0.09,
            "min_trace_spacing_mm": 0.09,
            "min_via_drill_mm": 0.2,
            "min_via_pad_mm": 0.45,
            "min_annular_ring_mm": 0.13,
            "min_hole_to_hole_mm": 0.254,
            "min_hole_to_edge_mm": 0.3,
            "min_solder_mask_bridge_mm": 0.1,
            "min_silkscreen_width_mm": 0.15,
            "max_layers": 32,
            "board_thickness_mm": [0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0, 2.4],
            "copper_weight_oz": [0.5, 1.0, 2.0],
        },
        "yield_margins": {
            "trace_width_margin": 0.03,
            "spacing_margin": 0.03,
            "drill_margin": 0.03,
            "annular_ring_margin": 0.02,
        },
        "base_cost_usd": 8.0,
        "per_sqcm": 0.05,
        "feature_costs": {
            "blind_vias": {"adder_pct": 30, "description": "Blind via processing"},
            "buried_vias": {"adder_pct": 50, "description": "Buried via processing"},
            "impedance_control": {"adder_usd": 15, "description": "Impedance-controlled stackup"},
            "enig": {"adder_usd": 5, "description": "ENIG surface finish"},
            "via_in_pad": {"adder_pct": 20, "description": "Via-in-pad with fill and cap"},
            "microvias": {"adder_pct": 40, "description": "Laser-drilled microvias"},
        },
        "surface_finishes": ["HASL", "HASL-LF", "ENIG", "OSP"],
        "notes": "Multi-layer, advanced features, longer lead time",
    },
    "pcbway": {
        "fab_name": "PCBWay",
        "design_rules": {
            "min_trace_width_mm": 0.09,
            "min_trace_spacing_mm": 0.09,
            "min_via_drill_mm": 0.15,
            "min_via_pad_mm": 0.35,
            "min_annular_ring_mm": 0.1,
            "min_hole_to_hole_mm": 0.254,
            "min_hole_to_edge_mm": 0.3,
            "min_solder_mask_bridge_mm": 0.08,
            "min_silkscreen_width_mm": 0.15,
            "max_layers": 28,
            "board_thickness_mm": [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0, 2.4, 3.2],
            "copper_weight_oz": [0.5, 1.0, 2.0, 3.0],
        },
        "yield_margins": {
            "trace_width_margin": 0.03,
            "spacing_margin": 0.03,
            "drill_margin": 0.03,
            "annular_ring_margin": 0.02,
        },
        "base_cost_usd": 5.0,
        "per_sqcm": 0.03,
        "feature_costs": {
            "blind_vias": {"adder_pct": 25, "description": "Blind via processing"},
            "buried_vias": {"adder_pct": 45, "description": "Buried via processing"},
            "impedance_control": {"adder_usd": 10, "description": "Impedance-controlled stackup"},
            "enig": {"adder_usd": 4, "description": "ENIG surface finish"},
            "flex_rigid": {"adder_pct": 100, "description": "Flex-rigid construction"},
        },
        "surface_finishes": ["HASL", "HASL-LF", "ENIG", "OSP", "Immersion Silver", "Immersion Tin"],
        "notes": "Versatile fab, good for advanced prototypes",
    },
    "osh_park": {
        "fab_name": "OSH Park",
        "design_rules": {
            "min_trace_width_mm": 0.15,
            "min_trace_spacing_mm": 0.15,
            "min_via_drill_mm": 0.254,
            "min_via_pad_mm": 0.61,
            "min_annular_ring_mm": 0.18,
            "min_hole_to_hole_mm": 0.38,
            "min_hole_to_edge_mm": 0.38,
            "min_solder_mask_bridge_mm": 0.1,
            "min_silkscreen_width_mm": 0.15,
            "max_layers": 4,
            "board_thickness_mm": [0.8, 1.6],
            "copper_weight_oz": [1.0, 2.0],
        },
        "yield_margins": {
            "trace_width_margin": 0.05,
            "spacing_margin": 0.05,
            "drill_margin": 0.05,
            "annular_ring_margin": 0.03,
        },
        "base_cost_usd": 0.0,
        "per_sqcm": 0.22,
        "feature_costs": {},
        "surface_finishes": ["ENIG"],
        "notes": "Purple boards, per-area pricing, no blind/buried vias, ENIG only",
    },
    "eurocircuits": {
        "fab_name": "Eurocircuits",
        "design_rules": {
            "min_trace_width_mm": 0.10,
            "min_trace_spacing_mm": 0.10,
            "min_via_drill_mm": 0.2,
            "min_via_pad_mm": 0.45,
            "min_annular_ring_mm": 0.125,
            "min_hole_to_hole_mm": 0.25,
            "min_hole_to_edge_mm": 0.3,
            "min_solder_mask_bridge_mm": 0.1,
            "min_silkscreen_width_mm": 0.15,
            "max_layers": 16,
            "board_thickness_mm": [0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0],
            "copper_weight_oz": [0.5, 1.0, 2.0],
        },
        "yield_margins": {
            "trace_width_margin": 0.03,
            "spacing_margin": 0.03,
            "drill_margin": 0.03,
            "annular_ring_margin": 0.025,
        },
        "base_cost_usd": 30.0,
        "per_sqcm": 0.08,
        "feature_costs": {
            "blind_vias": {"adder_pct": 35, "description": "Blind via sequential lamination"},
            "impedance_control": {"adder_usd": 20, "description": "Impedance-controlled stackup"},
            "enig": {"adder_usd": 8, "description": "ENIG surface finish"},
        },
        "surface_finishes": ["HASL", "HASL-LF", "ENIG", "OSP", "Immersion Silver"],
        "notes": "European fab, high quality, detailed DFM analysis included",
    },
}


class FabDesignRules(BaseModel):
    """Optimized design rules for a specific fab."""
    min_trace_width_mm: float
    min_trace_spacing_mm: float
    min_via_drill_mm: float
    min_via_pad_mm: float
    min_annular_ring_mm: float
    min_hole_to_hole_mm: float
    min_hole_to_edge_mm: float
    min_solder_mask_bridge_mm: float
    min_silkscreen_width_mm: float
    max_layers: int
    recommended_trace_width_mm: float = Field(
        description="Recommended minimum trace width (above fab minimum for yield)"
    )
    recommended_spacing_mm: float = Field(
        description="Recommended minimum spacing (above fab minimum for yield)"
    )
    recommended_via_drill_mm: float = Field(
        description="Recommended via drill (above fab minimum for yield)"
    )


class FeatureCost(BaseModel):
    """Cost impact of a specific PCB feature."""
    feature: str
    description: str
    cost_type: str = Field(description="adder_pct or adder_usd")
    cost_value: float
    required: bool = Field(default=False, description="Whether the board requires this feature")


class FabOptimizedConfig(BaseModel):
    """Fab-optimized configuration for manufacturing."""
    fab_name: str
    design_rules: FabDesignRules
    cost_estimate: float = Field(description="Estimated cost in USD for a standard 5-board order")
    yield_margin_notes: list[str] = Field(default_factory=list)
    feature_costs: list[FeatureCost] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    surface_finish: str = Field(default="HASL")
    suggested_stackup: dict[str, Any] = Field(default_factory=dict)
    llm_recommendations: str = Field(default="")


FAB_ROUTER_SYSTEM_PROMPT = """\
You are a PCB manufacturing engineer who optimizes designs for specific fabrication \
houses. You know the capabilities, pricing structures, and yield characteristics of \
major PCB fabs.

Given a fab profile and board design, you must:
1. Set optimal design rules with margins above minimums for maximum yield
2. Identify features that incur extra cost (blind vias, impedance control, ENIG, etc.)
3. Suggest cost-saving alternatives where possible
4. Recommend surface finish based on the design requirements
5. Flag any board features incompatible with the chosen fab

Respond with a JSON object:
{
  "optimized_rules": {
    "trace_width_mm": N, "spacing_mm": N, "via_drill_mm": N,
    "rationale": "..."
  },
  "cost_analysis": {
    "base_cost": N, "feature_adders": [{"feature": "...", "cost": N}],
    "total_estimate": N
  },
  "surface_finish_recommendation": "...",
  "stackup_suggestion": {...},
  "yield_notes": ["..."],
  "warnings": ["..."],
  "cost_saving_tips": ["..."]
}
"""


class ManufacturingAwareRouter:
    """R9: Configure design rules optimized for a specific fabrication house.

    Selects from built-in fab profiles, applies yield margins, estimates costs,
    and identifies features that trigger cost adders.
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        openai_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        openai_model: str = "gpt-4o",
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            openai_api_key=openai_api_key,
            anthropic_model=anthropic_model,
            openai_model=openai_model,
        )

    @staticmethod
    def available_fabs() -> list[str]:
        """Return list of available fab profile names."""
        return list(FAB_PROFILES_EXTENDED.keys()) + ["custom"]

    async def configure_for_fab(
        self,
        fab_name: str,
        board_context: dict,
    ) -> FabOptimizedConfig:
        """Generate fab-optimized design configuration.

        Args:
            fab_name: Fab profile key (e.g. "jlcpcb_standard", "pcbway", "osh_park",
                "eurocircuits", "custom") or a free-form name for LLM lookup.
            board_context: Board info including layer_count, dimensions, features used,
                impedance_controlled, blind_vias, etc.

        Returns:
            FabOptimizedConfig with optimized design rules, cost estimate, and warnings.
        """
        profile_key = fab_name.lower().replace(" ", "_").replace("-", "_")
        profile = FAB_PROFILES_EXTENDED.get(profile_key)

        if profile is None:
            # Try fuzzy match
            for key, p in FAB_PROFILES_EXTENDED.items():
                if fab_name.lower() in key or fab_name.lower() in p["fab_name"].lower():
                    profile = p
                    break

        if profile is None:
            # Use LLM to determine appropriate rules for unknown fab
            profile = FAB_PROFILES_EXTENDED["jlcpcb_advanced"]
            custom_fab = True
        else:
            custom_fab = False

        dr = profile["design_rules"]
        ym = profile["yield_margins"]

        # Apply yield margins above minimums
        rec_trace = dr["min_trace_width_mm"] + ym["trace_width_margin"]
        rec_spacing = dr["min_trace_spacing_mm"] + ym["spacing_margin"]
        rec_via = dr["min_via_drill_mm"] + ym["drill_margin"]
        rec_annular = dr["min_annular_ring_mm"] + ym["annular_ring_margin"]

        design_rules = FabDesignRules(
            min_trace_width_mm=dr["min_trace_width_mm"],
            min_trace_spacing_mm=dr["min_trace_spacing_mm"],
            min_via_drill_mm=dr["min_via_drill_mm"],
            min_via_pad_mm=dr["min_via_pad_mm"],
            min_annular_ring_mm=dr["min_annular_ring_mm"],
            min_hole_to_hole_mm=dr["min_hole_to_hole_mm"],
            min_hole_to_edge_mm=dr["min_hole_to_edge_mm"],
            min_solder_mask_bridge_mm=dr["min_solder_mask_bridge_mm"],
            min_silkscreen_width_mm=dr["min_silkscreen_width_mm"],
            max_layers=dr["max_layers"],
            recommended_trace_width_mm=round(rec_trace, 3),
            recommended_spacing_mm=round(rec_spacing, 3),
            recommended_via_drill_mm=round(rec_via, 3),
        )

        # Yield margin notes
        yield_notes = [
            f"Trace width: fab minimum {dr['min_trace_width_mm']}mm, "
            f"recommended {rec_trace:.3f}mm (+{ym['trace_width_margin']}mm margin for yield)",
            f"Spacing: fab minimum {dr['min_trace_spacing_mm']}mm, "
            f"recommended {rec_spacing:.3f}mm (+{ym['spacing_margin']}mm margin)",
            f"Via drill: fab minimum {dr['min_via_drill_mm']}mm, "
            f"recommended {rec_via:.3f}mm (+{ym['drill_margin']}mm margin)",
            f"Annular ring: fab minimum {dr['min_annular_ring_mm']}mm, "
            f"recommended {rec_annular:.3f}mm (+{ym['annular_ring_margin']}mm margin)",
        ]

        # Cost estimation
        board_w = float(board_context.get("board_width_mm", 50))
        board_h = float(board_context.get("board_height_mm", 50))
        area_sqcm = (board_w * board_h) / 100.0
        base_cost = profile["base_cost_usd"] + area_sqcm * profile["per_sqcm"]
        total_cost = base_cost

        feature_costs: list[FeatureCost] = []
        warnings: list[str] = []

        # Check board features against fab capabilities
        layer_count = int(board_context.get("layer_count", 2))
        if layer_count > dr["max_layers"]:
            warnings.append(
                f"Board has {layer_count} layers but {profile['fab_name']} "
                f"supports max {dr['max_layers']} layers"
            )

        # Check for cost-adding features
        board_features = board_context.get("features", {})

        for feature_key, cost_info in profile.get("feature_costs", {}).items():
            is_used = board_features.get(feature_key, False)
            cost_type = "adder_pct" if "adder_pct" in cost_info else "adder_usd"
            cost_val = cost_info.get("adder_pct", cost_info.get("adder_usd", 0))

            fc = FeatureCost(
                feature=feature_key,
                description=cost_info.get("description", feature_key),
                cost_type=cost_type,
                cost_value=cost_val,
                required=bool(is_used),
            )
            feature_costs.append(fc)

            if is_used:
                if cost_type == "adder_pct":
                    adder = base_cost * cost_val / 100.0
                    total_cost += adder
                else:
                    total_cost += cost_val

        # Determine surface finish
        surface_finish = "HASL"
        has_fine_pitch = board_context.get("has_fine_pitch_bga", False)
        has_rf = board_context.get("has_rf_components", False)
        if has_fine_pitch or has_rf:
            if "ENIG" in profile.get("surface_finishes", []):
                surface_finish = "ENIG"
                warnings.append(
                    "ENIG recommended for fine-pitch BGA/RF components "
                    "(flatter pad surface for reliable soldering)"
                )
            elif "OSP" in profile.get("surface_finishes", []):
                surface_finish = "OSP"

        # LLM analysis for additional recommendations
        user_msg = (
            f"Optimize this PCB design for manufacturing at {profile['fab_name']}.\n\n"
            f"## Fab Profile\n```json\n{json.dumps(profile, indent=2, default=str)}\n```\n\n"
            f"## Board Context\n```json\n{json.dumps(board_context, indent=2, default=str)}\n```\n\n"
            f"## Calculated Design Rules\n"
            f"- Recommended trace: {rec_trace:.3f}mm\n"
            f"- Recommended spacing: {rec_spacing:.3f}mm\n"
            f"- Recommended via drill: {rec_via:.3f}mm\n"
            f"- Surface finish: {surface_finish}\n"
            f"- Estimated cost: ${total_cost:.2f}\n\n"
            "Provide additional optimization recommendations and cost-saving tips."
        )

        llm_result = await self._llm.query(
            system_prompt=FAB_ROUTER_SYSTEM_PROMPT,
            user_message=user_msg,
        )

        # Integrate LLM warnings and tips
        for w in llm_result.get("warnings", []):
            if isinstance(w, str) and w not in warnings:
                warnings.append(w)

        for tip in llm_result.get("cost_saving_tips", []):
            if isinstance(tip, str):
                yield_notes.append(f"Cost saving: {tip}")

        llm_recommendations = json.dumps(llm_result, indent=2, default=str)

        return FabOptimizedConfig(
            fab_name=profile["fab_name"] if not custom_fab else f"Custom ({fab_name})",
            design_rules=design_rules,
            cost_estimate=round(total_cost, 2),
            yield_margin_notes=yield_notes,
            feature_costs=feature_costs,
            warnings=warnings,
            surface_finish=surface_finish,
            suggested_stackup=llm_result.get("stackup_suggestion", {}),
            llm_recommendations=llm_recommendations,
        )


# ============================================================================
# R10: Style Matching Router
# ============================================================================

class RoutingStyleProfile(BaseModel):
    """Captured routing style from manually routed traces."""
    angle_preference: str = Field(
        description="Dominant angle style: '45_degree', '90_degree', 'any_angle', 'curved'"
    )
    angle_distribution: dict[str, float] = Field(
        default_factory=dict,
        description="Distribution of angle types observed (fraction 0-1)",
    )
    clearance_margin_factor: float = Field(
        description="Ratio of actual clearance to minimum required (e.g. 1.5 = 50% extra)"
    )
    via_placement_pattern: str = Field(
        description="Observed via style: 'minimal', 'generous', 'symmetric', 'near_pad'"
    )
    width_preferences: dict[str, float] = Field(
        default_factory=dict,
        description="Net class/type -> preferred width in mm",
    )
    layer_preferences: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Signal type -> preferred layer list",
    )
    avg_segment_length_mm: float = Field(default=0.0)
    corner_style: str = Field(
        default="chamfered",
        description="Corner treatment: 'chamfered', 'rounded', 'sharp'",
    )
    symmetry_tendency: float = Field(
        default=0.0,
        description="How much the router prefers symmetric layouts (0-1)",
    )
    via_count_per_net_avg: float = Field(default=0.0)
    complexity_score: float = Field(
        default=0.5,
        description="How complex the routing style is (0=simple straight, 1=complex)",
    )
    raw_statistics: dict[str, Any] = Field(default_factory=dict)


class StyledRoutingConstraint(BaseModel):
    """A single routing constraint derived from the style profile."""
    constraint_type: str
    description: str
    value: Any = Field(default=None)
    priority: str = Field(default="preferred")


class StyledRoutingStrategy(BaseModel):
    """Routing strategy that matches a captured style profile."""
    style_applied: str = Field(description="Name/summary of the applied style")
    per_net_constraints: dict[str, list[StyledRoutingConstraint]] = Field(default_factory=dict)
    global_constraints: list[StyledRoutingConstraint] = Field(default_factory=list)
    cost_weights: dict[str, float] = Field(default_factory=dict)
    notes: list[str] = Field(default_factory=list)
    llm_analysis: str = Field(default="")


STYLE_LEARN_SYSTEM_PROMPT = """\
You are a PCB routing style analyst. Given statistics from manually routed traces, \
you characterize the engineer's routing preferences and style.

Analyze the provided routing statistics and determine:
1. Preferred angle style (45-degree, 90-degree, any-angle, curved)
2. Clearance preferences (how much margin above minimum)
3. Via usage patterns (minimal, generous, symmetric near pads)
4. Width preferences by signal type
5. Layer usage preferences
6. Corner treatment style (chamfered, rounded, sharp)
7. Overall complexity and symmetry tendencies

Respond with JSON:
{
  "angle_preference": "45_degree|90_degree|any_angle|curved",
  "clearance_margin_factor": N,
  "via_placement_pattern": "minimal|generous|symmetric|near_pad",
  "corner_style": "chamfered|rounded|sharp",
  "symmetry_tendency": N,
  "width_preferences": {"signal_type": width_mm, ...},
  "layer_preferences": {"signal_type": ["layer1", ...], ...},
  "style_summary": "...",
  "complexity_score": N
}
"""

STYLE_APPLY_SYSTEM_PROMPT = """\
You are a PCB routing engine that replicates a specific engineer's routing style. \
Given a routing style profile and a set of nets to route, you generate per-net \
routing constraints that match the style.

For each net, determine:
1. Preferred trace width (matching the style's width preferences for that net type)
2. Layer assignment (matching style's layer preferences)
3. Angle constraints (matching style's angle preference)
4. Via budget (matching style's via usage pattern)
5. Clearance settings (matching style's margin factor)

Also set global cost weights that bias the router toward the observed style.

Respond with JSON:
{
  "style_applied": "summary of style",
  "per_net_constraints": {
    "net_name": [
      {"constraint_type": "width|angle|layer|via_budget|clearance",
       "description": "...", "value": ..., "priority": "required|preferred"}
    ]
  },
  "global_constraints": [
    {"constraint_type": "...", "description": "...", "value": ..., "priority": "..."}
  ],
  "cost_weights": {"wire_length": N, "via_count": N, "congestion": N, "angle_penalty": N},
  "notes": ["..."]
}
"""


class StyleMatchingRouter:
    """R10: Learn routing style from manual traces and replay it on new nets.

    Analyzes manually routed traces to extract angle preferences, clearance
    margins, via patterns, width preferences, and layer usage. Then applies
    the learned style to new nets through constraint generation.
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        openai_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        openai_model: str = "gpt-4o",
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            openai_api_key=openai_api_key,
            anthropic_model=anthropic_model,
            openai_model=openai_model,
        )

    @staticmethod
    def _analyze_angles(segments: list[dict]) -> dict[str, float]:
        """Analyze angle distribution from trace segments."""
        angle_counts: Counter[str] = Counter()
        total = 0

        for seg in segments:
            x1 = float(seg.get("start_x", seg.get("x1", 0)))
            y1 = float(seg.get("start_y", seg.get("y1", 0)))
            x2 = float(seg.get("end_x", seg.get("x2", 0)))
            y2 = float(seg.get("end_y", seg.get("y2", 0)))

            dx = x2 - x1
            dy = y2 - y1
            if abs(dx) < 0.001 and abs(dy) < 0.001:
                continue

            angle = abs(math.degrees(math.atan2(dy, dx))) % 180

            if angle < 2 or abs(angle - 180) < 2 or abs(angle - 90) < 2:
                angle_counts["90_degree"] += 1
            elif abs(angle - 45) < 5 or abs(angle - 135) < 5:
                angle_counts["45_degree"] += 1
            else:
                angle_counts["any_angle"] += 1
            total += 1

        if total == 0:
            return {"45_degree": 0.5, "90_degree": 0.5}

        return {k: round(v / total, 3) for k, v in angle_counts.items()}

    @staticmethod
    def _analyze_clearances(routes: list[dict], min_clearance: float) -> float:
        """Compute average clearance margin factor from observed clearances."""
        clearances: list[float] = []
        for route in routes:
            observed = float(route.get("min_clearance_mm", route.get("clearance", 0)))
            if observed > 0 and min_clearance > 0:
                clearances.append(observed / min_clearance)
        if not clearances:
            return 1.0
        return round(statistics.mean(clearances), 2)

    @staticmethod
    def _analyze_via_pattern(routes: list[dict]) -> tuple[str, float]:
        """Determine via placement pattern from routes."""
        via_counts: list[int] = []
        near_pad_count = 0
        total_vias = 0

        for route in routes:
            vias = route.get("vias", [])
            via_counts.append(len(vias))
            total_vias += len(vias)
            for v in vias:
                if v.get("near_pad", False) or float(v.get("dist_to_pad_mm", 999)) < 1.0:
                    near_pad_count += 1

        avg_vias = statistics.mean(via_counts) if via_counts else 0

        if avg_vias < 0.5:
            pattern = "minimal"
        elif total_vias > 0 and near_pad_count / total_vias > 0.7:
            pattern = "near_pad"
        elif avg_vias > 3:
            pattern = "generous"
        else:
            pattern = "symmetric"

        return pattern, round(avg_vias, 2)

    @staticmethod
    def _analyze_widths(routes: list[dict]) -> dict[str, float]:
        """Collect width preferences by net class."""
        width_by_class: dict[str, list[float]] = defaultdict(list)
        for route in routes:
            net_class = route.get("net_class", route.get("type", "signal"))
            for seg in route.get("segments", []):
                w = float(seg.get("width", seg.get("w", 0)))
                if w > 0:
                    width_by_class[net_class].append(w)

        return {
            cls: round(statistics.median(widths), 3)
            for cls, widths in width_by_class.items()
            if widths
        }

    @staticmethod
    def _analyze_layers(routes: list[dict]) -> dict[str, list[str]]:
        """Collect layer preferences by net class."""
        layer_by_class: dict[str, Counter[str]] = defaultdict(Counter)
        for route in routes:
            net_class = route.get("net_class", route.get("type", "signal"))
            for seg in route.get("segments", []):
                layer = seg.get("layer", "")
                if layer:
                    layer_by_class[net_class][layer] += 1

        result: dict[str, list[str]] = {}
        for cls, counter in layer_by_class.items():
            result[cls] = [layer for layer, _ in counter.most_common()]
        return result

    @staticmethod
    def _analyze_segment_lengths(routes: list[dict]) -> float:
        """Average segment length across all routes."""
        lengths: list[float] = []
        for route in routes:
            for seg in route.get("segments", []):
                x1 = float(seg.get("start_x", seg.get("x1", 0)))
                y1 = float(seg.get("start_y", seg.get("y1", 0)))
                x2 = float(seg.get("end_x", seg.get("x2", 0)))
                y2 = float(seg.get("end_y", seg.get("y2", 0)))
                length = math.sqrt((x2 - x1)**2 + (y2 - y1)**2)
                if length > 0.01:
                    lengths.append(length)
        return round(statistics.mean(lengths), 2) if lengths else 0.0

    async def learn_style(
        self,
        manual_routes: list[dict],
    ) -> RoutingStyleProfile:
        """Learn a routing style from manually routed traces.

        Args:
            manual_routes: List of route dicts, each with:
                net_name, net_class/type, segments (list of {start_x, start_y,
                end_x, end_y, width, layer}), vias (list of {x, y, layer_from,
                layer_to, near_pad, dist_to_pad_mm}), min_clearance_mm

        Returns:
            RoutingStyleProfile capturing the observed style.
        """
        # Phase 1: Statistical analysis
        all_segments: list[dict] = []
        for route in manual_routes:
            all_segments.extend(route.get("segments", []))

        angle_dist = self._analyze_angles(all_segments)
        clearance_factor = self._analyze_clearances(manual_routes, 0.15)
        via_pattern, avg_vias = self._analyze_via_pattern(manual_routes)
        width_prefs = self._analyze_widths(manual_routes)
        layer_prefs = self._analyze_layers(manual_routes)
        avg_seg_len = self._analyze_segment_lengths(manual_routes)

        # Determine dominant angle style
        if angle_dist.get("45_degree", 0) > 0.6:
            angle_pref = "45_degree"
        elif angle_dist.get("90_degree", 0) > 0.6:
            angle_pref = "90_degree"
        elif angle_dist.get("any_angle", 0) > 0.4:
            angle_pref = "any_angle"
        else:
            angle_pref = "45_degree"

        raw_stats = {
            "num_routes": len(manual_routes),
            "num_segments": len(all_segments),
            "angle_distribution": angle_dist,
            "avg_vias_per_net": avg_vias,
            "avg_segment_length_mm": avg_seg_len,
            "width_preferences": width_prefs,
            "layer_preferences": layer_prefs,
            "clearance_factor": clearance_factor,
        }

        # Phase 2: LLM style interpretation
        user_msg = (
            "Analyze this routing style from manually routed traces.\n\n"
            f"## Statistics\n```json\n{json.dumps(raw_stats, indent=2)}\n```\n\n"
            f"## Sample Routes\n```json\n"
            f"{json.dumps(manual_routes[:5], indent=2, default=str)}\n```\n\n"
            "Characterize the routing style and provide your assessment."
        )

        llm_result = await self._llm.query(
            system_prompt=STYLE_LEARN_SYSTEM_PROMPT,
            user_message=user_msg,
        )

        # Merge LLM insights with computed statistics
        llm_angle = llm_result.get("angle_preference", angle_pref)
        llm_corner = llm_result.get("corner_style", "chamfered")
        llm_symmetry = float(llm_result.get("symmetry_tendency", 0.5))
        llm_complexity = float(llm_result.get("complexity_score", 0.5))

        # LLM may override if it has better context
        if llm_angle in ("45_degree", "90_degree", "any_angle", "curved"):
            angle_pref = llm_angle

        llm_width_prefs = llm_result.get("width_preferences", {})
        for k, v in llm_width_prefs.items():
            if k not in width_prefs:
                try:
                    width_prefs[k] = float(v)
                except (TypeError, ValueError):
                    pass

        llm_layer_prefs = llm_result.get("layer_preferences", {})
        for k, v in llm_layer_prefs.items():
            if k not in layer_prefs and isinstance(v, list):
                layer_prefs[k] = v

        return RoutingStyleProfile(
            angle_preference=angle_pref,
            angle_distribution=angle_dist,
            clearance_margin_factor=clearance_factor,
            via_placement_pattern=via_pattern,
            width_preferences=width_prefs,
            layer_preferences=layer_prefs,
            avg_segment_length_mm=avg_seg_len,
            corner_style=llm_corner,
            symmetry_tendency=llm_symmetry,
            via_count_per_net_avg=avg_vias,
            complexity_score=llm_complexity,
            raw_statistics=raw_stats,
        )

    async def apply_style(
        self,
        style: RoutingStyleProfile,
        nets_to_route: list,
    ) -> StyledRoutingStrategy:
        """Apply a learned routing style to a set of nets.

        Args:
            style: Previously learned RoutingStyleProfile.
            nets_to_route: List of net dicts or net name strings to apply the style to.

        Returns:
            StyledRoutingStrategy with per-net constraints matching the style.
        """
        # Normalize nets_to_route
        net_list: list[dict[str, Any]] = []
        for net in nets_to_route:
            if isinstance(net, str):
                net_list.append({"net_name": net})
            elif isinstance(net, dict):
                net_list.append(net)

        user_msg = (
            "Apply this routing style to the following nets.\n\n"
            f"## Style Profile\n```json\n{style.model_dump_json(indent=2)}\n```\n\n"
            f"## Nets to Route\n```json\n{json.dumps(net_list, indent=2, default=str)}\n```\n\n"
            "Generate per-net constraints and global cost weights that replicate this style."
        )

        llm_result = await self._llm.query(
            system_prompt=STYLE_APPLY_SYSTEM_PROMPT,
            user_message=user_msg,
        )

        # Build per-net constraints from LLM output
        per_net: dict[str, list[StyledRoutingConstraint]] = {}
        for net_name, constraints_raw in llm_result.get("per_net_constraints", {}).items():
            constraints: list[StyledRoutingConstraint] = []
            if isinstance(constraints_raw, list):
                for c in constraints_raw:
                    if isinstance(c, dict):
                        constraints.append(StyledRoutingConstraint(
                            constraint_type=c.get("constraint_type", ""),
                            description=c.get("description", ""),
                            value=c.get("value"),
                            priority=c.get("priority", "preferred"),
                        ))
            per_net[net_name] = constraints

        # Add default constraints for nets not covered by LLM
        for net_info in net_list:
            net_name = net_info.get("net_name", net_info.get("name", ""))
            if net_name and net_name not in per_net:
                net_class = net_info.get("net_class", "signal")
                default_constraints = [
                    StyledRoutingConstraint(
                        constraint_type="angle",
                        description=f"Use {style.angle_preference} routing style",
                        value=style.angle_preference,
                        priority="preferred",
                    ),
                    StyledRoutingConstraint(
                        constraint_type="clearance",
                        description=f"Maintain {style.clearance_margin_factor}x clearance margin",
                        value=style.clearance_margin_factor,
                        priority="preferred",
                    ),
                ]
                if net_class in style.width_preferences:
                    default_constraints.append(StyledRoutingConstraint(
                        constraint_type="width",
                        description=f"Use preferred width for {net_class}",
                        value=style.width_preferences[net_class],
                        priority="preferred",
                    ))
                if net_class in style.layer_preferences:
                    default_constraints.append(StyledRoutingConstraint(
                        constraint_type="layer",
                        description=f"Prefer layers {style.layer_preferences[net_class]}",
                        value=style.layer_preferences[net_class],
                        priority="preferred",
                    ))
                per_net[net_name] = default_constraints

        # Global constraints
        global_constraints: list[StyledRoutingConstraint] = []
        for gc in llm_result.get("global_constraints", []):
            if isinstance(gc, dict):
                global_constraints.append(StyledRoutingConstraint(
                    constraint_type=gc.get("constraint_type", ""),
                    description=gc.get("description", ""),
                    value=gc.get("value"),
                    priority=gc.get("priority", "preferred"),
                ))

        if not global_constraints:
            global_constraints = [
                StyledRoutingConstraint(
                    constraint_type="angle",
                    description=f"Global angle preference: {style.angle_preference}",
                    value=style.angle_preference,
                    priority="preferred",
                ),
                StyledRoutingConstraint(
                    constraint_type="corner",
                    description=f"Corner style: {style.corner_style}",
                    value=style.corner_style,
                    priority="preferred",
                ),
                StyledRoutingConstraint(
                    constraint_type="via_budget",
                    description=f"Target ~{style.via_count_per_net_avg:.1f} vias per net average",
                    value=style.via_count_per_net_avg,
                    priority="preferred",
                ),
            ]

        # Cost weights
        cost_weights = llm_result.get("cost_weights", {})
        if not cost_weights:
            # Derive from style
            cost_weights = {
                "wire_length": 0.5,
                "via_count": 0.7 if style.via_placement_pattern == "minimal" else 0.3,
                "congestion": 0.4,
                "angle_penalty": 0.8 if style.angle_preference == "45_degree" else 0.3,
            }

        return StyledRoutingStrategy(
            style_applied=f"{style.angle_preference} style, "
                         f"{style.via_placement_pattern} vias, "
                         f"{style.corner_style} corners",
            per_net_constraints=per_net,
            global_constraints=global_constraints,
            cost_weights=cost_weights,
            notes=llm_result.get("notes", []),
            llm_analysis=json.dumps(llm_result, indent=2, default=str),
        )


# ============================================================================
# R11: Route Critique
# ============================================================================

class CritiqueFinding(BaseModel):
    """A single finding from the routing critique."""
    category: str = Field(
        description="Category: clearance, impedance, thermal, emc, si, "
        "manufacturing, power_integrity, signal_integrity, crosstalk"
    )
    severity: str = Field(description="info, warning, error, critical")
    location: dict[str, Any] = Field(
        default_factory=dict,
        description="Location on board: {x, y, layer, net_name, component_ref}",
    )
    geometric_data: dict[str, Any] = Field(
        default_factory=dict,
        description="Geometric details: {trace_width, spacing, length, via_count, etc.}",
    )
    physics_explanation: str = Field(
        description="Engineering explanation of why this is an issue"
    )
    emc_impact_estimate: str = Field(
        default="",
        description="Estimated EMC/SI impact (e.g. 'radiated emissions +6dB at 500MHz')",
    )
    fixes: list[dict[str, Any]] = Field(
        default_factory=list,
        description="Ranked fixes: [{description, effort, effectiveness, auto_fixable}]",
    )
    auto_fixable: bool = Field(
        default=False,
        description="Whether this issue can be auto-fixed by the router",
    )


class RoutingCritiqueReport(BaseModel):
    """Complete routing critique report."""
    overall_score: float = Field(
        description="Overall routing quality score 0-100"
    )
    findings: list[CritiqueFinding] = Field(default_factory=list)
    summary: str = Field(default="")
    category_scores: dict[str, float] = Field(
        default_factory=dict,
        description="Per-category scores: {category: score}",
    )
    auto_fixable_count: int = Field(default=0)
    critical_count: int = Field(default=0)
    llm_analysis: str = Field(default="")


CRITIQUE_SYSTEM_PROMPT = """\
You are a senior PCB design reviewer performing a post-routing critique. You combine \
DRC results, signal integrity analysis, and manufacturing checks into a comprehensive \
engineering assessment.

For each issue found, you must:
1. Explain the physics/engineering significance (not just "violation found")
2. Estimate the EMC/SI impact quantitatively where possible (dB, mV, ps)
3. Rank possible fixes by effort vs effectiveness
4. Mark whether each fix can be automated

Categories to evaluate:
- Clearance: trace spacing, copper-to-edge, pad-to-via
- Impedance: controlled impedance deviations, return path discontinuities
- Crosstalk: parallel trace coupling, aggressor/victim identification
- Power integrity: decoupling, plane splits, via stitching
- EMC: loop areas, unshielded high-speed traces, clock routing
- Manufacturing: acid traps, starved thermals, solder bridging risk
- Thermal: current capacity, via thermal relief

Scoring: Start at 100, deduct based on severity:
- Critical: -15 per issue
- Error: -8 per issue
- Warning: -3 per issue
- Info: -0.5 per issue

Respond with JSON:
{
  "overall_score": N,
  "findings": [
    {
      "category": "...",
      "severity": "info|warning|error|critical",
      "location": {"x": N, "y": N, "layer": "...", "net_name": "...", "component_ref": "..."},
      "geometric_data": {"trace_width_mm": N, "spacing_mm": N, "length_mm": N, ...},
      "physics_explanation": "...",
      "emc_impact_estimate": "...",
      "fixes": [
        {"description": "...", "effort": "low|medium|high",
         "effectiveness": "low|medium|high", "auto_fixable": true|false}
      ],
      "auto_fixable": true|false
    }
  ],
  "category_scores": {"clearance": N, "impedance": N, ...},
  "summary": "..."
}
"""


class RouteCritique:
    """R11: Post-routing review combining all solver outputs into an engineering critique.

    Analyzes DRC results, SI results, and board context to produce a comprehensive
    critique with physics explanations, EMC impact estimates, and ranked fixes.
    """

    def __init__(
        self,
        anthropic_api_key: str | None = None,
        openai_api_key: str | None = None,
        anthropic_model: str = "claude-sonnet-4-20250514",
        openai_model: str = "gpt-4o",
    ) -> None:
        self._llm = _DualProviderLLM(
            anthropic_api_key=anthropic_api_key,
            openai_api_key=openai_api_key,
            anthropic_model=anthropic_model,
            openai_model=openai_model,
        )

    @staticmethod
    def _pre_analyze_drc(drc_results: dict) -> list[dict[str, Any]]:
        """Pre-process DRC results into categorized findings with physics context."""
        findings: list[dict[str, Any]] = []

        for violation in drc_results.get("violations", []):
            rule = violation.get("rule", "")
            severity_map = {
                "error": "error",
                "warning": "warning",
                "info": "info",
            }
            raw_severity = violation.get("severity", "warning")
            severity = severity_map.get(raw_severity, "warning")

            category = "clearance"
            if "impedance" in rule or "impedance" in str(violation.get("message", "")):
                category = "impedance"
            elif "current" in rule or "thermal" in rule:
                category = "thermal"
            elif "annular" in rule or "drill" in rule or "mask" in rule:
                category = "manufacturing"
            elif "spacing" in rule or "clearance" in rule:
                category = "clearance"

            loc = violation.get("location", {})
            if isinstance(loc, (list, tuple)) and len(loc) >= 2:
                loc = {"x": loc[0], "y": loc[1]}

            findings.append({
                "category": category,
                "severity": severity,
                "location": loc,
                "drc_rule": rule,
                "drc_message": violation.get("message", ""),
                "measured_value": violation.get("measured_value"),
                "required_value": violation.get("required_value"),
            })

        return findings

    @staticmethod
    def _pre_analyze_si(si_results: dict) -> list[dict[str, Any]]:
        """Pre-process SI results into categorized findings."""
        findings: list[dict[str, Any]] = []

        for issue in si_results.get("impedance_violations", []):
            findings.append({
                "category": "impedance",
                "severity": "error" if abs(
                    float(issue.get("deviation_pct", 0))
                ) > 15 else "warning",
                "net_name": issue.get("net_name", ""),
                "target_ohm": issue.get("target_ohm"),
                "actual_ohm": issue.get("actual_ohm"),
                "deviation_pct": issue.get("deviation_pct"),
            })

        for issue in si_results.get("crosstalk_violations", []):
            findings.append({
                "category": "crosstalk",
                "severity": "error" if float(
                    issue.get("coupling_pct", 0)
                ) > 10 else "warning",
                "aggressor": issue.get("aggressor_net", ""),
                "victim": issue.get("victim_net", ""),
                "coupling_pct": issue.get("coupling_pct"),
                "parallel_length_mm": issue.get("parallel_length_mm"),
            })

        for issue in si_results.get("timing_violations", []):
            findings.append({
                "category": "signal_integrity",
                "severity": "error",
                "net_name": issue.get("net_name", ""),
                "skew_ps": issue.get("skew_ps"),
                "max_allowed_ps": issue.get("max_allowed_ps"),
            })

        for issue in si_results.get("return_path_breaks", []):
            findings.append({
                "category": "emc",
                "severity": "critical",
                "net_name": issue.get("net_name", ""),
                "break_location": issue.get("location", {}),
                "description": "Return path discontinuity - signal crosses plane split",
            })

        return findings

    @staticmethod
    def _compute_base_score(findings: list[CritiqueFinding]) -> float:
        """Compute the base quality score from findings."""
        score = 100.0
        severity_deductions = {
            "critical": 15.0,
            "error": 8.0,
            "warning": 3.0,
            "info": 0.5,
        }
        for f in findings:
            score -= severity_deductions.get(f.severity, 1.0)
        return max(0.0, round(score, 1))

    @staticmethod
    def _compute_category_scores(findings: list[CritiqueFinding]) -> dict[str, float]:
        """Compute per-category scores."""
        categories: set[str] = set()
        category_deductions: dict[str, float] = defaultdict(float)
        severity_deductions = {
            "critical": 15.0, "error": 8.0, "warning": 3.0, "info": 0.5,
        }

        for f in findings:
            categories.add(f.category)
            category_deductions[f.category] += severity_deductions.get(f.severity, 1.0)

        result: dict[str, float] = {}
        for cat in categories:
            result[cat] = max(0.0, round(100.0 - category_deductions[cat], 1))

        return result

    async def critique_routing(
        self,
        board_context: dict,
        drc_results: dict,
        si_results: dict | None = None,
    ) -> RoutingCritiqueReport:
        """Perform a comprehensive post-routing critique.

        Args:
            board_context: Board design information including stackup, components,
                traces, design rules.
            drc_results: DRC analysis results with violations list.
            si_results: Optional SI analysis results with impedance violations,
                crosstalk, timing issues, return path breaks.

        Returns:
            RoutingCritiqueReport with scored findings, physics explanations,
            EMC impact estimates, and ranked fixes.
        """
        # Phase 1: Pre-analyze DRC and SI results
        drc_findings = self._pre_analyze_drc(drc_results)
        si_findings = self._pre_analyze_si(si_results or {})

        all_pre_findings = drc_findings + si_findings

        # Phase 2: LLM deep analysis
        user_msg = (
            "Perform a comprehensive post-routing critique.\n\n"
            f"## Board Context\n```json\n"
            f"{json.dumps(board_context, indent=2, default=str)}\n```\n\n"
            f"## DRC Results\n```json\n"
            f"{json.dumps(drc_results, indent=2, default=str)}\n```\n\n"
        )

        if si_results:
            user_msg += (
                f"## SI Analysis Results\n```json\n"
                f"{json.dumps(si_results, indent=2, default=str)}\n```\n\n"
            )

        user_msg += (
            f"## Pre-analyzed Findings ({len(all_pre_findings)} issues)\n"
            f"```json\n{json.dumps(all_pre_findings, indent=2, default=str)}\n```\n\n"
            "For each finding:\n"
            "1. Explain the physics/engineering significance\n"
            "2. Estimate quantitative EMC/SI impact\n"
            "3. Rank fixes by effort vs effectiveness\n"
            "4. Mark auto-fixable issues\n\n"
            "Also identify any additional issues not caught by DRC/SI "
            "(e.g., EMC concerns, acid traps, thermal issues, power integrity)."
        )

        llm_result = await self._llm.query(
            system_prompt=CRITIQUE_SYSTEM_PROMPT,
            user_message=user_msg,
        )

        # Phase 3: Build structured findings
        findings: list[CritiqueFinding] = []

        for f_raw in llm_result.get("findings", []):
            if not isinstance(f_raw, dict):
                continue

            location = f_raw.get("location", {})
            if not isinstance(location, dict):
                location = {}

            geometric_data = f_raw.get("geometric_data", {})
            if not isinstance(geometric_data, dict):
                geometric_data = {}

            fixes_raw = f_raw.get("fixes", [])
            fixes: list[dict[str, Any]] = []
            for fix in fixes_raw:
                if isinstance(fix, dict):
                    fixes.append({
                        "description": fix.get("description", ""),
                        "effort": fix.get("effort", "medium"),
                        "effectiveness": fix.get("effectiveness", "medium"),
                        "auto_fixable": bool(fix.get("auto_fixable", False)),
                    })

            finding = CritiqueFinding(
                category=f_raw.get("category", "general"),
                severity=f_raw.get("severity", "warning"),
                location=location,
                geometric_data=geometric_data,
                physics_explanation=f_raw.get("physics_explanation", ""),
                emc_impact_estimate=f_raw.get("emc_impact_estimate", ""),
                fixes=fixes,
                auto_fixable=bool(f_raw.get("auto_fixable", False)),
            )
            findings.append(finding)

        # If LLM returned no findings, create them from pre-analysis
        if not findings and all_pre_findings:
            for pf in all_pre_findings:
                finding = CritiqueFinding(
                    category=pf.get("category", "general"),
                    severity=pf.get("severity", "warning"),
                    location=pf.get("location", {}),
                    geometric_data={
                        "measured_value": pf.get("measured_value"),
                        "required_value": pf.get("required_value"),
                    },
                    physics_explanation=pf.get("drc_message", pf.get("description", "")),
                    emc_impact_estimate="",
                    fixes=[],
                    auto_fixable=False,
                )
                findings.append(finding)

        # Phase 4: Scoring
        overall_score = self._compute_base_score(findings)

        # Override with LLM score if provided and reasonable
        llm_score = llm_result.get("overall_score")
        if isinstance(llm_score, (int, float)) and 0 <= llm_score <= 100:
            # Average our computed score with LLM's assessment
            overall_score = round((overall_score + float(llm_score)) / 2.0, 1)

        category_scores = self._compute_category_scores(findings)
        llm_cat_scores = llm_result.get("category_scores", {})
        if isinstance(llm_cat_scores, dict):
            for cat, score in llm_cat_scores.items():
                if isinstance(score, (int, float)):
                    if cat in category_scores:
                        category_scores[cat] = round(
                            (category_scores[cat] + float(score)) / 2.0, 1
                        )
                    else:
                        category_scores[cat] = round(float(score), 1)

        auto_fixable_count = sum(1 for f in findings if f.auto_fixable)
        critical_count = sum(1 for f in findings if f.severity == "critical")

        summary = llm_result.get("summary", "")
        if not summary:
            summary = (
                f"Routing critique: score {overall_score}/100. "
                f"{len(findings)} findings ({critical_count} critical, "
                f"{sum(1 for f in findings if f.severity == 'error')} errors, "
                f"{sum(1 for f in findings if f.severity == 'warning')} warnings). "
                f"{auto_fixable_count} auto-fixable."
            )

        return RoutingCritiqueReport(
            overall_score=overall_score,
            findings=findings,
            summary=summary,
            category_scores=category_scores,
            auto_fixable_count=auto_fixable_count,
            critical_count=critical_count,
            llm_analysis=json.dumps(llm_result, indent=2, default=str),
        )
