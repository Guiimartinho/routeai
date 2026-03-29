#pragma once

#include "grid.h"

#include <string>
#include <unordered_map>
#include <vector>

namespace routeai {

/// A coarse global routing cell.
struct GlobalCell {
    int cx = 0;   // coarse x index
    int cy = 0;   // coarse y index
    int layer = 0;

    bool operator==(const GlobalCell& o) const {
        return cx == o.cx && cy == o.cy && layer == o.layer;
    }
};

struct GlobalCellHash {
    std::size_t operator()(const GlobalCell& c) const noexcept {
        return static_cast<std::size_t>(c.cx) * 73856093ULL
             ^ static_cast<std::size_t>(c.cy) * 19349669ULL
             ^ static_cast<std::size_t>(c.layer) * 83492791ULL;
    }
};

/// A global route: the sequence of coarse cells a net should pass through.
struct GlobalRoute {
    int net_id = 0;
    std::vector<GlobalCell> cells;
    double estimated_length = 0.0;
};

/// Global router: partitions the board into coarse cells, models capacity,
/// and assigns nets to cell sequences using a multicommodity flow approach.
class GlobalRouter {
public:
    /// @param grid       the fine routing grid (used for extents / layer count)
    /// @param cell_size  coarse cell size in fine-grid units (e.g., 10 means 10x10)
    GlobalRouter(const RoutingGrid& grid, int cell_size = 10);

    /// Generate global routes for all given nets.
    std::vector<GlobalRoute> guide(
        const std::vector<std::pair<int /*net_id*/, std::vector<GridCoord>>>& net_pins);

    /// Set capacity per edge between adjacent cells.
    void setEdgeCapacity(int capacity) { edge_capacity_ = capacity; }

    /// Get the fine-grid bounding box of a coarse cell.
    void cellBounds(const GlobalCell& gc, int& gx_min, int& gy_min,
                    int& gx_max, int& gy_max) const;

private:
    struct Edge {
        GlobalCell a, b;
        int capacity = 0;
        int usage = 0;
    };

    GlobalCell pinToCell(const GridCoord& pin) const;
    float edgeCost(const Edge& e) const;
    std::vector<GlobalCell> routeNet(const GlobalCell& src, const GlobalCell& dst, int layer);

    int coarse_w_, coarse_h_;
    int cell_size_;
    int num_layers_;
    int edge_capacity_ = 4;
    const RoutingGrid& fine_grid_;

    /// Edge usage tracking: key = canonical edge pair.
    using EdgeKey = std::pair<GlobalCell, GlobalCell>;
    struct EdgeKeyHash {
        std::size_t operator()(const EdgeKey& k) const {
            GlobalCellHash h;
            return h(k.first) ^ (h(k.second) << 1);
        }
    };
    struct EdgeKeyEq {
        bool operator()(const EdgeKey& a, const EdgeKey& b) const {
            return a.first == b.first && a.second == b.second;
        }
    };
    std::unordered_map<EdgeKey, int, EdgeKeyHash, EdgeKeyEq> edge_usage_;

    EdgeKey makeKey(const GlobalCell& a, const GlobalCell& b) const;
    int getUsage(const GlobalCell& a, const GlobalCell& b) const;
    void addUsage(const GlobalCell& a, const GlobalCell& b, int delta);
};

}  // namespace routeai
