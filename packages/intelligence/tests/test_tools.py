"""Tests for tool definitions and handlers.

Tests all 6 tools: impedance_calc, clearance_lookup, drc_check,
datasheet_lookup, stackup_suggest, component_search.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from routeai_intelligence.agent.tools import (
    ALL_TOOLS,
    CLEARANCE_LOOKUP_TOOL,
    COMPONENT_SEARCH_TOOL,
    DATASHEET_LOOKUP_TOOL,
    DRC_CHECK_TOOL,
    IMPEDANCE_CALC_TOOL,
    STACKUP_SUGGEST_TOOL,
    ToolDefinition,
    _IPC2221B_CLEARANCE_TABLE,
    _handle_clearance_lookup,
    _handle_component_search,
    _handle_datasheet_lookup,
    _handle_drc_check,
    _handle_impedance_calc,
    _handle_stackup_suggest,
    get_tool_handler,
    get_tool_schemas,
)


# ---------------------------------------------------------------------------
# Tool schema definition tests
# ---------------------------------------------------------------------------


class TestToolSchemaDefinitions:
    """Test tool schema metadata and structure."""

    def test_impedance_calc_name_and_required_params(self):
        """impedance_calc should require trace_width_mm, dielectric_height_mm, dielectric_constant."""
        assert IMPEDANCE_CALC_TOOL.name == "impedance_calc"
        required = IMPEDANCE_CALC_TOOL.input_schema["required"]
        assert "trace_width_mm" in required
        assert "dielectric_height_mm" in required
        assert "dielectric_constant" in required

    def test_clearance_lookup_name_and_required_params(self):
        assert CLEARANCE_LOOKUP_TOOL.name == "clearance_lookup"
        assert "voltage_v" in CLEARANCE_LOOKUP_TOOL.input_schema["required"]

    def test_drc_check_name_and_required_params(self):
        assert DRC_CHECK_TOOL.name == "drc_check"
        assert "board_state" in DRC_CHECK_TOOL.input_schema["required"]

    def test_datasheet_lookup_name_and_required_params(self):
        assert DATASHEET_LOOKUP_TOOL.name == "datasheet_lookup"
        assert "query" in DATASHEET_LOOKUP_TOOL.input_schema["required"]

    def test_stackup_suggest_name_and_required_params(self):
        assert STACKUP_SUGGEST_TOOL.name == "stackup_suggest"
        assert "layer_count" in STACKUP_SUGGEST_TOOL.input_schema["required"]

    def test_component_search_name_and_required_params(self):
        assert COMPONENT_SEARCH_TOOL.name == "component_search"
        assert "query" in COMPONENT_SEARCH_TOOL.input_schema["required"]

    def test_all_tools_have_descriptions(self):
        for tool in ALL_TOOLS:
            assert len(tool.description) > 20, f"Tool {tool.name} has a very short description"

    def test_topology_enum_values(self):
        props = IMPEDANCE_CALC_TOOL.input_schema["properties"]
        assert set(props["topology"]["enum"]) == {"microstrip", "stripline"}

    def test_clearance_condition_enum_values(self):
        props = CLEARANCE_LOOKUP_TOOL.input_schema["properties"]
        assert set(props["condition"]["enum"]) == {"B1", "B2", "B3", "B4"}

    def test_stackup_layer_count_enum(self):
        props = STACKUP_SUGGEST_TOOL.input_schema["properties"]
        assert set(props["layer_count"]["enum"]) == {2, 4, 6, 8}


# ---------------------------------------------------------------------------
# impedance_calc handler tests
# ---------------------------------------------------------------------------


class TestImpedanceCalcHandler:
    """Test impedance_calc tool handler."""

    @pytest.mark.asyncio
    async def test_microstrip_single_ended(self):
        """Single-ended microstrip should return z0_ohm and er_eff."""
        result = await _handle_impedance_calc(
            trace_width_mm=0.2,
            dielectric_height_mm=0.2,
            dielectric_constant=4.2,
        )
        assert result["status"] == "ok"
        assert result["topology"] == "microstrip"
        assert "z0_ohm" in result
        assert "er_eff" in result
        assert "delay_ps_per_mm" in result
        assert "velocity_m_per_s" in result
        assert result["z0_ohm"] > 0

    @pytest.mark.asyncio
    async def test_microstrip_differential(self):
        """Differential microstrip should return z_diff_ohm."""
        result = await _handle_impedance_calc(
            trace_width_mm=0.15,
            dielectric_height_mm=0.2,
            dielectric_constant=4.2,
            spacing_mm=0.15,
        )
        assert result["status"] == "ok"
        assert result["topology"] == "differential_microstrip"
        assert "z_diff_ohm" in result
        assert result["z_diff_ohm"] > result["z0_single_ended_ohm"]

    @pytest.mark.asyncio
    async def test_stripline_single_ended(self):
        """Single-ended stripline should work."""
        result = await _handle_impedance_calc(
            trace_width_mm=0.15,
            dielectric_height_mm=0.2,
            dielectric_constant=4.2,
            topology="stripline",
        )
        assert result["status"] == "ok"
        assert result["topology"] == "stripline"
        assert "z0_ohm" in result

    @pytest.mark.asyncio
    async def test_stripline_differential(self):
        """Differential stripline should return z_diff_ohm."""
        result = await _handle_impedance_calc(
            trace_width_mm=0.15,
            dielectric_height_mm=0.2,
            dielectric_constant=4.2,
            topology="stripline",
            spacing_mm=0.15,
        )
        assert result["status"] == "ok"
        assert result["topology"] == "differential_stripline"
        assert "z_diff_ohm" in result

    @pytest.mark.asyncio
    async def test_unknown_topology_error(self):
        """Unknown topology should return an error."""
        result = await _handle_impedance_calc(
            trace_width_mm=0.15,
            dielectric_height_mm=0.2,
            dielectric_constant=4.2,
            topology="coplanar",
        )
        assert result["status"] == "error"
        assert "coplanar" in result["message"].lower() or "unknown" in result["message"].lower()

    @pytest.mark.asyncio
    async def test_custom_trace_thickness(self):
        """Custom trace thickness should be accepted."""
        result = await _handle_impedance_calc(
            trace_width_mm=0.2,
            dielectric_height_mm=0.2,
            dielectric_constant=4.2,
            trace_thickness_mm=0.07,  # 2oz copper
        )
        assert result["status"] == "ok"

    @pytest.mark.asyncio
    async def test_error_on_invalid_params(self):
        """Negative width should return error from the physics module."""
        result = await _handle_impedance_calc(
            trace_width_mm=-1.0,
            dielectric_height_mm=0.2,
            dielectric_constant=4.2,
        )
        assert result["status"] == "error"


# ---------------------------------------------------------------------------
# clearance_lookup handler tests
# ---------------------------------------------------------------------------


class TestClearanceLookupHandler:
    """Test clearance_lookup tool handler."""

    @pytest.mark.asyncio
    async def test_low_voltage_clearance(self):
        result = await _handle_clearance_lookup(voltage_v=5.0)
        assert result["status"] == "ok"
        assert result["clearance_mm"] > 0
        assert "IPC-2221B" in result["reference"]

    @pytest.mark.asyncio
    async def test_high_voltage_clearance(self):
        result = await _handle_clearance_lookup(voltage_v=500.0)
        assert result["status"] == "ok"
        assert result["clearance_mm"] >= 2.0

    @pytest.mark.asyncio
    async def test_very_high_voltage(self):
        result = await _handle_clearance_lookup(voltage_v=2000.0)
        assert result["status"] == "ok"
        # Should use the last entry in the table (scaled)
        assert result["clearance_mm"] > 10

    @pytest.mark.asyncio
    async def test_negative_voltage_error(self):
        result = await _handle_clearance_lookup(voltage_v=-5.0)
        assert result["status"] == "error"
        assert "non-negative" in result["message"].lower()

    @pytest.mark.asyncio
    async def test_b2_condition_lower_than_b1(self):
        """B2 (coated) should have lower clearance than B1 (uncoated)."""
        b1 = await _handle_clearance_lookup(voltage_v=200.0, condition="B1")
        b2 = await _handle_clearance_lookup(voltage_v=200.0, condition="B2")
        assert b1["clearance_mm"] > b2["clearance_mm"]

    @pytest.mark.asyncio
    async def test_b3_condition_internal(self):
        """B3 (internal) should have ~50% of B1."""
        b1 = await _handle_clearance_lookup(voltage_v=100.0, condition="B1")
        b3 = await _handle_clearance_lookup(voltage_v=100.0, condition="B3")
        assert abs(b3["clearance_mm"] - b1["clearance_mm"] * 0.5) < 0.01

    @pytest.mark.asyncio
    async def test_b4_condition_higher_than_b1(self):
        """B4 (altitude) should have higher clearance than B1."""
        b1 = await _handle_clearance_lookup(voltage_v=100.0, condition="B1")
        b4 = await _handle_clearance_lookup(voltage_v=100.0, condition="B4")
        assert b4["clearance_mm"] > b1["clearance_mm"]

    @pytest.mark.asyncio
    async def test_zero_voltage(self):
        result = await _handle_clearance_lookup(voltage_v=0.0)
        assert result["status"] == "ok"
        assert result["clearance_mm"] >= 0

    @pytest.mark.asyncio
    async def test_interpolation_between_entries(self):
        """Voltage between table entries should produce interpolated clearance."""
        result = await _handle_clearance_lookup(voltage_v=75.0, condition="B1")
        assert result["status"] == "ok"
        assert 0.1 <= result["clearance_mm"] <= 1.0


# ---------------------------------------------------------------------------
# drc_check handler tests (mocked)
# ---------------------------------------------------------------------------


class TestDRCCheckHandler:
    """Test drc_check tool handler with mocked DRCEngine."""

    @pytest.mark.asyncio
    async def test_drc_check_success(self):
        """drc_check should return results from DRCEngine."""
        mock_violation = MagicMock()
        mock_violation.rule = "clearance"
        mock_violation.severity = MagicMock(value="error")
        mock_violation.message = "Clearance violation between U1-pad1 and R1-pad2"
        mock_violation.location = {"x": 10.0, "y": 20.0}
        mock_violation.affected_items = ["U1", "R1"]

        mock_report = MagicMock()
        mock_report.passed = False
        mock_report.error_count = 1
        mock_report.warning_count = 0
        mock_report.info_count = 0
        mock_report.violations = [mock_violation]
        mock_report.stats = {"total_checks": 10}
        mock_report.elapsed_seconds = 0.05

        with (
            patch("routeai_solver.drc.engine.DRCEngine") as MockEngine,
            patch("routeai_solver.board_model.BoardDesign") as MockBoard,
        ):
            MockEngine.return_value.run.return_value = mock_report
            MockBoard.return_value = MagicMock()

            result = await _handle_drc_check(board_state={"components": []})

        assert result["status"] == "ok"
        assert result["passed"] is False
        assert result["error_count"] == 1
        assert len(result["violations"]) == 1
        assert result["violations"][0]["rule"] == "clearance"

    @pytest.mark.asyncio
    async def test_drc_check_specific_checks(self):
        """drc_check with specific checks should pass the categories."""
        mock_report = MagicMock()
        mock_report.passed = True
        mock_report.error_count = 0
        mock_report.warning_count = 0
        mock_report.info_count = 0
        mock_report.violations = []
        mock_report.stats = {}
        mock_report.elapsed_seconds = 0.01

        with (
            patch("routeai_solver.drc.engine.DRCEngine") as MockEngine,
            patch("routeai_solver.board_model.BoardDesign") as MockBoard,
        ):
            engine_instance = MockEngine.return_value
            engine_instance.run.return_value = mock_report
            MockBoard.return_value = MagicMock()

            result = await _handle_drc_check(
                board_state={}, checks=["geometric"]
            )

        assert result["status"] == "ok"
        assert result["passed"] is True
        # Verify engine was constructed with correct flags
        MockEngine.assert_called_once_with(
            run_geometric=True,
            run_electrical=False,
            run_manufacturing=False,
        )

    @pytest.mark.asyncio
    async def test_drc_check_exception_handling(self):
        """drc_check should handle exceptions gracefully."""
        with patch.dict("sys.modules", {"routeai_solver.drc.engine": None, "routeai_solver.board_model": None}):
            result = await _handle_drc_check(board_state={})
        assert result["status"] == "error"
        assert "failed" in result["message"].lower() or "drc" in result["message"].lower()


# ---------------------------------------------------------------------------
# datasheet_lookup handler tests (mocked)
# ---------------------------------------------------------------------------


class TestDatasheetLookupHandler:
    """Test datasheet_lookup tool handler with mocked retriever."""

    @pytest.mark.asyncio
    async def test_datasheet_lookup_success(self):
        mock_doc = MagicMock()
        mock_doc.content = "STM32F405 requires 100nF decoupling per VDD pin"
        mock_doc.source = "STM32F405 datasheet Rev.G"
        mock_doc.relevance_score = 0.92
        mock_doc.metadata = {"section": "layout_guidelines"}

        with patch("routeai_intelligence.rag.retriever.KnowledgeRetriever") as MockRetriever:
            instance = MockRetriever.return_value
            instance.search = AsyncMock(return_value=[mock_doc])

            result = await _handle_datasheet_lookup(query="STM32F405 decoupling")

        assert result["status"] == "ok"
        assert result["result_count"] == 1
        assert result["documents"][0]["source"] == "STM32F405 datasheet Rev.G"
        assert result["documents"][0]["relevance_score"] == 0.92

    @pytest.mark.asyncio
    async def test_datasheet_lookup_with_filters(self):
        with patch("routeai_intelligence.rag.retriever.KnowledgeRetriever") as MockRetriever:
            instance = MockRetriever.return_value
            instance.search = AsyncMock(return_value=[])

            result = await _handle_datasheet_lookup(
                query="layout", component="STM32", section="pcb_layout", top_k=3
            )

        instance.search.assert_called_once_with(
            query="layout",
            top_k=3,
            filters={"component": "STM32", "section": "pcb_layout"},
        )
        assert result["status"] == "ok"
        assert result["result_count"] == 0

    @pytest.mark.asyncio
    async def test_datasheet_lookup_error_handling(self):
        with patch(
            "routeai_intelligence.rag.retriever.KnowledgeRetriever",
            side_effect=Exception("DB not available"),
        ):
            result = await _handle_datasheet_lookup(query="test")
        assert result["status"] == "error"
        assert result["result_count"] == 0
        assert "RAG system" in result["message"] or "failed" in result["message"].lower()


# ---------------------------------------------------------------------------
# stackup_suggest handler tests
# ---------------------------------------------------------------------------


class TestStackupSuggestHandler:
    """Test stackup_suggest tool handler."""

    @pytest.mark.asyncio
    async def test_2_layer_stackup(self):
        result = await _handle_stackup_suggest(layer_count=2)
        assert result["status"] == "ok"
        assert result["layer_count"] == 2
        # 2-layer: F.Cu, Core, B.Cu
        signal_layers = [l for l in result["stackup"] if l["type"] == "signal"]
        assert len(signal_layers) == 2

    @pytest.mark.asyncio
    async def test_6_layer_stackup(self):
        result = await _handle_stackup_suggest(layer_count=6)
        assert result["status"] == "ok"
        assert result["layer_count"] == 6

    @pytest.mark.asyncio
    async def test_8_layer_stackup(self):
        result = await _handle_stackup_suggest(layer_count=8)
        assert result["status"] == "ok"
        assert result["layer_count"] == 8

    @pytest.mark.asyncio
    async def test_unsupported_layer_count(self):
        result = await _handle_stackup_suggest(layer_count=3)
        assert result["status"] == "error"
        assert "unsupported" in result["message"].lower()

    @pytest.mark.asyncio
    async def test_high_speed_material(self):
        result = await _handle_stackup_suggest(layer_count=4, material="high-speed")
        assert result["status"] == "ok"
        # High-speed material has lower Er
        dielectric_layers = [l for l in result["stackup"] if l["type"] == "dielectric"]
        assert dielectric_layers[0]["er"] == 3.5

    @pytest.mark.asyncio
    async def test_achievable_impedances_populated(self):
        result = await _handle_stackup_suggest(layer_count=4)
        assert len(result["achievable_impedances"]) > 0
        for imp in result["achievable_impedances"]:
            assert "z0_ohm" in imp
            assert imp["z0_ohm"] > 0


# ---------------------------------------------------------------------------
# component_search handler tests (mocked)
# ---------------------------------------------------------------------------


class TestComponentSearchHandler:
    """Test component_search tool handler with mocked retriever."""

    @pytest.mark.asyncio
    async def test_component_search_success(self):
        mock_doc = MagicMock()
        mock_doc.content = "TPS54331 - 3A 28V input buck converter"
        mock_doc.source = "TPS54331 datasheet"
        mock_doc.relevance_score = 0.88
        mock_doc.metadata = {"category": "voltage_regulator"}

        with patch("routeai_intelligence.rag.retriever.KnowledgeRetriever") as MockRetriever:
            instance = MockRetriever.return_value
            instance.search = AsyncMock(return_value=[mock_doc])

            result = await _handle_component_search(query="buck converter 3A")

        assert result["status"] == "ok"
        assert result["result_count"] == 1
        assert result["components"][0]["source"] == "TPS54331 datasheet"

    @pytest.mark.asyncio
    async def test_component_search_with_category_and_package(self):
        with patch("routeai_intelligence.rag.retriever.KnowledgeRetriever") as MockRetriever:
            instance = MockRetriever.return_value
            instance.search = AsyncMock(return_value=[])

            result = await _handle_component_search(
                query="LDO regulator",
                category="voltage_regulator",
                package="SOT-23",
                parameters={"voltage": "3.3V"},
                top_k=5,
            )

        # Should build a combined query
        call_args = instance.search.call_args
        assert "category:voltage_regulator" in call_args.kwargs["query"]
        assert "package:SOT-23" in call_args.kwargs["query"]
        assert call_args.kwargs["filters"]["domain"] == "component"
        assert call_args.kwargs["filters"]["category"] == "voltage_regulator"

    @pytest.mark.asyncio
    async def test_component_search_error(self):
        with patch(
            "routeai_intelligence.rag.retriever.KnowledgeRetriever",
            side_effect=RuntimeError("connection failed"),
        ):
            result = await _handle_component_search(query="any component")
        assert result["status"] == "error"
        assert result["result_count"] == 0
