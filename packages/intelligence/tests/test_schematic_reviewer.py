"""Tests for the SchematicReviewer module.

Tests pull-up detection, decoupling cap verification, ESD protection checking,
crystal load cap validation, power pin connectivity, floating input detection,
unused pin flagging, and review scoring.
"""

from __future__ import annotations

import pytest

from routeai_intelligence.agent.schematic_reviewer import (
    FindingCategory,
    FindingSeverity,
    SchematicReviewer,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def reviewer():
    return SchematicReviewer(agent=None)


def _make_schematic(
    components: list | None = None,
    nets: list | None = None,
) -> dict:
    return {
        "components": components or [],
        "nets": nets or [],
    }


# ---------------------------------------------------------------------------
# Pull-up detection tests
# ---------------------------------------------------------------------------


class TestPullUpDetection:
    """Test detection of missing pull-up resistors on open-drain signals."""

    @pytest.mark.asyncio
    async def test_i2c_missing_pullup_detected(self, reviewer):
        """I2C nets without pull-ups should trigger ERROR findings."""
        schematic = _make_schematic(
            components=[
                {"reference": "U1", "value": "STM32F405", "pads": ["U1:1", "U1:2"]},
                {"reference": "U2", "value": "BME280", "pads": ["U2:1", "U2:2"]},
            ],
            nets=[
                {"name": "I2C_SDA", "pinIds": ["U1:1", "U2:1"]},
                {"name": "I2C_SCL", "pinIds": ["U1:2", "U2:2"]},
            ],
        )
        report = await reviewer.review(schematic)
        pullup_findings = [f for f in report.findings if f.category == FindingCategory.PULL_UP_MISSING]
        assert len(pullup_findings) >= 2
        for f in pullup_findings:
            assert f.severity == FindingSeverity.ERROR

    @pytest.mark.asyncio
    async def test_i2c_with_pullup_no_finding(self, reviewer):
        """I2C nets with proper pull-ups should not trigger findings."""
        schematic = _make_schematic(
            components=[
                {"reference": "U1", "value": "STM32F405", "pads": ["U1:1", "U1:2"]},
                {"reference": "R1", "value": "4.7k", "pads": ["R1:1", "R1:2"]},
                {"reference": "R2", "value": "4.7k", "pads": ["R2:1", "R2:2"]},
            ],
            nets=[
                {"name": "I2C_SDA", "pinIds": ["U1:1", "R1:1"]},
                {"name": "VDD_3V3", "pinIds": ["R1:2"]},
                {"name": "I2C_SCL", "pinIds": ["U1:2", "R2:1"]},
                {"name": "VCC", "pinIds": ["R2:2"]},
            ],
        )
        report = await reviewer.review(schematic)
        pullup_findings = [f for f in report.findings if f.category == FindingCategory.PULL_UP_MISSING]
        assert len(pullup_findings) == 0

    @pytest.mark.asyncio
    async def test_interrupt_missing_pullup_is_warning(self, reviewer):
        """Non-I2C open-drain signals (INT, IRQ) should trigger WARNING not ERROR."""
        schematic = _make_schematic(
            components=[
                {"reference": "U1", "value": "BME280", "pads": ["U1:1"]},
                {"reference": "U2", "value": "STM32", "pads": ["U2:1"]},
            ],
            nets=[
                {"name": "nINT_SENSOR", "pinIds": ["U1:1", "U2:1"]},
            ],
        )
        report = await reviewer.review(schematic)
        findings = [f for f in report.findings if f.category == FindingCategory.PULL_UP_MISSING]
        assert len(findings) == 1
        assert findings[0].severity == FindingSeverity.WARNING


# ---------------------------------------------------------------------------
# Decoupling cap verification tests
# ---------------------------------------------------------------------------


class TestDecouplingCapVerification:
    """Test detection of missing decoupling capacitors."""

    @pytest.mark.asyncio
    async def test_mcu_without_decoupling(self, reviewer):
        """MCU without decoupling caps should trigger ERROR."""
        schematic = _make_schematic(
            components=[
                {"reference": "U1", "value": "STM32F405", "pads": ["U1:VDD", "U1:GND"]},
            ],
            nets=[
                {"name": "VDD_3V3", "pinIds": ["U1:VDD"]},
                {"name": "GND", "pinIds": ["U1:GND"]},
            ],
        )
        report = await reviewer.review(schematic)
        decoupling = [f for f in report.findings if f.category == FindingCategory.DECOUPLING_CAP]
        assert len(decoupling) >= 1
        assert decoupling[0].severity == FindingSeverity.ERROR

    @pytest.mark.asyncio
    async def test_mcu_with_sufficient_decoupling(self, reviewer):
        """MCU with proper decoupling should not trigger finding."""
        schematic = _make_schematic(
            components=[
                {"reference": "U1", "value": "STM32F405", "pads": ["U1:VDD", "U1:GND"]},
                {"reference": "C1", "value": "100nF", "pads": ["C1:1", "C1:2"]},
            ],
            nets=[
                {"name": "VDD_3V3", "pinIds": ["U1:VDD", "C1:1"]},
                {"name": "GND", "pinIds": ["U1:GND", "C1:2"]},
            ],
        )
        report = await reviewer.review(schematic)
        decoupling = [f for f in report.findings if f.category == FindingCategory.DECOUPLING_CAP]
        assert len(decoupling) == 0

    @pytest.mark.asyncio
    async def test_generic_ic_warning_level(self, reviewer):
        """Generic IC missing decoupling should trigger WARNING not ERROR."""
        schematic = _make_schematic(
            components=[
                {"reference": "U1", "value": "SN74HC595", "pads": ["U1:VCC", "U1:GND"]},
            ],
            nets=[
                {"name": "VCC", "pinIds": ["U1:VCC"]},
                {"name": "GND", "pinIds": ["U1:GND"]},
            ],
        )
        report = await reviewer.review(schematic)
        decoupling = [f for f in report.findings if f.category == FindingCategory.DECOUPLING_CAP]
        assert len(decoupling) >= 1
        assert decoupling[0].severity == FindingSeverity.WARNING


# ---------------------------------------------------------------------------
# ESD protection tests
# ---------------------------------------------------------------------------


class TestESDProtection:
    """Test detection of missing ESD protection."""

    @pytest.mark.asyncio
    async def test_usb_without_esd_error(self, reviewer):
        """USB data lines without ESD protection should trigger ERROR."""
        schematic = _make_schematic(
            components=[
                {"reference": "J1", "value": "USB-C", "pads": ["J1:DP", "J1:DM"]},
                {"reference": "U1", "value": "STM32", "pads": ["U1:DP", "U1:DM"]},
            ],
            nets=[
                {"name": "USB_DP", "pinIds": ["J1:DP", "U1:DP"]},
                {"name": "USB_DM", "pinIds": ["J1:DM", "U1:DM"]},
            ],
        )
        report = await reviewer.review(schematic)
        esd_findings = [f for f in report.findings if f.category == FindingCategory.ESD_PROTECTION]
        usb_esd = [f for f in esd_findings if "USB" in f.title]
        assert len(usb_esd) >= 1
        assert usb_esd[0].severity == FindingSeverity.ERROR

    @pytest.mark.asyncio
    async def test_usb_with_esd_no_finding(self, reviewer):
        """USB with ESD protection device should not trigger finding."""
        schematic = _make_schematic(
            components=[
                {"reference": "J1", "value": "USB-C", "pads": ["J1:DP"]},
                {"reference": "U2", "value": "USBLC6-2SC6", "description": "USB ESD protection", "pads": ["U2:1"]},
            ],
            nets=[
                {"name": "USB_DP", "pinIds": ["J1:DP", "U2:1"]},
            ],
        )
        report = await reviewer.review(schematic)
        usb_esd = [f for f in report.findings if f.category == FindingCategory.ESD_PROTECTION and "USB" in f.title]
        assert len(usb_esd) == 0

    @pytest.mark.asyncio
    async def test_ethernet_without_protection_warning(self, reviewer):
        """Ethernet without protection should trigger WARNING."""
        schematic = _make_schematic(
            components=[
                {"reference": "U1", "value": "LAN8720", "pads": ["U1:TXP"]},
            ],
            nets=[
                {"name": "ETH_TXP", "pinIds": ["U1:TXP"]},
            ],
        )
        report = await reviewer.review(schematic)
        eth_esd = [f for f in report.findings if f.category == FindingCategory.ESD_PROTECTION and "Ethernet" in f.title]
        assert len(eth_esd) >= 1
        assert eth_esd[0].severity == FindingSeverity.WARNING


# ---------------------------------------------------------------------------
# Crystal load cap validation tests
# ---------------------------------------------------------------------------


class TestCrystalLoadCapValidation:
    """Test crystal load capacitor checking."""

    @pytest.mark.asyncio
    async def test_crystal_missing_load_caps(self, reviewer):
        """Crystal without load caps should trigger ERROR."""
        schematic = _make_schematic(
            components=[
                {"reference": "Y1", "value": "8MHz", "pads": ["Y1:1", "Y1:2"]},
            ],
            nets=[
                {"name": "XTAL_IN", "pinIds": ["Y1:1"]},
                {"name": "XTAL_OUT", "pinIds": ["Y1:2"]},
            ],
        )
        report = await reviewer.review(schematic)
        crystal = [f for f in report.findings if f.category == FindingCategory.CRYSTAL_LOAD_CAP]
        assert len(crystal) >= 1
        assert crystal[0].severity == FindingSeverity.ERROR
        assert "Missing load capacitors" in crystal[0].title

    @pytest.mark.asyncio
    async def test_crystal_with_matched_load_caps(self, reviewer):
        """Crystal with two matched load caps should not trigger an error for missing caps."""
        schematic = _make_schematic(
            components=[
                {"reference": "Y1", "value": "8MHz", "pads": ["Y1:1", "Y1:2"]},
                {"reference": "C1", "value": "22pF", "pads": ["C1:1", "C1:2"]},
                {"reference": "C2", "value": "22pF", "pads": ["C2:1", "C2:2"]},
            ],
            nets=[
                {"name": "XTAL_IN", "pinIds": ["Y1:1", "C1:1"]},
                {"name": "XTAL_OUT", "pinIds": ["Y1:2", "C2:1"]},
                {"name": "GND", "pinIds": ["C1:2", "C2:2"]},
            ],
        )
        report = await reviewer.review(schematic)
        missing = [f for f in report.findings if f.category == FindingCategory.CRYSTAL_LOAD_CAP and "Missing" in f.title]
        assert len(missing) == 0

    @pytest.mark.asyncio
    async def test_crystal_mismatched_load_caps(self, reviewer):
        """Crystal with mismatched load caps should trigger WARNING."""
        schematic = _make_schematic(
            components=[
                {"reference": "Y1", "value": "8MHz", "pads": ["Y1:1", "Y1:2"]},
                {"reference": "C1", "value": "22pF", "pads": ["C1:1", "C1:2"]},
                {"reference": "C2", "value": "33pF", "pads": ["C2:1", "C2:2"]},
            ],
            nets=[
                {"name": "XTAL_IN", "pinIds": ["Y1:1", "C1:1"]},
                {"name": "XTAL_OUT", "pinIds": ["Y1:2", "C2:1"]},
                {"name": "GND", "pinIds": ["C1:2", "C2:2"]},
            ],
        )
        report = await reviewer.review(schematic)
        mismatch = [f for f in report.findings if "Mismatched" in f.title]
        assert len(mismatch) == 1
        assert mismatch[0].severity == FindingSeverity.WARNING


# ---------------------------------------------------------------------------
# Power pin connectivity tests
# ---------------------------------------------------------------------------


class TestPowerPinConnectivity:
    """Test detection of unconnected power pins."""

    @pytest.mark.asyncio
    async def test_unconnected_power_pin_critical(self, reviewer):
        """Unconnected VDD pin on an IC should be CRITICAL."""
        schematic = _make_schematic(
            components=[
                {
                    "reference": "U1",
                    "value": "STM32",
                    "pads": ["U1:1"],
                    "pins": [
                        {"id": "U1:VDD", "name": "VDD", "type": "power", "number": "1"},
                    ],
                },
            ],
            nets=[],
        )
        report = await reviewer.review(schematic)
        power = [f for f in report.findings if f.category == FindingCategory.POWER_PIN]
        assert len(power) >= 1
        assert power[0].severity == FindingSeverity.CRITICAL


# ---------------------------------------------------------------------------
# Floating input detection tests
# ---------------------------------------------------------------------------


class TestFloatingInputDetection:
    """Test detection of floating digital inputs."""

    @pytest.mark.asyncio
    async def test_floating_input_warning(self, reviewer):
        """Input pin with no driver should trigger WARNING."""
        schematic = _make_schematic(
            components=[
                {
                    "reference": "U1",
                    "value": "STM32",
                    "pads": ["U1:PA0"],
                    "pins": [
                        {"id": "U1:PA0", "name": "PA0", "type": "input", "number": "10"},
                    ],
                },
            ],
            nets=[
                {"name": "FLOATING_NET", "pinIds": ["U1:PA0"]},  # Only 1 pin
            ],
        )
        report = await reviewer.review(schematic)
        floating = [f for f in report.findings if f.category == FindingCategory.FLOATING_INPUT]
        assert len(floating) >= 1
        assert floating[0].severity == FindingSeverity.WARNING


# ---------------------------------------------------------------------------
# Unused pin flagging tests
# ---------------------------------------------------------------------------


class TestUnusedPinFlagging:
    """Test detection of unused IC pins."""

    @pytest.mark.asyncio
    async def test_unused_pins_info(self, reviewer):
        """A few unconnected non-passive IC pins should trigger INFO."""
        schematic = _make_schematic(
            components=[
                {
                    "reference": "U1",
                    "value": "STM32",
                    "pads": ["U1:1", "U1:2"],
                    "pins": [
                        {"id": "U1:GPIO1", "name": "GPIO1", "type": "bidirectional", "number": "1"},
                        {"id": "U1:GPIO2", "name": "GPIO2", "type": "bidirectional", "number": "2"},
                        {"id": "U1:GPIO3", "name": "GPIO3", "type": "bidirectional", "number": "3"},
                    ],
                },
            ],
            nets=[
                {"name": "NET1", "pinIds": ["U1:1"]},
                # U1:GPIO1, GPIO2, GPIO3 are not in pinIds of any net
            ],
        )
        report = await reviewer.review(schematic)
        unused = [f for f in report.findings if f.category == FindingCategory.UNUSED_PIN]
        assert len(unused) >= 1
        assert unused[0].severity == FindingSeverity.INFO


# ---------------------------------------------------------------------------
# Review scoring tests
# ---------------------------------------------------------------------------


class TestReviewScoring:
    """Test overall score calculation."""

    @pytest.mark.asyncio
    async def test_clean_design_perfect_score(self, reviewer):
        """Design with no findings should score 100."""
        schematic = _make_schematic(components=[], nets=[])
        report = await reviewer.review(schematic)
        assert report.score == 100.0
        assert report.passed is True

    @pytest.mark.asyncio
    async def test_critical_finding_fails_review(self, reviewer):
        """Design with a CRITICAL finding should not pass."""
        schematic = _make_schematic(
            components=[
                {
                    "reference": "U1",
                    "value": "STM32",
                    "pads": [],
                    "pins": [
                        {"id": "U1:VDD", "name": "VDD", "type": "power", "number": "1"},
                    ],
                },
            ],
            nets=[],
        )
        report = await reviewer.review(schematic)
        assert report.passed is False
        assert report.score < 100

    @pytest.mark.asyncio
    async def test_score_decreases_with_findings(self, reviewer):
        """Score should decrease proportionally with findings."""
        # Design with multiple issues
        schematic = _make_schematic(
            components=[
                {"reference": "U1", "value": "STM32F405", "pads": ["U1:1", "U1:2"]},
                {"reference": "U2", "value": "ESP32", "pads": ["U2:1"]},
            ],
            nets=[
                {"name": "I2C_SDA", "pinIds": ["U1:1", "U2:1"]},
                {"name": "I2C_SCL", "pinIds": ["U1:2"]},
                {"name": "USB_DP", "pinIds": []},
            ],
        )
        report = await reviewer.review(schematic)
        assert report.score < 100
        assert report.score >= 0

    @pytest.mark.asyncio
    async def test_summary_contains_counts(self, reviewer):
        """Summary should contain severity counts."""
        schematic = _make_schematic(
            components=[
                {"reference": "U1", "value": "STM32", "pads": ["U1:1"]},
            ],
            nets=[
                {"name": "I2C_SDA", "pinIds": ["U1:1"]},
            ],
        )
        report = await reviewer.review(schematic)
        assert "total_findings" in report.summary
        assert "by_severity" in report.summary
        assert "by_category" in report.summary
