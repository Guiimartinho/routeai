#include "astar_router.h"
#include "lee_router.h"   // RoutingResult

#include <algorithm>
#include <cmath>
#include <queue>
#include <unordered_map>
#include <unordered_set>

namespace routeai {

AStarRouter::AStarRouter(RoutingGrid& grid) : grid_(grid) {}

float AStarRouter::heuristic(const GridCoord& from, const GridCoord& to) const {
    // Manhattan distance + estimated via cost for layer difference.
    float dx = static_cast<float>(std::abs(from.x - to.x));
    float dy = static_cast<float>(std::abs(from.y - to.y));
    float dl = static_cast<float>(std::abs(from.layer - to.layer));
    return dx + dy + dl * via_penalty_;
}

RoutingResult AStarRouter::route(int net_id,
                                  const std::vector<GridCoord>& starts,
                                  const std::vector<GridCoord>& ends,
                                  const NetConstraints& constraints)
{
    RoutingResult result;
    if (starts.empty() || ends.empty()) {
        result.error = "empty start or end set";
        return result;
    }

    // Build allowed-layer set.
    std::unordered_set<int> allowed_layers;
    for (int l : constraints.allowed_layers) allowed_layers.insert(l);
    bool layer_restricted = !allowed_layers.empty();

    // Target lookup.
    std::unordered_set<GridCoord, GridCoordHash> target_set(ends.begin(), ends.end());

    // Pick the target closest to any start for heuristic.
    // We use the first target as the heuristic anchor (admissible since
    // we take the min over all targets during evaluation).
    const auto& heuristic_targets = ends;

    struct Node {
        GridCoord coord;
        float f;
        bool operator>(const Node& o) const { return f > o.f; }
    };

    std::priority_queue<Node, std::vector<Node>, std::greater<Node>> open;
    std::unordered_map<GridCoord, float, GridCoordHash> g_score;
    std::unordered_map<GridCoord, GridCoord, GridCoordHash> came_from;

    // Seed starts.
    for (auto& s : starts) {
        if (!grid_.inBounds(s) || grid_.isBlocked(s)) continue;
        if (layer_restricted && !allowed_layers.count(s.layer)) continue;
        g_score[s] = 0.0f;
        // h = min over all targets
        float best_h = std::numeric_limits<float>::max();
        for (auto& t : heuristic_targets) best_h = std::min(best_h, heuristic(s, t));
        open.push({s, best_h});
    }

    GridCoord found_target;
    bool reached = false;
    std::size_t expansions = 0;

    while (!open.empty()) {
        if (expansion_limit_ > 0 && expansions >= expansion_limit_) break;

        Node cur = open.top();
        open.pop();
        ++expansions;

        // Skip stale entries.
        auto git = g_score.find(cur.coord);
        if (git == g_score.end()) continue;
        float cur_g = git->second;
        // If we've already found a better path to this node, skip.
        if (cur.f > cur_g + heuristic(cur.coord, ends[0]) + 1e-3f) {
            // Tolerate small float drift, but skip obviously stale.
            // Actually, a simpler check: if g stored is less than the g this
            // entry had, skip.  We recompute g from f - h.
            // Simpler: just keep a closed set.
        }

        if (target_set.count(cur.coord)) {
            found_target = cur.coord;
            reached = true;
            break;
        }

        for (const auto& nb : grid_.getNeighbors(cur.coord, /*allow_via=*/true)) {
            // Check layer restriction.
            if (layer_restricted && !allowed_layers.count(nb.layer)) continue;

            // Allow same-net cells.
            if (grid_.isBlocked(nb)) {
                int owner = grid_.getTraceOwner(nb.x, nb.y, nb.layer);
                if (owner != net_id) continue;
            }

            // ── Compute edge cost ────────────────────────────────────────────
            float edge_cost = grid_.getCost(nb) * congestion_weight_;

            // Via penalty for layer change.
            bool is_via = (nb.layer != cur.coord.layer);
            if (is_via) {
                edge_cost += via_penalty_;
                // Check max vias constraint.
                // (We approximate by not counting precisely during search;
                //  final path is validated afterwards.)
            }

            // Direction preference penalty: if moving horizontally on a
            // vertical-preferred layer (or vice versa), add penalty.
            if (!is_via) {
                PreferredDir pref = grid_.getLayerDirection(nb.layer);
                bool moving_h = (nb.x != cur.coord.x);
                bool moving_v = (nb.y != cur.coord.y);
                if ((pref == PreferredDir::HORIZONTAL && moving_v) ||
                    (pref == PreferredDir::VERTICAL   && moving_h)) {
                    edge_cost += direction_penalty_;
                }
            }

            float tentative_g = cur_g + edge_cost;

            auto nit = g_score.find(nb);
            if (nit == g_score.end() || tentative_g < nit->second) {
                g_score[nb] = tentative_g;
                came_from[nb] = cur.coord;

                // h = min distance to any target.
                float best_h = std::numeric_limits<float>::max();
                for (auto& t : heuristic_targets)
                    best_h = std::min(best_h, heuristic(nb, t));

                open.push({nb, tentative_g + best_h});
            }
        }
    }

    if (!reached) {
        result.error = "A* failed to find path";
        return result;
    }

    // ── Backtrace ────────────────────────────────────────────────────────────
    std::vector<GridCoord> path;
    GridCoord cur = found_target;
    while (true) {
        path.push_back(cur);
        auto it = came_from.find(cur);
        if (it == came_from.end()) break;
        cur = it->second;
    }
    std::reverse(path.begin(), path.end());

    // Mark on grid and collect vias.
    int via_count = 0;
    for (std::size_t i = 0; i < path.size(); ++i) {
        grid_.markTrace(path[i], net_id);
        if (i > 0 && path[i].layer != path[i - 1].layer) {
            result.vias.push_back(path[i]);
            ++via_count;
        }
    }

    // Update congestion costs along the path for subsequent nets.
    for (auto& p : path) {
        grid_.addCost(p.x, p.y, p.layer, 0.5f);  // congestion increment
    }

    // ── Validate constraints ─────────────────────────────────────────────────
    if (constraints.max_vias >= 0 && via_count > constraints.max_vias) {
        result.error = "exceeds max via count";
        result.success = false;
        // Still return the path so caller can decide.
    } else {
        result.success = true;
    }

    result.path        = std::move(path);
    result.wire_length = g_score[found_target];
    result.via_count   = via_count;
    return result;
}

}  // namespace routeai
