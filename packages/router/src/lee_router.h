#pragma once

#include "grid.h"

#include <functional>
#include <string>
#include <vector>

namespace routeai {

/// Result from a single-net route attempt.
struct RoutingResult {
    bool   success = false;
    std::vector<GridCoord> path;           // ordered source -> target
    std::vector<GridCoord> vias;           // cells where layer changes occur
    double wire_length = 0.0;              // total length in grid cells
    int    via_count   = 0;
    std::string error;
};

/// Classic Lee / BFS maze router.
///
/// Performs breadth-first wavefront expansion on the multi-layer grid,
/// inserting vias when changing layers.  Guaranteed to find the shortest
/// (unweighted) path if one exists.
class LeeRouter {
public:
    explicit LeeRouter(RoutingGrid& grid);

    /// Route from any of @p starts to any of @p ends.
    /// The grid cells along the path are marked with @p net_id.
    RoutingResult route(int net_id,
                        const std::vector<GridCoord>& starts,
                        const std::vector<GridCoord>& ends);

    /// Set maximum cells to expand before giving up (0 = unlimited).
    void setExpansionLimit(std::size_t limit) { expansion_limit_ = limit; }

private:
    RoutingGrid& grid_;
    std::size_t  expansion_limit_ = 0;
};

}  // namespace routeai
