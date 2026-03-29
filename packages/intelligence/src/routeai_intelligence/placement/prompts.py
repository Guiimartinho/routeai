"""LLM prompt templates for PCB component placement.

Contains the system prompt and helper functions for generating placement
strategy prompts sent to the LLM.
"""

from __future__ import annotations

PLACEMENT_SYSTEM_PROMPT = """You are an expert PCB placement engineer with 20+ years of experience.
You follow IPC-7351 and IPC-2221B placement guidelines.

PLACEMENT RULES:
1. Decoupling capacitors MUST be within 2mm of their associated IC power pin
2. Crystal/oscillator MUST be within 5mm of the MCU clock pins
3. Connectors should be placed at board edges
4. Power section (regulators, inductors, bulk caps) should be grouped together
5. Analog and digital sections should be separated with ground plane isolation
6. High-current traces need wide paths - place components to minimize trace length
7. ESD protection components should be between connector and IC
8. Thermal pads/heatsinks need adequate clearance for airflow
9. Test points should be accessible from the board edge
10. Place ICs with pin 1 orientation consistent for manufacturing

ZONE PRIORITY (place in this order):
1. Connectors (define board interface)
2. Power section (establish power topology)
3. MCU/FPGA (central to most nets)
4. Decoupling caps (near their ICs)
5. Clock components (near MCU)
6. High-speed interfaces
7. Analog section (far from digital noise)
8. General digital
9. LEDs and indicators
10. Mechanical/mounting

For each component, explain WHY you placed it at that position.
Reference specific IPC standards or datasheet requirements.

Output JSON format:
{
    "board_size_mm": {"width": float, "height": float},
    "zones": [
        {
            "type": "POWER|DIGITAL|ANALOG|RF|CONNECTORS|CLOCK",
            "region_mm": {"x_min": float, "y_min": float, "x_max": float, "y_max": float},
            "components": [
                {
                    "ref": "U1",
                    "x_mm": 25.0,
                    "y_mm": 30.0,
                    "rotation_deg": 0,
                    "layer": "F.Cu",
                    "reason": "MCU centered for star routing topology"
                }
            ]
        }
    ],
    "critical_pairs": [
        {
            "a": "C1",
            "b": "U1",
            "actual_distance_mm": 1.5,
            "max_distance_mm": 2.0,
            "reason": "Decoupling cap for U1 VDD (pin 14)"
        }
    ],
    "ground_planes": ["In1.Cu"],
    "power_planes": ["In2.Cu"],
    "overall_reasoning": "..."
}
"""

PLACEMENT_EXPLAIN_PROMPT = """Given the following PCB placement strategy and component details,
explain why component {component_ref} was placed at its current position.

Include:
1. The functional reason (zone assignment, nearby components)
2. Any IPC standard or datasheet requirement driving the position
3. Signal integrity or thermal considerations
4. How this placement benefits overall routing

Placement Strategy:
{strategy_json}

Provide a clear, concise explanation suitable for a PCB designer.
"""


def build_placement_user_message(
    components_info: str,
    net_connectivity: str,
    zone_analysis: str,
    critical_pairs: str,
    board_width_mm: float,
    board_height_mm: float,
    layer_count: int,
    extra_constraints: str = "",
) -> str:
    """Build the user message for placement strategy generation.

    Args:
        components_info: JSON string of component list with values and packages.
        net_connectivity: JSON string of net connections.
        zone_analysis: JSON string of zone classification results.
        critical_pairs: JSON string of critical pair constraints.
        board_width_mm: Board width in mm.
        board_height_mm: Board height in mm.
        layer_count: Number of PCB layers.
        extra_constraints: Additional constraint text.

    Returns:
        Formatted user message string.
    """
    parts = [
        "Generate a complete placement strategy for the following PCB design.\n",
        f"## Board Dimensions\n"
        f"Width: {board_width_mm}mm, Height: {board_height_mm}mm, Layers: {layer_count}\n",
        f"## Components\n```json\n{components_info}\n```\n",
        f"## Net Connectivity\n```json\n{net_connectivity}\n```\n",
        f"## Zone Analysis\n```json\n{zone_analysis}\n```\n",
        f"## Critical Pairs\n```json\n{critical_pairs}\n```\n",
    ]

    if extra_constraints:
        parts.append(f"## Additional Constraints\n{extra_constraints}\n")

    parts.append(
        "Place all components within the board outline. Respect all critical pair "
        "distance constraints. Group components by zone. Explain the reasoning for "
        "each component's position. Respond with a single JSON object matching the "
        "output format specified in the system prompt."
    )

    return "\n".join(parts)
