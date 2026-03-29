"""Geometric primitives for PCB design.

Provides Point, Line, Arc, Polygon, and BoundingBox with boolean operations
powered by Shapely.
"""

from __future__ import annotations

import math
from typing import Optional

from pydantic import BaseModel, Field
from shapely.geometry import LineString as ShapelyLineString
from shapely.geometry import MultiPolygon as ShapelyMultiPolygon
from shapely.geometry import Point as ShapelyPoint
from shapely.geometry import Polygon as ShapelyPolygon

from routeai_core.units import Angle, Length


class Point(BaseModel):
    """A 2D point in PCB coordinate space.

    Coordinates are stored as Length values (internally in mm).
    """

    x: Length = Field(default_factory=lambda: Length.from_mm(0.0), description="X coordinate")
    y: Length = Field(default_factory=lambda: Length.from_mm(0.0), description="Y coordinate")

    model_config = {"arbitrary_types_allowed": True}

    def distance_to(self, other: Point) -> Length:
        """Compute Euclidean distance to another point."""
        dx = self.x.mm - other.x.mm
        dy = self.y.mm - other.y.mm
        return Length.from_mm(math.sqrt(dx * dx + dy * dy))

    def translate(self, dx: Length, dy: Length) -> Point:
        """Return a new point translated by (dx, dy)."""
        return Point(x=self.x + dx, y=self.y + dy)

    def rotate(self, angle: Angle, origin: Optional[Point] = None) -> Point:
        """Return a new point rotated around origin by the given angle.

        Args:
            angle: Rotation angle.
            origin: Center of rotation. Defaults to (0, 0).
        """
        if origin is None:
            origin = Point()
        rad = angle.radians
        cos_a = math.cos(rad)
        sin_a = math.sin(rad)
        dx = self.x.mm - origin.x.mm
        dy = self.y.mm - origin.y.mm
        new_x = cos_a * dx - sin_a * dy + origin.x.mm
        new_y = sin_a * dx + cos_a * dy + origin.y.mm
        return Point(x=Length.from_mm(new_x), y=Length.from_mm(new_y))

    def to_tuple(self) -> tuple[float, float]:
        """Return (x_mm, y_mm) tuple."""
        return (self.x.mm, self.y.mm)

    def to_shapely(self) -> ShapelyPoint:
        """Convert to a Shapely Point."""
        return ShapelyPoint(self.x.mm, self.y.mm)


class Line(BaseModel):
    """A line segment between two points."""

    start: Point = Field(description="Start point of the line")
    end: Point = Field(description="End point of the line")

    model_config = {"arbitrary_types_allowed": True}

    @property
    def length(self) -> Length:
        """Length of the line segment."""
        return self.start.distance_to(self.end)

    @property
    def midpoint(self) -> Point:
        """Midpoint of the line segment."""
        return Point(
            x=Length.from_mm((self.start.x.mm + self.end.x.mm) / 2.0),
            y=Length.from_mm((self.start.y.mm + self.end.y.mm) / 2.0),
        )

    def to_shapely(self) -> ShapelyLineString:
        """Convert to a Shapely LineString."""
        return ShapelyLineString([self.start.to_tuple(), self.end.to_tuple()])


class Arc(BaseModel):
    """A circular arc defined by center, radius, and angular extent."""

    center: Point = Field(description="Center of the arc")
    radius: Length = Field(description="Radius of the arc")
    start_angle: Angle = Field(default_factory=lambda: Angle(0.0), description="Start angle")
    end_angle: Angle = Field(default_factory=lambda: Angle(360.0), description="End angle")

    model_config = {"arbitrary_types_allowed": True}

    @property
    def sweep_angle(self) -> Angle:
        """Angular sweep of the arc."""
        return self.end_angle - self.start_angle

    @property
    def arc_length(self) -> Length:
        """Length of the arc along the curve."""
        sweep_rad = abs(self.sweep_angle.radians)
        return Length.from_mm(self.radius.mm * sweep_rad)

    def point_at_angle(self, angle: Angle) -> Point:
        """Return the point on the arc at the given angle."""
        rad = angle.radians
        x = self.center.x.mm + self.radius.mm * math.cos(rad)
        y = self.center.y.mm + self.radius.mm * math.sin(rad)
        return Point(x=Length.from_mm(x), y=Length.from_mm(y))

    def to_points(self, num_segments: int = 64) -> list[Point]:
        """Approximate the arc as a list of points.

        Args:
            num_segments: Number of line segments to approximate the arc.
        """
        start_rad = self.start_angle.radians
        end_rad = self.end_angle.radians
        points = []
        for i in range(num_segments + 1):
            t = i / num_segments
            angle_rad = start_rad + t * (end_rad - start_rad)
            x = self.center.x.mm + self.radius.mm * math.cos(angle_rad)
            y = self.center.y.mm + self.radius.mm * math.sin(angle_rad)
            points.append(Point(x=Length.from_mm(x), y=Length.from_mm(y)))
        return points


