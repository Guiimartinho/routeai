"""Converter layer between routeai_parsers.models and routeai_core.models.

Provides bidirectional conversion between the parser's flat data model
(float-based, KiCad-centric) and the core's rich data model (Length/Angle/Point-based).
"""

from __future__ import annotations

from typing import Optional

from routeai_core.geometry import Line, Point, Polygon
from routeai_core.models.constraints import DesignRules as CoreDesignRules
from routeai_core.models.constraints import NetClass as CoreNetClass
from routeai_core.models.physical import (
    BoardDesign as CoreBoardDesign,
)
from routeai_core.models.physical import (
    BoardOutline as CoreBoardOutline,
)
from routeai_core.models.physical import (
    Footprint as CoreFootprint,
)
from routeai_core.models.physical import (
    Model3D as CoreModel3D,
)
from routeai_core.models.physical import (
    Pad as CorePad,
)
from routeai_core.models.physical import (
    PadShape as CorePadShape,
)
from routeai_core.models.physical import (
    PadType as CorePadType,
)
from routeai_core.models.physical import (
    ThermalRelief as CoreThermalRelief,
)
from routeai_core.models.physical import (
    TraceSegment as CoreTraceSegment,
)
from routeai_core.models.physical import (
    Via as CoreVia,
)
from routeai_core.models.physical import (
    ViaType as CoreViaType,
)
from routeai_core.models.physical import (
    Zone as CoreZone,
)
from routeai_core.models.physical import (
    ZoneFillType as CoreZoneFillType,
)
from routeai_core.models.schematic import (
    Bus as CoreBus,
)
from routeai_core.models.schematic import (
    Component as CoreComponent,
)
from routeai_core.models.schematic import (
    ElectricalType as CoreElectricalType,
)
from routeai_core.models.schematic import (
    Net as CoreNet,
)
from routeai_core.models.schematic import (
    Pin as CorePin,
)
from routeai_core.models.schematic import (
    SchematicDesign as CoreSchematicDesign,
)
from routeai_core.models.schematic import (
    Sheet as CoreSheet,
)
from routeai_core.models.schematic import (
    SheetInstance as CoreSheetInstance,
)
from routeai_core.models.stackup import (
    DielectricLayer as CoreDielectricLayer,
)
from routeai_core.models.stackup import (
    Layer as CoreLayer,
)
from routeai_core.models.stackup import (
    LayerType as CoreLayerType,
)
from routeai_core.models.stackup import (
    StackUp as CoreStackUp,
)
from routeai_core.models.stackup import (
    StackupLayer as CoreStackupLayer,
)
from routeai_core.units import Angle, Length
from routeai_parsers import models as pm

# ---------------------------------------------------------------------------
# Helper: coordinate conversions
# ---------------------------------------------------------------------------

def _point_to_core(p: pm.Point2D) -> Point:
    """Convert a parser Point2D (float mm) to a core Point (Length)."""
    return Point(x=Length.from_mm(p.x), y=Length.from_mm(p.y))


def _point_from_core(p: Point) -> pm.Point2D:
    """Convert a core Point (Length) to a parser Point2D (float mm)."""
    return pm.Point2D(x=p.x.mm, y=p.y.mm)


# ---------------------------------------------------------------------------
# Helper: enum mappings
# ---------------------------------------------------------------------------

_PAD_SHAPE_TO_CORE: dict[pm.PadShape, CorePadShape] = {
    pm.PadShape.CIRCLE: CorePadShape.CIRCLE,
    pm.PadShape.RECT: CorePadShape.RECT,
    pm.PadShape.OVAL: CorePadShape.OVAL,
    pm.PadShape.ROUNDRECT: CorePadShape.ROUNDRECT,
    pm.PadShape.CUSTOM: CorePadShape.CUSTOM,
    # TRAPEZOID has no core equivalent; map to RECT as closest match
    pm.PadShape.TRAPEZOID: CorePadShape.RECT,
}

_PAD_SHAPE_FROM_CORE: dict[CorePadShape, pm.PadShape] = {
    CorePadShape.CIRCLE: pm.PadShape.CIRCLE,
    CorePadShape.RECT: pm.PadShape.RECT,
    CorePadShape.OVAL: pm.PadShape.OVAL,
    CorePadShape.ROUNDRECT: pm.PadShape.ROUNDRECT,
    CorePadShape.CUSTOM: pm.PadShape.CUSTOM,
}

_PAD_TYPE_TO_CORE: dict[pm.PadType, CorePadType] = {
    pm.PadType.SMD: CorePadType.SMD,
    pm.PadType.THRU_HOLE: CorePadType.THROUGH_HOLE,
    pm.PadType.NP_THRU_HOLE: CorePadType.NPTH,
    # CONNECT has no core equivalent; map to SMD
    pm.PadType.CONNECT: CorePadType.SMD,
}

