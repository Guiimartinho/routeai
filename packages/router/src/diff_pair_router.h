#pragma once

#include "astar_router.h"
#include "grid.h"
#include "lee_router.h"

#include <string>
#include <vector>

namespace routeai {

/// Coupling mode for differential pairs.
enum class CouplingMode {
    EDGE_COUPLED,      // side-by-side on the same layer
    BROADSIDE_COUPLED  // stacked on adjacent layers
};

/// Result of a differential pair route.
struct DiffPairResult {
    bool success = false;
    std::vector<GridCoord> pos_path;
    std::vector<GridCoord> neg_path;
    std::vector<GridCoord> pos_vias;
    std::vector<GridCoord> neg_vias;
    double pos_length = 0.0;
    double neg_length = 0.0;
    double gap_achieved = 0.0;   // average gap in grid cells
    std::string error;
};

/// Routes differential pairs maintaining constant separation.
///
/// Edge-coupled mode: both traces on the same layer, separated by @p gap cells.
/// Broadside-coupled mode: traces on adjacent layers, aligned vertically.
/// Phase tuning: adds meanders to the shorter trace after initial routing.
class DiffPairRouter {
public:
    explicit DiffPairRouter(RoutingGrid& grid);

    /// Route a differential pair.
    /// @param pos_net_id, neg_net_id   net identifiers
    /// @param pos_starts, pos_ends     pads for positive net
    /// @param neg_starts, neg_ends     pads for negative net
    /// @param gap                      target gap in grid cells
    /// @param impedance_target         target impedance in ohms (0 = don't care)
    /// @param mode                     coupling mode
    DiffPairResult route(int pos_net_id, int neg_net_id,
                         const std::vector<GridCoord>& pos_starts,
                         const std::vector<GridCoord>& pos_ends,
                         const std::vector<GridCoord>& neg_starts,
                         const std::vector<GridCoord>& neg_ends,
                         int gap,
                         double impedance_target = 0.0,
                         CouplingMode mode = CouplingMode::EDGE_COUPLED);

    /// Enable phase tuning (add meanders to shorter trace).
    void setPhaseTuning(bool enable) { phase_tuning_ = enable; }
    void setMaxMeanderAmplitude(int cells) { max_meander_amp_ = cells; }

private:
    /// Offset a path laterally by @p offset grid cells.
    std::vector<GridCoord> offsetPath(const std::vector<GridCoord>& path,
                                       int offset, int layer) const;

    /// Add meander patterns to lengthen a trace.
    std::vector<GridCoord> addMeanders(const std::vector<GridCoord>& path,
                                        double target_length, int net_id);

    RoutingGrid& grid_;
    bool phase_tuning_ = true;
    int  max_meander_amp_ = 5;
};

}  // namespace routeai
