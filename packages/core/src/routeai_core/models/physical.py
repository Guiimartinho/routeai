"""Physical/layout models for PCB design.

Defines the physical representation of a PCB including pads, vias, traces,
footprints, zones, board outline, and the top-level BoardDesign.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field

from routeai_core.geometry import Line, Point, Polygon
from routeai_core.models.constraints import DesignRules, NetClass
from routeai_core.models.stackup import StackUp
from routeai_core.units import Angle, Length


class PadShape(str, Enum):
    """Shape of a pad."""

    CIRCLE = "circle"
    RECT = "rect"
    OVAL = "oval"
    ROUNDRECT = "roundrect"
    CUSTOM = "custom"


class PadType(str, Enum):
    """Pad technology type."""

    SMD = "smd"
    THROUGH_HOLE = "through_hole"
    NPTH = "npth"


class Pad(BaseModel):
    """A pad on a footprint.

    Represents the copper area where a component pin connects to the board,
    including SMD pads, through-hole pads, and non-plated holes.
    """

    number: str = Field(default="1", description="Pad number or designator")
    shape: PadShape = Field(default=PadShape.CIRCLE, description="Pad shape")
    size_x: Length = Field(
        default_factory=lambda: Length.from_mm(1.0), description="Pad width"
    )
    size_y: Length = Field(
        default_factory=lambda: Length.from_mm(1.0), description="Pad height"
    )
    drill: Optional[Length] = Field(default=None, description="Drill diameter for through-hole pads")
    layers: list[str] = Field(
        default_factory=lambda: ["F.Cu"], description="Copper layers the pad exists on"
    )
    position: Point = Field(
        default_factory=Point, description="Position relative to footprint origin"
    )
    net_ref: Optional[str] = Field(default=None, description="Connected net name")
    pad_type: PadType = Field(default=PadType.SMD, description="Pad technology type")
    roundrect_ratio: float = Field(
        default=0.25,
        ge=0.0,
        le=0.5,
        description="Corner radius ratio for ROUNDRECT pads (0=rect, 0.5=oval)",
    )

    model_config = {"arbitrary_types_allowed": True}


class ViaType(str, Enum):
    """Type of via."""

    THROUGH = "through"
    BLIND = "blind"
    BURIED = "buried"
    MICRO = "micro"


class Via(BaseModel):
    """A via connecting copper layers.

    Vias are plated holes that connect traces on different copper layers.
    """

    position: Point = Field(default_factory=Point, description="Via center position")
    drill: Length = Field(
        default_factory=lambda: Length.from_mm(0.3), description="Drill diameter"
    )
    size: Length = Field(
        default_factory=lambda: Length.from_mm(0.6), description="Annular ring outer diameter"
    )
    layers: list[str] = Field(
        default_factory=lambda: ["F.Cu", "B.Cu"],
        description="Connected copper layers",
    )
    net_ref: Optional[str] = Field(default=None, description="Connected net name")
    via_type: ViaType = Field(default=ViaType.THROUGH, description="Via type")

    model_config = {"arbitrary_types_allowed": True}

    @property
    def annular_ring(self) -> Length:
        """Width of the annular ring."""
        return Length.from_mm((self.size.mm - self.drill.mm) / 2.0)


class TraceSegment(BaseModel):
    """A straight trace segment on a copper layer.

    Represents a single segment of a routed connection between pads.
    """

    start: Point = Field(description="Start point of the trace")
    end: Point = Field(description="End point of the trace")
    width: Length = Field(
        default_factory=lambda: Length.from_mm(0.25), description="Trace width"
    )
    layer: str = Field(default="F.Cu", description="Copper layer")
    net_ref: Optional[str] = Field(default=None, description="Connected net name")

    model_config = {"arbitrary_types_allowed": True}

    @property
    def length(self) -> Length:
        """Length of the trace segment."""
        return self.start.distance_to(self.end)


class TraceArc(BaseModel):
    """A curved trace segment on a copper layer.

    Represents an arc-shaped section of a routed trace.
    """

    center: Point = Field(description="Arc center point")
    radius: Length = Field(description="Arc radius")
    start_angle: Angle = Field(
        default_factory=lambda: Angle(0.0), description="Start angle"
    )
    end_angle: Angle = Field(
        default_factory=lambda: Angle(90.0), description="End angle"
    )
    width: Length = Field(
        default_factory=lambda: Length.from_mm(0.25), description="Trace width"
    )
    layer: str = Field(default="F.Cu", description="Copper layer")
    net_ref: Optional[str] = Field(default=None, description="Connected net name")

    model_config = {"arbitrary_types_allowed": True}

    @property
    def arc_length(self) -> Length:
        """Length along the arc."""
        sweep = abs(self.end_angle.radians - self.start_angle.radians)
        return Length.from_mm(self.radius.mm * sweep)


class Model3D(BaseModel):
    """Reference to a 3D model for visualization."""

    path: str = Field(description="File path or URL to the 3D model")
    offset: Point = Field(default_factory=Point, description="Position offset")
    rotation: Angle = Field(
        default_factory=lambda: Angle(0.0), description="Rotation around Z axis"
    )
    scale: float = Field(default=1.0, description="Scale factor")

    model_config = {"arbitrary_types_allowed": True}


class Footprint(BaseModel):
    """A physical footprint (land pattern) placed on the PCB.

    A footprint defines the copper pads, silkscreen, courtyard, and other
    physical features for a component.
    """

    reference: str = Field(description="Reference designator (e.g. 'R1', 'U3')")
    value: str = Field(default="", description="Component value")
    position: Point = Field(default_factory=Point, description="Position on the board")
    rotation: Angle = Field(default_factory=lambda: Angle(0.0), description="Rotation angle")
    layer: str = Field(default="F.Cu", description="Placement layer (F.Cu or B.Cu)")
    pads: list[Pad] = Field(default_factory=list, description="Pads in the footprint")
    courtyard: Optional[Polygon] = Field(
        default=None, description="Courtyard outline polygon"
    )
    fab_layer_lines: list[Line] = Field(
        default_factory=list, description="Fabrication layer lines"
    )
    silkscreen_lines: list[Line] = Field(
        default_factory=list, description="Silkscreen lines"
    )
    model_3d: Optional[Model3D] = Field(
        default=None, description="3D model reference"
    )

    model_config = {"arbitrary_types_allowed": True}

    def get_pad(self, number: str) -> Optional[Pad]:
        """Find a pad by its number."""
        for pad in self.pads:
            if pad.number == number:
                return pad
        return None


class ZoneFillType(str, Enum):
    """Zone fill strategy."""

    SOLID = "solid"
    HATCHED = "hatched"
    NONE = "none"


class ThermalRelief(BaseModel):
    """Thermal relief parameters for zone-to-pad connections."""

    gap: Length = Field(
        default_factory=lambda: Length.from_mm(0.5), description="Gap width"
    )
    bridge_width: Length = Field(
        default_factory=lambda: Length.from_mm(0.5), description="Thermal bridge width"
    )

    model_config = {"arbitrary_types_allowed": True}


class Zone(BaseModel):
    """A copper zone (fill area) on the PCB.

    Zones are large copper areas typically used for power planes or ground fills.
    """

    name: str = Field(default="", description="Zone name for identification")
    net_ref: Optional[str] = Field(default=None, description="Connected net name")
    layer: str = Field(default="F.Cu", description="Copper layer")
    polygon: Polygon = Field(
        default_factory=Polygon, description="Zone outline polygon"
    )
    fill_type: ZoneFillType = Field(
        default=ZoneFillType.SOLID, description="Fill type"
    )
    clearance: Length = Field(
        default_factory=lambda: Length.from_mm(0.3), description="Clearance to other copper"
    )
    min_width: Length = Field(
        default_factory=lambda: Length.from_mm(0.25), description="Minimum fill width"
    )
    priority: int = Field(default=0, description="Fill priority (higher fills first)")
    thermal_relief: Optional[ThermalRelief] = Field(
        default_factory=ThermalRelief, description="Thermal relief settings"
    )

    model_config = {"arbitrary_types_allowed": True}


class BoardOutline(BaseModel):
    """The physical outline of the PCB board.

    Defines the board edge and any internal cutouts.
    """

    polygon: Polygon = Field(description="Main board outline")
    cutouts: list[Polygon] = Field(
        default_factory=list, description="Internal cutout polygons"
    )

    model_config = {"arbitrary_types_allowed": True}


class BoardDesign(BaseModel):
    """Top-level physical board design container.

    Aggregates all physical elements that make up a complete PCB layout.
    """

    title: str = Field(default="Untitled", description="Board design title")
    footprints: list[Footprint] = Field(
        default_factory=list, description="All placed footprints"
    )
    traces: list[TraceSegment] = Field(
        default_factory=list, description="All routed trace segments"
    )
    vias: list[Via] = Field(default_factory=list, description="All vias")
    zones: list[Zone] = Field(default_factory=list, description="All copper zones")
    outline: Optional[BoardOutline] = Field(
        default=None, description="Board outline with cutouts"
    )
    stackup: Optional[StackUp] = Field(
        default=None, description="Board layer stackup"
    )
    design_rules: Optional[DesignRules] = Field(
        default=None, description="Design rule constraints"
    )
    nets: list[str] = Field(
        default_factory=list, description="List of net names in the design"
    )
    net_classes: list[NetClass] = Field(
        default_factory=list, description="Net class definitions"
    )

    model_config = {"arbitrary_types_allowed": True}

    def get_footprint(self, reference: str) -> Optional[Footprint]:
        """Find a footprint by reference designator."""
        for fp in self.footprints:
            if fp.reference == reference:
                return fp
        return None

    @property
    def footprint_count(self) -> int:
        """Total number of placed footprints."""
        return len(self.footprints)

    @property
    def via_count(self) -> int:
        """Total number of vias."""
        return len(self.vias)

    @property
    def trace_count(self) -> int:
        """Total number of trace segments."""
        return len(self.traces)
