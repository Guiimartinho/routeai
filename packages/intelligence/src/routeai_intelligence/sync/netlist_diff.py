"""Netlist diff engine for comparing schematic versions.

Compares two schematic netlist snapshots and produces a structured diff
showing added, removed, and modified nets and components. The output includes
visual diff data that the frontend can render with color coding.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

logger = logging.getLogger(__name__)


class DiffStatus(str, Enum):
    """Status of a diff element."""
    ADDED = "added"
    REMOVED = "removed"
    MODIFIED = "modified"
    UNCHANGED = "unchanged"


@dataclass
class NetDiff:
    """Diff information for a single net."""
    net_name: str
    status: DiffStatus
    old_pins: list[str] = field(default_factory=list)
    new_pins: list[str] = field(default_factory=list)
    added_pins: list[str] = field(default_factory=list)
    removed_pins: list[str] = field(default_factory=list)
    details: str = ""


@dataclass
class ComponentDiff:
    """Diff information for a single component."""
    reference: str
    status: DiffStatus
    old_value: str = ""
    new_value: str = ""
    old_footprint: str = ""
    new_footprint: str = ""
    changed_fields: list[str] = field(default_factory=list)
    details: str = ""


@dataclass
class NetlistChanges:
    """Complete set of differences between two schematic versions."""
    added_nets: list[NetDiff]
    removed_nets: list[NetDiff]
    modified_nets: list[NetDiff]
    added_components: list[ComponentDiff]
    removed_components: list[ComponentDiff]
    modified_components: list[ComponentDiff]
    summary: str = ""

    @property
    def total_changes(self) -> int:
        return (
            len(self.added_nets) + len(self.removed_nets) + len(self.modified_nets)
            + len(self.added_components) + len(self.removed_components)
            + len(self.modified_components)
        )

    @property
    def has_changes(self) -> bool:
        return self.total_changes > 0

    def to_visual_diff(self) -> list[dict[str, Any]]:
        """Generate visual diff data for the frontend.

        Returns a list of diff entries with color coding:
        - added: green (#22c55e)
        - removed: red (#ef4444)
        - modified: blue (#3b82f6)

        Each entry has type, id, label, color, and detail text.
        """
        entries: list[dict[str, Any]] = []

        for nd in self.added_nets:
            entries.append({
                "type": "net",
                "id": nd.net_name,
                "label": f"+ Net: {nd.net_name}",
                "color": "#22c55e",
                "status": "added",
                "detail": f"New net with {len(nd.new_pins)} pins: {', '.join(nd.new_pins[:5])}",
                "pins": nd.new_pins,
            })

        for nd in self.removed_nets:
            entries.append({
                "type": "net",
                "id": nd.net_name,
                "label": f"- Net: {nd.net_name}",
                "color": "#ef4444",
                "status": "removed",
                "detail": f"Removed net with {len(nd.old_pins)} pins",
                "pins": nd.old_pins,
            })

        for nd in self.modified_nets:
            detail_parts = []
            if nd.added_pins:
                detail_parts.append(f"+{len(nd.added_pins)} pins")
            if nd.removed_pins:
                detail_parts.append(f"-{len(nd.removed_pins)} pins")
            entries.append({
                "type": "net",
                "id": nd.net_name,
                "label": f"~ Net: {nd.net_name}",
                "color": "#3b82f6",
                "status": "modified",
                "detail": ", ".join(detail_parts) if detail_parts else "connectivity changed",
                "added_pins": nd.added_pins,
                "removed_pins": nd.removed_pins,
            })

        for cd in self.added_components:
            entries.append({
                "type": "component",
                "id": cd.reference,
                "label": f"+ {cd.reference}: {cd.new_value}",
                "color": "#22c55e",
                "status": "added",
                "detail": f"Footprint: {cd.new_footprint}" if cd.new_footprint else "",
            })

        for cd in self.removed_components:
            entries.append({
                "type": "component",
                "id": cd.reference,
                "label": f"- {cd.reference}: {cd.old_value}",
                "color": "#ef4444",
                "status": "removed",
                "detail": f"Was: {cd.old_footprint}" if cd.old_footprint else "",
            })

        for cd in self.modified_components:
            changes = []
            if cd.old_value != cd.new_value:
                changes.append(f"value: {cd.old_value} -> {cd.new_value}")
            if cd.old_footprint != cd.new_footprint:
                changes.append(f"footprint: {cd.old_footprint} -> {cd.new_footprint}")
            for f in cd.changed_fields:
                if f not in ("value", "footprint"):
                    changes.append(f"{f} changed")
            entries.append({
                "type": "component",
                "id": cd.reference,
                "label": f"~ {cd.reference}",
                "color": "#3b82f6",
                "status": "modified",
                "detail": "; ".join(changes) if changes else "properties changed",
                "changed_fields": cd.changed_fields,
            })

        return entries


class NetlistDiff:
    """Computes differences between two schematic netlist snapshots.

    Usage:
        differ = NetlistDiff()
        changes = differ.diff(old_schematic, new_schematic)
        visual = changes.to_visual_diff()  # For frontend rendering
    """

    def diff(
        self,
        old_schematic: dict[str, Any],
        new_schematic: dict[str, Any],
    ) -> NetlistChanges:
        """Compare two schematic snapshots and return structured differences.

        Args:
            old_schematic: Previous schematic state (components, nets).
            new_schematic: Current schematic state (components, nets).

        Returns:
            NetlistChanges with all detected differences.
        """
        # Index old and new components by reference designator.
        old_components = {
            c.get("reference", ""): c
            for c in old_schematic.get("components", [])
            if c.get("reference")
        }
        new_components = {
            c.get("reference", ""): c
            for c in new_schematic.get("components", [])
            if c.get("reference")
        }

        # Index old and new nets by name.
        old_nets = {
            n.get("name", n.get("id", "")): n
            for n in old_schematic.get("nets", [])
            if n.get("name", n.get("id"))
        }
        new_nets = {
            n.get("name", n.get("id", "")): n
            for n in new_schematic.get("nets", [])
            if n.get("name", n.get("id"))
        }

        # ---- Component diffs ----
        added_components: list[ComponentDiff] = []
        removed_components: list[ComponentDiff] = []
        modified_components: list[ComponentDiff] = []

        all_refs = set(old_components.keys()) | set(new_components.keys())
        for ref in sorted(all_refs):
            old_comp = old_components.get(ref)
            new_comp = new_components.get(ref)

            if old_comp is None and new_comp is not None:
                added_components.append(ComponentDiff(
                    reference=ref,
                    status=DiffStatus.ADDED,
                    new_value=new_comp.get("value", ""),
                    new_footprint=new_comp.get("footprint", ""),
                ))
            elif old_comp is not None and new_comp is None:
                removed_components.append(ComponentDiff(
                    reference=ref,
                    status=DiffStatus.REMOVED,
                    old_value=old_comp.get("value", ""),
                    old_footprint=old_comp.get("footprint", ""),
                ))
            elif old_comp is not None and new_comp is not None:
                changed_fields = self._compare_components(old_comp, new_comp)
                if changed_fields:
                    modified_components.append(ComponentDiff(
                        reference=ref,
                        status=DiffStatus.MODIFIED,
                        old_value=old_comp.get("value", ""),
                        new_value=new_comp.get("value", ""),
                        old_footprint=old_comp.get("footprint", ""),
                        new_footprint=new_comp.get("footprint", ""),
                        changed_fields=changed_fields,
                    ))

        # ---- Net diffs ----
        added_nets: list[NetDiff] = []
        removed_nets: list[NetDiff] = []
        modified_nets: list[NetDiff] = []

        all_net_names = set(old_nets.keys()) | set(new_nets.keys())
        for name in sorted(all_net_names):
            old_net = old_nets.get(name)
            new_net = new_nets.get(name)

            if old_net is None and new_net is not None:
                pins = self._get_net_pins(new_net)
                added_nets.append(NetDiff(
                    net_name=name,
                    status=DiffStatus.ADDED,
                    new_pins=pins,
                ))
            elif old_net is not None and new_net is None:
                pins = self._get_net_pins(old_net)
                removed_nets.append(NetDiff(
                    net_name=name,
                    status=DiffStatus.REMOVED,
                    old_pins=pins,
                ))
            elif old_net is not None and new_net is not None:
                old_pins = set(self._get_net_pins(old_net))
                new_pins = set(self._get_net_pins(new_net))
                if old_pins != new_pins:
                    added_pins = sorted(new_pins - old_pins)
                    removed_pins = sorted(old_pins - new_pins)
                    modified_nets.append(NetDiff(
                        net_name=name,
                        status=DiffStatus.MODIFIED,
                        old_pins=sorted(old_pins),
                        new_pins=sorted(new_pins),
                        added_pins=added_pins,
                        removed_pins=removed_pins,
                    ))

        # Build summary.
        parts = []
        if added_components:
            parts.append(f"{len(added_components)} component(s) added")
        if removed_components:
            parts.append(f"{len(removed_components)} component(s) removed")
        if modified_components:
            parts.append(f"{len(modified_components)} component(s) modified")
        if added_nets:
            parts.append(f"{len(added_nets)} net(s) added")
        if removed_nets:
            parts.append(f"{len(removed_nets)} net(s) removed")
        if modified_nets:
            parts.append(f"{len(modified_nets)} net(s) modified")
        summary = "; ".join(parts) if parts else "No changes detected"

        logger.info("Netlist diff complete: %s", summary)

        return NetlistChanges(
            added_nets=added_nets,
            removed_nets=removed_nets,
            modified_nets=modified_nets,
            added_components=added_components,
            removed_components=removed_components,
            modified_components=modified_components,
            summary=summary,
        )

    @staticmethod
    def _get_net_pins(net: dict[str, Any]) -> list[str]:
        """Extract pin identifiers from a net definition."""
        pins = net.get("pinIds", net.get("pins", []))
        result = []
        for p in pins:
            if isinstance(p, str):
                result.append(p)
            elif isinstance(p, dict):
                result.append(p.get("id", p.get("pin_id", "")))
        return result

    @staticmethod
    def _compare_components(
        old_comp: dict[str, Any],
        new_comp: dict[str, Any],
    ) -> list[str]:
        """Compare two component dicts and return a list of changed field names."""
        changed: list[str] = []
        fields_to_compare = ["value", "footprint", "description", "manufacturer", "mpn"]

        for field_name in fields_to_compare:
            old_val = old_comp.get(field_name, "")
            new_val = new_comp.get(field_name, "")
            if str(old_val) != str(new_val):
                changed.append(field_name)

        # Compare pin counts.
        old_pins = old_comp.get("pins", [])
        new_pins = new_comp.get("pins", [])
        if len(old_pins) != len(new_pins):
            changed.append("pin_count")

        return changed
