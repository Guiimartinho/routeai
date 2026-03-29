"""Tests for sync modules: annotation, cross-probe, and netlist diff.

Tests annotation creation/deletion, cross-probe coordinate mapping,
and netlist diff (added/removed/changed nets and components).
"""

from __future__ import annotations

import pytest

from routeai_intelligence.sync.annotation import (
    AnnotationResult,
    AnnotationSync,
    ChangeType,
    SyncChange,
)
from routeai_intelligence.sync.cross_probe import (
    CrossProbe,
    CrossProbeResult,
    HighlightInfo,
    NetHighlightResult,
    Position,
)
from routeai_intelligence.sync.netlist_diff import (
    ComponentDiff,
    DiffStatus,
    NetDiff,
    NetlistChanges,
    NetlistDiff,
)


# ===========================================================================
# Annotation Tests
# ===========================================================================


class TestAnnotationForward:
    """Test forward annotation (schematic -> layout)."""

    def test_add_component(self):
        """Adding a component should produce ADD_COMPONENT changes."""
        sync = AnnotationSync()
        result = sync.forward_annotate(
            schematic_changes={
                "added_components": [
                    {"reference": "R1", "value": "10k", "footprint": "0402", "pins": ["1", "2"]},
                ],
            },
            current_layout={"components": [], "nets": []},
        )
        assert result.success
        assert result.change_count == 1
        assert result.changes[0].change_type == ChangeType.ADD_COMPONENT
        assert result.changes[0].component_ref == "R1"
        assert result.changes[0].new_value == "0402"
        assert result.changes[0].details["value"] == "10k"

    def test_add_component_no_footprint_errors(self):
        """Adding a component without footprint should produce an error."""
        sync = AnnotationSync()
        result = sync.forward_annotate(
            schematic_changes={
                "added_components": [
                    {"reference": "U1", "value": "STM32", "footprint": ""},
                ],
            },
            current_layout={"components": [], "nets": []},
        )
        assert not result.success
        assert len(result.errors) == 1
        assert "footprint" in result.errors[0].lower()

    def test_add_existing_component_warns(self):
        """Adding a component that already exists in layout should warn."""
        sync = AnnotationSync()
        result = sync.forward_annotate(
            schematic_changes={
                "added_components": [
                    {"reference": "R1", "value": "10k", "footprint": "0402"},
                ],
            },
            current_layout={
                "components": [{"reference": "R1", "footprint": "0402"}],
                "nets": [],
            },
        )
        assert result.success
        assert len(result.warnings) == 1
        assert "already exists" in result.warnings[0].lower()

    def test_remove_component(self):
        """Removing a component should produce REMOVE_COMPONENT changes."""
        sync = AnnotationSync()
        result = sync.forward_annotate(
            schematic_changes={
                "removed_components": ["R1"],
            },
            current_layout={
                "components": [{"reference": "R1", "footprint": "0402"}],
                "nets": [{"name": "NET1", "pinIds": ["R1:1", "U1:2"]}],
            },
        )
        assert result.success
        assert result.change_count == 1
        assert result.changes[0].change_type == ChangeType.REMOVE_COMPONENT
        assert "NET1" in result.changes[0].details["affected_nets"]

    def test_remove_nonexistent_warns(self):
        """Removing a component not in layout should warn."""
        sync = AnnotationSync()
        result = sync.forward_annotate(
            schematic_changes={"removed_components": ["R99"]},
            current_layout={"components": [], "nets": []},
        )
        assert result.success
        assert len(result.warnings) == 1

    def test_modify_value(self):
        """Modifying a component value should produce UPDATE_VALUE changes."""
        sync = AnnotationSync()
        result = sync.forward_annotate(
            schematic_changes={
                "modified_components": [
                    {"reference": "R1", "field": "value", "old_value": "10k", "new_value": "4.7k"},
                ],
            },
            current_layout={
                "components": [{"reference": "R1", "footprint": "0402"}],
                "nets": [],
            },
        )
        assert result.success
        assert result.changes[0].change_type == ChangeType.UPDATE_VALUE
        assert result.changes[0].old_value == "10k"
        assert result.changes[0].new_value == "4.7k"

    def test_modify_footprint(self):
        """Modifying footprint should produce UPDATE_FOOTPRINT change."""
        sync = AnnotationSync()
        result = sync.forward_annotate(
            schematic_changes={
                "modified_components": [
                    {"reference": "R1", "field": "footprint", "old_value": "0402", "new_value": "0603"},
                ],
            },
            current_layout={
                "components": [{"reference": "R1", "footprint": "0402", "pad_count": 2}],
                "nets": [],
            },
        )
        assert result.changes[0].change_type == ChangeType.UPDATE_FOOTPRINT
        assert result.changes[0].details["requires_reroute"] is True

    def test_add_net(self):
        sync = AnnotationSync()
        result = sync.forward_annotate(
            schematic_changes={
                "net_changes": [
                    {"net_name": "NEW_NET", "action": "add", "pins": ["U1:1", "R1:2"]},
                ],
            },
            current_layout={"components": [], "nets": []},
        )
        assert result.changes[0].change_type == ChangeType.ADD_NET
        assert result.changes[0].net_name == "NEW_NET"

    def test_remove_net(self):
        sync = AnnotationSync()
        result = sync.forward_annotate(
            schematic_changes={
                "net_changes": [
                    {"net_name": "OLD_NET", "action": "remove"},
                ],
            },
            current_layout={
                "components": [],
                "nets": [{"name": "OLD_NET", "pins": ["U1:1"]}],
            },
        )
        assert result.changes[0].change_type == ChangeType.REMOVE_NET

    def test_rename_net(self):
        sync = AnnotationSync()
        result = sync.forward_annotate(
            schematic_changes={
                "net_changes": [
                    {"net_name": "NET_NEW", "action": "rename", "old_name": "NET_OLD"},
                ],
            },
            current_layout={"components": [], "nets": []},
        )
        assert result.changes[0].change_type == ChangeType.RENAME_NET
        assert result.changes[0].old_value == "NET_OLD"
        assert result.changes[0].new_value == "NET_NEW"


