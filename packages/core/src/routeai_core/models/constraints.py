"""Constraint models for PCB design rules.

Defines net classes, differential pairs, length matching groups, keepout zones,
and general design rule constraints.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from routeai_core.geometry import Polygon
from routeai_core.units import Length


class NetClass(BaseModel):
    """A net class defining design rules for a group of nets.

    Net classes allow different electrical constraints to be applied
    to different groups of nets (e.g., power vs signal).
    """

    name: str = Field(description="Net class name (e.g. 'Default', 'Power', 'HighSpeed')")
    clearance: Length = Field(
        default_factory=lambda: Length.from_mm(0.2), description="Minimum clearance to other copper"
    )
    trace_width: Length = Field(
        default_factory=lambda: Length.from_mm(0.25), description="Default trace width"
    )
    via_drill: Length = Field(
        default_factory=lambda: Length.from_mm(0.3), description="Default via drill diameter"
    )
    via_size: Length = Field(
        default_factory=lambda: Length.from_mm(0.6), description="Default via annular ring outer diameter"
    )
    diff_pair_width: Optional[Length] = Field(
        default=None, description="Differential pair trace width"
    )
    diff_pair_gap: Optional[Length] = Field(
        default=None, description="Differential pair gap"
    )
    nets: list[str] = Field(
        default_factory=list, description="Net names belonging to this class"
    )

    model_config = {"arbitrary_types_allowed": True}


class DiffPair(BaseModel):
    """A differential pair definition.

    Defines two complementary nets that should be routed as a differential pair
    with matched length and controlled impedance.
    """

    name: str = Field(description="Differential pair name (e.g. 'USB_D')")
    positive_net: str = Field(description="Positive signal net name (e.g. 'USB_D+')")
    negative_net: str = Field(description="Negative signal net name (e.g. 'USB_D-')")
    impedance_target: Optional[float] = Field(
        default=None, description="Target differential impedance in ohms"
    )
    max_skew: Optional[Length] = Field(
        default=None, description="Maximum length skew between positive and negative"
    )
    gap: Optional[Length] = Field(
        default=None, description="Gap between differential traces"
    )
    width: Optional[Length] = Field(
        default=None, description="Trace width for differential pair"
    )

    model_config = {"arbitrary_types_allowed": True}


class LengthGroup(BaseModel):
    """A length matching group for timing-critical signals.

    Groups nets that must be routed to a similar or specific length,
    such as DDR data bus signals.
    """

    name: str = Field(description="Group name (e.g. 'DDR4_DQ0')")
    nets: list[str] = Field(default_factory=list, description="Net names in this group")
    target_length: Optional[Length] = Field(
        default=None, description="Target trace length; if None, match to longest"
    )
    tolerance: Length = Field(
        default_factory=lambda: Length.from_mm(1.0),
        description="Allowed deviation from target length",
    )
    priority: int = Field(
        default=0, description="Matching priority (higher = more important)"
    )

    model_config = {"arbitrary_types_allowed": True}


class KeepOut(BaseModel):
    """A keepout zone restricting copper placement.

    Keepout zones prevent routing or copper fill within a defined area
    on specific layers.
    """

    name: str = Field(default="", description="Keepout zone name")
    layer: str = Field(default="F.Cu", description="Layer or 'All' for all layers")
    polygon: Polygon = Field(
        default_factory=Polygon, description="Keepout zone boundary"
    )
    no_tracks: bool = Field(
        default=True, description="Disallow tracks in this zone"
    )
    no_vias: bool = Field(
        default=True, description="Disallow vias in this zone"
    )
    no_copper: bool = Field(
        default=True, description="Disallow copper fill in this zone"
    )

    model_config = {"arbitrary_types_allowed": True}


class DesignRules(BaseModel):
    """Global design rule constraints for the board.

    These are the minimum manufacturing capabilities that the design
    must respect.
    """

    min_clearance: Length = Field(
        default_factory=lambda: Length.from_mm(0.15),
        description="Minimum copper-to-copper clearance",
    )
    min_trace_width: Length = Field(
        default_factory=lambda: Length.from_mm(0.15),
        description="Minimum trace width",
    )
    min_via_drill: Length = Field(
        default_factory=lambda: Length.from_mm(0.2),
        description="Minimum via drill diameter",
    )
    min_via_size: Length = Field(
        default_factory=lambda: Length.from_mm(0.45),
        description="Minimum via outer diameter",
    )
    min_annular_ring: Length = Field(
        default_factory=lambda: Length.from_mm(0.125),
        description="Minimum annular ring width",
    )
    min_drill: Length = Field(
        default_factory=lambda: Length.from_mm(0.2),
        description="Minimum drill diameter (any hole)",
    )
    board_edge_clearance: Length = Field(
        default_factory=lambda: Length.from_mm(0.25),
        description="Minimum clearance from board edge",
    )
    silk_clearance: Length = Field(
        default_factory=lambda: Length.from_mm(0.15),
        description="Minimum clearance for silkscreen to pads",
    )

    model_config = {"arbitrary_types_allowed": True}
