#pragma once

#include "grid.h"

#include <string>
#include <vector>

namespace routeai {

// Forward-declared in lee_router.h – reuse RoutingResult.
struct RoutingResult;

/// Routing constraints passed per-net.
struct NetConstraints {
    double min_clearance   = 0.0;     // mm (not yet enforced in grid-level)
    double max_length      = 0.0;     // mm; 0 = unlimited
    int    max_vias        = -1;      // -1 = unlimited
    std::vector<int> allowed_layers;  // empty = all
};

/// A* router with a multi-factor cost function.
///
/// f(n) = g(n) + h(n)
///   g: actual accumulated cost (grid cost, via penalty, direction penalty)
///   h: heuristic (Manhattan distance scaled by min grid cost + via estimate)
class AStarRouter {
public:
    explicit AStarRouter(RoutingGrid& grid);

    /// Route a single net.
    RoutingResult route(int net_id,
                        const std::vector<GridCoord>& starts,
                        const std::vector<GridCoord>& ends,
                        const NetConstraints& constraints = {});

    // ── Tuning knobs ─────────────────────────────────────────────────────────
    void setViaPenalty(float p)           { via_penalty_ = p; }
    void setDirectionPenalty(float p)     { direction_penalty_ = p; }
    void setCongestionWeight(float w)     { congestion_weight_ = w; }
    void setExpansionLimit(std::size_t n) { expansion_limit_ = n; }

private:
    float heuristic(const GridCoord& from, const GridCoord& to) const;

    RoutingGrid& grid_;
    float via_penalty_       = 5.0f;
    float direction_penalty_ = 2.0f;
    float congestion_weight_ = 1.0f;
    std::size_t expansion_limit_ = 0;
};

}  // namespace routeai