class TestAnnotationBack:
    """Test back annotation (layout -> schematic)."""

    def test_pin_swap(self):
        sync = AnnotationSync()
        result = sync.back_annotate(
            layout_changes={
                "pin_swaps": [
                    {"component": "U1", "pin_a": "1", "pin_b": "2", "net_a": "NET_A", "net_b": "NET_B"},
                ],
            },
            current_schematic={
                "components": [
                    {
                        "reference": "U1",
                        "pins": [
                            {"id": "p1", "number": "1", "function": "GPIO"},
                            {"id": "p2", "number": "2", "function": "GPIO"},
                        ],
                    },
                ],
                "nets": [],
            },
        )
        assert result.success
        assert result.changes[0].change_type == ChangeType.PIN_SWAP
        assert result.changes[0].details["pin_a"] == "1"
        assert result.changes[0].details["pin_b"] == "2"

    def test_pin_swap_cross_function_warns(self):
        """Swapping pins with different functions should warn."""
        sync = AnnotationSync()
        result = sync.back_annotate(
            layout_changes={
                "pin_swaps": [
                    {"component": "U1", "pin_a": "1", "pin_b": "2", "net_a": "A", "net_b": "B"},
                ],
            },
            current_schematic={
                "components": [
                    {
                        "reference": "U1",
                        "pins": [
                            {"id": "p1", "number": "1", "function": "input"},
                            {"id": "p2", "number": "2", "function": "output"},
                        ],
                    },
                ],
                "nets": [],
            },
        )
        assert len(result.warnings) >= 1
        assert "function" in result.warnings[0].lower()

    def test_pin_swap_invalid_component_errors(self):
        sync = AnnotationSync()
        result = sync.back_annotate(
            layout_changes={
                "pin_swaps": [
                    {"component": "U99", "pin_a": "1", "pin_b": "2", "net_a": "", "net_b": ""},
                ],
            },
            current_schematic={"components": [], "nets": []},
        )
        assert not result.success
        assert len(result.errors) == 1

    def test_gate_swap(self):
        sync = AnnotationSync()
        result = sync.back_annotate(
            layout_changes={
                "gate_swaps": [
                    {"component": "U1", "gate_a": "A", "gate_b": "B"},
                ],
            },
            current_schematic={
                "components": [
                    {
                        "reference": "U1",
                        "gates": [{"id": "A"}, {"id": "B"}],
                        "pins": [
                            {"number": "1", "gate": "A"},
                            {"number": "2", "gate": "B"},
                        ],
                    },
                ],
                "nets": [],
            },
        )
        assert result.success
        assert result.changes[0].change_type == ChangeType.GATE_SWAP

    def test_sync_change_describe(self):
        """SyncChange.describe() should return a human-readable string."""
        change = SyncChange(
            change_type=ChangeType.ADD_COMPONENT,
            component_ref="R1",
            new_value="0402",
        )
        desc = change.describe()
        assert "R1" in desc
        assert "0402" in desc


