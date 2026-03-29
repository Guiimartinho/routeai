#include "ripup_reroute.h"

#include <algorithm>

namespace routeai {

RipupRerouter::RipupRerouter(RoutingGrid& grid) : grid_(grid) {}

void RipupRerouter::ripUp(int net_id, const std::vector<GridCoord>& path) {
    for (auto& c : path) {
        grid_.unmarkTrace(c, net_id);
    }
}

void RipupRerouter::applyHistoryCosts() {
    for (auto& [coord, count] : history_) {
        // Escalate grid cost based on historical conflicts.
        float penalty = history_factor_ * static_cast<float>(count);
        grid_.addCost(coord.x, coord.y, coord.layer, penalty);
    }
}

RerouteResult RipupRerouter::reroute(std::vector<NetDescriptor> nets, int max_iterations) {
    if (max_iterations <= 0) max_iterations = 50;

    RerouteResult result;
    result.iterations_used = 0;

    // Current paths per net.
    std::unordered_map<int, std::vector<GridCoord>> current_paths;
    std::vector<int> failed_ids;

    // Initially all nets are "failed" (need routing).
    for (auto& nd : nets) {
        failed_ids.push_back(nd.net_id);
    }

    // Build a quick lookup from net_id to descriptor.
    std::unordered_map<int, NetDescriptor*> net_map;
    for (auto& nd : nets) net_map[nd.net_id] = &nd;

    AStarRouter astar(grid_);
    LeeRouter   lee(grid_);

    for (int iter = 0; iter < max_iterations; ++iter) {
        result.iterations_used = iter + 1;

        if (progress_cb_) {
            progress_cb_(iter + 1, static_cast<int>(failed_ids.size()));
        }

        if (failed_ids.empty()) {
            result.all_routed = true;
            break;
        }

        // 1) Rip up all failed nets.
        for (int nid : failed_ids) {
            auto it = current_paths.find(nid);
            if (it != current_paths.end()) {
                ripUp(nid, it->second);
                current_paths.erase(it);
            }
        }

        // 2) Apply history-based cost escalation.
        applyHistoryCosts();

        // 3) Re-route each failed net.
        std::vector<int> still_failed;

        for (int nid : failed_ids) {
            auto* nd = net_map[nid];
            if (!nd) continue;

            // Try A* first.
            auto res = astar.route(nid, nd->starts, nd->ends, nd->constraints);

            if (!res.success) {
                // Fallback to Lee (BFS) which is guaranteed shortest if path exists.
                // First remove any partial marking from A*.
                for (auto& c : res.path) grid_.unmarkTrace(c, nid);
                res = lee.route(nid, nd->starts, nd->ends);
            }

            if (res.success) {
                current_paths[nid] = std::move(res.path);
            } else {
                still_failed.push_back(nid);
            }
        }

        // 4) Detect conflicts: cells owned by multiple nets.
        //    Since markTrace blocks the cell, a true conflict happens when
        //    a net fails because another net occupies a required bottleneck.
        //    Record failed cells into history.
        for (int nid : still_failed) {
            auto* nd = net_map[nid];
            if (!nd) continue;
            // Add history penalty at the target cells (bottleneck hint).
            for (auto& t : nd->ends) {
                history_[t]++;
            }
            for (auto& s : nd->starts) {
                history_[s]++;
            }
        }

        failed_ids = std::move(still_failed);
    }

    result.all_routed     = failed_ids.empty();
    result.failed_net_ids = std::move(failed_ids);
    result.paths          = std::move(current_paths);
    return result;
}

}  // namespace routeai
