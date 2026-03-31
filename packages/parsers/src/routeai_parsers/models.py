"""Data models for parsed PCB and schematic designs.

These Pydantic models represent the unified data model used throughout RouteAI.
They serve as the output of all parsers and input to exporters, providing a
format-agnostic representation of PCB designs and schematics.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Geometry primitives
# ---------------------------------------------------------------------------

class Point2D(BaseModel):
    """A 2D point in millimeters."""
    x: float = 0.0
    y: float = 0.0


class Point3D(BaseModel):
    """A 3D point for model placement."""
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------

class PadType(str, Enum):
    """Pad mounting type."""
    SMD = "smd"
    THRU_HOLE = "thru_hole"
    CONNECT = "connect"
    NP_THRU_HOLE = "np_thru_hole"


class PadShape(str, Enum):
    """Pad shape."""
    CIRCLE = "circle"
    RECT = "rect"
    OVAL = "oval"
    TRAPEZOID = "trapezoid"
    ROUNDRECT = "roundrect"
    CUSTOM = "custom"


class ZoneFillType(str, Enum):
    """Zone fill strategy."""
    SOLID = "solid"
    HATCHED = "hatched"
    NONE = "none"


class LabelType(str, Enum):
    """Schematic label type."""
    LOCAL = "local"
    GLOBAL = "global"
    HIERARCHICAL = "hierarchical"
    POWER = "power"


# ---------------------------------------------------------------------------
# PCB Board models
# ---------------------------------------------------------------------------

class LayerDef(BaseModel):
    """A PCB layer definition."""
    ordinal: int
    name: str
    layer_type: str = "signal"
    user_name: str = ""


class Net(BaseModel):
    """A net (electrical connection)."""
    number: int
    name: str


class NetClass(BaseModel):
    """A net class with design rules."""
    name: str = "Default"
    description: str = ""
    clearance: float = 0.2
    trace_width: float = 0.25
    via_diameter: float = 0.6
    via_drill: float = 0.3
    uvia_diameter: float = 0.3
    uvia_drill: float = 0.1
    diff_pair_width: float = 0.2
    diff_pair_gap: float = 0.25
    nets: list[str] = Field(default_factory=list)


class Pad(BaseModel):
    """A component pad."""
    number: str
    pad_type: PadType = PadType.SMD
    shape: PadShape = PadShape.RECT
    at: Point2D = Field(default_factory=Point2D)
    angle: float = 0.0
    size_x: float = 0.0
    size_y: float = 0.0
    layers: list[str] = Field(default_factory=list)
    net_number: int = 0
    net_name: str = ""
    drill: float = 0.0
    drill_oval_x: float = 0.0
    drill_oval_y: float = 0.0
    roundrect_rratio: float = 0.25
    solder_mask_margin: float | None = None
    solder_paste_margin: float | None = None
    clearance: float | None = None


class FpText(BaseModel):
    """A text item within a footprint."""
    text_type: str = ""  # reference, value, user
    text: str = ""
    at: Point2D = Field(default_factory=Point2D)
    angle: float = 0.0
    layer: str = ""
    font_size_x: float = 1.0
    font_size_y: float = 1.0
    font_thickness: float = 0.15
    hidden: bool = False


class FpLine(BaseModel):
    """A line within a footprint."""
    start: Point2D = Field(default_factory=Point2D)
    end: Point2D = Field(default_factory=Point2D)
    layer: str = ""
    width: float = 0.0
    stroke_width: float = 0.0


class FpCircle(BaseModel):
    """A circle within a footprint."""
    center: Point2D = Field(default_factory=Point2D)
    end: Point2D = Field(default_factory=Point2D)
    layer: str = ""
    width: float = 0.0
    stroke_width: float = 0.0


class FpArc(BaseModel):
    """An arc within a footprint."""
    start: Point2D = Field(default_factory=Point2D)
    mid: Point2D = Field(default_factory=Point2D)
    end: Point2D = Field(default_factory=Point2D)
    layer: str = ""
    width: float = 0.0
    stroke_width: float = 0.0


class FpPoly(BaseModel):
    """A polygon within a footprint."""
    points: list[Point2D] = Field(default_factory=list)
    layer: str = ""
    width: float = 0.0
    stroke_width: float = 0.0


class Model3D(BaseModel):
    """A 3D model reference for a footprint."""
    path: str = ""
    offset: Point3D = Field(default_factory=Point3D)
    scale: Point3D = Field(default_factory=lambda: Point3D(x=1.0, y=1.0, z=1.0))
    rotate: Point3D = Field(default_factory=Point3D)


class Footprint(BaseModel):
    """A component footprint (physical package)."""
    library_link: str = ""
    at: Point2D = Field(default_factory=Point2D)
    angle: float = 0.0
    layer: str = "F.Cu"
    locked: bool = False
    pads: list[Pad] = Field(default_factory=list)
    texts: list[FpText] = Field(default_factory=list)
    lines: list[FpLine] = Field(default_factory=list)
    circles: list[FpCircle] = Field(default_factory=list)
    arcs: list[FpArc] = Field(default_factory=list)
    polygons: list[FpPoly] = Field(default_factory=list)
    model: Model3D | None = None
    reference: str = ""
    value: str = ""
    uuid: str = ""
    properties: dict[str, str] = Field(default_factory=dict)


class Segment(BaseModel):
    """A PCB trace segment."""
    start: Point2D = Field(default_factory=Point2D)
    end: Point2D = Field(default_factory=Point2D)
    width: float = 0.25
    layer: str = ""
    net: int = 0
    uuid: str = ""


class Arc(BaseModel):
    """A PCB arc trace."""
    start: Point2D = Field(default_factory=Point2D)
    mid: Point2D = Field(default_factory=Point2D)
    end: Point2D = Field(default_factory=Point2D)
    width: float = 0.25
    layer: str = ""
    net: int = 0
    uuid: str = ""


class Via(BaseModel):
    """A PCB via."""
    at: Point2D = Field(default_factory=Point2D)
    size: float = 0.6
    drill: float = 0.3
    layers: list[str] = Field(default_factory=list)
    net: int = 0
    via_type: str = ""  # "", "blind", "micro"
    uuid: str = ""


class ZoneFill(BaseModel):
    """Zone fill settings."""
    filled: bool = True
    thermal_gap: float = 0.5
    thermal_bridge_width: float = 0.5
    fill_type: ZoneFillType = ZoneFillType.SOLID
    hatch_thickness: float = 0.0
    hatch_gap: float = 0.0
    hatch_orientation: float = 0.0
    smoothing: str = ""
    smoothing_radius: float = 0.0
    island_removal_mode: int = 0
    island_area_min: float = 0.0


class ZonePolygon(BaseModel):
    """A polygon outline for a zone."""
    points: list[Point2D] = Field(default_factory=list)


class Zone(BaseModel):
    """A copper zone (pour)."""
    net: int = 0
    net_name: str = ""
    layer: str = ""
    layers: list[str] = Field(default_factory=list)
    uuid: str = ""
    name: str = ""
    priority: int = 0
    connect_pads: str = "yes"  # yes, thru_hole_only, no
    connect_pads_clearance: float = 0.0
    min_thickness: float = 0.25
    fill: ZoneFill = Field(default_factory=ZoneFill)
    polygons: list[ZonePolygon] = Field(default_factory=list)
    fill_polygons: list[ZonePolygon] = Field(default_factory=list)
    keepout_tracks: str = ""
    keepout_vias: str = ""
    keepout_pads: str = ""
    keepout_copperpour: str = ""
    keepout_footprints: str = ""


class GrLine(BaseModel):
    """A graphical line on the board."""
    start: Point2D = Field(default_factory=Point2D)
    end: Point2D = Field(default_factory=Point2D)
    layer: str = ""
    width: float = 0.0
    stroke_width: float = 0.0
    uuid: str = ""


class GrArc(BaseModel):
    """A graphical arc on the board."""
    start: Point2D = Field(default_factory=Point2D)
    mid: Point2D = Field(default_factory=Point2D)
    end: Point2D = Field(default_factory=Point2D)
    layer: str = ""
    width: float = 0.0
    stroke_width: float = 0.0
    uuid: str = ""


class GrCircle(BaseModel):
    """A graphical circle on the board."""
    center: Point2D = Field(default_factory=Point2D)
    end: Point2D = Field(default_factory=Point2D)
    layer: str = ""
    width: float = 0.0
    stroke_width: float = 0.0
    uuid: str = ""


class GrRect(BaseModel):
    """A graphical rectangle on the board."""
    start: Point2D = Field(default_factory=Point2D)
    end: Point2D = Field(default_factory=Point2D)
    layer: str = ""
    width: float = 0.0
    stroke_width: float = 0.0
    uuid: str = ""


class StackupLayer(BaseModel):
    """A layer in the board stackup."""
    name: str = ""
    layer_type: str = ""  # copper, core, prepreg, etc.
    thickness: float = 0.0
    material: str = ""
    epsilon_r: float = 0.0
    loss_tangent: float = 0.0


class Stackup(BaseModel):
    """Board stackup definition."""
    layers: list[StackupLayer] = Field(default_factory=list)


class DesignRules(BaseModel):
    """PCB design rules."""
    min_clearance: float = 0.2
    min_trace_width: float = 0.2
    min_via_diameter: float = 0.6
    min_via_drill: float = 0.3
    min_uvia_diameter: float = 0.3
    min_uvia_drill: float = 0.1
    min_through_hole_diameter: float = 0.3
    copper_edge_clearance: float = 0.0
    allow_blind_buried_vias: bool = False
    allow_micro_vias: bool = False


class BoardDesign(BaseModel):
    """Complete parsed representation of a .kicad_pcb board design."""
    version: int = 0
    generator: str = ""
    thickness: float = 1.6
    layers: list[LayerDef] = Field(default_factory=list)
    nets: list[Net] = Field(default_factory=list)
    net_classes: list[NetClass] = Field(default_factory=list)
    footprints: list[Footprint] = Field(default_factory=list)
    segments: list[Segment] = Field(default_factory=list)
    arcs: list[Arc] = Field(default_factory=list)
    vias: list[Via] = Field(default_factory=list)
    zones: list[Zone] = Field(default_factory=list)
    gr_lines: list[GrLine] = Field(default_factory=list)
    gr_arcs: list[GrArc] = Field(default_factory=list)
    gr_circles: list[GrCircle] = Field(default_factory=list)
    gr_rects: list[GrRect] = Field(default_factory=list)
    stackup: Stackup = Field(default_factory=Stackup)
    design_rules: DesignRules = Field(default_factory=DesignRules)
    setup_raw: list[Any] | None = None

    def net_by_number(self, num: int) -> Net | None:
        """Look up a net by its number."""
        for n in self.nets:
            if n.number == num:
                return n
        return None

    def net_by_name(self, name: str) -> Net | None:
        """Look up a net by its name."""
        for n in self.nets:
            if n.name == name:
                return n
        return None

    def layer_names(self, layer_type: str | None = None) -> list[str]:
        """Get all layer names, optionally filtered by type."""
        if layer_type is None:
            return [layer.name for layer in self.layers]
        return [layer.name for layer in self.layers if layer.layer_type == layer_type]


# ---------------------------------------------------------------------------
# Schematic models
# ---------------------------------------------------------------------------

class SchPin(BaseModel):
    """A pin on a schematic symbol instance."""
    number: str = ""
    uuid: str = ""
    name: str = ""
    position: Point2D = Field(default_factory=Point2D)
    connected_net: str = ""


class SchProperty(BaseModel):
    """A property on a schematic symbol."""
    key: str = ""
    value: str = ""
    at: Point2D = Field(default_factory=Point2D)
    angle: float = 0.0
    effects_hidden: bool = False


class LibSymbolPin(BaseModel):
    """A pin definition in a library symbol."""
    name: str = ""
    number: str = ""
    pin_type: str = ""  # input, output, passive, power_in, etc.
    at: Point2D = Field(default_factory=Point2D)
    angle: float = 0.0
    length: float = 2.54


class LibSymbol(BaseModel):
    """A library symbol definition."""
    lib_id: str = ""
    pins: list[LibSymbolPin] = Field(default_factory=list)
    properties: list[SchProperty] = Field(default_factory=list)
    raw: list[Any] | None = None


class SchSymbol(BaseModel):
    """A placed symbol instance on a schematic."""
    lib_id: str = ""
    at: Point2D = Field(default_factory=Point2D)
    angle: float = 0.0
    mirror: str = ""  # "", "x", "y"
    unit: int = 1
    uuid: str = ""
    pins: list[SchPin] = Field(default_factory=list)
    properties: list[SchProperty] = Field(default_factory=list)
    reference: str = ""
    value: str = ""


class SchWire(BaseModel):
    """A wire (electrical connection) on a schematic."""
    points: list[Point2D] = Field(default_factory=list)
    uuid: str = ""


class SchBus(BaseModel):
    """A bus line on a schematic."""
    points: list[Point2D] = Field(default_factory=list)
    uuid: str = ""


class SchLabel(BaseModel):
    """A label on a schematic."""
    text: str = ""
    label_type: LabelType = LabelType.LOCAL
    at: Point2D = Field(default_factory=Point2D)
    angle: float = 0.0
    uuid: str = ""
    shape: str = ""  # for global/hierarchical: input, output, bidirectional, etc.


class SchJunction(BaseModel):
    """A junction point on a schematic."""
    at: Point2D = Field(default_factory=Point2D)
    diameter: float = 0.0
    uuid: str = ""


class SchNoConnect(BaseModel):
    """A no-connect marker on a schematic."""
    at: Point2D = Field(default_factory=Point2D)
    uuid: str = ""


class HierarchicalSheet(BaseModel):
    """A hierarchical sheet reference."""
    at: Point2D = Field(default_factory=Point2D)
    size_x: float = 0.0
    size_y: float = 0.0
    uuid: str = ""
    sheet_name: str = ""
    file_name: str = ""
    pins: list[SchPin] = Field(default_factory=list)
    properties: list[SchProperty] = Field(default_factory=list)


class SchNet(BaseModel):
    """A resolved net in the schematic."""
    name: str = ""
    pins: list[tuple[str, str]] = Field(default_factory=list)  # (ref, pin_number)
    labels: list[str] = Field(default_factory=list)
    is_power: bool = False


class SchematicDesign(BaseModel):
    """Complete parsed representation of a .kicad_sch schematic."""
    version: int = 0
    generator: str = ""
    uuid: str = ""
    lib_symbols: list[LibSymbol] = Field(default_factory=list)
    symbols: list[SchSymbol] = Field(default_factory=list)
    wires: list[SchWire] = Field(default_factory=list)
    buses: list[SchBus] = Field(default_factory=list)
    labels: list[SchLabel] = Field(default_factory=list)
    junctions: list[SchJunction] = Field(default_factory=list)
    no_connects: list[SchNoConnect] = Field(default_factory=list)
    hierarchical_sheets: list[HierarchicalSheet] = Field(default_factory=list)
    nets: list[SchNet] = Field(default_factory=list)
    title: str = ""
    date: str = ""
    revision: str = ""
    company: str = ""

    def symbol_by_reference(self, ref: str) -> SchSymbol | None:
        """Find a symbol by its reference designator."""
        for sym in self.symbols:
            if sym.reference == ref:
                return sym
        return None

    def lib_symbol_by_id(self, lib_id: str) -> LibSymbol | None:
        """Find a library symbol definition by its lib_id."""
        for ls in self.lib_symbols:
            if ls.lib_id == lib_id:
                return ls
        return None