_PAD_TYPE_FROM_CORE: dict[CorePadType, pm.PadType] = {
    CorePadType.SMD: pm.PadType.SMD,
    CorePadType.THROUGH_HOLE: pm.PadType.THRU_HOLE,
    CorePadType.NPTH: pm.PadType.NP_THRU_HOLE,
}

_VIA_TYPE_TO_CORE: dict[str, CoreViaType] = {
    "": CoreViaType.THROUGH,
    "blind": CoreViaType.BLIND,
    "micro": CoreViaType.MICRO,
}

_VIA_TYPE_FROM_CORE: dict[CoreViaType, str] = {
    CoreViaType.THROUGH: "",
    CoreViaType.BLIND: "blind",
    CoreViaType.BURIED: "blind",  # KiCad does not distinguish buried
    CoreViaType.MICRO: "micro",
}

_ZONE_FILL_TO_CORE: dict[pm.ZoneFillType, CoreZoneFillType] = {
    pm.ZoneFillType.SOLID: CoreZoneFillType.SOLID,
    pm.ZoneFillType.HATCHED: CoreZoneFillType.HATCHED,
    pm.ZoneFillType.NONE: CoreZoneFillType.NONE,
}

_ZONE_FILL_FROM_CORE: dict[CoreZoneFillType, pm.ZoneFillType] = {
    CoreZoneFillType.SOLID: pm.ZoneFillType.SOLID,
    CoreZoneFillType.HATCHED: pm.ZoneFillType.HATCHED,
    CoreZoneFillType.NONE: pm.ZoneFillType.NONE,
}

_LAYER_TYPE_TO_CORE: dict[str, CoreLayerType] = {
    "signal": CoreLayerType.SIGNAL,
    "power": CoreLayerType.POWER,
    "mixed": CoreLayerType.MIXED,
    "user": CoreLayerType.SIGNAL,  # user layers map to signal as default
    "jumper": CoreLayerType.SIGNAL,
}

_LAYER_TYPE_FROM_CORE: dict[CoreLayerType, str] = {
    CoreLayerType.SIGNAL: "signal",
    CoreLayerType.POWER: "power",
    CoreLayerType.MIXED: "mixed",
    CoreLayerType.DIELECTRIC: "user",
}

# Parser SchPin / LibSymbolPin pin_type -> core ElectricalType
_PIN_TYPE_TO_CORE: dict[str, CoreElectricalType] = {
    "input": CoreElectricalType.INPUT,
    "output": CoreElectricalType.OUTPUT,
    "bidirectional": CoreElectricalType.BIDIRECTIONAL,
    "tri_state": CoreElectricalType.TRI_STATE,
    "passive": CoreElectricalType.PASSIVE,
    "power_in": CoreElectricalType.POWER_IN,
    "power_out": CoreElectricalType.POWER_OUT,
    "open_collector": CoreElectricalType.OPEN_COLLECTOR,
    "open_emitter": CoreElectricalType.OPEN_EMITTER,
    "unconnected": CoreElectricalType.UNCONNECTED,
    "unspecified": CoreElectricalType.UNSPECIFIED,
    "free": CoreElectricalType.UNSPECIFIED,
    "": CoreElectricalType.UNSPECIFIED,
}

_PIN_TYPE_FROM_CORE: dict[CoreElectricalType, str] = {
    CoreElectricalType.INPUT: "input",
    CoreElectricalType.OUTPUT: "output",
    CoreElectricalType.BIDIRECTIONAL: "bidirectional",
    CoreElectricalType.TRI_STATE: "tri_state",
    CoreElectricalType.PASSIVE: "passive",
    CoreElectricalType.POWER_IN: "power_in",
    CoreElectricalType.POWER_OUT: "power_out",
    CoreElectricalType.OPEN_COLLECTOR: "open_collector",
    CoreElectricalType.OPEN_EMITTER: "open_emitter",
    CoreElectricalType.UNCONNECTED: "unconnected",
    CoreElectricalType.UNSPECIFIED: "unspecified",
}


# ---------------------------------------------------------------------------
# Board converter
# ---------------------------------------------------------------------------