# ===========================================================================
# Cross-Probe Tests
# ===========================================================================


class TestCrossProbeSchematicToLayout:
    """Test cross-probing from schematic to layout."""

    def test_component_found_in_layout(self):
        cp = CrossProbe()
        cp.set_schematic({"components": [{"reference": "U1", "value": "STM32"}], "nets": []})
        cp.set_layout({
            "components": [
                {"reference": "U1", "x": 50.0, "y": 30.0, "layer_id": "F.Cu", "value": "STM32"},
            ],
            "nets": [],
            "traces": [],
            "pads": [],
            "vias": [],
        })

        result = cp.schematic_to_layout("U1")
        assert result.found is True
        assert result.source_view == "schematic"
        assert result.target_view == "layout"
        assert result.highlight.position.x == 50.0
        assert result.highlight.position.y == 30.0
        assert "U1" in result.highlight.label

    def test_component_not_found_in_layout(self):
        cp = CrossProbe()
        cp.set_schematic({"components": [], "nets": []})
        cp.set_layout({"components": [], "nets": [], "traces": [], "pads": [], "vias": []})

        result = cp.schematic_to_layout("U1")
        assert result.found is False

    def test_related_pads_included(self):
        cp = CrossProbe()
        cp.set_schematic({"components": [], "nets": []})
        cp.set_layout({
            "components": [{"reference": "U1", "x": 10.0, "y": 10.0, "value": "IC"}],
            "nets": [],
            "traces": [],
            "pads": [
                {"component_ref": "U1", "x": 10.5, "y": 10.5},
                {"component_ref": "U1", "x": 11.0, "y": 10.0},
            ],
            "vias": [],
        })

        result = cp.schematic_to_layout("U1")
        assert result.found is True
        assert len(result.related_highlights) == 2


class TestCrossProbeLayoutToSchematic:
    """Test cross-probing from layout to schematic."""

    def test_component_found_in_schematic(self):
        cp = CrossProbe()
        cp.set_schematic({
            "components": [
                {"reference": "R1", "value": "10k", "x": 100.0, "y": 200.0, "pins": []},
            ],
            "nets": [],
        })
        cp.set_layout({"components": [], "nets": [], "traces": [], "pads": [], "vias": []})

        result = cp.layout_to_schematic("R1")
        assert result.found is True
        assert result.source_view == "layout"
        assert result.target_view == "schematic"
        assert result.highlight.position.x == 100.0

    def test_component_not_in_schematic(self):
        cp = CrossProbe()
        cp.set_schematic({"components": [], "nets": []})
        cp.set_layout({"components": [], "nets": [], "traces": [], "pads": [], "vias": []})

        result = cp.layout_to_schematic("U99")
        assert result.found is False

    def test_pin_related_highlights(self):
        cp = CrossProbe()
        cp.set_schematic({
            "components": [
                {
                    "reference": "U1",
                    "value": "IC",
                    "x": 50.0,
                    "y": 50.0,
                    "pins": [
                        {"number": "1", "name": "VDD", "position": {"x": 55.0, "y": 48.0}},
                        {"number": "2", "name": "GND", "position": {"x": 55.0, "y": 52.0}},
                    ],
                },
            ],
            "nets": [],
        })
        cp.set_layout({"components": [], "nets": [], "traces": [], "pads": [], "vias": []})

        result = cp.layout_to_schematic("U1")
        assert result.found is True
        assert len(result.related_highlights) == 2
        assert result.related_highlights[0].element_type == "pin"