class Polygon(BaseModel):
    """A polygon defined by a list of vertices, with boolean operations via Shapely."""

    points: list[Point] = Field(default_factory=list, description="Vertices of the polygon")

    model_config = {"arbitrary_types_allowed": True}

    def to_shapely(self) -> ShapelyPolygon:
        """Convert to a Shapely Polygon."""
        coords = [p.to_tuple() for p in self.points]
        if len(coords) < 3:
            raise ValueError("Polygon requires at least 3 points")
        return ShapelyPolygon(coords)

    @classmethod
    def from_shapely(cls, shapely_poly: ShapelyPolygon) -> Polygon:
        """Create a Polygon from a Shapely Polygon.

        Args:
            shapely_poly: A Shapely Polygon object.
        """
        coords = list(shapely_poly.exterior.coords)
        # Shapely closes the ring; drop the duplicate last point
        if coords and coords[0] == coords[-1]:
            coords = coords[:-1]
        points = [Point(x=Length.from_mm(c[0]), y=Length.from_mm(c[1])) for c in coords]
        return cls(points=points)

    @property
    def area(self) -> float:
        """Area of the polygon in mm^2."""
        return self.to_shapely().area

    @property
    def perimeter(self) -> Length:
        """Perimeter of the polygon."""
        return Length.from_mm(self.to_shapely().length)

    @property
    def centroid(self) -> Point:
        """Centroid of the polygon."""
        c = self.to_shapely().centroid
        return Point(x=Length.from_mm(c.x), y=Length.from_mm(c.y))

    def contains_point(self, point: Point) -> bool:
        """Check if a point lies inside the polygon."""
        return self.to_shapely().contains(point.to_shapely())

    def union(self, other: Polygon) -> Polygon:
        """Boolean union with another polygon."""
        result = self.to_shapely().union(other.to_shapely())
        if isinstance(result, ShapelyMultiPolygon):
            # Return the largest polygon from the result
            result = max(result.geoms, key=lambda g: g.area)
        return Polygon.from_shapely(result)

    def intersection(self, other: Polygon) -> Polygon:
        """Boolean intersection with another polygon."""
        result = self.to_shapely().intersection(other.to_shapely())
        if result.is_empty:
            return Polygon(points=[])
        if isinstance(result, ShapelyMultiPolygon):
            result = max(result.geoms, key=lambda g: g.area)
        if not isinstance(result, ShapelyPolygon):
            return Polygon(points=[])
        return Polygon.from_shapely(result)

    def difference(self, other: Polygon) -> Polygon:
        """Boolean difference: self minus other."""
        result = self.to_shapely().difference(other.to_shapely())
        if result.is_empty:
            return Polygon(points=[])
        if isinstance(result, ShapelyMultiPolygon):
            result = max(result.geoms, key=lambda g: g.area)
        if not isinstance(result, ShapelyPolygon):
            return Polygon(points=[])
        return Polygon.from_shapely(result)

    def buffer(self, distance: Length) -> Polygon:
        """Expand or shrink the polygon by a distance.

        Positive distance expands, negative distance shrinks.
        """
        result = self.to_shapely().buffer(distance.mm)
        if isinstance(result, ShapelyMultiPolygon):
            result = max(result.geoms, key=lambda g: g.area)
        return Polygon.from_shapely(result)


class BoundingBox(BaseModel):
    """An axis-aligned bounding box."""

    min_x: Length = Field(description="Minimum X coordinate")
    min_y: Length = Field(description="Minimum Y coordinate")
    max_x: Length = Field(description="Maximum X coordinate")
    max_y: Length = Field(description="Maximum Y coordinate")

    model_config = {"arbitrary_types_allowed": True}

    @property
    def width(self) -> Length:
        """Width of the bounding box."""
        return self.max_x - self.min_x

    @property
    def height(self) -> Length:
        """Height of the bounding box."""
        return self.max_y - self.min_y

    @property
    def center(self) -> Point:
        """Center point of the bounding box."""
        return Point(
            x=Length.from_mm((self.min_x.mm + self.max_x.mm) / 2.0),
            y=Length.from_mm((self.min_y.mm + self.max_y.mm) / 2.0),
        )

    @property
    def area(self) -> float:
        """Area of the bounding box in mm^2."""
        return self.width.mm * self.height.mm

    def contains_point(self, point: Point) -> bool:
        """Check if a point is inside this bounding box."""
        return (
            self.min_x.mm <= point.x.mm <= self.max_x.mm
            and self.min_y.mm <= point.y.mm <= self.max_y.mm
        )

    def overlaps(self, other: BoundingBox) -> bool:
        """Check if this bounding box overlaps with another."""
        return not (
            self.max_x.mm < other.min_x.mm
            or self.min_x.mm > other.max_x.mm
            or self.max_y.mm < other.min_y.mm
            or self.min_y.mm > other.max_y.mm
        )

    def merge(self, other: BoundingBox) -> BoundingBox:
        """Return the smallest bounding box containing both."""
        return BoundingBox(
            min_x=Length.from_mm(min(self.min_x.mm, other.min_x.mm)),
            min_y=Length.from_mm(min(self.min_y.mm, other.min_y.mm)),
            max_x=Length.from_mm(max(self.max_x.mm, other.max_x.mm)),
            max_y=Length.from_mm(max(self.max_y.mm, other.max_y.mm)),
        )

    @classmethod
    def from_polygon(cls, polygon: Polygon) -> BoundingBox:
        """Compute the bounding box of a polygon."""
        if not polygon.points:
            raise ValueError("Cannot compute bounding box of empty polygon")
        xs = [p.x.mm for p in polygon.points]
        ys = [p.y.mm for p in polygon.points]
        return cls(
            min_x=Length.from_mm(min(xs)),
            min_y=Length.from_mm(min(ys)),
            max_x=Length.from_mm(max(xs)),
            max_y=Length.from_mm(max(ys)),
        )
