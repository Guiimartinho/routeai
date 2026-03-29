#include "length_matcher.h"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace routeai {

LengthMatcher::LengthMatcher(RoutingGrid& grid) : grid_(grid) {}

double LengthMatcher::computeLength(const std::vector<GridCoord>& path) const {
    if (path.size() < 2) return 0.0;

    double res = grid_.resolution();
    double total = 0.0;

    for (std::size_t i = 1; i < path.size(); ++i) {
        double dx = std::abs(path[i].x - path[i - 1].x) * res;
        double dy = std::abs(path[i].y - path[i - 1].y) * res;
        int dl = std::abs(path[i].layer - path[i - 1].layer);

        if (dl > 0) {
            // Via: no horizontal length contribution.
            continue;
        }

        // Check for 90-degree bend: if direction changes at this point.
        bool is_bend = false;
        if (i >= 2) {
            int prev_dx = path[i - 1].x - path[i - 2].x;
            int prev_dy = path[i - 1].y - path[i - 2].y;
            int cur_dx  = path[i].x - path[i - 1].x;
            int cur_dy  = path[i].y - path[i - 1].y;
            // Direction changed if one was horizontal and now vertical or vice versa.
            if ((prev_dx != 0 && cur_dy != 0 && cur_dx == 0 && prev_dy == 0) ||
                (prev_dy != 0 && cur_dx != 0 && cur_dy == 0 && prev_dx == 0)) {
                is_bend = true;
            }
        }

        if (is_bend) {
            // Approximate a 90-degree arc of radius = one grid cell.
            // Arc length = pi/2 * r.
            total += (M_PI / 2.0) * res;
        } else {
            total += std::sqrt(dx * dx + dy * dy);
        }
    }

    return total;
}

std::vector<GridCoord> LengthMatcher::insertTrombone(
    const std::vector<GridCoord>& path,
    std::size_t seg_start,
    int amplitude,
    bool is_horizontal)
{
    // Insert a U-turn (trombone) at the segment starting at seg_start.
    // For horizontal segment: jog up by amplitude, go forward spacing cells, jog back down.
    // Adds 2 * amplitude to length.
    if (seg_start + 1 >= path.size()) return path;

    std::vector<GridCoord> result;
    result.reserve(path.size() + 2 * amplitude + 2);

    // Copy up to seg_start (inclusive).
    for (std::size_t i = 0; i <= seg_start; ++i) {
        result.push_back(path[i]);
    }

    GridCoord base = path[seg_start];
    int layer = base.layer;

    if (is_horizontal) {
        // Jog in Y direction.
        int sign = 1;
        // Check if there's room above.
        if (base.y + amplitude >= grid_.height()) sign = -1;

        for (int j = 1; j <= amplitude; ++j) {
            GridCoord c{base.x, base.y + sign * j, layer};
            if (grid_.isBlocked(c)) {
                // Can't insert here; return original.
                return path;
            }
            result.push_back(c);
        }
        // Move forward one cell.
        GridCoord top{base.x + (path[seg_start + 1].x > base.x ? 1 : -1),
                      base.y + sign * amplitude, layer};
        if (grid_.isBlocked(top)) return path;
        result.push_back(top);
        // Jog back.
        for (int j = amplitude - 1; j >= 0; --j) {
            GridCoord c{top.x, base.y + sign * j, layer};
            if (grid_.isBlocked(c)) return path;
            result.push_back(c);
        }
    } else {
        // Vertical segment: jog in X direction.
        int sign = 1;
        if (base.x + amplitude >= grid_.width()) sign = -1;

        for (int j = 1; j <= amplitude; ++j) {
            GridCoord c{base.x + sign * j, base.y, layer};
            if (grid_.isBlocked(c)) return path;
            result.push_back(c);
        }
        GridCoord top{base.x + sign * amplitude,
                      base.y + (path[seg_start + 1].y > base.y ? 1 : -1), layer};
        if (grid_.isBlocked(top)) return path;
        result.push_back(top);
        for (int j = amplitude - 1; j >= 0; --j) {
            GridCoord c{base.x + sign * j, top.y, layer};
            if (grid_.isBlocked(c)) return path;
            result.push_back(c);
        }
    }

    // Copy remainder.
    for (std::size_t i = seg_start + 1; i < path.size(); ++i) {
        result.push_back(path[i]);
    }

    return result;
}

std::vector<GridCoord> LengthMatcher::insertSerpentine(
    const std::vector<GridCoord>& path,
    double current_length,
    double target_length,
    int /*net_id*/)
{
    double deficit = target_length - current_length;
    if (deficit <= 0.0) return path;

    // Find straight segments where we can insert trombones.
    // Each trombone of amplitude A adds 2*A*resolution to length.
    double res = grid_.resolution();
    std::vector<GridCoord> result = path;

    // Iterate and insert trombones until deficit is met.
    int attempts = 0;
    const int max_attempts = 100;

    while (deficit > res && attempts < max_attempts) {
        ++attempts;
        bool inserted = false;

        for (std::size_t i = 0; i + 1 < result.size(); ++i) {
            int dx = result[i + 1].x - result[i].x;
            int dy = result[i + 1].y - result[i].y;
            int dl = std::abs(result[i + 1].layer - result[i].layer);
            if (dl > 0) continue;  // Skip vias.

            bool is_h = (dy == 0 && dx != 0);
            bool is_v = (dx == 0 && dy != 0);
            if (!is_h && !is_v) continue;

            // Choose amplitude to roughly fill the deficit.
            int amp = std::min(max_amplitude_,
                               static_cast<int>(std::ceil(deficit / (2.0 * res))));
            amp = std::max(1, amp);

            auto candidate = insertTrombone(result, i, amp, is_h);
            if (candidate.size() > result.size()) {
                double new_len = computeLength(candidate);
                if (new_len > current_length) {
                    deficit -= (new_len - current_length);
                    current_length = new_len;
                    result = std::move(candidate);
                    inserted = true;
                    break;  // Restart scan.
                }
            }
        }

        if (!inserted) break;  // No more room for trombones.
    }

    return result;
}

MatchResult LengthMatcher::match(
    const std::unordered_map<int, std::vector<GridCoord>>& traces,
    double target_length,
    double tolerance)
{
    MatchResult result;

    if (traces.empty()) {
        result.success = true;
        return result;
    }

    // Compute current lengths.
    std::unordered_map<int, double> lengths;
    double max_length = 0.0;
    for (auto& [nid, path] : traces) {
        double len = computeLength(path);
        lengths[nid] = len;
        max_length = std::max(max_length, len);
    }

    // If target is 0, use the longest trace.
    double target = (target_length > 0.0) ? target_length : max_length;

    // For each trace shorter than target - tolerance, insert serpentine.
    bool all_matched = true;
    for (auto& [nid, path] : traces) {
        double len = lengths[nid];
        if (len >= target - tolerance) {
            // Already within tolerance.
            result.adjusted_paths[nid] = path;
            result.lengths[nid] = len;
            continue;
        }

        auto adjusted = insertSerpentine(path, len, target, nid);
        double new_len = computeLength(adjusted);
        result.adjusted_paths[nid] = std::move(adjusted);
        result.lengths[nid] = new_len;

        if (std::abs(new_len - target) > tolerance) {
            all_matched = false;
        }
    }

    result.success = all_matched;
    if (!all_matched) {
        result.error = "some traces could not be matched within tolerance";
    }
    return result;
}

}  // namespace routeai