class TestNetHighlight:
    """Test net highlighting across both views."""

    def test_net_highlight_both_views(self):
        cp = CrossProbe()
        cp.set_schematic({
            "components": [
                {
                    "reference": "U1",
                    "x": 50.0,
                    "y": 50.0,
                    "pins": [{"id": "U1:1", "number": "1", "name": "PA0", "position": {"x": 55.0, "y": 48.0}}],
                },
            ],
            "nets": [{"name": "SDA", "pinIds": ["U1:1"]}],
            "wires": [],
        })
        cp.set_layout({
            "components": [],
            "nets": [{"name": "SDA", "id": 1}],
            "traces": [{"net_id": 1, "points": [{"x": 10.0, "y": 20.0}]}],
            "pads": [{"component_ref": "U1", "net_id": 1, "x": 10.0, "y": 20.0}],
            "vias": [],
        })

        result = cp.net_highlight("SDA")
        assert result.net_name == "SDA"
        assert len(result.schematic_positions) >= 1
        assert len(result.layout_positions) >= 1

    def test_net_highlight_unknown_net(self):
        cp = CrossProbe()
        cp.set_schematic({"components": [], "nets": []})
        cp.set_layout({"components": [], "nets": [], "traces": [], "pads": [], "vias": []})

        result = cp.net_highlight("UNKNOWN")
        assert result.net_name == "UNKNOWN"
        assert len(result.schematic_positions) == 0
        assert len(result.layout_positions) == 0


# ===========================================================================
# Netlist Diff Tests
# ===========================================================================


class TestNetlistDiffAddedRemoved:
    """Test detection of added and removed nets/components."""

    def test_added_net_detected(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={"components": [], "nets": []},
            new_schematic={
                "components": [],
                "nets": [{"name": "NEW_NET", "pinIds": ["U1:1", "U1:2"]}],
            },
        )
        assert len(changes.added_nets) == 1
        assert changes.added_nets[0].net_name == "NEW_NET"
        assert changes.added_nets[0].status == DiffStatus.ADDED

    def test_removed_net_detected(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={
                "components": [],
                "nets": [{"name": "OLD_NET", "pinIds": ["U1:1"]}],
            },
            new_schematic={"components": [], "nets": []},
        )
        assert len(changes.removed_nets) == 1
        assert changes.removed_nets[0].net_name == "OLD_NET"
        assert changes.removed_nets[0].status == DiffStatus.REMOVED

    def test_added_component_detected(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={"components": [], "nets": []},
            new_schematic={
                "components": [{"reference": "R1", "value": "10k", "footprint": "0402"}],
                "nets": [],
            },
        )
        assert len(changes.added_components) == 1
        assert changes.added_components[0].reference == "R1"
        assert changes.added_components[0].new_value == "10k"

    def test_removed_component_detected(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={
                "components": [{"reference": "C1", "value": "100nF", "footprint": "0402"}],
                "nets": [],
            },
            new_schematic={"components": [], "nets": []},
        )
        assert len(changes.removed_components) == 1
        assert changes.removed_components[0].reference == "C1"
        assert changes.removed_components[0].old_value == "100nF"


