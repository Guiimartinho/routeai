"""Shared test fixtures for routeai_intelligence tests."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def mock_anthropic_client() -> AsyncMock:
    """Mock Anthropic AsyncAnthropic client."""
    client = AsyncMock()
    # Default response: simple text with end_turn
    response = MagicMock()
    response.stop_reason = "end_turn"
    text_block = MagicMock()
    text_block.type = "text"
    text_block.text = '{"status": "ok"}'
    response.content = [text_block]
    response.usage = MagicMock(input_tokens=100, output_tokens=50)
    client.messages.create.return_value = response
    return client


@pytest.fixture
def sample_review_json() -> dict[str, Any]:
    """Sample valid design review JSON matching the review schema."""
    return {
        "findings": [
            {
                "id": "DRC-001",
                "category": "drc",
                "severity": "WARNING",
                "title": "Trace clearance below minimum",
                "description": "Trace on F.Cu near R1 pad 2 has 0.10mm clearance, below 0.15mm minimum.",
                "location": {"x_mm": 100.5, "y_mm": 100.0, "layer": "F.Cu"},
                "recommendation": "Increase trace spacing to meet 0.15mm minimum clearance.",
                "reference": "IPC-2221B Section 6.3",
                "auto_fixable": False,
                "confidence": 0.95,
            }
        ],
        "category_summaries": {
            "drc": {"count": 1, "critical": 0, "errors": 0, "warnings": 1, "info": 0},
        },
        "overall_status": "PASS_WITH_WARNINGS",
    }


@pytest.fixture
def sample_constraint_json() -> dict[str, Any]:
    """Sample valid constraint set JSON matching the constraint schema."""
    return {
        "net_classes": [
            {
                "name": "Default",
                "clearance_mm": 0.15,
                "trace_width_mm": 0.25,
                "via_drill_mm": 0.3,
                "via_size_mm": 0.6,
                "nets": ["GND", "VCC"],
                "confidence": 0.90,
                "source": "IPC-2221B default",
            }
        ],
        "diff_pairs": [
            {
                "name": "USB_DP_DN",
                "positive_net": "USB_DP",
                "negative_net": "USB_DN",
                "impedance_ohm": 90.0,
                "gap_mm": 0.15,
                "width_mm": 0.12,
                "max_skew_mm": 0.15,
                "confidence": 0.95,
                "source": "USB 2.0 specification",
            }
        ],
        "length_groups": [],
        "special_rules": [],
        "metadata": {
            "board_type": "mixed-signal",
            "layer_count": 4,
            "primary_interfaces": ["USB 2.0", "SPI"],
        },
    }


@pytest.fixture
def sample_routing_json() -> dict[str, Any]:
    """Sample valid routing strategy JSON matching the routing schema."""
    return {
        "routing_order": [
            {
                "net_pattern": "USB_D*",
                "priority": 10,
                "reason": "Critical USB differential pair",
                "constraints": {"impedance_ohm": 90.0, "max_length_mm": 50.0},
            },
        ],
        "layer_assignment": {
            "USB_D*": {
                "signal_layers": ["F.Cu"],
                "reason": "Microstrip for controlled impedance",
            },
        },
        "via_strategy": {
            "high_speed_max_vias": 2,
            "general_max_vias": 6,
            "return_path_via_distance_mm": 2.0,
            "prefer_blind_buried": False,
        },
        "cost_weights": {
            "wire_length": 0.3,
            "via_count": 0.25,
            "congestion": 0.2,
            "impedance_deviation": 0.15,
            "length_matching": 0.1,
        },
        "special_instructions": [],
    }


@pytest.fixture
def mock_drc_engine() -> MagicMock:
    """Mock DRC engine returning clean results."""
    engine = MagicMock()
    report = MagicMock()
    report.passed = True
    report.violations = []
    report.stats = {"checks_run": 6, "violations": 0}
    report.elapsed_seconds = 0.05
    engine.run.return_value = report
    return engine


@pytest.fixture
def mock_retriever() -> AsyncMock:
    """Mock RAG retriever."""
    retriever = AsyncMock()
    retriever.search.return_value = [
        {
            "text": "Per IPC-2221B Section 6.3, minimum clearance for 50V is 0.13mm.",
            "score": 0.92,
            "metadata": {"domain": "ipc", "section": "6.3"},
        }
    ]
    return retriever
