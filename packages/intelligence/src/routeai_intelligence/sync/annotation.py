"""Forward and back annotation between schematic and layout.

Forward annotation propagates schematic edits to the PCB layout:
  - New components get footprints placed in the layout
  - Deleted components are removed from the layout
  - Value or footprint changes update the layout accordingly
  - Net changes update copper connectivity

Back annotation propagates layout-side edits back to the schematic:
  - Pin swaps update schematic connections
  - Gate swaps update schematic symbols
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class ChangeType(str, Enum):
    """Types of synchronization changes."""
    ADD_COMPONENT = "add_component"
    REMOVE_COMPONENT = "remove_component"
    UPDATE_VALUE = "update_value"
    UPDATE_FOOTPRINT = "update_footprint"
    UPDATE_NET = "update_net"
    PIN_SWAP = "pin_swap"
    GATE_SWAP = "gate_swap"
    RENAME_NET = "rename_net"
    ADD_NET = "add_net"
    REMOVE_NET = "remove_net"


@dataclass
class SyncChange:
    """A single synchronization change to be applied."""
    change_type: ChangeType
    component_ref: str = ""
    net_name: str = ""
    old_value: Any = None
    new_value: Any = None
    details: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0

    def describe(self) -> str:
        """Return a human-readable description of this change."""
        descriptions = {
            ChangeType.ADD_COMPONENT: f"Add component {self.component_ref} with footprint {self.new_value}",
            ChangeType.REMOVE_COMPONENT: f"Remove component {self.component_ref} from layout",
            ChangeType.UPDATE_VALUE: f"Update {self.component_ref} value: {self.old_value} -> {self.new_value}",
            ChangeType.UPDATE_FOOTPRINT: f"Update {self.component_ref} footprint: {self.old_value} -> {self.new_value}",
            ChangeType.UPDATE_NET: f"Update net {self.net_name} connectivity for {self.component_ref}",
            ChangeType.PIN_SWAP: f"Pin swap on {self.component_ref}: {self.details.get('pins', '')}",
            ChangeType.GATE_SWAP: f"Gate swap on {self.component_ref}: {self.details.get('gates', '')}",
            ChangeType.RENAME_NET: f"Rename net {self.old_value} -> {self.new_value}",
            ChangeType.ADD_NET: f"Add net {self.net_name}",
            ChangeType.REMOVE_NET: f"Remove net {self.net_name}",
        }
        return descriptions.get(self.change_type, f"Unknown change: {self.change_type}")


@dataclass
class AnnotationResult:
    """Result of a forward or back annotation operation."""
    changes: list[SyncChange]
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    @property
    def success(self) -> bool:
        return len(self.errors) == 0

    @property
    def change_count(self) -> int:
        return len(self.changes)


class AnnotationSync:
    """Bidirectional synchronization between schematic and PCB layout.

    Computes the minimal set of changes needed to synchronize one view with
    edits made in the other. Supports both forward annotation (schematic to
    layout) and back annotation (layout to schematic).
    """

    def forward_annotate(
        self,
        schematic_changes: dict[str, Any],
        current_layout: dict[str, Any],
    ) -> AnnotationResult:
        """Propagate schematic changes to the PCB layout.

        Analyzes the delta between the schematic and the current layout to
        produce a list of layout modifications.

        Args:
            schematic_changes: Dict describing schematic edits. Expected keys:
                - added_components: list of {reference, value, footprint, pins}
                - removed_components: list of reference designators
                - modified_components: list of {reference, field, old_value, new_value}
                - net_changes: list of {net_name, action, pins}
            current_layout: Current PCB layout state with components, nets, traces.

        Returns:
            AnnotationResult with the list of layout changes to apply.
        """
        changes: list[SyncChange] = []
        warnings: list[str] = []
        errors: list[str] = []

        layout_components = {
            c.get("reference", ""): c
            for c in current_layout.get("components", [])
        }
        layout_nets = {
            n.get("name", ""): n
            for n in current_layout.get("nets", [])
        }

        # --- Handle added components ---
        for comp in schematic_changes.get("added_components", []):
            ref = comp.get("reference", "")
            if not ref:
                warnings.append("Skipped component with empty reference")
                continue

            if ref in layout_components:
                warnings.append(f"Component {ref} already exists in layout, skipping add")
                continue

            footprint = comp.get("footprint", "")
            if not footprint:
                errors.append(f"Component {ref} has no footprint assigned; cannot place in layout")
                continue

            # Determine initial placement position. Place near the board center
            # or at the next available grid position.
            board_width = current_layout.get("width", 100.0)
            board_height = current_layout.get("height", 100.0)
            placement_x = board_width / 2.0 + len(changes) * 5.0
            placement_y = board_height + 10.0  # Below the board for manual placement.

            changes.append(SyncChange(
                change_type=ChangeType.ADD_COMPONENT,
                component_ref=ref,
                new_value=footprint,
                details={
                    "value": comp.get("value", ""),
                    "footprint": footprint,
                    "pins": comp.get("pins", []),
                    "placement_x": placement_x,
                    "placement_y": placement_y,
                },
            ))

        # --- Handle removed components ---
        for ref in schematic_changes.get("removed_components", []):
            if ref not in layout_components:
                warnings.append(f"Component {ref} not found in layout, skipping removal")
                continue

            # Collect nets that will be affected by the removal.
            affected_nets = []
            for net_name, net_data in layout_nets.items():
                net_pins = net_data.get("pins", net_data.get("pinIds", []))
                for pin in net_pins:
                    if isinstance(pin, str) and pin.startswith(ref + ":"):
                        affected_nets.append(net_name)
                        break

            changes.append(SyncChange(
                change_type=ChangeType.REMOVE_COMPONENT,
                component_ref=ref,
                old_value=layout_components[ref].get("footprint", ""),
                details={
                    "affected_nets": affected_nets,
                },
            ))

        # --- Handle modified components ---
        for mod in schematic_changes.get("modified_components", []):
            ref = mod.get("reference", "")
            field_name = mod.get("field", "")
            old_val = mod.get("old_value", "")
            new_val = mod.get("new_value", "")

            if ref not in layout_components:
                warnings.append(f"Component {ref} not in layout, skipping modification")
                continue

            if field_name == "value":
                changes.append(SyncChange(
                    change_type=ChangeType.UPDATE_VALUE,
                    component_ref=ref,
                    old_value=old_val,
                    new_value=new_val,
                ))
            elif field_name == "footprint":
                changes.append(SyncChange(
                    change_type=ChangeType.UPDATE_FOOTPRINT,
                    component_ref=ref,
                    old_value=old_val,
                    new_value=new_val,
                    details={
                        "requires_reroute": True,
                        "old_pad_count": layout_components[ref].get("pad_count", 0),
                    },
                ))
            else:
                changes.append(SyncChange(
                    change_type=ChangeType.UPDATE_VALUE,
                    component_ref=ref,
                    old_value=old_val,
                    new_value=new_val,
                    details={"field": field_name},
                ))

        # --- Handle net changes ---
        for net_change in schematic_changes.get("net_changes", []):
            net_name = net_change.get("net_name", "")
            action = net_change.get("action", "")
            pins = net_change.get("pins", [])

            if action == "add":
                changes.append(SyncChange(
                    change_type=ChangeType.ADD_NET,
                    net_name=net_name,
                    new_value=pins,
                    details={"pins": pins},
                ))
            elif action == "remove":
                if net_name in layout_nets:
                    changes.append(SyncChange(
                        change_type=ChangeType.REMOVE_NET,
                        net_name=net_name,
                        old_value=layout_nets[net_name].get("pins", []),
                    ))
                else:
                    warnings.append(f"Net {net_name} not in layout, skipping removal")
            elif action == "modify":
                # Net connectivity changed: some pins added or removed.
                for pin_change in pins:
                    comp_ref = pin_change.get("component", "")
                    changes.append(SyncChange(
                        change_type=ChangeType.UPDATE_NET,
                        component_ref=comp_ref,
                        net_name=net_name,
                        old_value=pin_change.get("old_pin", ""),
                        new_value=pin_change.get("new_pin", ""),
                    ))
            elif action == "rename":
                old_name = net_change.get("old_name", "")
                changes.append(SyncChange(
                    change_type=ChangeType.RENAME_NET,
                    net_name=net_name,
                    old_value=old_name,
                    new_value=net_name,
                ))

        logger.info(
            "Forward annotation: %d changes, %d warnings, %d errors",
            len(changes), len(warnings), len(errors),
        )

        return AnnotationResult(changes=changes, warnings=warnings, errors=errors)

    def back_annotate(
        self,
        layout_changes: dict[str, Any],
        current_schematic: dict[str, Any],
    ) -> AnnotationResult:
        """Propagate layout changes back to the schematic.

        Handles layout-side edits that must be reflected in the schematic:
        - Pin swaps (e.g., swapping two pins of an op-amp for better routing)
        - Gate swaps (e.g., using a different gate in a multi-gate IC)

        Args:
            layout_changes: Dict describing layout edits. Expected keys:
                - pin_swaps: list of {component, pin_a, pin_b, net_a, net_b}
                - gate_swaps: list of {component, gate_a, gate_b}
            current_schematic: Current schematic state.

        Returns:
            AnnotationResult with schematic changes to apply.
        """
        changes: list[SyncChange] = []
        warnings: list[str] = []
        errors: list[str] = []

        schematic_components = {
            c.get("reference", ""): c
            for c in current_schematic.get("components", [])
        }
        schematic_nets = {
            n.get("name", ""): n
            for n in current_schematic.get("nets", [])
        }

        # --- Handle pin swaps ---
        for swap in layout_changes.get("pin_swaps", []):
            comp_ref = swap.get("component", "")
            pin_a = swap.get("pin_a", "")
            pin_b = swap.get("pin_b", "")
            net_a = swap.get("net_a", "")
            net_b = swap.get("net_b", "")

            if comp_ref not in schematic_components:
                errors.append(f"Component {comp_ref} not found in schematic for pin swap")
                continue

            comp = schematic_components[comp_ref]
            comp_pins = {
                p.get("number", p.get("id", "")): p
                for p in comp.get("pins", [])
            }

            if pin_a not in comp_pins or pin_b not in comp_pins:
                errors.append(
                    f"Pin swap invalid: {comp_ref} does not have pins {pin_a} and {pin_b}"
                )
                continue

            # Verify pins are in the same swap group (same electrical function).
            pin_a_func = comp_pins[pin_a].get("function", "")
            pin_b_func = comp_pins[pin_b].get("function", "")
            if pin_a_func != pin_b_func and pin_a_func and pin_b_func:
                warnings.append(
                    f"Pin swap {comp_ref}:{pin_a}<->{pin_b} crosses function groups "
                    f"({pin_a_func} vs {pin_b_func}); verify correctness"
                )

            changes.append(SyncChange(
                change_type=ChangeType.PIN_SWAP,
                component_ref=comp_ref,
                details={
                    "pins": f"{pin_a} <-> {pin_b}",
                    "pin_a": pin_a,
                    "pin_b": pin_b,
                    "net_a": net_a,
                    "net_b": net_b,
                },
            ))

        # --- Handle gate swaps ---
        for swap in layout_changes.get("gate_swaps", []):
            comp_ref = swap.get("component", "")
            gate_a = swap.get("gate_a", "")
            gate_b = swap.get("gate_b", "")

            if comp_ref not in schematic_components:
                errors.append(f"Component {comp_ref} not found in schematic for gate swap")
                continue

            comp = schematic_components[comp_ref]
            gates = comp.get("gates", [])
            gate_ids = {g.get("id", g.get("name", "")) for g in gates}

            if gate_a not in gate_ids or gate_b not in gate_ids:
                errors.append(
                    f"Gate swap invalid: {comp_ref} does not have gates {gate_a} and {gate_b}"
                )
                continue

            # Collect all pin-net mappings for both gates to swap in the schematic.
            gate_a_pins = [
                p for p in comp.get("pins", [])
                if p.get("gate", "") == gate_a
            ]
            gate_b_pins = [
                p for p in comp.get("pins", [])
                if p.get("gate", "") == gate_b
            ]

            changes.append(SyncChange(
                change_type=ChangeType.GATE_SWAP,
                component_ref=comp_ref,
                details={
                    "gates": f"{gate_a} <-> {gate_b}",
                    "gate_a": gate_a,
                    "gate_b": gate_b,
                    "gate_a_pins": [p.get("number", "") for p in gate_a_pins],
                    "gate_b_pins": [p.get("number", "") for p in gate_b_pins],
                },
            ))

        logger.info(
            "Back annotation: %d changes, %d warnings, %d errors",
            len(changes), len(warnings), len(errors),
        )

        return AnnotationResult(changes=changes, warnings=warnings, errors=errors)
