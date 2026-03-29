#pragma once

#include "grid.h"

#include <string>
#include <unordered_map>
#include <vector>

namespace routeai {

/// Result of a length-matching pass.
struct MatchResult {
    bool success = false;
    /// Updated paths per net_id, with meanders inserted.
    std::unordered_map<int, std::vector<GridCoord>> adjusted_paths;
    /// Achieved lengths per net_id.
    std::unordered_map<int, double> lengths;
    std::string error;
};

/// Calculates trace lengths and inserts serpentine / trombone patterns
/// to match a group of nets to a target length.
class LengthMatcher {
public:
    explicit LengthMatcher(RoutingGrid& grid);

    /// Compute the exact trace length (Manhattan, counting each step as
    /// resolution mm, with arcs approximated as 0.5*pi*r for 90-degree bends).
    double computeLength(const std::vector<GridCoord>& path) const;

    /// Match a set of traces to @p target_length within @p tolerance.
    /// If @p target_length is 0, the longest trace's length is used as target.
    /// @param traces  map from net_id -> current path
    MatchResult match(const std::unordered_map<int, std::vector<GridCoord>>& traces,
                      double target_length, double tolerance);

    /// Set maximum serpentine amplitude in grid cells.
    void setMaxAmplitude(int amp) { max_amplitude_ = amp; }

    /// Set serpentine spacing in grid cells.
    void setSpacing(int s) { spacing_ = s; }

private:
    /// Insert serpentine meanders into a path to reach target length.
    std::vector<GridCoord> insertSerpentine(const std::vector<GridCoord>& path,
                                             double current_length,
                                             double target_length,
                                             int net_id);

    /// Insert a trombone (U-turn) pattern at a straight segment.
    std::vector<GridCoord> insertTrombone(const std::vector<GridCoord>& path,
                                           std::size_t seg_start,
                                           int amplitude, bool is_horizontal);

    RoutingGrid& grid_;
    int max_amplitude_ = 8;
    int spacing_ = 2;
};

}  // namespace routeai
