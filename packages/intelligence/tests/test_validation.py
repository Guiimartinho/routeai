"""Tests for the 3-gate validation pipeline.

Gate 1: Schema validation (valid/invalid JSON)
Gate 2: Confidence scoring (safety-critical vs general)
Gate 3: Citation checking (all 8 patterns, strength classification)
End-to-end pipeline tests.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from routeai_intelligence.validation.citation_checker import (
    CitationChecker,
    _CITATION_PATTERNS,
    _STRONG_CITATION_TYPES,
    _WEAK_CITATION_TYPES,
)
from routeai_intelligence.validation.confidence import (
    GENERAL_THRESHOLD,
    SAFETY_CRITICAL_PARAMS,
    SAFETY_CRITICAL_THRESHOLD,
    ConfidenceChecker,
    FlaggedItem,
)
from routeai_intelligence.validation.schema_validator import (
    SchemaValidator,
    ValidationResult,
)


# ---------------------------------------------------------------------------
# Gate 1: Schema Validator Tests
# ---------------------------------------------------------------------------


class TestSchemaValidatorJSON:
    """Test schema validator with valid and invalid JSON."""

    def test_valid_json_parses(self):
        sv = SchemaValidator()
        result = sv._extract_json('{"key": "value"}')
        assert result == {"key": "value"}

    def test_invalid_json_returns_none(self):
        sv = SchemaValidator()
        result = sv._extract_json("this is not json")
        assert result is None

    def test_markdown_fenced_json(self):
        sv = SchemaValidator()
        result = sv._extract_json('```json\n{"key": 1}\n```')
        assert result == {"key": 1}

    def test_json_embedded_in_text(self):
        sv = SchemaValidator()
        result = sv._extract_json('Some text before {"key": "val"} and after')
        assert result == {"key": "val"}

    def test_empty_string_returns_none(self):
        sv = SchemaValidator()
        result = sv._extract_json("")
        assert result is None

    def test_array_json_returns_none(self):
        """Only object (dict) JSON should be extracted, not arrays."""
        sv = SchemaValidator()
        result = sv._extract_json("[1, 2, 3]")
        assert result is None

    def test_nested_json(self):
        sv = SchemaValidator()
        data = {"a": {"b": [1, 2, 3]}, "c": True}
        result = sv._extract_json(json.dumps(data))
        assert result == data


class TestSchemaValidatorTypeChecking:
    """Test type checking in schema validation."""

    def test_object_type_check(self):
        sv = SchemaValidator()
        errors: list[str] = []
        warnings: list[str] = []
        sv._validate_object("not a dict", {"type": "object"}, "root", errors, warnings)
        assert len(errors) == 1
        assert "object" in errors[0].lower()

    def test_array_type_check(self):
        sv = SchemaValidator()
        errors: list[str] = []
        warnings: list[str] = []
        sv._validate_object("not a list", {"type": "array"}, "root", errors, warnings)
        assert len(errors) == 1

    def test_string_type_check(self):
        sv = SchemaValidator()
        errors: list[str] = []
        warnings: list[str] = []
        sv._validate_object(42, {"type": "string"}, "root", errors, warnings)
        assert len(errors) == 1

    def test_number_type_check(self):
        sv = SchemaValidator()
        errors: list[str] = []
        warnings: list[str] = []
        sv._validate_object("abc", {"type": "number"}, "root", errors, warnings)
        assert len(errors) == 1

    def test_integer_type_check(self):
        sv = SchemaValidator()
        errors: list[str] = []
        warnings: list[str] = []
        sv._validate_object(3.14, {"type": "integer"}, "root", errors, warnings)
        assert len(errors) == 1

    def test_boolean_rejects_non_bool(self):
        sv = SchemaValidator()
        errors: list[str] = []
        warnings: list[str] = []
        sv._validate_object(1, {"type": "boolean"}, "root", errors, warnings)
        assert len(errors) == 1

    def test_null_type_check(self):
        sv = SchemaValidator()
        errors: list[str] = []
        warnings: list[str] = []
        sv._validate_object(None, {"type": "null"}, "root", errors, warnings)
        assert len(errors) == 0

    def test_union_type_number_or_null(self):
        sv = SchemaValidator()
        errors: list[str] = []
        warnings: list[str] = []
        sv._validate_object(None, {"type": ["number", "null"]}, "root", errors, warnings)
        assert len(errors) == 0

        errors2: list[str] = []
        sv._validate_object(3.14, {"type": ["number", "null"]}, "root", errors2, [])
        assert len(errors2) == 0


class TestSchemaValidatorConstraints:
    """Test value range and enum validation."""

    def test_number_minimum_violation(self):
        sv = SchemaValidator()
        errors: list[str] = []
        sv._validate_number(-1, {"type": "number", "minimum": 0}, "field", errors, [])
        assert len(errors) == 1
        assert "minimum" in errors[0].lower()

    def test_number_maximum_violation(self):
        sv = SchemaValidator()
        errors: list[str] = []
        sv._validate_number(200, {"type": "number", "maximum": 100}, "field", errors, [])
        assert len(errors) == 1

    def test_string_enum_violation(self):
        sv = SchemaValidator()
        errors: list[str] = []
        sv._validate_string("INVALID", {"type": "string", "enum": ["A", "B"]}, "field", errors, [])
        assert len(errors) == 1
        assert "allowed" in errors[0].lower()

    def test_string_min_length(self):
        sv = SchemaValidator()
        errors: list[str] = []
        sv._validate_string("ab", {"type": "string", "minLength": 5}, "field", errors, [])
        assert len(errors) == 1

    def test_array_min_items(self):
        sv = SchemaValidator()
        errors: list[str] = []
        sv._validate_array([], {"type": "array", "minItems": 1}, "field", errors, [])
        assert len(errors) == 1

    def test_required_field_missing(self):
        sv = SchemaValidator()
        errors: list[str] = []
        schema = {
            "type": "object",
            "required": ["name"],
            "properties": {"name": {"type": "string"}},
        }
        sv._validate_object({}, schema, "", errors, [])
        assert len(errors) == 1
        assert "required" in errors[0].lower()


# ---------------------------------------------------------------------------
# Gate 2: Confidence Scorer Tests
# ---------------------------------------------------------------------------


class TestConfidenceScorerSafetyCritical:
    """Test confidence scoring with safety-critical items."""

    def test_safety_critical_below_threshold_flagged(self):
        checker = ConfidenceChecker()
        items = [{"name": "HV_clearance", "confidence": 0.90, "clearance_mm": 2.0}]
        flagged = checker.check(items)
        assert len(flagged) == 1
        assert flagged[0]["is_safety_critical"] is True
        assert flagged[0]["threshold"] == SAFETY_CRITICAL_THRESHOLD

    def test_safety_critical_very_low_rejected(self):
        checker = ConfidenceChecker()
        items = [{"name": "bad_impedance", "confidence": 0.50, "impedance_ohm": 90}]
        flagged = checker.check(items)
        assert len(flagged) == 1
        assert flagged[0]["action"] == "reject"

    def test_safety_critical_above_threshold_passes(self):
        checker = ConfidenceChecker()
        items = [{"name": "good_clearance", "confidence": 0.98, "clearance_mm": 2.0}]
        flagged = checker.check(items)
        assert len(flagged) == 0

    def test_impedance_ohm_is_safety_critical(self):
        checker = ConfidenceChecker()
        assert checker._is_safety_critical({"impedance_ohm": 50})

    def test_max_current_a_is_safety_critical(self):
        checker = ConfidenceChecker()
        assert checker._is_safety_critical({"max_current_a": 5.0})

    def test_clearance_rule_type_is_safety_critical(self):
        checker = ConfidenceChecker()
        assert checker._is_safety_critical({"rule_type": "clearance"})

    def test_guard_ring_rule_type_is_safety_critical(self):
        checker = ConfidenceChecker()
        assert checker._is_safety_critical({"rule_type": "guard_ring"})

    def test_none_valued_safety_field_not_critical(self):
        checker = ConfidenceChecker()
        assert not checker._is_safety_critical({"impedance_ohm": None})

    def test_all_safety_critical_params_recognized(self):
        """All defined safety-critical params should trigger safety-critical status."""
        checker = ConfidenceChecker()
        for param in SAFETY_CRITICAL_PARAMS:
            item = {param: 1.0}
            assert checker._is_safety_critical(item), f"{param} not recognized as safety-critical"


class TestConfidenceScorerGeneral:
    """Test confidence scoring with general (non-safety) items."""

    def test_general_below_threshold_flagged(self):
        checker = ConfidenceChecker()
        items = [{"name": "routing_hint", "confidence": 0.70}]
        flagged = checker.check(items)
        assert len(flagged) == 1
        assert flagged[0]["is_safety_critical"] is False
        assert flagged[0]["action"] == "flag"

    def test_general_above_threshold_passes(self):
        checker = ConfidenceChecker()
        items = [{"name": "good_rule", "confidence": 0.85}]
        flagged = checker.check(items)
        assert len(flagged) == 0

    def test_missing_confidence_flagged(self):
        checker = ConfidenceChecker()
        items = [{"name": "no_score"}]
        flagged = checker.check(items)
        assert len(flagged) == 1
        assert flagged[0]["confidence"] == 0.0

    def test_custom_thresholds(self):
        checker = ConfidenceChecker(safety_threshold=0.99, general_threshold=0.95)
        items = [{"name": "medium", "confidence": 0.92}]
        flagged = checker.check(items)
        assert len(flagged) == 1

    def test_empty_list_returns_empty(self):
        checker = ConfidenceChecker()
        assert checker.check([]) == []

    def test_flagged_item_to_dict(self):
        item = FlaggedItem(
            item_name="test",
            confidence=0.5,
            threshold=0.8,
            is_safety_critical=False,
            reason="too low",
            action="flag",
        )
        d = item.to_dict()
        assert d["item_name"] == "test"
        assert d["action"] == "flag"

    def test_get_summary_counts(self):
        checker = ConfidenceChecker()
        items = [
            {"name": "A", "confidence": 0.50, "impedance_ohm": 50},  # reject
            {"name": "B", "confidence": 0.75},  # flag
            {"name": "C", "confidence": 0.90, "clearance_mm": 1.0},  # flag (safety below 0.95)
        ]
        flagged = checker.check(items)
        summary = checker.get_summary(flagged)
        assert summary["total_flagged"] == 3
        assert summary["rejected_count"] == 1
        assert summary["flagged_count"] == 2


# ---------------------------------------------------------------------------
# Gate 3: Citation Checker Tests (all 8 patterns)
# ---------------------------------------------------------------------------


class TestCitationPatterns:
    """Test all 8 citation patterns are recognized."""

    def test_ipc_standard_pattern(self):
        checker = CitationChecker()
        item = {"source": "IPC-2221B Table 6-1"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_ipc_standard_with_section(self):
        checker = CitationChecker()
        item = {"source": "IPC-2141A Section 4.3.2"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_jedec_standard_pattern(self):
        checker = CitationChecker()
        item = {"source": "JEDEC JESD79-4 DDR4 specification"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_jedec_lpddr(self):
        checker = CitationChecker()
        item = {"source": "JEDEC LPDDR4 specification"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_datasheet_with_page(self):
        checker = CitationChecker()
        item = {"source": "STM32F405 datasheet p.42"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_datasheet_with_section(self):
        checker = CitationChecker()
        item = {"source": "TPS54331 datasheet Section 8.2"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_datasheet_with_table(self):
        checker = CitationChecker()
        item = {"source": "LAN8720 datasheet Table 3.1"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_datasheet_rev_with_page(self):
        checker = CitationChecker()
        item = {"source": "datasheet Rev.G p.82"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_interface_spec_usb(self):
        checker = CitationChecker()
        item = {"source": "USB 3.2 Gen 1 specification"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_interface_spec_pcie(self):
        checker = CitationChecker()
        item = {"source": "PCIe 4.0 Gen 4 specification"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_interface_spec_hdmi(self):
        checker = CitationChecker()
        item = {"source": "HDMI 2.1 specification"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_physics_equation_z0(self):
        checker = CitationChecker()
        item = {"source": "Z0 = 87/sqrt(Er+1.41) * ln(5.98*h/(0.8*w+t))"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_physics_equation_hammerstad(self):
        checker = CitationChecker()
        item = {"source": "Hammerstad-Jensen microstrip equation"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_physics_equation_ipc_2141a_eq(self):
        checker = CitationChecker()
        item = {"source": "IPC-2141A Eq.4-1"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_safety_standard_mil_std(self):
        checker = CitationChecker()
        item = {"source": "MIL-STD-275 clearance requirements"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_safety_standard_iec(self):
        checker = CitationChecker()
        item = {"source": "IEC 61000 ESD immunity"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_safety_standard_ul(self):
        checker = CitationChecker()
        item = {"source": "UL 60950 safety clearance"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_application_note_an_number(self):
        checker = CitationChecker()
        item = {"source": "AN-1149 switching regulator layout"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_application_note_text(self):
        checker = CitationChecker()
        item = {"source": "Application Note AN1234 power supply design"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_best_practice(self):
        checker = CitationChecker()
        item = {"source": "Engineering best practice for analog routing"}
        is_cited, _ = checker.check(item)
        assert is_cited

    def test_industry_standard_practice(self):
        checker = CitationChecker()
        item = {"source": "Industry standard practice for power routing"}
        is_cited, _ = checker.check(item)
        assert is_cited


class TestCitationStrength:
    """Test citation strength classification."""

    def test_ipc_is_strong(self):
        assert "ipc_standard" in _STRONG_CITATION_TYPES

    def test_jedec_is_strong(self):
        assert "jedec_standard" in _STRONG_CITATION_TYPES

    def test_datasheet_is_strong(self):
        assert "datasheet" in _STRONG_CITATION_TYPES

    def test_interface_spec_is_strong(self):
        assert "interface_spec" in _STRONG_CITATION_TYPES

    def test_physics_equation_is_strong(self):
        assert "physics_equation" in _STRONG_CITATION_TYPES

    def test_safety_standard_is_strong(self):
        assert "safety_standard" in _STRONG_CITATION_TYPES

    def test_application_note_is_weak(self):
        assert "application_note" in _WEAK_CITATION_TYPES

    def test_best_practice_is_weak(self):
        assert "best_practice" in _WEAK_CITATION_TYPES

    def test_safety_critical_with_weak_citation_fails(self):
        """Safety-critical item with only weak citation should fail."""
        checker = CitationChecker()
        item = {
            "source": "Engineering best practice",
            "clearance_mm": 2.0,
        }
        is_cited, missing = checker.check(item)
        assert not is_cited
        assert any("strong" in m.lower() or "safety" in m.lower() for m in missing)

    def test_safety_critical_with_strong_citation_passes(self):
        """Safety-critical item with strong citation should pass."""
        checker = CitationChecker()
        item = {
            "source": "IPC-2221B Table 6-1 clearance for 100V",
            "clearance_mm": 2.0,
        }
        is_cited, missing = checker.check(item)
        assert is_cited
        assert len(missing) == 0

    def test_get_citation_details_extracts_all(self):
        checker = CitationChecker()
        source = "IPC-2221B Table 6-1 and Application Note AN1234"
        details = checker.get_citation_details(source)
        types = {d["type"] for d in details}
        assert "ipc_standard" in types
        assert "application_note" in types
        for d in details:
            assert d["strength"] in ("strong", "weak")


# ---------------------------------------------------------------------------
# End-to-end pipeline tests
# ---------------------------------------------------------------------------


class TestEndToEndPipeline:
    """Test the complete 3-gate pipeline as used by RouteAIAgent."""

    def test_all_gates_pass_for_well_formed_item(self):
        """A well-formed item with high confidence and strong citation should pass all gates."""
        sv = SchemaValidator()
        cc = ConfidenceChecker()
        cit = CitationChecker()

        item = {
            "name": "USB_DP_DM",
            "confidence": 0.97,
            "impedance_ohm": 90,
            "source": "USB 2.0 specification Section 7.1.2, 90 ohm differential impedance",
        }

        # Gate 2: confidence
        flagged = cc.check([item])
        assert len(flagged) == 0, f"Gate 2 failed: {flagged}"

        # Gate 3: citation
        is_cited, missing = cit.check(item)
        assert is_cited, f"Gate 3 failed: {missing}"

    def test_low_confidence_safety_critical_fails_gate2(self):
        """Low-confidence safety-critical item should fail Gate 2."""
        cc = ConfidenceChecker()
        item = {
            "name": "bad_clearance",
            "confidence": 0.60,
            "clearance_mm": 1.0,
            "source": "IPC-2221B Table 6-1",
        }
        flagged = cc.check([item])
        assert len(flagged) == 1
        assert flagged[0]["action"] == "reject"

    def test_uncited_item_fails_gate3(self):
        """Item without proper citation should fail Gate 3."""
        cit = CitationChecker()
        item = {
            "name": "guess_impedance",
            "confidence": 0.95,
            "source": "I think 50 ohm is standard",
        }
        is_cited, missing = cit.check(item)
        assert not is_cited
        assert len(missing) > 0

    def test_multiple_gates_fail_independently(self):
        """Item can fail both Gate 2 and Gate 3."""
        cc = ConfidenceChecker()
        cit = CitationChecker()

        item = {
            "name": "bad_everything",
            "confidence": 0.50,
            "impedance_ohm": 50,
            "source": "just a guess",
        }

        flagged = cc.check([item])
        assert len(flagged) == 1  # Gate 2 fails

        is_cited, missing = cit.check(item)
        assert not is_cited  # Gate 3 fails
