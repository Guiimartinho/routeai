"""Cross-probing between schematic and layout views.

Provides bidirectional element lookup so that selecting a component or net in
one view instantly highlights the corresponding element in the other view.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class Position:
    """2D position with optional layer information."""
    x: float
    y: float
    layer: str = ""
    rotation: float = 0.0


@dataclass
class HighlightInfo:
    """Information needed to highlight an element in a view."""
    element_type: str  # "component", "net", "pin", "trace"
    element_id: str
    position: Position
    bounding_box: dict[str, float] = field(default_factory=dict)  # min_x, min_y, max_x, max_y
    connected_elements: list[str] = field(default_factory=list)
    color: str = "#fbbf24"  # Default highlight color (amber).
    label: str = ""


@dataclass
class CrossProbeResult:
    """Result of a cross-probe query."""
    found: bool
    source_view: str  # "schematic" or "layout"
    target_view: str  # "schematic" or "layout"
    highlight: HighlightInfo | None = None
    related_highlights: list[HighlightInfo] = field(default_factory=list)


@dataclass
class NetHighlightResult:
    """Result of a net highlight query showing positions in both views."""
    net_name: str
    schematic_positions: list[HighlightInfo]
    layout_positions: list[HighlightInfo]


class CrossProbe:
    """Bidirectional cross-probing between schematic and layout views.

    Maintains indexed references to both views so that lookups are fast.
    The schematic and layout data should be set via set_schematic() and
    set_layout() before performing queries.
    """

    def __init__(self) -> None:
        self._schematic: dict[str, Any] = {}
        self._layout: dict[str, Any] = {}
        self._sch_component_index: dict[str, dict[str, Any]] = {}
        self._layout_component_index: dict[str, dict[str, Any]] = {}
        self._sch_net_index: dict[str, dict[str, Any]] = {}
        self._layout_net_index: dict[str, dict[str, Any]] = {}

    def set_schematic(self, schematic: dict[str, Any]) -> None:
        """Load schematic data and build lookup indices."""
        self._schematic = schematic
        self._sch_component_index = {
            c.get("reference", ""): c
            for c in schematic.get("components", [])
            if c.get("reference")
        }
        self._sch_net_index = {
            n.get("name", n.get("id", "")): n
            for n in schematic.get("nets", [])
        }

    def set_layout(self, layout: dict[str, Any]) -> None:
        """Load layout data and build lookup indices."""
        self._layout = layout
        self._layout_component_index = {
            c.get("reference", ""): c
            for c in layout.get("components", [])
            if c.get("reference")
        }
        self._layout_net_index = {}
        for n in layout.get("nets", []):
            name = n.get("name", "")
            if name:
                self._layout_net_index[name] = n
        # Also index traces and pads by net for highlight queries.
        self._layout_traces_by_net: dict[int, list[dict[str, Any]]] = {}
        for trace in layout.get("traces", []):
            net_id = trace.get("net_id", -1)
            self._layout_traces_by_net.setdefault(net_id, []).append(trace)

        self._layout_pads_by_ref: dict[str, list[dict[str, Any]]] = {}
        for pad in layout.get("pads", []):
            ref = pad.get("component_ref", "")
            if ref:
                self._layout_pads_by_ref.setdefault(ref, []).append(pad)

    def schematic_to_layout(self, component_ref: str) -> CrossProbeResult:
        """Find a component's position in the layout given its schematic reference.

        Args:
            component_ref: Component reference designator (e.g., "U1", "R5").

        Returns:
            CrossProbeResult with layout position and highlight info.
        """
        layout_comp = self._layout_component_index.get(component_ref)
        if layout_comp is None:
            return CrossProbeResult(
                found=False,
                source_view="schematic",
                target_view="layout",
            )

        pos = Position(
            x=layout_comp.get("x", 0.0),
            y=layout_comp.get("y", 0.0),
            layer=str(layout_comp.get("layer_id", "")),
            rotation=layout_comp.get("rotation", 0.0),
        )

        bbox = layout_comp.get("bounding_box", {})
        bounding_box = {
            "min_x": bbox.get("min_x", pos.x - 5),
            "min_y": bbox.get("min_y", pos.y - 5),
            "max_x": bbox.get("max_x", pos.x + 5),
            "max_y": bbox.get("max_y", pos.y + 5),
        }

        # Find connected pads for related highlights.
        related: list[HighlightInfo] = []
        for pad in self._layout_pads_by_ref.get(component_ref, []):
            related.append(HighlightInfo(
                element_type="pad",
                element_id=f"{component_ref}:pad",
                position=Position(x=pad.get("x", 0.0), y=pad.get("y", 0.0)),
                color="#60a5fa",
                label=component_ref,
            ))

        highlight = HighlightInfo(
            element_type="component",
            element_id=component_ref,
            position=pos,
            bounding_box=bounding_box,
            label=f"{component_ref} ({layout_comp.get('value', '')})",
            color="#fbbf24",
        )

        return CrossProbeResult(
            found=True,
            source_view="schematic",
            target_view="layout",
            highlight=highlight,
            related_highlights=related,
        )

    def layout_to_schematic(self, component_ref: str) -> CrossProbeResult:
        """Find a component's position in the schematic given its layout reference.

        Args:
            component_ref: Component reference designator.

        Returns:
            CrossProbeResult with schematic position and highlight info.
        """
        sch_comp = self._sch_component_index.get(component_ref)
        if sch_comp is None:
            return CrossProbeResult(
                found=False,
                source_view="layout",
                target_view="schematic",
            )

        # Schematic positions are typically in schematic coordinates.
        pos = Position(
            x=sch_comp.get("x", sch_comp.get("position", {}).get("x", 0.0)),
            y=sch_comp.get("y", sch_comp.get("position", {}).get("y", 0.0)),
        )

        bbox_data = sch_comp.get("bounding_box", {})
        bounding_box = {
            "min_x": bbox_data.get("min_x", pos.x - 20),
            "min_y": bbox_data.get("min_y", pos.y - 20),
            "max_x": bbox_data.get("max_x", pos.x + 20),
            "max_y": bbox_data.get("max_y", pos.y + 20),
        }

        # Related highlights: connected pins and wires in the schematic.
        related: list[HighlightInfo] = []
        for pin in sch_comp.get("pins", []):
            pin_pos = pin.get("position", {})
            if pin_pos:
                related.append(HighlightInfo(
                    element_type="pin",
                    element_id=f"{component_ref}:{pin.get('number', '')}",
                    position=Position(
                        x=pin_pos.get("x", 0.0),
                        y=pin_pos.get("y", 0.0),
                    ),
                    color="#60a5fa",
                    label=pin.get("name", ""),
                ))

        highlight = HighlightInfo(
            element_type="component",
            element_id=component_ref,
            position=pos,
            bounding_box=bounding_box,
            label=f"{component_ref} ({sch_comp.get('value', '')})",
            color="#fbbf24",
        )

        return CrossProbeResult(
            found=True,
            source_view="layout",
            target_view="schematic",
            highlight=highlight,
            related_highlights=related,
        )

    def net_highlight(self, net_name: str) -> NetHighlightResult:
        """Highlight a net in both schematic and layout views.

        Returns all positions where the named net appears in both views,
        including component pins, traces, pads, and wires.

        Args:
            net_name: Name of the net to highlight.

        Returns:
            NetHighlightResult with positions in both views.
        """
        schematic_positions: list[HighlightInfo] = []
        layout_positions: list[HighlightInfo] = []

        # --- Schematic side ---
        sch_net = self._sch_net_index.get(net_name, {})
        net_pins = sch_net.get("pinIds", sch_net.get("pins", []))

        # Map pins back to component positions in the schematic.
        for comp_ref, comp_data in self._sch_component_index.items():
            for pin in comp_data.get("pins", []):
                pin_id = pin.get("id", pin.get("number", ""))
                if pin_id in net_pins:
                    pin_pos = pin.get("position", {})
                    schematic_positions.append(HighlightInfo(
                        element_type="pin",
                        element_id=f"{comp_ref}:{pin_id}",
                        position=Position(
                            x=pin_pos.get("x", comp_data.get("x", 0.0)),
                            y=pin_pos.get("y", comp_data.get("y", 0.0)),
                        ),
                        color="#f59e0b",
                        label=f"{comp_ref}.{pin.get('name', pin_id)}",
                        connected_elements=[net_name],
                    ))

        # Include schematic wires on this net.
        for wire in self._schematic.get("wires", self._schematic.get("connections", [])):
            if wire.get("net", wire.get("net_name", "")) == net_name:
                points = wire.get("points", [])
                if points:
                    mid_idx = len(points) // 2
                    mid = points[mid_idx] if mid_idx < len(points) else points[0]
                    schematic_positions.append(HighlightInfo(
                        element_type="net",
                        element_id=net_name,
                        position=Position(
                            x=mid.get("x", 0.0),
                            y=mid.get("y", 0.0),
                        ),
                        color="#f59e0b",
                        label=net_name,
                    ))

        # --- Layout side ---
        layout_net = self._layout_net_index.get(net_name, {})
        net_id = layout_net.get("id", -1)

        # Find pads connected to this net.
        for pad in self._layout.get("pads", []):
            if pad.get("net_id") == net_id:
                layout_positions.append(HighlightInfo(
                    element_type="pad",
                    element_id=f"{pad.get('component_ref', '')}:pad",
                    position=Position(
                        x=pad.get("x", 0.0),
                        y=pad.get("y", 0.0),
                        layer=str(pad.get("layer_id", "")),
                    ),
                    color="#f59e0b",
                    label=pad.get("component_ref", ""),
                    connected_elements=[net_name],
                ))

        # Find traces on this net.
        for trace in self._layout_traces_by_net.get(net_id, []):
            points = trace.get("points", [])
            if points:
                mid = points[len(points) // 2]
                layout_positions.append(HighlightInfo(
                    element_type="trace",
                    element_id=f"trace:{net_name}",
                    position=Position(
                        x=mid.get("x", 0.0),
                        y=mid.get("y", 0.0),
                        layer=str(trace.get("layer_id", "")),
                    ),
                    color="#f59e0b",
                    label=net_name,
                ))

        # Find vias on this net.
        for via in self._layout.get("vias", []):
            if via.get("net_id") == net_id:
                layout_positions.append(HighlightInfo(
                    element_type="via",
                    element_id=f"via:{net_name}",
                    position=Position(
                        x=via.get("x", 0.0),
                        y=via.get("y", 0.0),
                    ),
                    color="#f59e0b",
                    label=f"{net_name} (via)",
                ))

        return NetHighlightResult(
            net_name=net_name,
            schematic_positions=schematic_positions,
            layout_positions=layout_positions,
        )