class TestNetlistDiffModified:
    """Test detection of modified nets and components."""

    def test_modified_net_pin_change(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={
                "components": [],
                "nets": [{"name": "NET1", "pinIds": ["U1:1", "R1:2"]}],
            },
            new_schematic={
                "components": [],
                "nets": [{"name": "NET1", "pinIds": ["U1:1", "R1:2", "C1:1"]}],
            },
        )
        assert len(changes.modified_nets) == 1
        nd = changes.modified_nets[0]
        assert nd.net_name == "NET1"
        assert "C1:1" in nd.added_pins
        assert len(nd.removed_pins) == 0

    def test_modified_component_value(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={
                "components": [{"reference": "R1", "value": "10k"}],
                "nets": [],
            },
            new_schematic={
                "components": [{"reference": "R1", "value": "4.7k"}],
                "nets": [],
            },
        )
        assert len(changes.modified_components) == 1
        cd = changes.modified_components[0]
        assert cd.reference == "R1"
        assert "value" in cd.changed_fields
        assert cd.old_value == "10k"
        assert cd.new_value == "4.7k"

    def test_modified_component_footprint(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={
                "components": [{"reference": "R1", "value": "10k", "footprint": "0402"}],
                "nets": [],
            },
            new_schematic={
                "components": [{"reference": "R1", "value": "10k", "footprint": "0603"}],
                "nets": [],
            },
        )
        assert len(changes.modified_components) == 1
        assert "footprint" in changes.modified_components[0].changed_fields

    def test_unchanged_component_not_reported(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={
                "components": [{"reference": "R1", "value": "10k", "footprint": "0402"}],
                "nets": [],
            },
            new_schematic={
                "components": [{"reference": "R1", "value": "10k", "footprint": "0402"}],
                "nets": [],
            },
        )
        assert len(changes.modified_components) == 0

    def test_pin_count_change_detected(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={
                "components": [{"reference": "U1", "value": "IC", "pins": [1, 2]}],
                "nets": [],
            },
            new_schematic={
                "components": [{"reference": "U1", "value": "IC", "pins": [1, 2, 3]}],
                "nets": [],
            },
        )
        assert len(changes.modified_components) == 1
        assert "pin_count" in changes.modified_components[0].changed_fields


class TestNetlistChangesProperties:
    """Test NetlistChanges model properties."""

    def test_total_changes(self):
        changes = NetlistChanges(
            added_nets=[NetDiff(net_name="N1", status=DiffStatus.ADDED)],
            removed_nets=[],
            modified_nets=[],
            added_components=[ComponentDiff(reference="R1", status=DiffStatus.ADDED)],
            removed_components=[],
            modified_components=[],
        )
        assert changes.total_changes == 2
        assert changes.has_changes is True

    def test_no_changes(self):
        changes = NetlistChanges(
            added_nets=[],
            removed_nets=[],
            modified_nets=[],
            added_components=[],
            removed_components=[],
            modified_components=[],
        )
        assert changes.total_changes == 0
        assert changes.has_changes is False

    def test_visual_diff_output(self):
        changes = NetlistChanges(
            added_nets=[NetDiff(net_name="NEW_NET", status=DiffStatus.ADDED, new_pins=["U1:1"])],
            removed_nets=[NetDiff(net_name="OLD_NET", status=DiffStatus.REMOVED, old_pins=["U2:1"])],
            modified_nets=[
                NetDiff(
                    net_name="MOD_NET",
                    status=DiffStatus.MODIFIED,
                    added_pins=["C1:1"],
                    removed_pins=["R1:2"],
                ),
            ],
            added_components=[ComponentDiff(reference="R1", status=DiffStatus.ADDED, new_value="10k")],
            removed_components=[ComponentDiff(reference="C1", status=DiffStatus.REMOVED, old_value="100nF")],
            modified_components=[
                ComponentDiff(
                    reference="U1",
                    status=DiffStatus.MODIFIED,
                    old_value="STM32F103",
                    new_value="STM32F405",
                    changed_fields=["value"],
                ),
            ],
        )
        visual = changes.to_visual_diff()
        assert len(visual) == 6

        statuses = {e["status"] for e in visual}
        assert statuses == {"added", "removed", "modified"}

        colors = {e["color"] for e in visual}
        assert "#22c55e" in colors  # green (added)
        assert "#ef4444" in colors  # red (removed)
        assert "#3b82f6" in colors  # blue (modified)

    def test_summary_generated(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={
                "components": [],
                "nets": [{"name": "NET1", "pinIds": ["U1:1"]}],
            },
            new_schematic={
                "components": [{"reference": "R1", "value": "10k"}],
                "nets": [],
            },
        )
        assert "added" in changes.summary.lower() or "removed" in changes.summary.lower()

    def test_no_changes_summary(self):
        differ = NetlistDiff()
        changes = differ.diff(
            old_schematic={"components": [], "nets": []},
            new_schematic={"components": [], "nets": []},
        )
        assert "no changes" in changes.summary.lower()
