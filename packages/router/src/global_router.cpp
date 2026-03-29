#include "global_router.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <queue>
#include <unordered_map>
#include <unordered_set>

namespace routeai {

GlobalRouter::GlobalRouter(const RoutingGrid& grid, int cell_size)
    : cell_size_(cell_size)
    , num_layers_(grid.numLayers())
    , fine_grid_(grid)
{
    coarse_w_ = (grid.width()  + cell_size - 1) / cell_size;
    coarse_h_ = (grid.height() + cell_size - 1) / cell_size;
}

GlobalCell GlobalRouter::pinToCell(const GridCoord& pin) const {
    return {pin.x / cell_size_, pin.y / cell_size_, pin.layer};
}

void GlobalRouter::cellBounds(const GlobalCell& gc, int& gx_min, int& gy_min,
                               int& gx_max, int& gy_max) const {
    gx_min = gc.cx * cell_size_;
    gy_min = gc.cy * cell_size_;
    gx_max = std::min(gx_min + cell_size_ - 1, fine_grid_.width() - 1);
    gy_max = std::min(gy_min + cell_size_ - 1, fine_grid_.height() - 1);
}

GlobalRouter::EdgeKey GlobalRouter::makeKey(const GlobalCell& a, const GlobalCell& b) const {
    // Canonical ordering.
    if (a.cx < b.cx || (a.cx == b.cx && a.cy < b.cy) ||
        (a.cx == b.cx && a.cy == b.cy && a.layer < b.layer)) {
        return {a, b};
    }
    return {b, a};
}

int GlobalRouter::getUsage(const GlobalCell& a, const GlobalCell& b) const {
    auto it = edge_usage_.find(makeKey(a, b));
    return it != edge_usage_.end() ? it->second : 0;
}

void GlobalRouter::addUsage(const GlobalCell& a, const GlobalCell& b, int delta) {
    edge_usage_[makeKey(a, b)] += delta;
}

float GlobalRouter::edgeCost(const Edge& e) const {
    // Base cost 1.0, increasing exponentially as usage approaches capacity.
    float usage_ratio = static_cast<float>(e.usage) / std::max(1, e.capacity);
    if (e.usage >= e.capacity) return 1000.0f;  // overflow penalty
    // Sigmoid-like cost growth.
    return 1.0f + 10.0f * usage_ratio * usage_ratio;
}

/// A* on the coarse grid for a single net.
std::vector<GlobalCell> GlobalRouter::routeNet(const GlobalCell& src,
                                                const GlobalCell& dst,
                                                int /*layer_hint*/) {
    struct Node {
        GlobalCell cell;
        float f;
        bool operator>(const Node& o) const { return f > o.f; }
    };

    auto h = [&](const GlobalCell& c) -> float {
        return static_cast<float>(std::abs(c.cx - dst.cx) + std::abs(c.cy - dst.cy)
                                + std::abs(c.layer - dst.layer) * 2);
    };

    std::priority_queue<Node, std::vector<Node>, std::greater<Node>> open;
    std::unordered_map<GlobalCell, float, GlobalCellHash> g_score;
    std::unordered_map<GlobalCell, GlobalCell, GlobalCellHash> came_from;

    g_score[src] = 0.0f;
    open.push({src, h(src)});

    while (!open.empty()) {
        auto cur = open.top();
        open.pop();

        if (cur.cell == dst) {
            // Backtrace.
            std::vector<GlobalCell> path;
            GlobalCell c = dst;
            while (true) {
                path.push_back(c);
                auto it = came_from.find(c);
                if (it == came_from.end()) break;
                c = it->second;
            }
            std::reverse(path.begin(), path.end());
            return path;
        }

        float cur_g = g_score[cur.cell];

        // Enumerate coarse-grid neighbors (4 coplanar + 2 via).
        static constexpr int dcx[] = {1, -1, 0, 0};
        static constexpr int dcy[] = {0, 0, 1, -1};

        auto tryNeighbor = [&](const GlobalCell& nb) {
            int usage = getUsage(cur.cell, nb);
            Edge e{cur.cell, nb, edge_capacity_, usage};
            float edge_c = edgeCost(e);
            float tent_g = cur_g + edge_c;
            auto git = g_score.find(nb);
            if (git == g_score.end() || tent_g < git->second) {
                g_score[nb] = tent_g;
                came_from[nb] = cur.cell;
                open.push({nb, tent_g + h(nb)});
            }
        };

        for (int i = 0; i < 4; ++i) {
            int nx = cur.cell.cx + dcx[i];
            int ny = cur.cell.cy + dcy[i];
            if (nx >= 0 && nx < coarse_w_ && ny >= 0 && ny < coarse_h_) {
                tryNeighbor({nx, ny, cur.cell.layer});
            }
        }
        // Layer changes.
        if (cur.cell.layer + 1 < num_layers_)
            tryNeighbor({cur.cell.cx, cur.cell.cy, cur.cell.layer + 1});
        if (cur.cell.layer - 1 >= 0)
            tryNeighbor({cur.cell.cx, cur.cell.cy, cur.cell.layer - 1});
    }

    // No path found in coarse grid.
    return {};
}

std::vector<GlobalRoute> GlobalRouter::guide(
    const std::vector<std::pair<int, std::vector<GridCoord>>>& net_pins)
{
    std::vector<GlobalRoute> routes;
    routes.reserve(net_pins.size());

    // Sort nets by bounding-box area (small first = short nets first).
    struct NetEntry {
        int net_id;
        GlobalCell src, dst;
        int bbox_area;
    };
    std::vector<NetEntry> sorted_nets;
    sorted_nets.reserve(net_pins.size());

    for (auto& [nid, pins] : net_pins) {
        if (pins.size() < 2) continue;
        // Use first and last pin as source/dest (simplification for 2-pin).
        GlobalCell s = pinToCell(pins.front());
        GlobalCell d = pinToCell(pins.back());
        int area = std::abs(s.cx - d.cx) * std::abs(s.cy - d.cy);
        sorted_nets.push_back({nid, s, d, area});
    }

    std::sort(sorted_nets.begin(), sorted_nets.end(),
              [](const NetEntry& a, const NetEntry& b) { return a.bbox_area < b.bbox_area; });

    for (auto& ne : sorted_nets) {
        auto cells = routeNet(ne.src, ne.dst, ne.src.layer);
        if (cells.empty()) {
            // Still add an empty route so caller knows it failed.
            routes.push_back({ne.net_id, {}, 0.0});
            continue;
        }

        // Update edge usage.
        for (std::size_t i = 1; i < cells.size(); ++i) {
            addUsage(cells[i - 1], cells[i], 1);
        }

        double est_len = static_cast<double>(cells.size() - 1) * cell_size_;
        routes.push_back({ne.net_id, std::move(cells), est_len});
    }

    return routes;
}

}  // namespace routeai
