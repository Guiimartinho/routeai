"""Tests for the RouteAI Intelligence package.

Tests schema validation, confidence scoring, citation checking, tool definitions,
and prompt template integrity without requiring API keys or database connections.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from routeai_intelligence.validation.schema_validator import SchemaValidator
from routeai_intelligence.validation.confidence import (
    GENERAL_THRESHOLD,
    SAFETY_CRITICAL_THRESHOLD,
    ConfidenceChecker,
)
from routeai_intelligence.validation.citation_checker import CitationChecker
from routeai_intelligence.agent.tools import ALL_TOOLS, get_tool_handler, get_tool_schemas


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SCHEMAS_DIR = Path(__file__).parent.parent / "src" / "routeai_intelligence" / "agent" / "schemas"


@pytest.fixture
def schema_validator():
    return SchemaValidator()


@pytest.fixture
def confidence_checker():
    return ConfidenceChecker()


@pytest.fixture
def citation_checker():
    return CitationChecker()


@pytest.fixture
def valid_constraint_output() -> dict:
    """A minimal valid constraint set conforming to constraint_schema.json."""
    return {
        "net_classes": [
            {
                "name": "Default",
                "description": "Default signal class",
                "nets": ["NET1", "NET2"],
                "trace_width_mm": 0.25,
                "clearance_mm": 0.2,
                "via_drill_mm": 0.3,
                "via_size_mm": 0.6,
                "impedance_ohm": None,
                "max_current_a": None,
                "confidence": 0.90,
                "source": "IPC-2221B Table 6-1, default clearance for <30V",
                "requires_review": False,
            },
            {
                "name": "Power",
                "description": "Power delivery nets",
                "nets": ["VCC", "GND"],
                "trace_width_mm": 0.5,
                "clearance_mm": 0.3,
                "via_drill_mm": 0.4,
                "via_size_mm": 0.8,
                "impedance_ohm": None,
                "max_current_a": 2.0,
                "confidence": 0.95,
                "source": "IPC-2152, 2A on external layer with 10C rise",
                "requires_review": False,
            },
        ],
        "diff_pairs": [
            {
                "name": "USB_D",
                "positive_net": "USB_D+",
                "negative_net": "USB_D-",
                "impedance_ohm": 90.0,
                "trace_width_mm": 0.15,
                "gap_mm": 0.15,
                "max_skew_mm": 0.15,
                "max_length_mm": 150.0,
                "confidence": 0.97,
                "source": "USB 2.0 specification Section 7.1.2, 90 ohm differential impedance",
                "requires_review": False,
            }
        ],
        "length_groups": [
            {
                "name": "SPI_CLK_DATA",
                "description": "SPI clock and data length matching",
                "nets": ["SPI_CLK", "SPI_MOSI", "SPI_MISO"],
                "target_length_mm": None,
                "tolerance_mm": 5.0,
                "reference_net": "SPI_CLK",
                "priority": 5,
                "confidence": 0.85,
                "source": "Engineering best practice for SPI at 10MHz",
            }
        ],
        "special_rules": [
            {
                "name": "Crystal_Guard",
                "description": "Guard ring around crystal oscillator",
                "affected_nets": ["XTAL_IN", "XTAL_OUT"],
                "rule_type": "guard_ring",
                "parameters": {"guard_width_mm": 0.3, "guard_clearance_mm": 0.5},
                "confidence": 0.88,
                "source": "STM32F405 datasheet Rev.G p.82, crystal layout recommendations",
                "requires_review": False,
            }
        ],
        "metadata": {
            "total_nets_analyzed": 25,
            "total_constraints_generated": 4,
            "safety_critical_count": 1,
            "review_required_count": 0,
            "average_confidence": 0.92,
        },
    }


@pytest.fixture
def valid_review_output() -> dict:
    """A minimal valid design review conforming to review_schema.json."""
    return {
        "summary": {
            "overall_status": "CONDITIONAL_PASS",
            "critical_count": 0,
            "error_count": 1,
            "warning_count": 2,
            "info_count": 1,
            "review_categories_evaluated": ["drc", "decoupling", "impedance", "thermal", "manufacturing", "placement", "high_speed"],
            "recommendation": "Fix the impedance mismatch on USB pair before fabrication.",
        },
        "findings": [
            {
                "id": "IMP-001",
                "category": "impedance",
                "severity": "ERROR",
                "title": "USB differential impedance out of tolerance",
                "description": "USB_D+/USB_D- differential impedance is 82 ohm, target is 90 ohm +/- 10%.",
                "location": {
                    "components": ["J1"],
                    "nets": ["USB_D+", "USB_D-"],
                    "coordinates_mm": {"x": 25.0, "y": 30.0},
                },
                "recommendation": "Increase trace width from 0.12mm to 0.15mm to achieve 90 ohm target.",
                "reference": "USB 2.0 spec Section 7.1.2",
                "auto_fixable": True,
            },
        ],
        "category_summaries": {
            "drc": {"status": "PASS", "finding_count": 0, "notes": "All DRC checks passed."},
            "decoupling": {"status": "PASS", "finding_count": 1, "notes": "One warning about bulk cap placement."},
            "impedance": {"status": "FAIL", "finding_count": 1, "notes": "USB impedance out of spec."},
            "thermal": {"status": "PASS", "finding_count": 0, "notes": "No thermal issues."},
            "manufacturing": {"status": "PASS", "finding_count": 1, "notes": "One info about silkscreen."},
            "placement": {"status": "PASS", "finding_count": 1, "notes": "Crystal placement warning."},
            "high_speed": {"status": "PASS", "finding_count": 0, "notes": "Length matching OK."},
        },
    }


# ---------------------------------------------------------------------------
# Schema Validation Tests (Gate 1)
# ---------------------------------------------------------------------------

class TestSchemaValidator:
    """Test the schema validation gate."""

    def test_valid_constraint_output(self, schema_validator, valid_constraint_output):
        """Valid constraint output should pass schema validation."""
        json_str = json.dumps(valid_constraint_output)
        result = schema_validator.validate(json_str, "constraint")
        assert result.valid, f"Expected valid, got errors: {result.errors}"

    def test_valid_review_output(self, schema_validator, valid_review_output):
        """Valid review output should pass schema validation."""
        json_str = json.dumps(valid_review_output)
        result = schema_validator.validate(json_str, "review")
        assert result.valid, f"Expected valid, got errors: {result.errors}"

    def test_invalid_json_string(self, schema_validator):
        """Invalid JSON should fail validation."""
        result = schema_validator.validate("this is not json {{{", "constraint")
        assert not result.valid
        assert any("parse" in e.lower() or "json" in e.lower() for e in result.errors)

    def test_missing_required_fields(self, schema_validator):
        """Missing required fields should fail validation."""
        incomplete = json.dumps({"net_classes": []})
        result = schema_validator.validate(incomplete, "constraint")
        assert not result.valid
        # Should mention missing fields
        error_text = " ".join(result.errors).lower()
        assert "required" in error_text or "missing" in error_text

    def test_wrong_type_for_field(self, schema_validator, valid_constraint_output):
        """Wrong type for a field should fail validation."""
        invalid = valid_constraint_output.copy()
        invalid["net_classes"] = "not an array"
        json_str = json.dumps(invalid)
        result = schema_validator.validate(json_str, "constraint")
        assert not result.valid

    def test_value_out_of_range(self, schema_validator, valid_constraint_output):
        """Value outside min/max range should fail validation."""
        invalid = valid_constraint_output.copy()
        invalid["net_classes"][0]["trace_width_mm"] = -1.0  # below minimum
        json_str = json.dumps(invalid)
        result = schema_validator.validate(json_str, "constraint")
        assert not result.valid

    def test_invalid_enum_value(self, schema_validator, valid_review_output):
        """Invalid enum value should fail validation."""
        invalid = valid_review_output.copy()
        invalid["summary"]["overall_status"] = "MAYBE"
        json_str = json.dumps(invalid)
        result = schema_validator.validate(json_str, "review")
        assert not result.valid

    def test_markdown_fenced_json(self, schema_validator, valid_constraint_output):
        """JSON wrapped in markdown code fences should still parse."""
        fenced = f"```json\n{json.dumps(valid_constraint_output)}\n```"
        result = schema_validator.validate(fenced, "constraint")
        assert result.valid, f"Expected valid, got errors: {result.errors}"

    def test_unknown_schema_name(self, schema_validator):
        """Unknown schema name should produce an error."""
        result = schema_validator.validate("{}", "nonexistent_schema")
        assert not result.valid
        assert any("unknown" in e.lower() or "nonexistent" in e.lower() for e in result.errors)

    def test_validate_dict_directly(self, schema_validator, valid_constraint_output):
        """validate_dict should work with pre-parsed dicts."""
        result = schema_validator.validate_dict(valid_constraint_output, "constraint")
        assert result.valid, f"Expected valid, got errors: {result.errors}"

    def test_constraint_confidence_range(self, schema_validator, valid_constraint_output):
        """Confidence outside 0-1 range should fail."""
        invalid = valid_constraint_output.copy()
        invalid["net_classes"][0]["confidence"] = 1.5
        json_str = json.dumps(invalid)
        result = schema_validator.validate(json_str, "constraint")
        assert not result.valid


# ---------------------------------------------------------------------------
# Confidence Scoring Tests (Gate 2)
# ---------------------------------------------------------------------------

class TestConfidenceChecker:
    """Test the confidence scoring gate."""

    def test_high_confidence_passes(self, confidence_checker):
        """Items above threshold should not be flagged."""
        items = [
            {"name": "Default", "confidence": 0.95, "clearance_mm": 0.2},
            {"name": "Signal", "confidence": 0.90},
        ]
        flagged = confidence_checker.check(items)
        assert len(flagged) == 0

    def test_low_confidence_general_flagged(self, confidence_checker):
        """General items below 0.80 should be flagged."""
        items = [
            {"name": "LowConf", "confidence": 0.65},
        ]
        flagged = confidence_checker.check(items)
        assert len(flagged) == 1
        assert flagged[0]["action"] == "flag"

    def test_safety_critical_below_threshold(self, confidence_checker):
        """Safety-critical items below 0.95 should be flagged."""
        items = [
            {"name": "PowerClearance", "confidence": 0.90, "clearance_mm": 0.6},
        ]
        flagged = confidence_checker.check(items)
        assert len(flagged) == 1
        assert flagged[0]["is_safety_critical"] is True

    def test_safety_critical_very_low_rejected(self, confidence_checker):
        """Safety-critical items below 0.70 should be rejected."""
        items = [
            {"name": "UncertainImpedance", "confidence": 0.55, "impedance_ohm": 50},
        ]
        flagged = confidence_checker.check(items)
        assert len(flagged) == 1
        assert flagged[0]["action"] == "reject"

    def test_safety_critical_high_confidence_passes(self, confidence_checker):
        """Safety-critical items at or above 0.95 should pass."""
        items = [
            {"name": "Clearance100V", "confidence": 0.98, "clearance_mm": 0.6},
        ]
        flagged = confidence_checker.check(items)
        assert len(flagged) == 0

    def test_missing_confidence_flagged(self, confidence_checker):
        """Items without confidence score should be flagged."""
        items = [
            {"name": "NoScore"},
        ]
        flagged = confidence_checker.check(items)
        assert len(flagged) == 1

    def test_impedance_is_safety_critical(self, confidence_checker):
        """Items with impedance_ohm should be treated as safety-critical."""
        items = [
            {"name": "USB", "confidence": 0.90, "impedance_ohm": 90},
        ]
        flagged = confidence_checker.check(items)
        assert len(flagged) == 1
        assert flagged[0]["is_safety_critical"] is True

    def test_max_current_is_safety_critical(self, confidence_checker):
        """Items with max_current_a should be treated as safety-critical."""
        items = [
            {"name": "Power", "confidence": 0.85, "max_current_a": 3.0},
        ]
        flagged = confidence_checker.check(items)
        assert len(flagged) == 1
        assert flagged[0]["is_safety_critical"] is True

    def test_clearance_rule_type_is_safety_critical(self, confidence_checker):
        """Items with rule_type='clearance' should be safety-critical."""
        items = [
            {"name": "HV_Clearance", "confidence": 0.85, "rule_type": "clearance"},
        ]
        flagged = confidence_checker.check(items)
        assert len(flagged) == 1
        assert flagged[0]["is_safety_critical"] is True

    def test_custom_thresholds(self):
        """Custom thresholds should be respected."""
        checker = ConfidenceChecker(safety_threshold=0.99, general_threshold=0.90)
        items = [
            {"name": "Medium", "confidence": 0.85},
        ]
        flagged = checker.check(items)
        assert len(flagged) == 1

    def test_summary(self, confidence_checker):
        """get_summary should return correct counts."""
        items = [
            {"name": "A", "confidence": 0.50, "impedance_ohm": 50},  # reject
            {"name": "B", "confidence": 0.75},  # flag
        ]
        flagged = confidence_checker.check(items)
        summary = confidence_checker.get_summary(flagged)
        assert summary["total_flagged"] == 2
        assert summary["rejected_count"] == 1
        assert summary["flagged_count"] == 1


# ---------------------------------------------------------------------------
# Citation Checker Tests (Gate 3)
# ---------------------------------------------------------------------------

class TestCitationChecker:
    """Test the citation verification gate."""

    def test_ipc_citation_accepted(self, citation_checker):
        """IPC standard citation should be accepted."""
        item = {"name": "test", "source": "IPC-2221B Table 6-1, B1 clearance for 100V peak"}
        is_cited, missing = citation_checker.check(item)
        assert is_cited
        assert len(missing) == 0

    def test_datasheet_citation_accepted(self, citation_checker):
        """Datasheet citation should be accepted."""
        item = {"name": "test", "source": "STM32F405 datasheet Rev.G p.42, recommended layout"}
        is_cited, missing = citation_checker.check(item)
        assert is_cited

    def test_interface_spec_citation_accepted(self, citation_checker):
        """Interface specification citation should be accepted."""
        item = {"name": "test", "source": "USB 3.2 Gen 1 specification Section 8.3"}
        is_cited, missing = citation_checker.check(item)
        assert is_cited

    def test_physics_equation_citation_accepted(self, citation_checker):
        """Physics equation citation should be accepted."""
        item = {"name": "test", "source": "Z0 = 87/sqrt(4.5+1.41) * ln(5.98*0.2/(0.8*0.15+0.035)), IPC-2141A Eq.4-1"}
        is_cited, missing = citation_checker.check(item)
        assert is_cited

    def test_no_source_field_rejected(self, citation_checker):
        """Item without source field should be rejected."""
        item = {"name": "test"}
        is_cited, missing = citation_checker.check(item)
        assert not is_cited
        assert len(missing) > 0

    def test_empty_source_rejected(self, citation_checker):
        """Empty source string should be rejected."""
        item = {"name": "test", "source": ""}
        is_cited, missing = citation_checker.check(item)
        assert not is_cited

    def test_vague_source_rejected(self, citation_checker):
        """Vague text without citation patterns should be rejected."""
        item = {"name": "test", "source": "I think this is probably about right"}
        is_cited, missing = citation_checker.check(item)
        assert not is_cited

    def test_best_practice_alone_is_weak(self, citation_checker):
        """Best practice citation alone should pass but is weak."""
        item = {"name": "test", "source": "Engineering best practice for analog routing"}
        is_cited, missing = citation_checker.check(item)
        assert is_cited  # accepted but noted as weak

    def test_safety_critical_needs_strong_citation(self, citation_checker):
        """Safety-critical item with only best practice should fail."""
        item = {
            "name": "test",
            "source": "Engineering best practice",
            "clearance_mm": 0.6,  # safety-critical field
        }
        is_cited, missing = citation_checker.check(item)
        assert not is_cited
        assert any("strong citation" in m.lower() or "safety" in m.lower() for m in missing)

    def test_batch_check(self, citation_checker):
        """check_batch should process multiple items."""
        items = [
            {"name": "good", "source": "IPC-2221B Table 6-1"},
            {"name": "bad", "source": "just a guess"},
        ]
        results = citation_checker.check_batch(items)
        assert len(results) == 2
        assert results[0][1] is True  # good passes
        assert results[1][1] is False  # bad fails

    def test_citation_details(self, citation_checker):
        """get_citation_details should extract all citations."""
        source = "IPC-2221B Table 6-1 and USB 3.2 Gen 1 specification"
        details = citation_checker.get_citation_details(source)
        assert len(details) >= 2
        types = {d["type"] for d in details}
        assert "ipc_standard" in types

    def test_jedec_citation_accepted(self, citation_checker):
        """JEDEC standard citation should be accepted."""
        item = {"name": "ddr", "source": "JEDEC JESD79-4 DDR4 timing specification"}
        is_cited, missing = citation_checker.check(item)
        assert is_cited


# ---------------------------------------------------------------------------
# Tool Definition Tests
# ---------------------------------------------------------------------------

class TestToolDefinitions:
    """Test that tool definitions are valid and complete."""

    def test_all_tools_have_required_fields(self):
        """Every tool must have name, description, input_schema, and handler."""
        for tool in ALL_TOOLS:
            assert tool.name, f"Tool missing name"
            assert tool.description, f"Tool {tool.name} missing description"
            assert isinstance(tool.input_schema, dict), f"Tool {tool.name} input_schema is not a dict"
            assert tool.handler is not None, f"Tool {tool.name} missing handler"

    def test_tool_schemas_are_valid_json_schema(self):
        """Tool input schemas must have 'type': 'object' and 'properties'."""
        for tool in ALL_TOOLS:
            schema = tool.input_schema
            assert schema.get("type") == "object", (
                f"Tool {tool.name} schema type must be 'object', got '{schema.get('type')}'"
            )
            assert "properties" in schema, f"Tool {tool.name} schema missing 'properties'"

    def test_tool_schemas_have_required_fields(self):
        """Tool schemas with required fields must list only defined properties."""
        for tool in ALL_TOOLS:
            schema = tool.input_schema
            required = schema.get("required", [])
            properties = schema.get("properties", {})
            for field_name in required:
                assert field_name in properties, (
                    f"Tool {tool.name}: required field '{field_name}' not in properties"
                )

    def test_get_tool_schemas_format(self):
        """get_tool_schemas should return Claude API-compatible format."""
        schemas = get_tool_schemas()
        assert len(schemas) == len(ALL_TOOLS)
        for s in schemas:
            assert "name" in s
            assert "description" in s
            assert "input_schema" in s

    def test_get_tool_handler_found(self):
        """get_tool_handler should return handlers for known tools."""
        for tool in ALL_TOOLS:
            handler = get_tool_handler(tool.name)
            assert handler is not None, f"Handler not found for tool {tool.name}"

    def test_get_tool_handler_unknown(self):
        """get_tool_handler should return None for unknown tools."""
        handler = get_tool_handler("nonexistent_tool")
        assert handler is None

    def test_tool_names_unique(self):
        """All tool names must be unique."""
        names = [t.name for t in ALL_TOOLS]
        assert len(names) == len(set(names)), f"Duplicate tool names: {names}"

    def test_expected_tools_present(self):
        """All required tools should be registered."""
        expected = {
            "impedance_calc",
            "clearance_lookup",
            "drc_check",
            "datasheet_lookup",
            "stackup_suggest",
            "component_search",
        }
        actual = {t.name for t in ALL_TOOLS}
        assert expected == actual, f"Missing tools: {expected - actual}, Extra: {actual - expected}"


# ---------------------------------------------------------------------------
# Prompt Template Tests
# ---------------------------------------------------------------------------

class TestPromptTemplates:
    """Test that prompt templates are well-formed and complete."""

    def test_constraint_gen_prompt_exists(self):
        """Constraint generation prompt should be a non-empty string."""
        from routeai_intelligence.agent.prompts.constraint_gen import SYSTEM_PROMPT
        assert isinstance(SYSTEM_PROMPT, str)
        assert len(SYSTEM_PROMPT) > 500  # Should be substantial

    def test_design_review_prompt_exists(self):
        """Design review prompt should be a non-empty string."""
        from routeai_intelligence.agent.prompts.design_review import SYSTEM_PROMPT
        assert isinstance(SYSTEM_PROMPT, str)
        assert len(SYSTEM_PROMPT) > 500

    def test_routing_strategy_prompt_exists(self):
        """Routing strategy prompt should be a non-empty string."""
        from routeai_intelligence.agent.prompts.routing_strategy import SYSTEM_PROMPT
        assert isinstance(SYSTEM_PROMPT, str)
        assert len(SYSTEM_PROMPT) > 500

    def test_constraint_prompt_mentions_ipc(self):
        """Constraint prompt should reference IPC standards."""
        from routeai_intelligence.agent.prompts.constraint_gen import SYSTEM_PROMPT
        assert "IPC" in SYSTEM_PROMPT

    def test_constraint_prompt_mentions_confidence(self):
        """Constraint prompt should discuss confidence scoring."""
        from routeai_intelligence.agent.prompts.constraint_gen import SYSTEM_PROMPT
        assert "confidence" in SYSTEM_PROMPT.lower()

    def test_constraint_prompt_mentions_citation(self):
        """Constraint prompt should require citations."""
        from routeai_intelligence.agent.prompts.constraint_gen import SYSTEM_PROMPT
        assert "citation" in SYSTEM_PROMPT.lower() or "source" in SYSTEM_PROMPT.lower()

    def test_review_prompt_has_seven_categories(self):
        """Design review prompt should define all 7 review categories."""
        from routeai_intelligence.agent.prompts.design_review import SYSTEM_PROMPT
        categories = ["DRC", "Decoupling", "Impedance", "Thermal", "Manufacturing", "Placement", "High-Speed"]
        for cat in categories:
            assert cat.lower() in SYSTEM_PROMPT.lower(), f"Missing category: {cat}"

    def test_review_prompt_has_severity_levels(self):
        """Design review prompt should define severity levels."""
        from routeai_intelligence.agent.prompts.design_review import SYSTEM_PROMPT
        for severity in ["CRITICAL", "ERROR", "WARNING", "INFO"]:
            assert severity in SYSTEM_PROMPT

    def test_routing_prompt_mentions_layer_assignment(self):
        """Routing prompt should discuss layer assignment strategy."""
        from routeai_intelligence.agent.prompts.routing_strategy import SYSTEM_PROMPT
        assert "layer" in SYSTEM_PROMPT.lower()

    def test_routing_prompt_mentions_via_strategy(self):
        """Routing prompt should discuss via strategy."""
        from routeai_intelligence.agent.prompts.routing_strategy import SYSTEM_PROMPT
        assert "via" in SYSTEM_PROMPT.lower()

    def test_routing_prompt_mentions_cost_weights(self):
        """Routing prompt should discuss cost function weights."""
        from routeai_intelligence.agent.prompts.routing_strategy import SYSTEM_PROMPT
        assert "cost" in SYSTEM_PROMPT.lower() or "weight" in SYSTEM_PROMPT.lower()


# ---------------------------------------------------------------------------
# Schema File Tests
# ---------------------------------------------------------------------------

class TestSchemaFiles:
    """Test that JSON schema files are valid and loadable."""

    def test_constraint_schema_loads(self):
        """constraint_schema.json should be valid JSON."""
        path = SCHEMAS_DIR / "constraint_schema.json"
        assert path.exists(), f"Schema file not found: {path}"
        with open(path) as f:
            schema = json.load(f)
        assert schema["title"] == "ConstraintSet"

    def test_review_schema_loads(self):
        """review_schema.json should be valid JSON."""
        path = SCHEMAS_DIR / "review_schema.json"
        assert path.exists()
        with open(path) as f:
            schema = json.load(f)
        assert schema["title"] == "ReviewResult"

    def test_routing_schema_loads(self):
        """routing_schema.json should be valid JSON."""
        path = SCHEMAS_DIR / "routing_schema.json"
        assert path.exists()
        with open(path) as f:
            schema = json.load(f)
        assert schema["title"] == "RoutingStrategy"

    def test_constraint_schema_has_required_sections(self):
        """Constraint schema should require all top-level sections."""
        path = SCHEMAS_DIR / "constraint_schema.json"
        with open(path) as f:
            schema = json.load(f)
        required = schema.get("required", [])
        assert "net_classes" in required
        assert "diff_pairs" in required
        assert "length_groups" in required
        assert "special_rules" in required
        assert "metadata" in required

    def test_review_schema_has_seven_categories(self):
        """Review schema category_summaries should have all 7 categories."""
        path = SCHEMAS_DIR / "review_schema.json"
        with open(path) as f:
            schema = json.load(f)
        cat_props = schema["properties"]["category_summaries"]["properties"]
        expected = {"drc", "decoupling", "impedance", "thermal", "manufacturing", "placement", "high_speed"}
        assert set(cat_props.keys()) == expected


# ---------------------------------------------------------------------------
# Tool Handler Tests (sync-safe, no external dependencies)
# ---------------------------------------------------------------------------

class TestToolHandlers:
    """Test tool handler functions with mock inputs."""

    @pytest.mark.asyncio
    async def test_impedance_calc_microstrip(self):
        """impedance_calc should return valid impedance for microstrip."""
        handler = get_tool_handler("impedance_calc")
        result = await handler(
            trace_width_mm=0.2,
            dielectric_height_mm=0.2,
            dielectric_constant=4.5,
            topology="microstrip",
        )
        assert result["status"] == "ok"
        assert "z0_ohm" in result
        assert 20 < result["z0_ohm"] < 200  # reasonable range

    @pytest.mark.asyncio
    async def test_impedance_calc_differential(self):
        """impedance_calc should return differential impedance when spacing given."""
        handler = get_tool_handler("impedance_calc")
        result = await handler(
            trace_width_mm=0.15,
            dielectric_height_mm=0.2,
            dielectric_constant=4.5,
            topology="microstrip",
            spacing_mm=0.15,
        )
        assert result["status"] == "ok"
        assert "z_diff_ohm" in result
        assert result["z_diff_ohm"] > 0

    @pytest.mark.asyncio
    async def test_impedance_calc_invalid_params(self):
        """impedance_calc should return error for invalid parameters."""
        handler = get_tool_handler("impedance_calc")
        result = await handler(
            trace_width_mm=-1.0,
            dielectric_height_mm=0.2,
            dielectric_constant=4.5,
        )
        assert result["status"] == "error"

    @pytest.mark.asyncio
    async def test_clearance_lookup_low_voltage(self):
        """clearance_lookup should return small clearance for low voltage."""
        handler = get_tool_handler("clearance_lookup")
        result = await handler(voltage_v=5.0)
        assert result["status"] == "ok"
        assert result["clearance_mm"] >= 0.05  # some minimum

    @pytest.mark.asyncio
    async def test_clearance_lookup_high_voltage(self):
        """clearance_lookup should return larger clearance for high voltage."""
        handler = get_tool_handler("clearance_lookup")
        result = await handler(voltage_v=500.0)
        assert result["status"] == "ok"
        assert result["clearance_mm"] > 1.0  # should be significant

    @pytest.mark.asyncio
    async def test_clearance_lookup_conditions(self):
        """clearance_lookup should vary by condition code."""
        handler = get_tool_handler("clearance_lookup")
        b1 = await handler(voltage_v=100.0, condition="B1")
        b3 = await handler(voltage_v=100.0, condition="B3")
        assert b1["clearance_mm"] > b3["clearance_mm"]  # internal has less clearance

    @pytest.mark.asyncio
    async def test_stackup_suggest_4_layer(self):
        """stackup_suggest should return a valid 4-layer stackup."""
        handler = get_tool_handler("stackup_suggest")
        result = await handler(layer_count=4)
        assert result["status"] == "ok"
        assert result["layer_count"] == 4
        assert len(result["stackup"]) > 0
        assert len(result["achievable_impedances"]) > 0

    @pytest.mark.asyncio
    async def test_stackup_suggest_invalid_layers(self):
        """stackup_suggest should reject unsupported layer counts."""
        handler = get_tool_handler("stackup_suggest")
        result = await handler(layer_count=3)
        assert result["status"] == "error"