class BoardConverter:
    """Bidirectional converter between parser and core board models."""

    # -- individual element converters (to core) --

    @staticmethod
    def _pad_to_core(pad: pm.Pad, net_map: dict[int, str]) -> CorePad:
        """Convert a parser Pad to a core Pad."""
        net_name: Optional[str] = pad.net_name if pad.net_name else net_map.get(pad.net_number)
        if net_name == "":
            net_name = None
        return CorePad(
            number=pad.number,
            shape=_PAD_SHAPE_TO_CORE.get(pad.shape, CorePadShape.RECT),
            size_x=Length.from_mm(pad.size_x),
            size_y=Length.from_mm(pad.size_y),
            drill=Length.from_mm(pad.drill) if pad.drill > 0 else None,
            layers=list(pad.layers),
            position=_point_to_core(pad.at),
            net_ref=net_name if net_name else None,
            pad_type=_PAD_TYPE_TO_CORE.get(pad.pad_type, CorePadType.SMD),
            roundrect_ratio=pad.roundrect_rratio,
        )

    @staticmethod
    def _pad_from_core(
        pad: CorePad,
        net_reverse: dict[str, int],
    ) -> pm.Pad:
        """Convert a core Pad to a parser Pad."""
        net_name = pad.net_ref or ""
        net_number = net_reverse.get(net_name, 0) if net_name else 0
        return pm.Pad(
            number=pad.number,
            pad_type=_PAD_TYPE_FROM_CORE.get(pad.pad_type, pm.PadType.SMD),
            shape=_PAD_SHAPE_FROM_CORE.get(pad.shape, pm.PadShape.RECT),
            at=_point_from_core(pad.position),
            size_x=pad.size_x.mm,
            size_y=pad.size_y.mm,
            layers=list(pad.layers),
            net_number=net_number,
            net_name=net_name,
            drill=pad.drill.mm if pad.drill is not None else 0.0,
            roundrect_rratio=pad.roundrect_ratio,
        )

    @staticmethod
    def _footprint_to_core(fp: pm.Footprint, net_map: dict[int, str]) -> CoreFootprint:
        """Convert a parser Footprint to a core Footprint."""
        core_pads = [BoardConverter._pad_to_core(p, net_map) for p in fp.pads]

        # Convert silkscreen and fab layer lines
        silk_lines: list[Line] = []
        fab_lines: list[Line] = []
        for line in fp.lines:
            core_line = Line(
                start=_point_to_core(line.start),
                end=_point_to_core(line.end),
            )
            if "SilkS" in line.layer or "Silkscreen" in line.layer:
                silk_lines.append(core_line)
            elif "Fab" in line.layer:
                fab_lines.append(core_line)
            else:
                fab_lines.append(core_line)

        model_3d: Optional[CoreModel3D] = None
        if fp.model is not None:
            model_3d = CoreModel3D(
                path=fp.model.path,
                offset=_point_to_core(pm.Point2D(x=fp.model.offset.x, y=fp.model.offset.y)),
                rotation=Angle(fp.model.rotate.z),
                scale=fp.model.scale.x,
            )

        return CoreFootprint(
            reference=fp.reference,
            value=fp.value,
            position=_point_to_core(fp.at),
            rotation=Angle(fp.angle),
            layer=fp.layer,
            pads=core_pads,
            silkscreen_lines=silk_lines,
            fab_layer_lines=fab_lines,
            model_3d=model_3d,
        )

    @staticmethod
    def _footprint_from_core(
        fp: CoreFootprint,
        net_reverse: dict[str, int],
    ) -> pm.Footprint:
        """Convert a core Footprint to a parser Footprint."""
        parser_pads = [BoardConverter._pad_from_core(p, net_reverse) for p in fp.pads]

        lines: list[pm.FpLine] = []
        for line in fp.silkscreen_lines:
            silk_layer = "F.SilkS" if fp.layer == "F.Cu" else "B.SilkS"
            lines.append(pm.FpLine(
                start=_point_from_core(line.start),
                end=_point_from_core(line.end),
                layer=silk_layer,
            ))
        for line in fp.fab_layer_lines:
            fab_layer = "F.Fab" if fp.layer == "F.Cu" else "B.Fab"
            lines.append(pm.FpLine(
                start=_point_from_core(line.start),
                end=_point_from_core(line.end),
                layer=fab_layer,
            ))

        model: Optional[pm.Model3D] = None
        if fp.model_3d is not None:
            model = pm.Model3D(
                path=fp.model_3d.path,
                offset=pm.Point3D(
                    x=fp.model_3d.offset.x.mm,
                    y=fp.model_3d.offset.y.mm,
                    z=0.0,
                ),
                scale=pm.Point3D(
                    x=fp.model_3d.scale,
                    y=fp.model_3d.scale,
                    z=fp.model_3d.scale,
                ),
                rotate=pm.Point3D(
                    x=0.0,
                    y=0.0,
                    z=fp.model_3d.rotation.degrees,
                ),
            )

        # Build reference and value text entries
        texts: list[pm.FpText] = [
            pm.FpText(text_type="reference", text=fp.reference, layer=fp.layer),
            pm.FpText(text_type="value", text=fp.value, layer=fp.layer),
        ]

        return pm.Footprint(
            reference=fp.reference,
            value=fp.value,
            at=_point_from_core(fp.position),
            angle=fp.rotation.degrees,
            layer=fp.layer,
            pads=parser_pads,
            lines=lines,
            texts=texts,
            model=model,
        )

    @staticmethod
    def _segment_to_core(seg: pm.Segment, net_map: dict[int, str]) -> CoreTraceSegment:
        """Convert a parser Segment to a core TraceSegment."""
        net_name = net_map.get(seg.net)
        if net_name == "":
            net_name = None
        return CoreTraceSegment(
            start=_point_to_core(seg.start),
            end=_point_to_core(seg.end),
            width=Length.from_mm(seg.width),
            layer=seg.layer,
            net_ref=net_name,
        )

    @staticmethod
    def _segment_from_core(
        seg: CoreTraceSegment,
        net_reverse: dict[str, int],
    ) -> pm.Segment:
        """Convert a core TraceSegment to a parser Segment."""
        net_name = seg.net_ref or ""
        return pm.Segment(
            start=_point_from_core(seg.start),
            end=_point_from_core(seg.end),
            width=seg.width.mm,
            layer=seg.layer,
            net=net_reverse.get(net_name, 0) if net_name else 0,
        )

    @staticmethod
    def _via_to_core(via: pm.Via, net_map: dict[int, str]) -> CoreVia:
        """Convert a parser Via to a core Via."""
        net_name = net_map.get(via.net)
        if net_name == "":
            net_name = None
        return CoreVia(
            position=_point_to_core(via.at),
            drill=Length.from_mm(via.drill),
            size=Length.from_mm(via.size),
            layers=list(via.layers),
            net_ref=net_name,
            via_type=_VIA_TYPE_TO_CORE.get(via.via_type, CoreViaType.THROUGH),
        )

    @staticmethod
    def _via_from_core(via: CoreVia, net_reverse: dict[str, int]) -> pm.Via:
        """Convert a core Via to a parser Via."""
        net_name = via.net_ref or ""
        return pm.Via(
            at=_point_from_core(via.position),
            size=via.size.mm,
            drill=via.drill.mm,
            layers=list(via.layers),
            net=net_reverse.get(net_name, 0) if net_name else 0,
            via_type=_VIA_TYPE_FROM_CORE.get(via.via_type, ""),
        )

    @staticmethod
    def _zone_to_core(zone: pm.Zone, net_map: dict[int, str]) -> CoreZone:
        """Convert a parser Zone to a core Zone."""
        net_name = zone.net_name if zone.net_name else net_map.get(zone.net)
        if net_name == "":
            net_name = None

        # Build polygon from the first zone polygon (outline)
        polygon = Polygon()
        if zone.polygons:
            polygon = Polygon(
                points=[_point_to_core(p) for p in zone.polygons[0].points]
            )

        layer = zone.layer if zone.layer else (zone.layers[0] if zone.layers else "F.Cu")

        thermal: Optional[CoreThermalRelief] = None
        if zone.fill.thermal_gap > 0 or zone.fill.thermal_bridge_width > 0:
            thermal = CoreThermalRelief(
                gap=Length.from_mm(zone.fill.thermal_gap),
                bridge_width=Length.from_mm(zone.fill.thermal_bridge_width),
            )

        return CoreZone(
            name=zone.name,
            net_ref=net_name,
            layer=layer,
            polygon=polygon,
            fill_type=_ZONE_FILL_TO_CORE.get(zone.fill.fill_type, CoreZoneFillType.SOLID),
            clearance=Length.from_mm(zone.connect_pads_clearance),
            min_width=Length.from_mm(zone.min_thickness),
            priority=zone.priority,
            thermal_relief=thermal,
        )

    @staticmethod
    def _zone_from_core(zone: CoreZone, net_reverse: dict[str, int]) -> pm.Zone:
        """Convert a core Zone to a parser Zone."""
        net_name = zone.net_ref or ""
        net_num = net_reverse.get(net_name, 0) if net_name else 0

        polygons: list[pm.ZonePolygon] = []
        if zone.polygon.points:
            polygons.append(pm.ZonePolygon(
                points=[_point_from_core(p) for p in zone.polygon.points]
            ))

        fill = pm.ZoneFill(
            fill_type=_ZONE_FILL_FROM_CORE.get(zone.fill_type, pm.ZoneFillType.SOLID),
            thermal_gap=zone.thermal_relief.gap.mm if zone.thermal_relief else 0.5,
            thermal_bridge_width=zone.thermal_relief.bridge_width.mm if zone.thermal_relief else 0.5,
        )

        return pm.Zone(
            net=net_num,
            net_name=net_name,
            layer=zone.layer,
            name=zone.name,
            priority=zone.priority,
            connect_pads_clearance=zone.clearance.mm,
            min_thickness=zone.min_width.mm,
            fill=fill,
            polygons=polygons,
        )

    @staticmethod
    def _net_class_to_core(nc: pm.NetClass) -> CoreNetClass:
        """Convert a parser NetClass to a core NetClass."""
        return CoreNetClass(
            name=nc.name,
            clearance=Length.from_mm(nc.clearance),
            trace_width=Length.from_mm(nc.trace_width),
            via_drill=Length.from_mm(nc.via_drill),
            via_size=Length.from_mm(nc.via_diameter),
            diff_pair_width=Length.from_mm(nc.diff_pair_width) if nc.diff_pair_width > 0 else None,
            diff_pair_gap=Length.from_mm(nc.diff_pair_gap) if nc.diff_pair_gap > 0 else None,
            nets=list(nc.nets),
        )

    @staticmethod
    def _net_class_from_core(nc: CoreNetClass) -> pm.NetClass:
        """Convert a core NetClass to a parser NetClass."""
        return pm.NetClass(
            name=nc.name,
            clearance=nc.clearance.mm,
            trace_width=nc.trace_width.mm,
            via_diameter=nc.via_size.mm,
            via_drill=nc.via_drill.mm,
            diff_pair_width=nc.diff_pair_width.mm if nc.diff_pair_width is not None else 0.0,
            diff_pair_gap=nc.diff_pair_gap.mm if nc.diff_pair_gap is not None else 0.0,
            nets=list(nc.nets),
        )

    @staticmethod
    def _design_rules_to_core(dr: pm.DesignRules) -> CoreDesignRules:
        """Convert parser DesignRules to core DesignRules."""
        return CoreDesignRules(
            min_clearance=Length.from_mm(dr.min_clearance),
            min_trace_width=Length.from_mm(dr.min_trace_width),
            min_via_drill=Length.from_mm(dr.min_via_drill),
            min_via_size=Length.from_mm(dr.min_via_diameter),
            min_drill=Length.from_mm(dr.min_through_hole_diameter),
            board_edge_clearance=Length.from_mm(dr.copper_edge_clearance),
        )

    @staticmethod
    def _design_rules_from_core(dr: CoreDesignRules) -> pm.DesignRules:
        """Convert core DesignRules to parser DesignRules."""
        return pm.DesignRules(
            min_clearance=dr.min_clearance.mm,
            min_trace_width=dr.min_trace_width.mm,
            min_via_diameter=dr.min_via_size.mm,
            min_via_drill=dr.min_via_drill.mm,
            min_through_hole_diameter=dr.min_drill.mm,
            copper_edge_clearance=dr.board_edge_clearance.mm,
        )

    @staticmethod
    def _stackup_to_core(stackup: pm.Stackup) -> CoreStackUp:
        """Convert parser Stackup to core StackUp."""
        layers: list[CoreStackupLayer] = []
        copper_count = 0
        for sl in stackup.layers:
            if sl.layer_type == "copper":
                lt = _LAYER_TYPE_TO_CORE.get("signal", CoreLayerType.SIGNAL)
                copper_layer = CoreLayer(
                    name=sl.name,
                    layer_type=lt,
                    thickness_mm=sl.thickness,
                    material=sl.material if sl.material else "Copper",
                )
                layers.append(CoreStackupLayer(copper=copper_layer))
                copper_count += 1
            elif sl.layer_type in ("core", "prepreg", "dielectric"):
                diel = CoreDielectricLayer(
                    name=sl.name,
                    thickness_mm=sl.thickness,
                    dielectric_constant=sl.epsilon_r if sl.epsilon_r > 0 else 4.5,
                    loss_tangent=sl.loss_tangent if sl.loss_tangent > 0 else 0.02,
                    material=sl.material if sl.material else "FR-4",
                )
                layers.append(CoreStackupLayer(dielectric=diel))
            else:
                # Unknown layer type; try copper if name contains "Cu"
                if "Cu" in sl.name:
                    copper_layer = CoreLayer(
                        name=sl.name,
                        layer_type=CoreLayerType.SIGNAL,
                        thickness_mm=sl.thickness,
                    )
                    layers.append(CoreStackupLayer(copper=copper_layer))
                    copper_count += 1
                else:
                    diel = CoreDielectricLayer(
                        name=sl.name,
                        thickness_mm=sl.thickness,
                        dielectric_constant=sl.epsilon_r if sl.epsilon_r > 0 else 4.5,
                        loss_tangent=sl.loss_tangent if sl.loss_tangent > 0 else 0.02,
                        material=sl.material if sl.material else "FR-4",
                    )
                    layers.append(CoreStackupLayer(dielectric=diel))

        total = sum(sl.thickness for sl in stackup.layers) if stackup.layers else None
        return CoreStackUp(
            layers=layers,
            total_thickness=total,
            layer_count=copper_count if copper_count > 0 else 2,
        )

    @staticmethod
    def _stackup_from_core(stackup: CoreStackUp) -> pm.Stackup:
        """Convert core StackUp to parser Stackup."""
        layers: list[pm.StackupLayer] = []
        for sl in stackup.layers:
            if sl.copper is not None:
                layers.append(pm.StackupLayer(
                    name=sl.copper.name,
                    layer_type="copper",
                    thickness=sl.copper.thickness_mm,
                    material=sl.copper.material,
                ))
            elif sl.dielectric is not None:
                lt = "core" if "Core" in sl.dielectric.name else "prepreg"
                layers.append(pm.StackupLayer(
                    name=sl.dielectric.name,
                    layer_type=lt,
                    thickness=sl.dielectric.thickness_mm,
                    material=sl.dielectric.material,
                    epsilon_r=sl.dielectric.dielectric_constant,
                    loss_tangent=sl.dielectric.loss_tangent,
                ))
        return pm.Stackup(layers=layers)

    @staticmethod
    def _build_outline(board: pm.BoardDesign) -> Optional[CoreBoardOutline]:
        """Build a core BoardOutline from parser gr_lines/gr_arcs on Edge.Cuts."""
        edge_lines = [gl for gl in board.gr_lines if gl.layer == "Edge.Cuts"]
        edge_rects = [gr for gr in board.gr_rects if gr.layer == "Edge.Cuts"]

        if not edge_lines and not edge_rects:
            return None

        # Collect points from edge lines
        points: list[Point] = []
        if edge_lines:
            # Chain line segments: start of first, then ends
            # Build a set of edges and attempt to order them
            edges: list[tuple[tuple[float, float], tuple[float, float]]] = []
            for gl in edge_lines:
                edges.append(
                    ((gl.start.x, gl.start.y), (gl.end.x, gl.end.y))
                )

            # Simple chain: find connected sequence
            ordered: list[tuple[float, float]] = []
            if edges:
                ordered.append(edges[0][0])
                ordered.append(edges[0][1])
                remaining = list(edges[1:])
                max_iter = len(remaining) * len(remaining) + 1
                iteration = 0
                while remaining and iteration < max_iter:
                    iteration += 1
                    found = False
                    for i, (s, e) in enumerate(remaining):
                        last = ordered[-1]
                        if _close(s, last):
                            ordered.append(e)
                            remaining.pop(i)
                            found = True
                            break
                        if _close(e, last):
                            ordered.append(s)
                            remaining.pop(i)
                            found = True
                            break
                    if not found:
                        break

                # Remove closing duplicate if present
                if len(ordered) > 1 and _close(ordered[0], ordered[-1]):
                    ordered = ordered[:-1]

            points = [
                Point(x=Length.from_mm(xy[0]), y=Length.from_mm(xy[1]))
                for xy in ordered
            ]
        elif edge_rects:
            # Use the first rect as the outline
            rect = edge_rects[0]
            points = [
                _point_to_core(rect.start),
                Point(x=Length.from_mm(rect.end.x), y=Length.from_mm(rect.start.y)),
                _point_to_core(rect.end),
                Point(x=Length.from_mm(rect.start.x), y=Length.from_mm(rect.end.y)),
            ]

        if len(points) < 3:
            return None

        return CoreBoardOutline(polygon=Polygon(points=points))

    @staticmethod
    def _outline_to_gr_lines(outline: CoreBoardOutline) -> list[pm.GrLine]:
        """Convert a core BoardOutline polygon back to parser GrLine segments."""
        lines: list[pm.GrLine] = []
        pts = outline.polygon.points
        if len(pts) < 3:
            return lines
        for i in range(len(pts)):
            start = pts[i]
            end = pts[(i + 1) % len(pts)]
            lines.append(pm.GrLine(
                start=_point_from_core(start),
                end=_point_from_core(end),
                layer="Edge.Cuts",
                width=0.05,
            ))
        return lines

    # -- top-level converters --

    @staticmethod
    def to_core(board: pm.BoardDesign) -> CoreBoardDesign:
        """Convert a parser BoardDesign to a core BoardDesign.

        Args:
            board: The parser BoardDesign to convert.

        Returns:
            A core BoardDesign with all fields mapped.
        """
        # Build net number -> name map
        net_map: dict[int, str] = {n.number: n.name for n in board.nets}
        # Net names list (excluding empty net 0)
        net_names = [n.name for n in board.nets if n.name]

        footprints = [BoardConverter._footprint_to_core(fp, net_map) for fp in board.footprints]
        traces = [BoardConverter._segment_to_core(s, net_map) for s in board.segments]
        vias = [BoardConverter._via_to_core(v, net_map) for v in board.vias]
        zones = [BoardConverter._zone_to_core(z, net_map) for z in board.zones]
        net_classes = [BoardConverter._net_class_to_core(nc) for nc in board.net_classes]
        design_rules = BoardConverter._design_rules_to_core(board.design_rules)
        stackup = BoardConverter._stackup_to_core(board.stackup) if board.stackup.layers else None
        outline = BoardConverter._build_outline(board)

        return CoreBoardDesign(
            title=board.generator or "Untitled",
            footprints=footprints,
            traces=traces,
            vias=vias,
            zones=zones,
            outline=outline,
            stackup=stackup,
            design_rules=design_rules,
            nets=net_names,
            net_classes=net_classes,
        )

    @staticmethod
    def from_core(board: CoreBoardDesign) -> pm.BoardDesign:
        """Convert a core BoardDesign to a parser BoardDesign.

        Args:
            board: The core BoardDesign to convert.

        Returns:
            A parser BoardDesign with all fields mapped.
        """
        # Build net list: net 0 is always unnamed, then real nets
        parser_nets: list[pm.Net] = [pm.Net(number=0, name="")]
        for i, name in enumerate(board.nets, start=1):
            parser_nets.append(pm.Net(number=i, name=name))
        net_reverse: dict[str, int] = {n.name: n.number for n in parser_nets if n.name}

        footprints = [BoardConverter._footprint_from_core(fp, net_reverse) for fp in board.footprints]
        segments = [BoardConverter._segment_from_core(s, net_reverse) for s in board.traces]
        vias = [BoardConverter._via_from_core(v, net_reverse) for v in board.vias]
        zones = [BoardConverter._zone_from_core(z, net_reverse) for z in board.zones]
        net_classes = [BoardConverter._net_class_from_core(nc) for nc in board.net_classes]

        design_rules = (
            BoardConverter._design_rules_from_core(board.design_rules)
            if board.design_rules is not None
            else pm.DesignRules()
        )

        stackup = (
            BoardConverter._stackup_from_core(board.stackup)
            if board.stackup is not None
            else pm.Stackup()
        )

        gr_lines: list[pm.GrLine] = []
        if board.outline is not None:
            gr_lines = BoardConverter._outline_to_gr_lines(board.outline)

        return pm.BoardDesign(
            generator=board.title if board.title != "Untitled" else "",
            nets=parser_nets,
            net_classes=net_classes,
            footprints=footprints,
            segments=segments,
            vias=vias,
            zones=zones,
            gr_lines=gr_lines,
            stackup=stackup,
            design_rules=design_rules,
        )


