"""IPC-2581C XML exporter for PCB manufacturing data exchange.

Generates IPC-2581C compliant XML output containing complete PCB
fabrication and assembly data including layer stack, design rules,
component BOM, netlist, physical net routing, component placement,
and manufacturing specifications.

Reference: IPC-2581C (Generic Requirements for Printed Board Assembly
Products Manufacturing Description Data and Transfer Methodology).
"""

from __future__ import annotations

import math
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from xml.dom import minidom
from typing import Optional

from routeai_solver.board_model import (
    BoardDesign,
    CopperZone,
    Layer,
    LayerType,
    Pad,
    PadShape,
    Trace,
    TraceSegment,
    Via,
)


# IPC-2581C namespace
IPC_NS = "http://webstds.ipc.org/2581"
IPC_NS_PREFIX = "ipc"


def _uid() -> str:
    """Generate a unique identifier."""
    return str(uuid.uuid4())


def _fmt(val: float) -> str:
    """Format a float to 6 decimal places."""
    return f"{val:.6f}"


class IPC2581Exporter:
    """Exports a board design to IPC-2581C XML format.

    Generates a complete IPC-2581C XML file covering all sections:
    Content (layer stack, design rules), Bom (component bill of materials),
    LogicalNet (schematic netlist), PhysicalNet (routed traces/vias),
    Component (placement), and Fabrication (manufacturing data).

    Usage::

        exporter = IPC2581Exporter()
        path = exporter.export(board, "output.xml")
    """

    def __init__(
        self,
        board_name: str = "RouteAI_Board",
        revision: str = "A",
    ) -> None:
        self.board_name = board_name
        self.revision = revision

    def export(self, board: BoardDesign, filepath: str | Path) -> str:
        """Export the board design to an IPC-2581C XML file.

        Args:
            board: The board design to export.
            filepath: Output path for the XML file.

        Returns:
            The path to the generated file.
        """
        filepath = Path(filepath)
        filepath.parent.mkdir(parents=True, exist_ok=True)

        root = self._build_xml(board)
        rough = ET.tostring(root, encoding="unicode", xml_declaration=False)
        dom = minidom.parseString(rough)
        pretty = dom.toprettyxml(indent="  ", encoding=None)

        # Fix the XML declaration
        lines = pretty.split("\n")
        if lines and lines[0].startswith("<?xml"):
            lines[0] = '<?xml version="1.0" encoding="UTF-8"?>'
        content = "\n".join(lines)

        filepath.write_text(content, encoding="utf-8")
        return str(filepath)

    def _build_xml(self, board: BoardDesign) -> ET.Element:
        """Build the complete IPC-2581C XML tree."""
        # Register namespace
        ET.register_namespace(IPC_NS_PREFIX, IPC_NS)

        root = ET.Element(f"{{{IPC_NS}}}IPC-2581")
        root.set("revision", "C")
        root.set("xmlns", IPC_NS)

        # Content section
        content = ET.SubElement(root, f"{{{IPC_NS}}}Content")
        content.set("roleRef", "Owner")
        self._build_content(board, content)

        # BOM section
        bom = ET.SubElement(root, f"{{{IPC_NS}}}Bom")
        bom.set("name", "BOM")
        self._build_bom(board, bom)

        # ECad section (contains logical/physical nets and component placement)
        ecad = ET.SubElement(root, f"{{{IPC_NS}}}Ecad")
        ecad.set("name", self.board_name)

        # CadHeader
        cad_header = ET.SubElement(ecad, f"{{{IPC_NS}}}CadHeader")
        cad_header.set("units", "MILLIMETER")

        # CadData
        cad_data = ET.SubElement(ecad, f"{{{IPC_NS}}}CadData")

        # LogicalNet section
        self._build_logical_nets(board, cad_data)

        # Step (contains physical layout)
        step = ET.SubElement(cad_data, f"{{{IPC_NS}}}Step")
        step.set("name", "pcb")

        # PhysicalNet section (traces and vias)
        self._build_physical_nets(board, step)

        # Component section (placement)
        self._build_components(board, step)

        # Profile (board outline)
        self._build_profile(board, step)

        # LayerFeature sections
        self._build_layer_features(board, step)

        return root

    # ------------------------------------------------------------------
    # Content section
    # ------------------------------------------------------------------

    def _build_content(self, board: BoardDesign, content: ET.Element) -> None:
        """Build the Content section with layer stack and design rules."""
        # FunctionMode
        func_mode = ET.SubElement(content, f"{{{IPC_NS}}}FunctionMode")
        func_mode.set("mode", "FABRICATION")

        # StepRef
        step_ref = ET.SubElement(content, f"{{{IPC_NS}}}StepRef")
        step_ref.set("name", "pcb")

        # LayerStackup
        stackup = ET.SubElement(content, f"{{{IPC_NS}}}StackupGroup")
        stackup.set("name", "Primary")

        for idx, layer in enumerate(board.layers):
            if layer.layer_type != LayerType.COPPER:
                continue
            stackup_layer = ET.SubElement(stackup, f"{{{IPC_NS}}}StackupLayer")
            stackup_layer.set("layerOrGroupRef", layer.name)
            stackup_layer.set("sequence", str(idx))

            # Find stackup physical properties
            for sl in board.stackup:
                if sl.layer == layer:
                    stackup_layer.set("thickness", _fmt(sl.thickness_mm))
                    if sl.material:
                        stackup_layer.set("material", sl.material)
                    break

        # DictionaryStandard for pad shapes
        dictionary = ET.SubElement(content, f"{{{IPC_NS}}}DictionaryStandard")
        dictionary.set("units", "MILLIMETER")

        # Build pad shape entries
        pad_shapes_seen: set[str] = set()
        for pad in board.pads:
            shape_key = f"{pad.shape.value}_{pad.width:.4f}_{pad.height:.4f}"
            if shape_key in pad_shapes_seen:
                continue
            pad_shapes_seen.add(shape_key)

            entry = ET.SubElement(dictionary, f"{{{IPC_NS}}}EntryStandard")
            entry.set("id", f"PAD_{shape_key}")

            if pad.shape == PadShape.CIRCLE:
                shape_el = ET.SubElement(entry, f"{{{IPC_NS}}}Circle")
                shape_el.set("diameter", _fmt(pad.width))
            elif pad.shape == PadShape.RECT:
                shape_el = ET.SubElement(entry, f"{{{IPC_NS}}}RectCenter")
                shape_el.set("width", _fmt(pad.width))
                shape_el.set("height", _fmt(pad.height))
            elif pad.shape == PadShape.OVAL:
                shape_el = ET.SubElement(entry, f"{{{IPC_NS}}}Oval")
                shape_el.set("width", _fmt(pad.width))
                shape_el.set("height", _fmt(pad.height))
            elif pad.shape == PadShape.ROUNDRECT:
                shape_el = ET.SubElement(entry, f"{{{IPC_NS}}}RectRound")
                shape_el.set("width", _fmt(pad.width))
                shape_el.set("height", _fmt(pad.height))
                cr = pad.corner_radius_ratio * min(pad.width, pad.height) / 2.0
                shape_el.set("radius", _fmt(cr))

        # DesignRules
        rules = ET.SubElement(content, f"{{{IPC_NS}}}DesignRules")
        dr = board.design_rules

        rule_clearance = ET.SubElement(rules, f"{{{IPC_NS}}}Rule")
        rule_clearance.set("name", "MinClearance")
        rule_clearance.set("value", _fmt(dr.min_clearance))
        rule_clearance.set("units", "MILLIMETER")

        rule_trace = ET.SubElement(rules, f"{{{IPC_NS}}}Rule")
        rule_trace.set("name", "MinTraceWidth")
        rule_trace.set("value", _fmt(dr.min_trace_width))
        rule_trace.set("units", "MILLIMETER")

        rule_drill = ET.SubElement(rules, f"{{{IPC_NS}}}Rule")
        rule_drill.set("name", "MinDrill")
        rule_drill.set("value", _fmt(dr.min_drill))
        rule_drill.set("units", "MILLIMETER")

        rule_via = ET.SubElement(rules, f"{{{IPC_NS}}}Rule")
        rule_via.set("name", "MinViaDiameter")
        rule_via.set("value", _fmt(dr.min_via_diameter))
        rule_via.set("units", "MILLIMETER")

        rule_ring = ET.SubElement(rules, f"{{{IPC_NS}}}Rule")
        rule_ring.set("name", "MinAnnularRing")
        rule_ring.set("value", _fmt(dr.min_annular_ring))
        rule_ring.set("units", "MILLIMETER")

        rule_edge = ET.SubElement(rules, f"{{{IPC_NS}}}Rule")
        rule_edge.set("name", "BoardEdgeClearance")
        rule_edge.set("value", _fmt(dr.board_edge_clearance))
        rule_edge.set("units", "MILLIMETER")

    # ------------------------------------------------------------------
    # BOM section
    # ------------------------------------------------------------------

    def _build_bom(self, board: BoardDesign, bom: ET.Element) -> None:
        """Build the BOM section listing all components."""
        # Group pads by component reference to identify unique components
        components: dict[str, list[Pad]] = {}
        for pad in board.pads:
            ref = pad.component_ref
            if ref:
                components.setdefault(ref, []).append(pad)

        # Group by footprint/value for BOM items
        bom_items: dict[str, list[str]] = {}
        for ref, pads in components.items():
            # Use first pad to determine grouping key
            key = f"item_{ref}"
            bom_items.setdefault(key, []).append(ref)

        bom_header = ET.SubElement(bom, f"{{{IPC_NS}}}BomHeader")
        bom_header.set("assembly", self.board_name)
        bom_header.set("revision", self.revision)

        for item_key, refs in bom_items.items():
            bom_item = ET.SubElement(bom, f"{{{IPC_NS}}}BomItem")
            bom_item.set("quantity", str(len(refs)))
            bom_item.set("OEMDesignNumberRef", item_key)
            bom_item.set("pinCount", str(
                len(components.get(refs[0], []))
            ))

            for ref in refs:
                ref_des = ET.SubElement(bom_item, f"{{{IPC_NS}}}RefDes")
                ref_des.set("name", ref)

    # ------------------------------------------------------------------
    # LogicalNet section
    # ------------------------------------------------------------------

    def _build_logical_nets(
        self, board: BoardDesign, cad_data: ET.Element
    ) -> None:
        """Build the LogicalNet section (schematic netlist)."""
        for net in board.nets:
            if not net.name:
                continue

            net_el = ET.SubElement(cad_data, f"{{{IPC_NS}}}LogicalNet")
            net_el.set("name", net.name)

            # List all pins in this net
            for pad in board.pads:
                if pad.net == net and pad.component_ref:
                    pin_ref = ET.SubElement(net_el, f"{{{IPC_NS}}}PinRef")
                    pin_ref.set("componentRef", pad.component_ref)
                    pin_ref.set("pin", pad.pad_number)

    # ------------------------------------------------------------------
    # PhysicalNet section
    # ------------------------------------------------------------------

    def _build_physical_nets(
        self, board: BoardDesign, step: ET.Element
    ) -> None:
        """Build physical net routing (traces and vias)."""
        # Group traces and vias by net
        net_traces: dict[str, list[Trace]] = {}
        for trace in board.traces:
            net_name = trace.net.name
            net_traces.setdefault(net_name, []).append(trace)

        net_vias: dict[str, list[Via]] = {}
        for via in board.vias:
            net_name = via.net.name
            net_vias.setdefault(net_name, []).append(via)

        for net in board.nets:
            if not net.name:
                continue
            traces = net_traces.get(net.name, [])
            vias = net_vias.get(net.name, [])
            if not traces and not vias:
                continue

            phys_net = ET.SubElement(step, f"{{{IPC_NS}}}PhysicalNet")
            phys_net.set("name", net.name)

            # Traces
            for trace in traces:
                for seg in trace.segments:
                    trace_seg = ET.SubElement(phys_net, f"{{{IPC_NS}}}TraceSegment")
                    trace_seg.set("layerRef", trace.layer.name)
                    trace_seg.set("width", _fmt(seg.width))

                    start_pt = ET.SubElement(trace_seg, f"{{{IPC_NS}}}StartPoint")
                    start_pt.set("x", _fmt(seg.start_x))
                    start_pt.set("y", _fmt(seg.start_y))

                    end_pt = ET.SubElement(trace_seg, f"{{{IPC_NS}}}EndPoint")
                    end_pt.set("x", _fmt(seg.end_x))
                    end_pt.set("y", _fmt(seg.end_y))

            # Vias
            for via in vias:
                via_el = ET.SubElement(phys_net, f"{{{IPC_NS}}}Via")
                via_el.set("x", _fmt(via.x))
                via_el.set("y", _fmt(via.y))
                via_el.set("drill", _fmt(via.drill))
                via_el.set("padDiameter", _fmt(via.diameter))
                via_el.set("startLayerRef", via.start_layer.name)
                via_el.set("endLayerRef", via.end_layer.name)

    # ------------------------------------------------------------------
    # Component section
    # ------------------------------------------------------------------

    def _build_components(
        self, board: BoardDesign, step: ET.Element
    ) -> None:
        """Build component placement data."""
        # Group pads by component ref
        comp_pads: dict[str, list[Pad]] = {}
        for pad in board.pads:
            if pad.component_ref:
                comp_pads.setdefault(pad.component_ref, []).append(pad)

        for ref, pads in comp_pads.items():
            if not pads:
                continue

            comp = ET.SubElement(step, f"{{{IPC_NS}}}Component")
            comp.set("refDes", ref)
            comp.set("packageRef", ref)

            # Determine component centroid from pad positions
            cx = sum(p.x for p in pads) / len(pads)
            cy = sum(p.y for p in pads) / len(pads)

            # Determine side from first pad's layer
            side = "TOP" if pads[0].layer.name == "F.Cu" else "BOTTOM"

            location = ET.SubElement(comp, f"{{{IPC_NS}}}Location")
            location.set("x", _fmt(cx))
            location.set("y", _fmt(cy))
            location.set("side", side)
            location.set("rotation", "0.000000")

    # ------------------------------------------------------------------
    # Profile
    # ------------------------------------------------------------------

    def _build_profile(self, board: BoardDesign, step: ET.Element) -> None:
        """Build the board profile (outline)."""
        if board.outline is None or board.outline.is_empty:
            return

        profile = ET.SubElement(step, f"{{{IPC_NS}}}Profile")
        polygon = ET.SubElement(profile, f"{{{IPC_NS}}}Polygon")

        coords = list(board.outline.exterior.coords)
        for i, (x, y) in enumerate(coords):
            if i == 0:
                pt = ET.SubElement(polygon, f"{{{IPC_NS}}}PolyBegin")
            else:
                pt = ET.SubElement(polygon, f"{{{IPC_NS}}}PolyStepSegment")
            pt.set("x", _fmt(x))
            pt.set("y", _fmt(y))

    # ------------------------------------------------------------------
    # Layer features (fabrication data)
    # ------------------------------------------------------------------

    def _build_layer_features(
        self, board: BoardDesign, step: ET.Element
    ) -> None:
        """Build per-layer fabrication feature data."""
        for layer in board.layers:
            if layer.layer_type != LayerType.COPPER:
                continue

            layer_feature = ET.SubElement(step, f"{{{IPC_NS}}}LayerFeature")
            layer_feature.set("layerRef", layer.name)

            # Pads on this layer
            for pad in board.pads_on_layer(layer):
                pad_el = ET.SubElement(layer_feature, f"{{{IPC_NS}}}Set")
                pad_el.set("net", pad.net.name if pad.net else "")
                pad_el.set("refDes", pad.component_ref)
                pad_el.set("pin", pad.pad_number)

                shape_key = f"{pad.shape.value}_{pad.width:.4f}_{pad.height:.4f}"
                pad_el.set("padstackDefRef", f"PAD_{shape_key}")

                pad_loc = ET.SubElement(pad_el, f"{{{IPC_NS}}}Location")
                pad_loc.set("x", _fmt(pad.x))
                pad_loc.set("y", _fmt(pad.y))

            # Traces
            for trace in board.traces_on_layer(layer):
                for seg in trace.segments:
                    line_el = ET.SubElement(layer_feature, f"{{{IPC_NS}}}Set")
                    line_el.set("net", trace.net.name)

                    feat = ET.SubElement(line_el, f"{{{IPC_NS}}}Line")
                    feat.set("startX", _fmt(seg.start_x))
                    feat.set("startY", _fmt(seg.start_y))
                    feat.set("endX", _fmt(seg.end_x))
                    feat.set("endY", _fmt(seg.end_y))
                    feat.set("width", _fmt(seg.width))

            # Zones
            for zone in board.zones:
                if zone.layer != layer:
                    continue
                poly = zone.to_shapely()
                if poly.is_empty:
                    continue

                zone_el = ET.SubElement(layer_feature, f"{{{IPC_NS}}}Set")
                zone_el.set("net", zone.net.name)

                polys_list = [poly] if poly.geom_type == "Polygon" else list(poly.geoms)
                for single_poly in polys_list:
                    if single_poly.is_empty:
                        continue
                    coords = list(single_poly.exterior.coords)
                    if len(coords) < 3:
                        continue

                    surface = ET.SubElement(zone_el, f"{{{IPC_NS}}}Polygon")
                    for idx_c, (cx, cy) in enumerate(coords):
                        if idx_c == 0:
                            pt = ET.SubElement(surface, f"{{{IPC_NS}}}PolyBegin")
                        else:
                            pt = ET.SubElement(surface, f"{{{IPC_NS}}}PolyStepSegment")
                        pt.set("x", _fmt(cx))
                        pt.set("y", _fmt(cy))
