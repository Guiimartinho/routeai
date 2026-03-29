"""Board data model for the solver package.

Defines all PCB design entities needed by DRC, physics, and constraint solvers.
All dimensions are in millimeters internally, consistent with routeai_core.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from shapely.geometry import (
    LineString,
    MultiPolygon,
    Point as ShapelyPoint,
    Polygon as ShapelyPolygon,
)
from shapely.ops import unary_union


class LayerType(Enum):
    """Type of PCB layer."""

    COPPER = "copper"
    DIELECTRIC = "dielectric"
    SOLDER_MASK = "solder_mask"
    SILK_SCREEN = "silk_screen"
    PASTE = "paste"
    COURTYARD = "courtyard"
    EDGE_CUTS = "edge_cuts"


class PadShape(Enum):
    """Shape of a pad."""

    CIRCLE = "circle"
    RECT = "rect"
    OVAL = "oval"
    ROUNDRECT = "roundrect"
    CUSTOM = "custom"


class DRCSeverity(Enum):
    """Severity levels for DRC violations -- duplicated here for model access."""

    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class Layer:
    """A PCB layer definition."""

    name: str
    layer_type: LayerType
    index: int = 0

    def __hash__(self) -> int:
        return hash((self.name, self.index))

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Layer):
            return NotImplemented
        return self.name == other.name and self.index == other.index


@dataclass
class StackupLayer:
    """A layer in the PCB stackup with physical properties."""

    layer: Layer
    thickness_mm: float  # layer thickness in mm
    dielectric_constant: float = 1.0  # relative permittivity (er)
    loss_tangent: float = 0.0
    material: str = ""


@dataclass
class Net:
    """An electrical net."""

    name: str
    id: int = 0

    def __hash__(self) -> int:
        return hash(self.name)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Net):
            return NotImplemented
        return self.name == other.name


@dataclass
class TraceSegment:
    """A single segment of a trace (straight line between two points)."""

    start_x: float  # mm
    start_y: float  # mm
    end_x: float  # mm
    end_y: float  # mm
    width: float  # mm

    @property
    def length(self) -> float:
        """Length of the segment in mm."""
        dx = self.end_x - self.start_x
        dy = self.end_y - self.start_y
        return math.sqrt(dx * dx + dy * dy)

    def to_shapely(self) -> ShapelyPolygon:
        """Convert to Shapely polygon representing the copper area (buffered line)."""
        line = LineString([(self.start_x, self.start_y), (self.end_x, self.end_y)])
        return line.buffer(self.width / 2.0, cap_style="round")

    def to_line(self) -> LineString:
        """Convert to Shapely LineString (centerline)."""
        return LineString([(self.start_x, self.start_y), (self.end_x, self.end_y)])

    @property
    def start(self) -> tuple[float, float]:
        return (self.start_x, self.start_y)

    @property
    def end(self) -> tuple[float, float]:
        return (self.end_x, self.end_y)


@dataclass
class Trace:
    """A trace (route) consisting of one or more segments on a layer."""

    net: Net
    layer: Layer
    segments: list[TraceSegment] = field(default_factory=list)

    @property
    def total_length(self) -> float:
        """Total length of the trace in mm."""
        return sum(seg.length for seg in self.segments)

    @property
    def width(self) -> float:
        """Width of the trace (from first segment)."""
        if self.segments:
            return self.segments[0].width
        return 0.0

    def to_shapely(self) -> ShapelyPolygon | MultiPolygon:
        """Return the union of all segment copper areas."""
        polys = [seg.to_shapely() for seg in self.segments]
        if not polys:
            return ShapelyPolygon()
        return unary_union(polys)

    def endpoints(self) -> list[tuple[float, float]]:
        """Return all unique start/end points."""
        pts: set[tuple[float, float]] = set()
        for seg in self.segments:
            pts.add((round(seg.start_x, 6), round(seg.start_y, 6)))
            pts.add((round(seg.end_x, 6), round(seg.end_y, 6)))
        return list(pts)


@dataclass
class Pad:
    """A component pad."""

    net: Net
    layer: Layer
    x: float  # mm - center position
    y: float  # mm
    shape: PadShape = PadShape.CIRCLE
    width: float = 1.0  # mm - pad width (or diameter for circle)
    height: float = 1.0  # mm - pad height (same as width for circle)
    drill: float = 0.0  # mm - drill diameter (0 = SMD pad)
    rotation: float = 0.0  # degrees
    corner_radius_ratio: float = 0.25  # for roundrect
    component_ref: str = ""  # reference designator
    pad_number: str = ""  # pad number/name

    @property
    def is_through_hole(self) -> bool:
        return self.drill > 0.0

    @property
    def annular_ring(self) -> float:
        """Annular ring width in mm (minimum of x and y annular rings)."""
        if self.drill <= 0.0:
            return 0.0
        ring_x = (self.width - self.drill) / 2.0
        ring_y = (self.height - self.drill) / 2.0
        return min(ring_x, ring_y)

    def to_shapely(self) -> ShapelyPolygon:
        """Convert pad to Shapely polygon representing its copper area."""
        if self.shape == PadShape.CIRCLE:
            return ShapelyPoint(self.x, self.y).buffer(self.width / 2.0, resolution=32)
        elif self.shape == PadShape.RECT:
            hw = self.width / 2.0
            hh = self.height / 2.0
            poly = ShapelyPolygon([
                (self.x - hw, self.y - hh),
                (self.x + hw, self.y - hh),
                (self.x + hw, self.y + hh),
                (self.x - hw, self.y + hh),
            ])
            if self.rotation != 0.0:
                from shapely.affinity import rotate
                poly = rotate(poly, self.rotation, origin=(self.x, self.y))
            return poly
        elif self.shape == PadShape.OVAL:
            # Oval is a rectangle with fully rounded ends (stadium shape)
            hw = self.width / 2.0
            hh = self.height / 2.0
            if self.width >= self.height:
                # Horizontal oval: line along x, buffer by half-height
                line = LineString([
                    (self.x - hw + hh, self.y),
                    (self.x + hw - hh, self.y),
                ])
                poly = line.buffer(hh, cap_style="round", resolution=32)
            else:
                # Vertical oval: line along y, buffer by half-width
                line = LineString([
                    (self.x, self.y - hh + hw),
                    (self.x, self.y + hh - hw),
                ])
                poly = line.buffer(hw, cap_style="round", resolution=32)
            if self.rotation != 0.0:
                from shapely.affinity import rotate
                poly = rotate(poly, self.rotation, origin=(self.x, self.y))
            return poly
        elif self.shape == PadShape.ROUNDRECT:
            hw = self.width / 2.0
            hh = self.height / 2.0
            min_dim = min(self.width, self.height)
            corner_r = self.corner_radius_ratio * min_dim / 2.0
            # Create inner rectangle and buffer with corner radius
            inner_hw = hw - corner_r
            inner_hh = hh - corner_r
            if inner_hw <= 0 or inner_hh <= 0:
                # Degenerate case: just return a circle
                return ShapelyPoint(self.x, self.y).buffer(
                    min(hw, hh), resolution=32
                )
            inner_rect = ShapelyPolygon([
                (self.x - inner_hw, self.y - inner_hh),
                (self.x + inner_hw, self.y - inner_hh),
                (self.x + inner_hw, self.y + inner_hh),
                (self.x - inner_hw, self.y + inner_hh),
            ])
            poly = inner_rect.buffer(corner_r, resolution=16)
            if self.rotation != 0.0:
                from shapely.affinity import rotate
                poly = rotate(poly, self.rotation, origin=(self.x, self.y))
            return poly
        else:
            # Fallback: circle
            return ShapelyPoint(self.x, self.y).buffer(self.width / 2.0, resolution=32)

    @property
    def position(self) -> tuple[float, float]:
        return (self.x, self.y)


@dataclass
class Via:
    """A via connecting layers."""

    net: Net
    x: float  # mm
    y: float  # mm
    drill: float  # mm - drill diameter
    diameter: float  # mm - pad diameter (annular ring)
    start_layer: Layer = field(default_factory=lambda: Layer("F.Cu", LayerType.COPPER))
    end_layer: Layer = field(default_factory=lambda: Layer("B.Cu", LayerType.COPPER))

    @property
    def annular_ring(self) -> float:
        return (self.diameter - self.drill) / 2.0

    def to_shapely(self) -> ShapelyPolygon:
        """Via pad copper area."""
        return ShapelyPoint(self.x, self.y).buffer(self.diameter / 2.0, resolution=32)

    @property
    def position(self) -> tuple[float, float]:
        return (self.x, self.y)


@dataclass
class DrillHole:
    """A non-plated drill hole (mounting hole, etc.)."""

    x: float  # mm
    y: float  # mm
    diameter: float  # mm
    plated: bool = False


@dataclass
class CopperZone:
    """A copper fill zone (pour)."""

    net: Net
    layer: Layer
    polygon: ShapelyPolygon = field(default_factory=ShapelyPolygon)
    clearance: float = 0.2  # mm - zone clearance

    def to_shapely(self) -> ShapelyPolygon:
        return self.polygon


@dataclass
class DesignRules:
    """Design rules / constraints for the board."""

    min_trace_width: float = 0.15  # mm
    min_clearance: float = 0.15  # mm
    min_annular_ring: float = 0.13  # mm
    min_drill: float = 0.2  # mm
    min_via_drill: float = 0.2  # mm
    min_via_diameter: float = 0.45  # mm
    board_edge_clearance: float = 0.25  # mm
    solder_mask_expansion: float = 0.05  # mm
    min_solder_mask_bridge: float = 0.1  # mm
    drill_to_copper_clearance: float = 0.2  # mm


@dataclass
class DiffPair:
    """A differential pair definition."""

    name: str
    positive_net: Net
    negative_net: Net
    target_impedance: float = 100.0  # ohms
    max_skew: float = 0.1  # mm


@dataclass
class LengthGroup:
    """A group of nets that must be length-matched."""

    name: str
    nets: list[str] = field(default_factory=list)
    target_length: Optional[float] = None  # mm, None = match to longest
    tolerance: float = 0.5  # mm


@dataclass
class BoardDesign:
    """Complete PCB board design representation for solver operations."""

    name: str = "Untitled"
    traces: list[Trace] = field(default_factory=list)
    pads: list[Pad] = field(default_factory=list)
    vias: list[Via] = field(default_factory=list)
    zones: list[CopperZone] = field(default_factory=list)
    drills: list[DrillHole] = field(default_factory=list)
    nets: list[Net] = field(default_factory=list)
    layers: list[Layer] = field(default_factory=list)
    stackup: list[StackupLayer] = field(default_factory=list)
    design_rules: DesignRules = field(default_factory=DesignRules)
    outline: Optional[ShapelyPolygon] = None  # board edge polygon
    diff_pairs: list[DiffPair] = field(default_factory=list)
    length_groups: list[LengthGroup] = field(default_factory=list)

    def get_net(self, name: str) -> Optional[Net]:
        """Find a net by name."""
        for net in self.nets:
            if net.name == name:
                return net
        return None

    def traces_on_layer(self, layer: Layer) -> list[Trace]:
        """Return all traces on a given layer."""
        return [t for t in self.traces if t.layer == layer]

    def pads_on_layer(self, layer: Layer) -> list[Pad]:
        """Return all pads on a given layer."""
        return [p for p in self.pads if p.layer == layer]

    def pads_in_net(self, net: Net) -> list[Pad]:
        """Return all pads belonging to a given net."""
        return [p for p in self.pads if p.net == net]

    def traces_in_net(self, net: Net) -> list[Trace]:
        """Return all traces belonging to a given net."""
        return [t for t in self.traces if t.net == net]

    def vias_in_net(self, net: Net) -> list[Via]:
        """Return all vias belonging to a given net."""
        return [v for v in self.vias if v.net == net]

    def copper_layers(self) -> list[Layer]:
        """Return only copper layers."""
        return [l for l in self.layers if l.layer_type == LayerType.COPPER]