# ---------------------------------------------------------------------------
# Schematic converter
# ---------------------------------------------------------------------------

class SchematicConverter:
    """Bidirectional converter between parser and core schematic models."""

    @staticmethod
    def _pin_to_core(
        pin: pm.SchPin,
        lib_pins: dict[str, pm.LibSymbolPin],
    ) -> CorePin:
        """Convert a parser SchPin to a core Pin, enriching with lib pin data."""
        lib_pin = lib_pins.get(pin.number)
        pin_type_str = lib_pin.pin_type if lib_pin else ""
        name = pin.name or (lib_pin.name if lib_pin else "")
        if name == "~":
            name = ""

        position = _point_to_core(pin.position)
        if lib_pin and pin.position.x == 0.0 and pin.position.y == 0.0:
            position = _point_to_core(lib_pin.at)

        return CorePin(
            number=pin.number,
            name=name,
            position=position,
            electrical_type=_PIN_TYPE_TO_CORE.get(pin_type_str, CoreElectricalType.UNSPECIFIED),
            net_ref=pin.connected_net if pin.connected_net else None,
        )

    @staticmethod
    def _pin_from_core(pin: CorePin) -> pm.SchPin:
        """Convert a core Pin to a parser SchPin."""
        return pm.SchPin(
            number=pin.number,
            name=pin.name,
            position=_point_from_core(pin.position),
            connected_net=pin.net_ref or "",
        )

    @staticmethod
    def _component_to_core(
        sym: pm.SchSymbol,
        lib_symbols: dict[str, pm.LibSymbol],
    ) -> CoreComponent:
        """Convert a parser SchSymbol to a core Component."""
        lib_sym = lib_symbols.get(sym.lib_id)
        lib_pins: dict[str, pm.LibSymbolPin] = {}
        if lib_sym:
            lib_pins = {p.number: p for p in lib_sym.pins}

        core_pins = [SchematicConverter._pin_to_core(p, lib_pins) for p in sym.pins]

        # Extract properties into a dict
        properties: dict[str, str] = {}
        for prop in sym.properties:
            if prop.key not in ("Reference", "Value"):
                properties[prop.key] = prop.value

        # Footprint from properties
        footprint = ""
        for prop in sym.properties:
            if prop.key == "Footprint":
                footprint = prop.value
                break

        return CoreComponent(
            reference=sym.reference,
            value=sym.value,
            footprint=footprint,
            position=_point_to_core(sym.at),
            rotation=Angle(sym.angle),
            properties=properties,
            pins=core_pins,
        )

    @staticmethod
    def _component_from_core(comp: CoreComponent) -> pm.SchSymbol:
        """Convert a core Component to a parser SchSymbol."""
        parser_pins = [SchematicConverter._pin_from_core(p) for p in comp.pins]

        properties: list[pm.SchProperty] = [
            pm.SchProperty(key="Reference", value=comp.reference),
            pm.SchProperty(key="Value", value=comp.value),
        ]
        if comp.footprint:
            properties.append(pm.SchProperty(key="Footprint", value=comp.footprint))
        for k, v in comp.properties.items():
            properties.append(pm.SchProperty(key=k, value=v))

        return pm.SchSymbol(
            lib_id=comp.footprint,
            at=_point_from_core(comp.position),
            angle=comp.rotation.degrees,
            reference=comp.reference,
            value=comp.value,
            pins=parser_pins,
            properties=properties,
        )

    @staticmethod
    def _net_to_core(net: pm.SchNet) -> CoreNet:
        """Convert a parser SchNet to a core Net."""
        pads = [f"{ref}.{pin}" for ref, pin in net.pins]
        return CoreNet(
            name=net.name,
            pads=pads,
        )

    @staticmethod
    def _net_from_core(net: CoreNet) -> pm.SchNet:
        """Convert a core Net to a parser SchNet."""
        pins: list[tuple[str, str]] = []
        for pad_ref in net.pads:
            parts = pad_ref.rsplit(".", 1)
            if len(parts) == 2:
                pins.append((parts[0], parts[1]))
            else:
                pins.append((pad_ref, ""))

        is_power = net.name.upper() in ("VCC", "VDD", "GND", "VSS", "3V3", "5V", "12V")
        return pm.SchNet(
            name=net.name,
            pins=pins,
            is_power=is_power,
        )

    @staticmethod
    def to_core(sch: pm.SchematicDesign) -> CoreSchematicDesign:
        """Convert a parser SchematicDesign to a core SchematicDesign.

        Args:
            sch: The parser SchematicDesign to convert.

        Returns:
            A core SchematicDesign with all fields mapped.
        """
        lib_symbols: dict[str, pm.LibSymbol] = {ls.lib_id: ls for ls in sch.lib_symbols}

        components = [
            SchematicConverter._component_to_core(sym, lib_symbols)
            for sym in sch.symbols
        ]
        nets = [SchematicConverter._net_to_core(n) for n in sch.nets]

        buses: list[CoreBus] = []
        for bus in sch.buses:
            # Buses in parser are just wire groups; we create a named bus
            buses.append(CoreBus(name=bus.uuid or "bus"))

        sheets: list[CoreSheet] = []
        for hs in sch.hierarchical_sheets:
            sheets.append(CoreSheet(
                name=hs.sheet_name,
                filename=hs.file_name,
                instances=[CoreSheetInstance(path=hs.uuid, page="")],
            ))

        return CoreSchematicDesign(
            title=sch.title or "Untitled",
            date=sch.date,
            revision=sch.revision,
            components=components,
            nets=nets,
            buses=buses,
            sheets=sheets,
        )

    @staticmethod
    def from_core(sch: CoreSchematicDesign) -> pm.SchematicDesign:
        """Convert a core SchematicDesign to a parser SchematicDesign.

        Args:
            sch: The core SchematicDesign to convert.

        Returns:
            A parser SchematicDesign with all fields mapped.
        """
        symbols = [SchematicConverter._component_from_core(c) for c in sch.components]
        nets = [SchematicConverter._net_from_core(n) for n in sch.nets]

        # Build lib_symbols from component data
        lib_symbols: list[pm.LibSymbol] = []
        seen_lib_ids: set[str] = set()
        for sym in symbols:
            if sym.lib_id and sym.lib_id not in seen_lib_ids:
                seen_lib_ids.add(sym.lib_id)
                lib_pins = [
                    pm.LibSymbolPin(
                        number=p.number,
                        name=p.name,
                        pin_type=_PIN_TYPE_FROM_CORE.get(
                            CoreElectricalType.UNSPECIFIED, "unspecified"
                        ),
                    )
                    for p in sym.pins
                ]
                lib_symbols.append(pm.LibSymbol(
                    lib_id=sym.lib_id,
                    pins=lib_pins,
                ))

        hierarchical_sheets: list[pm.HierarchicalSheet] = []
        for sheet in sch.sheets:
            hierarchical_sheets.append(pm.HierarchicalSheet(
                sheet_name=sheet.name,
                file_name=sheet.filename,
                uuid=sheet.instances[0].path if sheet.instances else "",
            ))

        buses: list[pm.SchBus] = [pm.SchBus(uuid=b.name) for b in sch.buses]

        return pm.SchematicDesign(
            title=sch.title if sch.title != "Untitled" else "",
            date=sch.date,
            revision=sch.revision,
            lib_symbols=lib_symbols,
            symbols=symbols,
            nets=nets,
            buses=buses,
            hierarchical_sheets=hierarchical_sheets,
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _close(a: tuple[float, float], b: tuple[float, float], tol: float = 0.001) -> bool:
    """Check if two 2D tuples are close within tolerance."""
    return abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol
