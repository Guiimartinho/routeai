#include "diff_pair_router.h"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace routeai {

DiffPairRouter::DiffPairRouter(RoutingGrid& grid) : grid_(grid) {}

std::vector<GridCoord> DiffPairRouter::offsetPath(const std::vector<GridCoord>& path,
                                                    int offset, int layer) const {
    // For each segment, compute a perpendicular offset.
    // Horizontal segments offset in Y, vertical segments offset in X.
    std::vector<GridCoord> result;
    result.reserve(path.size());

    for (std::size_t i = 0; i < path.size(); ++i) {
        GridCoord c = path[i];
        c.layer = layer;

        if (i + 1 < path.size()) {
            // Determine segment direction.
            int dx = path[i + 1].x - path[i].x;
            int dy = path[i + 1].y - path[i].y;
            if (dx != 0) {
                // Horizontal segment -> offset in Y.
                c.y += offset;
            } else if (dy != 0) {
                // Vertical segment -> offset in X.
                c.x += offset;
            } else {
                // Via or same point -> use previous direction or just offset Y.
                c.y += offset;
            }
        } else if (i > 0) {
            // Last point: use direction from previous segment.
            int dx = path[i].x - path[i - 1].x;
            int dy = path[i].y - path[i - 1].y;
            if (dx != 0) {
                c.y += offset;
            } else {
                c.x += offset;
            }
        }

        // Clamp to grid bounds.
        c.x = std::clamp(c.x, 0, grid_.width() - 1);
        c.y = std::clamp(c.y, 0, grid_.height() - 1);
        result.push_back(c);
    }

    return result;
}

std::vector<GridCoord> DiffPairRouter::addMeanders(const std::vector<GridCoord>& path,
                                                     double target_length, int net_id) {
    double current_length = static_cast<double>(path.size() - 1);
    double deficit = target_length - current_length;
    if (deficit <= 2.0) return path;  // Already close enough.

    std::vector<GridCoord> result;
    result.reserve(path.size() + static_cast<std::size_t>(deficit));

    // Insert meander patterns into straight segments.
    // A meander of amplitude A adds 2*A to length per insertion.
    int amplitude = std::min(max_meander_amp_, static_cast<int>(std::ceil(deficit / 4.0)));
    amplitude = std::max(1, amplitude);
    double added = 0.0;

    for (std::size_t i = 0; i < path.size(); ++i) {
        result.push_back(path[i]);

        if (added >= deficit) continue;
        if (i + 1 >= path.size()) continue;

        int dx = path[i + 1].x - path[i].x;
        int dy = path[i + 1].y - path[i].y;

        // Only meander along straight horizontal or vertical segments of sufficient length.
        bool horizontal = (dy == 0 && std::abs(dx) >= 2);
        bool vertical   = (dx == 0 && std::abs(dy) >= 2);

        if (horizontal && added < deficit) {
            // Insert a vertical jog: up, across, down (or vice versa).
            int sign_x = (dx > 0) ? 1 : -1;
            GridCoord cur = path[i];

            // Check there's room for the meander.
            int jog_y = cur.y + amplitude;
            if (jog_y >= grid_.height()) jog_y = cur.y - amplitude;
            if (jog_y < 0) continue;  // Can't meander here.

            bool blocked = false;
            // Go up/down.
            int step_y = (jog_y > cur.y) ? 1 : -1;
            for (int y = cur.y + step_y; y != jog_y + step_y; y += step_y) {
                GridCoord c{cur.x, y, cur.layer};
                if (grid_.isBlocked(c)) { blocked = true; break; }
                result.push_back(c);
            }
            if (blocked) continue;

            // Go forward one cell.
            GridCoord mid{cur.x + sign_x, jog_y, cur.layer};
            if (!grid_.isBlocked(mid)) {
                result.push_back(mid);
                // Go back down/up.
                for (int y = jog_y - step_y; y != cur.y; y -= step_y) {
                    GridCoord c{mid.x, y, cur.layer};
                    if (grid_.isBlocked(c)) { blocked = true; break; }
                    result.push_back(c);
                }
                if (!blocked) {
                    added += 2.0 * std::abs(amplitude);
                }
            }
        } else if (vertical && added < deficit) {
            int sign_y = (dy > 0) ? 1 : -1;
            GridCoord cur = path[i];

            int jog_x = cur.x + amplitude;
            if (jog_x >= grid_.width()) jog_x = cur.x - amplitude;
            if (jog_x < 0) continue;

            bool blocked = false;
            int step_x = (jog_x > cur.x) ? 1 : -1;
            for (int x = cur.x + step_x; x != jog_x + step_x; x += step_x) {
                GridCoord c{x, cur.y, cur.layer};
                if (grid_.isBlocked(c)) { blocked = true; break; }
                result.push_back(c);
            }
            if (blocked) continue;

            GridCoord mid{jog_x, cur.y + sign_y, cur.layer};
            if (!grid_.isBlocked(mid)) {
                result.push_back(mid);
                for (int x = jog_x - step_x; x != cur.x; x -= step_x) {
                    GridCoord c{x, mid.y, cur.layer};
                    if (grid_.isBlocked(c)) { blocked = true; break; }
                    result.push_back(c);
                }
                if (!blocked) {
                    added += 2.0 * std::abs(amplitude);
                }
            }
        }
    }

    return result;
}

DiffPairResult DiffPairRouter::route(int pos_net_id, int neg_net_id,
                                      const std::vector<GridCoord>& pos_starts,
                                      const std::vector<GridCoord>& pos_ends,
                                      const std::vector<GridCoord>& neg_starts,
                                      const std::vector<GridCoord>& neg_ends,
                                      int gap,
                                      double impedance_target,
                                      CouplingMode mode)
{
    DiffPairResult result;

    // ── Step 1: Route the positive net using A* ──────────────────────────────
    AStarRouter astar(grid_);
    auto pos_res = astar.route(pos_net_id, pos_starts, pos_ends);

    if (!pos_res.success) {
        result.error = "failed to route positive net: " + pos_res.error;
        return result;
    }

    // ── Step 2: Derive the negative net path ─────────────────────────────────
    if (mode == CouplingMode::EDGE_COUPLED) {
        // Offset the positive path laterally by 'gap' cells.
        int layer = pos_res.path.empty() ? 0 : pos_res.path.front().layer;
        auto neg_path = offsetPath(pos_res.path, gap, layer);

        // Verify the offset path is clear.
        bool path_clear = true;
        for (auto& c : neg_path) {
            if (grid_.isBlocked(c)) {
                // Try the other side.
                path_clear = false;
                break;
            }
        }

        if (!path_clear) {
            // Try negative offset.
            neg_path = offsetPath(pos_res.path, -gap, layer);
            path_clear = true;
            for (auto& c : neg_path) {
                if (grid_.isBlocked(c)) {
                    path_clear = false;
                    break;
                }
            }
        }

        if (!path_clear) {
            // Fall back to independent routing for negative net.
            auto neg_res = astar.route(neg_net_id, neg_starts, neg_ends);
            if (!neg_res.success) {
                result.error = "failed to route negative net independently";
                return result;
            }
            result.neg_path = std::move(neg_res.path);
            result.neg_vias = std::move(neg_res.vias);
            result.neg_length = neg_res.wire_length;
        } else {
            // Mark the offset path.
            for (auto& c : neg_path) {
                grid_.markTrace(c, neg_net_id);
            }
            result.neg_path = std::move(neg_path);
            result.neg_length = static_cast<double>(result.neg_path.size() - 1);
        }

    } else {
        // Broadside coupled: route on adjacent layer.
        int adj_layer = pos_res.path.empty() ? 1 : pos_res.path.front().layer + 1;
        if (adj_layer >= grid_.numLayers()) adj_layer = pos_res.path.front().layer - 1;
        if (adj_layer < 0) {
            result.error = "no adjacent layer for broadside coupling";
            return result;
        }

        // Create starts/ends projected to adjacent layer.
        auto project = [adj_layer](const std::vector<GridCoord>& coords) {
            std::vector<GridCoord> out;
            out.reserve(coords.size());
            for (auto c : coords) { c.layer = adj_layer; out.push_back(c); }
            return out;
        };

        auto neg_res = astar.route(neg_net_id, project(neg_starts), project(neg_ends));
        if (!neg_res.success) {
            result.error = "failed to route negative net on adjacent layer";
            return result;
        }
        result.neg_path = std::move(neg_res.path);
        result.neg_vias = std::move(neg_res.vias);
        result.neg_length = neg_res.wire_length;
    }

    result.pos_path = std::move(pos_res.path);
    result.pos_vias = std::move(pos_res.vias);
    result.pos_length = pos_res.wire_length;

    // ── Step 3: Phase tuning ─────────────────────────────────────────────────
    if (phase_tuning_) {
        double len_diff = std::abs(result.pos_length - result.neg_length);
        if (len_diff > 1.0) {
            if (result.pos_length < result.neg_length) {
                result.pos_path = addMeanders(result.pos_path, result.neg_length, pos_net_id);
                result.pos_length = static_cast<double>(result.pos_path.size() - 1);
            } else {
                result.neg_path = addMeanders(result.neg_path, result.pos_length, neg_net_id);
                result.neg_length = static_cast<double>(result.neg_path.size() - 1);
            }
        }
    }

    // ── Compute achieved gap ─────────────────────────────────────────────────
    if (!result.pos_path.empty() && !result.neg_path.empty()) {
        double total_gap = 0.0;
        std::size_t samples = std::min(result.pos_path.size(), result.neg_path.size());
        for (std::size_t i = 0; i < samples; ++i) {
            double dx = result.pos_path[i].x - result.neg_path[i].x;
            double dy = result.pos_path[i].y - result.neg_path[i].y;
            total_gap += std::sqrt(dx * dx + dy * dy);
        }
        result.gap_achieved = (samples > 0) ? total_gap / static_cast<double>(samples) : 0.0;
    }

    result.success = true;
    return result;
}

}  // namespace routeai
