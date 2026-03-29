#include "lee_router.h"

#include <queue>
#include <unordered_map>
#include <unordered_set>

namespace routeai {

LeeRouter::LeeRouter(RoutingGrid& grid) : grid_(grid) {}

RoutingResult LeeRouter::route(int net_id,
                                const std::vector<GridCoord>& starts,
                                const std::vector<GridCoord>& ends)
{
    RoutingResult result;
    if (starts.empty() || ends.empty()) {
        result.error = "empty start or end set";
        return result;
    }

    // Build target set for O(1) lookup.
    std::unordered_set<GridCoord, GridCoordHash> target_set(ends.begin(), ends.end());

    // BFS state: distance from source and predecessor.
    std::unordered_map<GridCoord, int, GridCoordHash> dist;
    std::unordered_map<GridCoord, GridCoord, GridCoordHash> prev;

    std::queue<GridCoord> frontier;

    // Seed all start cells.
    for (auto& s : starts) {
        if (grid_.inBounds(s) && !grid_.isBlocked(s)) {
            dist[s] = 0;
            frontier.push(s);
        }
    }

    GridCoord found_target;
    bool reached = false;
    std::size_t expansions = 0;

    // ── Wavefront expansion (BFS) ───────────────────────────────────────────
    while (!frontier.empty()) {
        if (expansion_limit_ > 0 && expansions >= expansion_limit_) break;

        GridCoord cur = frontier.front();
        frontier.pop();
        ++expansions;

        if (target_set.count(cur)) {
            found_target = cur;
            reached = true;
            break;
        }

        int cur_dist = dist[cur];

        for (const auto& nb : grid_.getNeighbors(cur, /*allow_via=*/true)) {
            // Allow walking through cells owned by the same net.
            if (grid_.isBlocked(nb)) {
                int owner = grid_.getTraceOwner(nb.x, nb.y, nb.layer);
                if (owner != net_id) continue;
            }

            if (dist.count(nb) == 0) {
                dist[nb] = cur_dist + 1;
                prev[nb] = cur;
                frontier.push(nb);
            }
        }
    }

    if (!reached) {
        result.error = "no path found";
        return result;
    }

    // ── Backtrace ────────────────────────────────────────────────────────────
    std::vector<GridCoord> path;
    GridCoord cur = found_target;
    while (true) {
        path.push_back(cur);
        auto it = prev.find(cur);
        if (it == prev.end()) break;   // reached a start cell
        cur = it->second;
    }

    // Reverse so path goes start -> target.
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

    result.success     = true;
    result.path        = std::move(path);
    result.wire_length = static_cast<double>(result.path.size() - 1);
    result.via_count   = via_count;
    return result;
}

}  // namespace routeai
