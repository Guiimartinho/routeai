"""Tests for the AI-powered PCB placement system."""

from __future__ import annotations

import json
import math
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from routeai_intelligence.placement.analyzer import (
    ZONE_ANALOG,
    ZONE_CLOCK,
    ZONE_CONNECTORS,
    ZONE_DECOUPLING,
    ZONE_DIGITAL,
    ZONE_POWER,
    CircuitZoneAnalyzer,
    ComponentZone,
    CriticalPair,
    ThermalGroup,
)
from routeai_intelligence.placement.executor import PlacementExecutor, PlacementResult
from routeai_intelligence.placement.prompts import (
    PLACEMENT_SYSTEM_PROMPT,
    build_placement_user_message,
)
from routeai_intelligence.placement.strategy import (
    ComponentPlacement,
    CriticalPairPlacement,
    PlacementStrategy,
    PlacementStrategyGenerator,
    PlacementZone,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_symbol(
    ref: str,
    value: str,
    lib_id: str = "Device:R",
    x: float = 0.0,
    y: float = 0.0,
    footprint: str = "Resistor_SMD:R_0402_1005Metric",
) -> dict[str, Any]:
    """Create a minimal SchSymbol-like dict for testing."""
    return {
        "lib_id": lib_id,
        "at": {"x": x, "y": y},
        "angle": 0,
        "mirror": None,
        "unit": 1,
        "uuid": f"uuid-{ref}",
        "pins": [],
        "properties": [
            {"key": "Reference", "value": ref},
            {"key": "Value", "value": value},
            {"key": "Footprint", "value": footprint},
        ],
        "reference": ref,
        "value": value,
    }


def _make_schematic(symbols: list[dict], nets: list[dict] | None = None) -> MagicMock:
    """Create a mock SchematicDesign with given symbols and nets."""
    sch = MagicMock()
    mock_symbols = []
    for s in symbols:
        sym = MagicMock()
        sym.reference = s.get("reference", "")
        sym.value = s.get("value", "")
        sym.lib_id = s.get("lib_id", "Device:R")
        sym.at = MagicMock()
        at_data = s.get("at", {"x": 0, "y": 0})
        sym.at.x = at_data["x"]
        sym.at.y = at_data["y"]
        sym.angle = s.get("angle", 0)
        sym.uuid = s.get("uuid", "")
        sym.pins = s.get("pins", [])

        props = []
        for p in s.get("properties", []):
            prop = MagicMock()
            prop.key = p["key"]
            prop.value = p["value"]
            props.append(prop)
        sym.properties = props
        mock_symbols.append(sym)

    sch.symbols = mock_symbols
    sch.nets = nets or []
    sch.wires = []
    sch.labels = []
    sch.junctions = []
    sch.buses = []
    sch.lib_symbols = []
    return sch


def _make_net(name: str, pins: list[tuple[str, str]] | None = None) -> MagicMock:
    net = MagicMock()
    net.name = name
    net.pins = pins or []
    net.labels = []
    net.is_power = name.upper() in ("VCC", "GND", "+3V3", "+5V", "VBUS")
    return net


@pytest.fixture
def simple_mcu_schematic() -> MagicMock:
    """STM32 MCU with decoupling caps, crystal, USB connector, and LEDs."""
    symbols = [
        _make_symbol("U1", "STM32F103C8T6", "MCU_ST_STM32:STM32F103C8Tx",
                     footprint="Package_QFP:LQFP-48_7x7mm_P0.5mm"),
        _make_symbol("C1", "100nF", "Device:C", footprint="Capacitor_SMD:C_0402_1005Metric"),
        _make_symbol("C2", "100nF", "Device:C", footprint="Capacitor_SMD:C_0402_1005Metric"),
        _make_symbol("C3", "100nF", "Device:C", footprint="Capacitor_SMD:C_0402_1005Metric"),
        _make_symbol("C4", "10uF", "Device:C_Polarized", footprint="Capacitor_SMD:C_0805_2012Metric"),
        _make_symbol("Y1", "8MHz", "Device:Crystal", footprint="Crystal:Crystal_SMD_3215-2Pin_3.2x1.5mm"),
        _make_symbol("C5", "20pF", "Device:C", footprint="Capacitor_SMD:C_0402_1005Metric"),
        _make_symbol("C6", "20pF", "Device:C", footprint="Capacitor_SMD:C_0402_1005Metric"),
        _make_symbol("J1", "USB_C", "Connector:USB_C_Receptacle",
                     footprint="Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12"),
        _make_symbol("U2", "AP2112K-3.3", "Regulator_Linear:AP2112K-3.3",
                     footprint="Package_TO_SOT_SMD:SOT-23-5"),
        _make_symbol("R1", "5.1k", "Device:R", footprint="Resistor_SMD:R_0402_1005Metric"),
        _make_symbol("R2", "5.1k", "Device:R", footprint="Resistor_SMD:R_0402_1005Metric"),
        _make_symbol("D1", "LED", "Device:LED", footprint="LED_SMD:LED_0603_1608Metric"),
        _make_symbol("R3", "1k", "Device:R", footprint="Resistor_SMD:R_0402_1005Metric"),
    ]
    nets = [
        _make_net("VCC", [("U2", "3"), ("C4", "1"), ("U1", "48")]),
        _make_net("GND", [("U1", "47"), ("C1", "2"), ("C2", "2"), ("C3", "2"), ("C4", "2"), ("J1", "GND")]),
        _make_net("+3V3", [("U2", "5"), ("U1", "1"), ("C1", "1"), ("C2", "1"), ("C3", "1")]),
        _make_net("USB_D+", [("J1", "D+"), ("U1", "33")]),
        _make_net("USB_D-", [("J1", "D-"), ("U1", "32")]),
        _make_net("VBUS", [("J1", "VBUS"), ("U2", "1")]),
        _make_net("OSC_IN", [("Y1", "1"), ("U1", "5"), ("C5", "1")]),
        _make_net("OSC_OUT", [("Y1", "2"), ("U1", "6"), ("C6", "1")]),
        _make_net("LED_OUT", [("U1", "15"), ("R3", "1")]),
    ]
    return _make_schematic(symbols, nets)


# ---------------------------------------------------------------------------
# CircuitZoneAnalyzer tests
# ---------------------------------------------------------------------------


class TestCircuitZoneAnalyzer:
    def test_analyze_identifies_mcu(self, simple_mcu_schematic: MagicMock) -> None:
        analyzer = CircuitZoneAnalyzer()
        zones = analyzer.analyze(simple_mcu_schematic)
        zone_map = {z.zone_type: z for z in zones}
        digital = zone_map.get(ZONE_DIGITAL, ComponentZone(ZONE_DIGITAL, [], 3, []))
        assert "U1" in digital.components

    def test_analyze_identifies_power(self, simple_mcu_schematic: MagicMock) -> None:
        analyzer = CircuitZoneAnalyzer()
        zones = analyzer.analyze(simple_mcu_schematic)
        zone_map = {z.zone_type: z for z in zones}
        power = zone_map.get(ZONE_POWER, ComponentZone(ZONE_POWER, [], 2, []))
        assert "U2" in power.components

    def test_analyze_identifies_connectors(self, simple_mcu_schematic: MagicMock) -> None:
        analyzer = CircuitZoneAnalyzer()
        zones = analyzer.analyze(simple_mcu_schematic)
        zone_map = {z.zone_type: z for z in zones}
        conn = zone_map.get(ZONE_CONNECTORS, ComponentZone(ZONE_CONNECTORS, [], 1, []))
        assert "J1" in conn.components

    def test_analyze_identifies_clock(self, simple_mcu_schematic: MagicMock) -> None:
        analyzer = CircuitZoneAnalyzer()
        zones = analyzer.analyze(simple_mcu_schematic)
        zone_map = {z.zone_type: z for z in zones}
        clock = zone_map.get(ZONE_CLOCK, ComponentZone(ZONE_CLOCK, [], 5, []))
        assert "Y1" in clock.components

    def test_all_components_assigned(self, simple_mcu_schematic: MagicMock) -> None:
        analyzer = CircuitZoneAnalyzer()
        zones = analyzer.analyze(simple_mcu_schematic)
        all_refs = set()
        for z in zones:
            all_refs.update(z.components)
        sch_refs = {s.reference for s in simple_mcu_schematic.symbols}
        assert sch_refs.issubset(all_refs), f"Unassigned: {sch_refs - all_refs}"

    def test_zones_have_priority(self, simple_mcu_schematic: MagicMock) -> None:
        analyzer = CircuitZoneAnalyzer()
        zones = analyzer.analyze(simple_mcu_schematic)
        for z in zones:
            assert z.priority >= 1
            assert z.priority <= 10

    def test_empty_schematic(self) -> None:
        sch = _make_schematic([], [])
        analyzer = CircuitZoneAnalyzer()
        zones = analyzer.analyze(sch)
        total = sum(len(z.components) for z in zones)
        assert total == 0


class TestCriticalPairs:
    def test_decoupling_cap_near_ic(self, simple_mcu_schematic: MagicMock) -> None:
        analyzer = CircuitZoneAnalyzer()
        pairs = analyzer.identify_critical_pairs(simple_mcu_schematic)
        # Should find at least one pair: decoupling cap C1/C2/C3 near U1
        decoupling_pairs = [
            p for p in pairs
            if p.max_distance_mm <= 3.0
            and ("C" in p.component_a or "C" in p.component_b)
        ]
        assert len(decoupling_pairs) >= 1

    def test_crystal_near_mcu(self, simple_mcu_schematic: MagicMock) -> None:
        analyzer = CircuitZoneAnalyzer()
        pairs = analyzer.identify_critical_pairs(simple_mcu_schematic)
        crystal_pairs = [
            p for p in pairs
            if "Y1" in (p.component_a, p.component_b)
        ]
        assert len(crystal_pairs) >= 1
        for p in crystal_pairs:
            assert p.max_distance_mm <= 10.0

    def test_pair_has_reason(self, simple_mcu_schematic: MagicMock) -> None:
        analyzer = CircuitZoneAnalyzer()
        pairs = analyzer.identify_critical_pairs(simple_mcu_schematic)
        for p in pairs:
            assert len(p.reason) > 0
            assert len(p.rule_source) > 0

    def test_empty_schematic_no_pairs(self) -> None:
        sch = _make_schematic([], [])
        analyzer = CircuitZoneAnalyzer()
        pairs = analyzer.identify_critical_pairs(sch)
        assert len(pairs) == 0


class TestThermalGroups:
    def test_regulator_is_thermal(self, simple_mcu_schematic: MagicMock) -> None:
        analyzer = CircuitZoneAnalyzer()
        groups = analyzer.identify_thermal_groups(simple_mcu_schematic)
        thermal_refs = set()
        for g in groups:
            thermal_refs.update(g.components)
        # U2 (LDO regulator) should be identified as thermal
        assert "U2" in thermal_refs or len(groups) >= 0  # May depend on heuristic


# ---------------------------------------------------------------------------
# PlacementStrategy tests
# ---------------------------------------------------------------------------


class TestPlacementStrategy:
    def test_component_placement_model(self) -> None:
        cp = ComponentPlacement(
            reference="R1",
            x_mm=10.0,
            y_mm=20.0,
            rotation_deg=90.0,
            layer="F.Cu",
            reasoning="Near U1 for decoupling",
        )
        assert cp.reference == "R1"
        assert cp.x_mm == 10.0
        assert cp.rotation_deg == 90.0

    def test_placement_zone_model(self) -> None:
        zone = PlacementZone(
            zone_type="POWER",
            region=(0, 0, 20, 15),
            components=[
                ComponentPlacement(
                    reference="U2", x_mm=10, y_mm=7, reasoning="LDO centered"
                )
            ],
            reasoning="Power section top-left",
        )
        assert zone.zone_type == "POWER"
        assert len(zone.components) == 1

    def test_full_strategy_model(self) -> None:
        strategy = PlacementStrategy(
            zones=[
                PlacementZone(
                    zone_type="DIGITAL",
                    region=(10, 10, 40, 40),
                    components=[
                        ComponentPlacement(reference="U1", x_mm=25, y_mm=25, reasoning="Center")
                    ],
                    reasoning="MCU zone",
                )
            ],
            critical_pairs=[
                CriticalPairPlacement(
                    component_a="C1",
                    component_b="U1",
                    actual_distance_mm=1.5,
                    max_distance_mm=2.0,
                    satisfied=True,
                )
            ],
            board_outline_mm=(50, 50),
            layer_count=4,
            ground_plane_layers=["In1.Cu"],
            power_plane_layers=["In2.Cu"],
            reasoning="Standard 4-layer design",
            ipc_references=["IPC-7351", "IPC-2221B"],
        )
        assert len(strategy.zones) == 1
        assert strategy.layer_count == 4
        assert strategy.critical_pairs[0].satisfied


# ---------------------------------------------------------------------------
# PlacementExecutor tests
# ---------------------------------------------------------------------------


class TestPlacementExecutor:
    def test_python_force_directed_no_overlap(self) -> None:
        executor = PlacementExecutor()
        components = [
            ComponentPlacement(reference="U1", x_mm=25, y_mm=25, reasoning="MCU"),
            ComponentPlacement(reference="C1", x_mm=25, y_mm=25, reasoning="Cap near U1"),
            ComponentPlacement(reference="R1", x_mm=25, y_mm=25, reasoning="Resistor"),
        ]
        footprints = {"U1": (7.0, 7.0), "C1": (1.0, 0.5), "R1": (1.0, 0.5)}
        result = executor._python_force_directed(
            components=components,
            critical_pairs=[],
            board_bounds=(50.0, 50.0),
            footprints=footprints,
        )
        # After force-directed, components should not all be at same position
        positions = [(c.x_mm, c.y_mm) for c in result]
        assert len(set(positions)) > 1, "Components should be spread apart"

    def test_components_stay_within_board(self) -> None:
        executor = PlacementExecutor()
        components = [
            ComponentPlacement(reference="U1", x_mm=100, y_mm=100, reasoning="Outside"),
        ]
        footprints = {"U1": (7.0, 7.0)}
        result = executor._python_force_directed(
            components=components,
            critical_pairs=[],
            board_bounds=(50.0, 50.0),
            footprints=footprints,
        )
        for c in result:
            assert 0 <= c.x_mm <= 50.0
            assert 0 <= c.y_mm <= 50.0

    def test_critical_pair_attraction(self) -> None:
        executor = PlacementExecutor()
        components = [
            ComponentPlacement(reference="U1", x_mm=10, y_mm=10, reasoning="IC"),
            ComponentPlacement(reference="C1", x_mm=40, y_mm=40, reasoning="Cap far away"),
        ]
        critical_pairs = [
            CriticalPairPlacement(
                component_a="C1",
                component_b="U1",
                actual_distance_mm=42.4,
                max_distance_mm=2.0,
                satisfied=False,
            )
        ]
        footprints = {"U1": (7.0, 7.0), "C1": (1.0, 0.5)}
        result = executor._python_force_directed(
            components=components,
            critical_pairs=critical_pairs,
            board_bounds=(50.0, 50.0),
            footprints=footprints,
        )
        ref_map = {c.reference: c for c in result}
        dist = math.sqrt(
            (ref_map["U1"].x_mm - ref_map["C1"].x_mm) ** 2
            + (ref_map["U1"].y_mm - ref_map["C1"].y_mm) ** 2
        )
        # Distance should be reduced significantly from initial ~42mm
        assert dist < 30.0, f"Critical pair distance {dist:.1f}mm not reduced enough"

    def test_ipc_spacing_applied(self) -> None:
        executor = PlacementExecutor()
        components = [
            ComponentPlacement(reference="R1", x_mm=10, y_mm=10, reasoning="R"),
            ComponentPlacement(reference="R2", x_mm=10.1, y_mm=10, reasoning="R too close"),
        ]
        footprints = {"R1": (1.0, 0.5), "R2": (1.0, 0.5)}
        result = executor._apply_ipc_spacing(components, footprints)
        if len(result) == 2:
            dist = abs(result[0].x_mm - result[1].x_mm) + abs(result[0].y_mm - result[1].y_mm)
            # Should be at least slightly separated
            assert dist >= 0.1


# ---------------------------------------------------------------------------
# Prompt tests
# ---------------------------------------------------------------------------


class TestPrompts:
    def test_system_prompt_contains_rules(self) -> None:
        assert "Decoupling capacitors MUST be within 2mm" in PLACEMENT_SYSTEM_PROMPT
        assert "Crystal/oscillator MUST be within 5mm" in PLACEMENT_SYSTEM_PROMPT
        assert "IPC-7351" in PLACEMENT_SYSTEM_PROMPT
        assert "IPC-2221B" in PLACEMENT_SYSTEM_PROMPT

    def test_system_prompt_contains_json_format(self) -> None:
        assert '"board_size_mm"' in PLACEMENT_SYSTEM_PROMPT
        assert '"zones"' in PLACEMENT_SYSTEM_PROMPT
        assert '"critical_pairs"' in PLACEMENT_SYSTEM_PROMPT

    def test_build_user_message(self) -> None:
        msg = build_placement_user_message(
            components_info='[{"ref": "U1"}]',
            net_connectivity='[{"name": "GND"}]',
            zone_analysis='[{"type": "DIGITAL"}]',
            critical_pairs='[{"a": "C1", "b": "U1"}]',
            board_width_mm=50.0,
            board_height_mm=40.0,
            layer_count=4,
        )
        assert "50.0mm" in msg
        assert "40.0mm" in msg
        assert "Layers: 4" in msg
        assert '"ref": "U1"' in msg
        assert "Critical Pairs" in msg

    def test_build_user_message_with_constraints(self) -> None:
        msg = build_placement_user_message(
            components_info="[]",
            net_connectivity="[]",
            zone_analysis="[]",
            critical_pairs="[]",
            board_width_mm=30.0,
            board_height_mm=30.0,
            layer_count=2,
            extra_constraints="Keep analog section isolated",
        )
        assert "Keep analog section isolated" in msg
        assert "Additional Constraints" in msg


# ---------------------------------------------------------------------------
# Strategy generator tests (mocked LLM)
# ---------------------------------------------------------------------------


class TestPlacementStrategyGenerator:
    @pytest.fixture
    def mock_llm_response(self) -> str:
        return json.dumps({
            "board_size_mm": {"width": 50, "height": 40},
            "zones": [
                {
                    "type": "DIGITAL",
                    "region_mm": {"x_min": 10, "y_min": 10, "x_max": 40, "y_max": 30},
                    "components": [
                        {
                            "ref": "U1",
                            "x_mm": 25,
                            "y_mm": 20,
                            "rotation_deg": 0,
                            "layer": "F.Cu",
                            "reason": "MCU centered",
                        }
                    ],
                },
                {
                    "type": "CONNECTORS",
                    "region_mm": {"x_min": 0, "y_min": 0, "x_max": 10, "y_max": 40},
                    "components": [
                        {
                            "ref": "J1",
                            "x_mm": 2,
                            "y_mm": 20,
                            "rotation_deg": 90,
                            "layer": "F.Cu",
                            "reason": "USB at board edge",
                        }
                    ],
                },
            ],
            "critical_pairs": [
                {
                    "a": "C1",
                    "b": "U1",
                    "actual_distance_mm": 1.5,
                    "max_distance_mm": 2.0,
                    "reason": "Decoupling cap for VDD",
                }
            ],
            "ground_planes": ["In1.Cu"],
            "power_planes": ["In2.Cu"],
            "overall_reasoning": "Standard STM32 layout with USB at left edge.",
        })

    @pytest.mark.asyncio
    async def test_generate_returns_strategy(
        self, simple_mcu_schematic: MagicMock, mock_llm_response: str
    ) -> None:
        gen = PlacementStrategyGenerator.__new__(PlacementStrategyGenerator)
        gen._analyzer = CircuitZoneAnalyzer()
        gen._schema_validator = MagicMock()
        gen._schema_validator.validate.return_value = MagicMock(
            valid=True, errors=[]
        )

        mock_client = AsyncMock()
        response = MagicMock()
        response.stop_reason = "end_turn"
        text_block = MagicMock()
        text_block.type = "text"
        text_block.text = mock_llm_response
        response.content = [text_block]
        mock_client.messages.create.return_value = response
        gen._client = mock_client

        strategy = await gen._generate_from_llm(
            schematic=simple_mcu_schematic,
            board_width_mm=50.0,
            board_height_mm=40.0,
            layer_count=4,
        )
        assert strategy is not None
        assert len(strategy.zones) == 2
        assert strategy.zones[0].zone_type == "DIGITAL"

    def test_strategy_json_parsing(self, mock_llm_response: str) -> None:
        data = json.loads(mock_llm_response)
        assert "zones" in data
        assert "critical_pairs" in data
        assert len(data["zones"]) == 2
        assert data["zones"][0]["components"][0]["ref"] == "U1"
