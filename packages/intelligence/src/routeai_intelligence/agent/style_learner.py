"""Routing Style Learner — extracts routing style from existing boards.

Accepts a parsed ``BoardDesign`` (from ``routeai_parsers.models``) **or** a
plain dict with the same structure and produces a ``RoutingStyleProfile``
containing purely statistical features.  No LLM is required for extraction;
an optional ``generate_summary()`` method uses the LLM router to produce a
short human-readable description of the style.

100 % local, 100 % deterministic (except the optional summary).
"""

from __future__ import annotations

import logging
import math
from collections import Counter, defaultdict
from typing import TYPE_CHECKING, Any

from routeai_intelligence.agent.style_profile import RoutingStyleProfile

if TYPE_CHECKING:
    from routeai_intelligence.llm.router import LLMRouter

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers to normalise access — works with both Pydantic models and dicts
# ---------------------------------------------------------------------------

def _attr(obj: Any, key: str, default: Any = None) -> Any:
    """Get *key* from an object (attribute) or dict (key)."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _point_xy(point: Any) -> tuple[float, float]:
    """Extract (x, y) from a Point2D / dict / None."""
    if point is None:
        return (0.0, 0.0)
    x = _attr(point, "x", 0.0)
    y = _attr(point, "y", 0.0)
    return (float(x), float(y))


# ---------------------------------------------------------------------------
# StyleLearner
# ---------------------------------------------------------------------------

class StyleLearner:
    """Extracts ``RoutingStyleProfile`` from a parsed board.

    Parameters
    ----------
    llm_router:
        Optional ``LLMRouter`` instance.  Only needed if you want to call
        ``generate_summary()``.
    """

    def __init__(self, llm_router: LLMRouter | None = None) -> None:
        self._router = llm_router

    # ------------------------------------------------------------------
    # Main extraction — pure Python, no LLM
    # ------------------------------------------------------------------

    def extract_profile(self, board: Any) -> RoutingStyleProfile:
        """Extract a statistical profile from *board*.

        *board* can be a ``routeai_parsers.models.BoardDesign`` instance or a
        plain ``dict`` with equivalent keys (``segments``/``traces``, ``vias``,
        ``nets``, ``footprints``, ``net_classes``, etc.).

        All calculations are deterministic — no LLM involved.
        """
        profile = RoutingStyleProfile()

        # ---- Resolve field names (parser model uses "segments", dict may use "traces")
        segments = _attr(board, "segments", None) or _attr(board, "traces", [])
        vias = _attr(board, "vias", []) or []
        nets_raw = _attr(board, "nets", []) or []
        net_classes = _attr(board, "net_classes", []) or []
        footprints = _attr(board, "footprints", _attr(board, "components", [])) or []
        arcs = _attr(board, "arcs", []) or []

        # Net names list — parser uses Net objects with .name, dicts use strings
        net_names: list[str] = []
        for n in nets_raw:
            name = _attr(n, "name", n) if not isinstance(n, str) else n
            if name:
                net_names.append(str(name))

        profile.board_name = str(_attr(board, "title", _attr(board, "board_name", "")))
        profile.net_count = len(net_names)
        profile.trace_count = len(segments) + len(arcs)
        profile.via_count = len(vias)

        # ---- 1. Trace width histogram ----
        widths: list[float] = []
        for seg in segments:
            w = float(_attr(seg, "width", 0.25))
            widths.append(round(w, 3))
        profile.trace_width_histogram = dict(Counter(widths))

        # ---- 2. Trace width by net class ----
        for nc in net_classes:
            nc_name = str(_attr(nc, "name", "Default"))
            nc_width = float(_attr(nc, "trace_width", 0.25))
            profile.trace_width_by_net_class[nc_name] = nc_width

        # ---- 3. Average segment length ----
        lengths: list[float] = []
        for seg in segments:
            sx, sy = _point_xy(_attr(seg, "start"))
            ex, ey = _point_xy(_attr(seg, "end"))
            dx = ex - sx
            dy = ey - sy
            length = math.sqrt(dx * dx + dy * dy)
            if length > 0.0:
                lengths.append(length)
        profile.avg_segment_length_mm = (
            sum(lengths) / len(lengths) if lengths else 0.0
        )

        # ---- 4. Via statistics ----
        via_type_counter: Counter[str] = Counter()
        for v in vias:
            vtype = str(_attr(v, "via_type", _attr(v, "type", "")) or "")
            # Normalise: empty / "through" -> "through"
            if vtype in ("", "through", "THROUGH"):
                vtype = "through"
            elif vtype in ("blind", "BLIND"):
                vtype = "blind"
            elif vtype in ("buried", "BURIED"):
                vtype = "buried"
            elif vtype in ("micro", "MICRO"):
                vtype = "micro"
            via_type_counter[vtype] += 1

        total_vias = sum(via_type_counter.values()) or 1
        profile.via_types_ratio = {
            k: round(v / total_vias, 4) for k, v in via_type_counter.items()
        }
        profile.avg_vias_per_net = (
            len(vias) / max(profile.net_count, 1)
        )

        # ---- 5. Preferred angles ----
        angle_buckets: Counter[int] = Counter()
        for seg in segments:
            sx, sy = _point_xy(_attr(seg, "start"))
            ex, ey = _point_xy(_attr(seg, "end"))
            dx = ex - sx
            dy = ey - sy
            if abs(dx) < 0.001 and abs(dy) < 0.001:
                continue
            angle_deg = abs(math.degrees(math.atan2(dy, dx))) % 90
            if angle_deg < 15:
                angle_buckets[0] += 1
            elif 30 < angle_deg < 60:
                angle_buckets[45] += 1
            else:
                angle_buckets[90] += 1
        profile.preferred_angles = sorted(
            angle_buckets.keys(),
            key=lambda a: angle_buckets[a],
            reverse=True,
        )

        # ---- 6. Manhattan ratio ----
        ratios: list[float] = []
        for seg in segments:
            sx, sy = _point_xy(_attr(seg, "start"))
            ex, ey = _point_xy(_attr(seg, "end"))
            dx = ex - sx
            dy = ey - sy
            manhattan = abs(dx) + abs(dy)
            actual = math.sqrt(dx * dx + dy * dy)
            if manhattan > 0.001:
                ratios.append(actual / manhattan)
        profile.manhattan_ratio = (
            round(sum(ratios) / len(ratios), 4) if ratios else 1.0
        )

        # ---- 7. Layer utilisation ----
        layer_counter: Counter[str] = Counter()
        for seg in segments:
            layer_counter[str(_attr(seg, "layer", "unknown"))] += 1
        for a in arcs:
            layer_counter[str(_attr(a, "layer", "unknown"))] += 1
        total_on_layers = sum(layer_counter.values()) or 1
        profile.layer_utilization = {
            k: round(v / total_on_layers, 4) for k, v in layer_counter.items()
        }
        profile.layer_count = len(set(layer_counter.keys()))

        # ---- 8. Layer transitions per net ----
        net_layers: dict[int, set[str]] = defaultdict(set)
        for seg in segments:
            net_id = _attr(seg, "net", _attr(seg, "net_ref", 0))
            layer = str(_attr(seg, "layer", ""))
            if net_id and layer:
                net_layers[net_id].add(layer)
        if net_layers:
            transitions = [max(len(layers) - 1, 0) for layers in net_layers.values()]
            profile.avg_layer_transitions_per_net = round(
                sum(transitions) / len(transitions), 2
            )

        # ---- 9. Board area from outline ----
        profile.board_area_mm2 = self._estimate_board_area(board, footprints)
        if profile.board_area_mm2 > 0:
            area_cm2 = profile.board_area_mm2 / 100.0
            profile.via_density_per_cm2 = round(len(vias) / max(area_cm2, 0.01), 2)

        # ---- 10. Spacing from design rules / net classes ----
        dr = _attr(board, "design_rules", None)
        if dr is not None:
            profile.min_clearance_mm = float(_attr(dr, "min_clearance", 0.0))
        if net_classes:
            clearances = [float(_attr(nc, "clearance", 0.0)) for nc in net_classes]
            profile.avg_clearance_mm = round(
                sum(clearances) / len(clearances), 4
            ) if clearances else 0.0

        # ---- 11. Diff pair gap ratio ----
        for nc in net_classes:
            dp_gap = float(_attr(nc, "diff_pair_gap", 0.0))
            dp_width = float(_attr(nc, "diff_pair_width", 0.0))
            if dp_width > 0:
                profile.diff_pair_gap_ratio = round(dp_gap / dp_width, 3)
                break  # use first net class that defines diff pair

        return profile

    # ------------------------------------------------------------------
    # Board area estimation
    # ------------------------------------------------------------------

    @staticmethod
    def _estimate_board_area(board: Any, footprints: list[Any]) -> float:
        """Estimate board area in mm^2 from outline or component bounding box."""
        # Try Edge.Cuts graphical lines (KiCad board outline)
        gr_lines = _attr(board, "gr_lines", []) or []
        edge_xs: list[float] = []
        edge_ys: list[float] = []
        for line in gr_lines:
            layer = str(_attr(line, "layer", ""))
            if layer == "Edge.Cuts":
                sx, sy = _point_xy(_attr(line, "start"))
                ex, ey = _point_xy(_attr(line, "end"))
                edge_xs.extend([sx, ex])
                edge_ys.extend([sy, ey])

        # Also try gr_rects on Edge.Cuts
        gr_rects = _attr(board, "gr_rects", []) or []
        for rect in gr_rects:
            layer = str(_attr(rect, "layer", ""))
            if layer == "Edge.Cuts":
                sx, sy = _point_xy(_attr(rect, "start"))
                ex, ey = _point_xy(_attr(rect, "end"))
                edge_xs.extend([sx, ex])
                edge_ys.extend([sy, ey])

        if edge_xs and edge_ys:
            width = max(edge_xs) - min(edge_xs)
            height = max(edge_ys) - min(edge_ys)
            if width > 0 and height > 0:
                return round(width * height, 2)

        # Try explicit outline field (dict-based boards)
        outline = _attr(board, "outline", None)
        if outline:
            points = _attr(outline, "points", []) or []
            if points:
                xs = [float(_attr(p, "x", 0)) for p in points]
                ys = [float(_attr(p, "y", 0)) for p in points]
                if xs and ys:
                    return round((max(xs) - min(xs)) * (max(ys) - min(ys)), 2)

        # Fallback: bounding box of all footprint positions
        fp_xs: list[float] = []
        fp_ys: list[float] = []
        for fp in footprints:
            pos = _attr(fp, "at", _attr(fp, "position", None))
            if pos is not None:
                px, py = _point_xy(pos)
                fp_xs.append(px)
                fp_ys.append(py)
        if len(fp_xs) >= 2:
            width = max(fp_xs) - min(fp_xs)
            height = max(fp_ys) - min(fp_ys)
            if width > 0 and height > 0:
                # Add ~10 % margin to approximate board edge
                return round(width * height * 1.21, 2)

        return 0.0

    # ------------------------------------------------------------------
    # LLM-powered semantic summary (optional)
    # ------------------------------------------------------------------

    async def generate_summary(self, profile: RoutingStyleProfile) -> str:
        """Generate a semantic summary of the routing style using the LLM.

        Returns a 4-5 sentence technical description (~500 tokens).
        Falls back to a deterministic template if no LLM is available.
        """
        if not self._router:
            profile.summary = self._fallback_summary(profile)
            return profile.summary

        prompt = (
            "Summarize this PCB routing style in 4-5 sentences for an engineer:\n\n"
            f"Board: {profile.board_name}, {profile.net_count} nets, "
            f"{profile.layer_count} layers\n"
            f"Traces: {profile.trace_count} segments, "
            f"widths: {profile.trace_width_histogram}\n"
            f"Vias: {profile.via_count} ({profile.via_types_ratio})\n"
            f"Preferred angles: {profile.preferred_angles}\n"
            f"Manhattan ratio: {profile.manhattan_ratio:.2f}\n"
            f"Layer usage: {profile.layer_utilization}\n"
            f"Via density: {profile.via_density_per_cm2:.1f}/cm\u00b2\n\n"
            "Describe: routing philosophy (manhattan/diagonal?), layer strategy, "
            "via usage, density pattern."
        )

        try:
            response = await self._router.generate(
                messages=[{"role": "user", "content": prompt}],
                system="You are a PCB design analyst. Be concise and technical.",
                tools=[],
                task_type="routing_style_learner",
            )
            profile.summary = response.text.strip()
        except Exception:
            logger.warning("LLM summary generation failed, using fallback")
            profile.summary = self._fallback_summary(profile)

        return profile.summary

    # ------------------------------------------------------------------
    # Deterministic fallback summary
    # ------------------------------------------------------------------

    @staticmethod
    def _fallback_summary(profile: RoutingStyleProfile) -> str:
        """Generate a summary without an LLM."""
        # Routing philosophy
        if profile.preferred_angles:
            has_45 = 45 in profile.preferred_angles
            top_angle = profile.preferred_angles[0]
            if top_angle == 0 and not has_45:
                style = "Manhattan (0/90-degree)"
            elif has_45:
                style = "45-degree"
            else:
                style = "mixed-angle"
        else:
            style = "unknown"

        # Density
        if profile.via_density_per_cm2 > 10:
            density = "high-density"
        elif profile.via_density_per_cm2 > 5:
            density = "moderate-density"
        else:
            density = "low-density"

        # Primary layer
        primary_layer = "unknown"
        if profile.layer_utilization:
            primary_layer = max(
                profile.layer_utilization,
                key=profile.layer_utilization.get,  # type: ignore[arg-type]
            )

        parts = [
            f"{profile.layer_count}-layer board with {profile.net_count} nets.",
            f"{style} routing style (manhattan ratio {profile.manhattan_ratio:.2f}).",
            f"{density.capitalize()} via usage "
            f"({profile.via_density_per_cm2:.1f}/cm\u00b2, "
            f"{profile.via_count} total).",
            f"Primary routing layer: {primary_layer}.",
        ]
        if profile.trace_width_histogram:
            dominant_width = max(
                profile.trace_width_histogram,
                key=profile.trace_width_histogram.get,  # type: ignore[arg-type]
            )
            parts.append(
                f"Dominant trace width: {dominant_width} mm "
                f"({profile.trace_width_histogram[dominant_width]} segments)."
            )

        return " ".join(parts)
