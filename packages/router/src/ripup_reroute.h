#pragma once

#include "astar_router.h"
#include "grid.h"
#include "lee_router.h"

#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace routeai {

/// Describes a net to be (re-)routed.
struct NetDescriptor {
    int net_id = 0;
    std::vector<GridCoord> starts;
    std::vector<GridCoord> ends;
    NetConstraints constraints;
};

/// Result of the rip-up & reroute pass.
struct RerouteResult {
    bool all_routed = false;
    int  iterations_used = 0;
    std::vector<int> failed_net_ids;
    /// Final paths per net (indexed by net_id).
    std::unordered_map<int, std::vector<GridCoord>> paths;
};

/// Pathfinder-style iterative rip-up and reroute.
///
/// On each iteration:
///   1. Rip up all failed nets (remove their trace marks from the grid).
///   2. Re-route each failed net with A*.
///   3. For cells with conflicts (multiple nets), escalate cost using a
///      history-based penalty so future iterations avoid those cells.
///   4. Repeat until all nets route or max_iterations reached.
class RipupRerouter {
public:
    explicit RipupRerouter(RoutingGrid& grid);

    /// Attempt to reroute @p nets that failed or conflict.
    /// @param max_iterations  convergence limit (0 uses default 50).
    RerouteResult reroute(std::vector<NetDescriptor> nets, int max_iterations = 0);

    /// Set the history cost escalation factor (added per conflict per iteration).
    void setHistoryCostFactor(float f) { history_factor_ = f; }

    /// Optional progress callback (iteration, nets_remaining).
    using ProgressCallback = std::function<void(int, int)>;
    void setProgressCallback(ProgressCallback cb) { progress_cb_ = std::move(cb); }

private:
    void ripUp(int net_id, const std::vector<GridCoord>& path);
    void applyHistoryCosts();

    RoutingGrid& grid_;
    float history_factor_ = 1.5f;

    /// Per-cell conflict count (history).
    std::unordered_map<GridCoord, int, GridCoordHash> history_;
    ProgressCallback progress_cb_;
};

}  // namespace routeai
