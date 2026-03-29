#include "placement.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <numeric>
#include <random>
#include <unordered_map>
#include <vector>

namespace routeai {

// ═══════════════════════════════════════════════════════════════════════════════
//  Force-Directed Placer
// ═══════════════════════════════════════════════════════════════════════════════

ForceDirectedPlacer::ForceDirectedPlacer(const PlaceBounds& bounds,
                                          const std::vector<PlaceKeepout>& keepouts)
    : bounds_(bounds), keepouts_(keepouts) {}

bool ForceDirectedPlacer::isInKeepout(double x, double y, double w, double h) const {
    double x0 = x - w / 2.0, x1 = x + w / 2.0;
    double y0 = y - h / 2.0, y1 = y + h / 2.0;
    for (auto& ko : keepouts_) {
        // Overlap test.
        if (x0 < ko.x_max && x1 > ko.x_min && y0 < ko.y_max && y1 > ko.y_min)
            return true;
    }
    return false;
}

void ForceDirectedPlacer::clampToBounds(PlaceComponent& c) const {
    double half_w = c.w / 2.0;
    double half_h = c.h / 2.0;
    c.x = std::clamp(c.x, bounds_.x_min + half_w, bounds_.x_max - half_w);
    c.y = std::clamp(c.y, bounds_.y_min + half_h, bounds_.y_max - half_h);
}

double ForceDirectedPlacer::computeHPWL(const std::vector<PlaceComponent>& comps,
                                          const std::vector<PlaceNet>& nets) const {
    double total = 0.0;
    // Build id -> index map.
    std::unordered_map<int, std::size_t> idx_map;
    for (std::size_t i = 0; i < comps.size(); ++i) idx_map[comps[i].id] = i;

    for (auto& net : nets) {
        double xmin = std::numeric_limits<double>::max();
        double xmax = std::numeric_limits<double>::lowest();
        double ymin = xmin, ymax = xmax;
        for (int cid : net.component_ids) {
            auto it = idx_map.find(cid);
            if (it == idx_map.end()) continue;
            auto& c = comps[it->second];
            xmin = std::min(xmin, c.x);
            xmax = std::max(xmax, c.x);
            ymin = std::min(ymin, c.y);
            ymax = std::max(ymax, c.y);
        }
        if (xmin <= xmax) total += (xmax - xmin) + (ymax - ymin);
    }
    return total;
}

PlacementResult ForceDirectedPlacer::place(std::vector<PlaceComponent> components,
                                            const std::vector<PlaceNet>& nets,
                                            int max_iterations,
                                            double convergence_threshold)
{
    PlacementResult result;
    if (components.empty()) {
        result.success = true;
        return result;
    }

    // Build id -> index.
    std::unordered_map<int, std::size_t> idx_map;
    for (std::size_t i = 0; i < components.size(); ++i)
        idx_map[components[i].id] = i;

    const std::size_t n = components.size();
    std::vector<double> fx(n, 0.0), fy(n, 0.0);

    double step_size = 1.0;
    double prev_hpwl = computeHPWL(components, nets);

    for (int iter = 0; iter < max_iterations; ++iter) {
        std::fill(fx.begin(), fx.end(), 0.0);
        std::fill(fy.begin(), fy.end(), 0.0);

        // ── Attraction forces (spring model per net) ─────────────────────────
        for (auto& net : nets) {
            if (net.component_ids.size() < 2) continue;

            // Compute net centroid.
            double cx_sum = 0.0, cy_sum = 0.0;
            int count = 0;
            for (int cid : net.component_ids) {
                auto it = idx_map.find(cid);
                if (it == idx_map.end()) continue;
                cx_sum += components[it->second].x;
                cy_sum += components[it->second].y;
                ++count;
            }
            if (count == 0) continue;
            double cx_avg = cx_sum / count;
            double cy_avg = cy_sum / count;

            // Each component is pulled toward centroid.
            for (int cid : net.component_ids) {
                auto it = idx_map.find(cid);
                if (it == idx_map.end()) continue;
                auto& comp = components[it->second];
                if (comp.fixed) continue;
                double dx = cx_avg - comp.x;
                double dy = cy_avg - comp.y;
                fx[it->second] += attraction_weight_ * dx;
                fy[it->second] += attraction_weight_ * dy;
            }
        }

        // ── Repulsion forces (overlap avoidance) ─────────────────────────────
        for (std::size_t i = 0; i < n; ++i) {
            if (components[i].fixed) continue;
            for (std::size_t j = i + 1; j < n; ++j) {
                double dx = components[i].x - components[j].x;
                double dy = components[i].y - components[j].y;
                double dist2 = dx * dx + dy * dy;
                double min_dist = (components[i].w + components[j].w) / 2.0
                                + (components[i].h + components[j].h) / 2.0;
                double min_dist2 = min_dist * min_dist;

                if (dist2 < min_dist2 && dist2 > 1e-10) {
                    double dist = std::sqrt(dist2);
                    double force = repulsion_weight_ * (min_dist - dist) / dist;
                    double fdx = force * dx / dist;
                    double fdy = force * dy / dist;
                    if (!components[i].fixed) { fx[i] += fdx; fy[i] += fdy; }
                    if (!components[j].fixed) { fx[j] -= fdx; fy[j] -= fdy; }
                }
            }
        }

        // ── Update positions ─────────────────────────────────────────────────
        double max_move = 0.0;
        for (std::size_t i = 0; i < n; ++i) {
            if (components[i].fixed) continue;
            double dx = step_size * fx[i];
            double dy = step_size * fy[i];
            // Limit max displacement per iteration.
            double mag = std::sqrt(dx * dx + dy * dy);
            double max_step = 5.0;
            if (mag > max_step) {
                dx *= max_step / mag;
                dy *= max_step / mag;
            }
            components[i].x += dx;
            components[i].y += dy;
            clampToBounds(components[i]);
            max_move = std::max(max_move, std::abs(dx) + std::abs(dy));
        }

        // ── Push out of keepouts ─────────────────────────────────────────────
        for (std::size_t i = 0; i < n; ++i) {
            if (components[i].fixed) continue;
            while (isInKeepout(components[i].x, components[i].y,
                               components[i].w, components[i].h)) {
                // Nudge toward board center.
                double cx = (bounds_.x_min + bounds_.x_max) / 2.0;
                double cy = (bounds_.y_min + bounds_.y_max) / 2.0;
                double dx = cx - components[i].x;
                double dy = cy - components[i].y;
                double d = std::sqrt(dx * dx + dy * dy);
                if (d < 1e-6) { components[i].x += 1.0; break; }
                components[i].x += 0.5 * dx / d;
                components[i].y += 0.5 * dy / d;
                clampToBounds(components[i]);
            }
        }

        double hpwl = computeHPWL(components, nets);
        double improvement = std::abs(prev_hpwl - hpwl);
        prev_hpwl = hpwl;

        // Adaptive step size.
        if (max_move < 0.1) step_size *= 1.1;
        else step_size *= 0.95;
        step_size = std::clamp(step_size, 0.01, 2.0);

        if (max_move < convergence_threshold && improvement < convergence_threshold) break;
    }

    result.success = true;
    result.components = std::move(components);
    result.total_wirelength = prev_hpwl;
    return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FM Partitioner
// ═══════════════════════════════════════════════════════════════════════════════

int FMPartitioner::computeCutSize(const std::vector<bool>& part,
                                    const std::vector<PlaceNet>& nets) const {
    // Build component_id -> index (assumes id == index for simplicity).
    int cut = 0;
    for (auto& net : nets) {
        bool has_a = false, has_b = false;
        for (int cid : net.component_ids) {
            if (cid < 0 || cid >= static_cast<int>(part.size())) continue;
            if (part[cid]) has_b = true; else has_a = true;
            if (has_a && has_b) { ++cut; break; }
        }
    }
    return cut;
}

std::vector<bool> FMPartitioner::partition(const std::vector<PlaceComponent>& components,
                                            const std::vector<PlaceNet>& nets,
                                            double balance_ratio,
                                            int max_passes) {
    const int n = static_cast<int>(components.size());
    if (n == 0) return {};

    // Initial partition: first half -> A, second half -> B.
    std::vector<bool> part(n, false);
    int target_b = static_cast<int>(std::round(n / (1.0 + balance_ratio)));
    for (int i = n - target_b; i < n; ++i) part[i] = true;

    // Build adjacency: for each component, which nets connect to it.
    std::vector<std::vector<int>> comp_nets(n);
    for (int ni = 0; ni < static_cast<int>(nets.size()); ++ni) {
        for (int cid : nets[ni].component_ids) {
            if (cid >= 0 && cid < n) comp_nets[cid].push_back(ni);
        }
    }

    int best_cut = computeCutSize(part, nets);
    std::vector<bool> best_part = part;

    for (int pass = 0; pass < max_passes; ++pass) {
        std::vector<bool> locked(n, false);
        std::vector<bool> trial_part = part;
        bool improved = false;

        // Compute initial gains for each node.
        // Gain(v) = #nets where v is the only member on its side (cut would decrease)
        //          - #nets where v is on same side as all others (cut would increase).
        std::vector<int> gain(n, 0);
        for (int v = 0; v < n; ++v) {
            if (components[v].fixed) { locked[v] = true; continue; }
            for (int ni : comp_nets[v]) {
                bool all_same = true;
                bool v_is_only = true;
                for (int cid : nets[ni].component_ids) {
                    if (cid == v || cid < 0 || cid >= n) continue;
                    if (trial_part[cid] == trial_part[v]) v_is_only = false;
                    else all_same = false;
                }
                if (all_same) gain[v]--;   // Moving v would increase cut.
                if (v_is_only) gain[v]++;  // Moving v would decrease cut.
            }
        }

        std::vector<std::pair<int, int>> move_sequence;  // (node, gain)

        for (int step = 0; step < n; ++step) {
            // Find unlocked node with highest gain, respecting balance.
            int best_v = -1;
            int best_g = std::numeric_limits<int>::min();

            int count_a = 0, count_b = 0;
            for (int v = 0; v < n; ++v) {
                if (trial_part[v]) count_b++; else count_a++;
            }

            for (int v = 0; v < n; ++v) {
                if (locked[v]) continue;
                // Check balance after potential move.
                int new_a = count_a + (trial_part[v] ? 1 : -1);
                int new_b = count_b + (trial_part[v] ? -1 : 1);
                if (new_a <= 0 || new_b <= 0) continue;  // Degenerate.
                double ratio = static_cast<double>(new_a) / new_b;
                if (ratio < 0.3 * balance_ratio || ratio > 3.0 * balance_ratio) continue;

                if (gain[v] > best_g) {
                    best_g = gain[v];
                    best_v = v;
                }
            }

            if (best_v < 0) break;

            // Move best_v.
            trial_part[best_v] = !trial_part[best_v];
            locked[best_v] = true;
            move_sequence.push_back({best_v, best_g});

            // Update gains of neighbors.
            for (int ni : comp_nets[best_v]) {
                for (int cid : nets[ni].component_ids) {
                    if (cid < 0 || cid >= n || locked[cid]) continue;
                    // Recompute gain for cid (simple recomputation).
                    gain[cid] = 0;
                    for (int nj : comp_nets[cid]) {
                        bool all_same = true;
                        bool v_is_only = true;
                        for (int kid : nets[nj].component_ids) {
                            if (kid == cid || kid < 0 || kid >= n) continue;
                            if (trial_part[kid] == trial_part[cid]) v_is_only = false;
                            else all_same = false;
                        }
                        if (all_same) gain[cid]--;
                        if (v_is_only) gain[cid]++;
                    }
                }
            }
        }

        // Find prefix of moves that gives maximum cumulative gain.
        int max_cum_gain = 0;
        int cum_gain = 0;
        int best_prefix = -1;  // -1 = no moves
        for (std::size_t i = 0; i < move_sequence.size(); ++i) {
            cum_gain += move_sequence[i].second;
            if (cum_gain > max_cum_gain) {
                max_cum_gain = cum_gain;
                best_prefix = static_cast<int>(i);
            }
        }

        if (max_cum_gain > 0 && best_prefix >= 0) {
            // Apply only the first best_prefix+1 moves.
            std::vector<bool> new_part = part;
            for (int i = 0; i <= best_prefix; ++i) {
                new_part[move_sequence[i].first] = !new_part[move_sequence[i].first];
            }
            part = new_part;
            int new_cut = computeCutSize(part, nets);
            if (new_cut < best_cut) {
                best_cut = new_cut;
                best_part = part;
                improved = true;
            }
        }

        if (!improved) break;  // Converged.
    }

    return best_part;
}

PlacementResult FMPartitioner::recursiveBisectionPlace(
    std::vector<PlaceComponent> components,
    const std::vector<PlaceNet>& nets,
    const PlaceBounds& bounds,
    int depth)
{
    PlacementResult result;
    if (components.empty() || depth <= 0) {
        result.success = true;
        result.components = std::move(components);
        return result;
    }

    // Partition components.
    auto part = partition(components, nets);

    // Determine split direction: alternate H/V.
    bool split_horizontal = (depth % 2 == 0);

    // Assign positions based on partition.
    PlaceBounds bounds_a = bounds, bounds_b = bounds;
    if (split_horizontal) {
        double mid = (bounds.x_min + bounds.x_max) / 2.0;
        bounds_a.x_max = mid;
        bounds_b.x_min = mid;
    } else {
        double mid = (bounds.y_min + bounds.y_max) / 2.0;
        bounds_a.y_max = mid;
        bounds_b.y_min = mid;
    }

    std::vector<PlaceComponent> group_a, group_b;
    for (std::size_t i = 0; i < components.size(); ++i) {
        if (part.size() > i && part[i]) {
            group_b.push_back(components[i]);
        } else {
            group_a.push_back(components[i]);
        }
    }

    // Recurse.
    auto res_a = recursiveBisectionPlace(std::move(group_a), nets, bounds_a, depth - 1);
    auto res_b = recursiveBisectionPlace(std::move(group_b), nets, bounds_b, depth - 1);

    // Merge results.
    result.components.reserve(res_a.components.size() + res_b.components.size());

    // Spread components within their partition.
    auto spread = [](std::vector<PlaceComponent>& comps, const PlaceBounds& b) {
        if (comps.empty()) return;
        double area_w = b.x_max - b.x_min;
        double area_h = b.y_max - b.y_min;
        int cols = std::max(1, static_cast<int>(std::ceil(std::sqrt(comps.size()))));
        int rows = static_cast<int>(std::ceil(static_cast<double>(comps.size()) / cols));
        double dx = area_w / (cols + 1);
        double dy = area_h / (rows + 1);
        for (std::size_t i = 0; i < comps.size(); ++i) {
            if (comps[i].fixed) continue;
            int col = static_cast<int>(i) % cols;
            int row = static_cast<int>(i) / cols;
            comps[i].x = b.x_min + (col + 1) * dx;
            comps[i].y = b.y_min + (row + 1) * dy;
        }
    };

    spread(res_a.components, bounds_a);
    spread(res_b.components, bounds_b);

    for (auto& c : res_a.components) result.components.push_back(std::move(c));
    for (auto& c : res_b.components) result.components.push_back(std::move(c));

    result.success = true;
    return result;
}

}  // namespace routeai
