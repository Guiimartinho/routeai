#pragma once

#include <cstdint>
#include <limits>
#include <memory>
#include <vector>

namespace routeai {

/// Coordinates on the discrete routing grid.
struct GridCoord {
    int x = 0;
    int y = 0;
    int layer = 0;

    bool operator==(const GridCoord& o) const {
        return x == o.x && y == o.y && layer == o.layer;
    }
    bool operator!=(const GridCoord& o) const { return !(*this == o); }
};

/// Hash for GridCoord so it can be used in unordered containers.
struct GridCoordHash {
    std::size_t operator()(const GridCoord& c) const noexcept {
        // Combine hashes with bit mixing.
        std::size_t h = static_cast<std::size_t>(c.x) * 73856093ULL;
        h ^= static_cast<std::size_t>(c.y) * 19349669ULL;
        h ^= static_cast<std::size_t>(c.layer) * 83492791ULL;
        return h;
    }
};

/// Per-cell direction preference used in cost computation.
enum class PreferredDir { HORIZONTAL, VERTICAL, BOTH };

/// The multi-layer routing grid with obstacle and cost maps.
class RoutingGrid {
public:
    /// Construct a grid from board extents and resolution.
    /// @param x_min, y_min, x_max, y_max  board outline in mm
    /// @param resolution   grid cell size in mm
    /// @param num_layers   number of routing layers
    RoutingGrid(double x_min, double y_min, double x_max, double y_max,
                double resolution, int num_layers);

    // ── Queries ──────────────────────────────────────────────────────────────
    int  width()      const { return width_; }
    int  height()     const { return height_; }
    int  numLayers()  const { return num_layers_; }
    double resolution() const { return resolution_; }

    /// Convert world coords (mm) to grid coords.
    GridCoord worldToGrid(double wx, double wy, int layer) const;

    /// Convert grid coords back to world coords (cell centre).
    void gridToWorld(const GridCoord& gc, double& wx, double& wy) const;

    // ── Obstacle map ─────────────────────────────────────────────────────────
    void setObstacle(int gx, int gy, int layer, bool blocked);
    bool isBlocked(int gx, int gy, int layer) const;
    bool isBlocked(const GridCoord& c) const { return isBlocked(c.x, c.y, c.layer); }

    /// Mark a rectangular region (in grid coords) as obstacle.
    void setObstacleRect(int gx1, int gy1, int gx2, int gy2, int layer, bool blocked);

    // ── Cost map ─────────────────────────────────────────────────────────────
    /// Base cost for entering this cell (>= 1.0).
    float getCost(int gx, int gy, int layer) const;
    float getCost(const GridCoord& c) const { return getCost(c.x, c.y, c.layer); }

    void  setCost(int gx, int gy, int layer, float cost);
    void  addCost(int gx, int gy, int layer, float delta);

    /// Set preferred routing direction for a layer.
    void setLayerDirection(int layer, PreferredDir dir);
    PreferredDir getLayerDirection(int layer) const;

    // ── Neighbor enumeration ─────────────────────────────────────────────────
    /// Return the reachable neighbors (up to 4 coplanar + 2 via).
    /// @param allow_via  whether to include layer changes
    std::vector<GridCoord> getNeighbors(const GridCoord& c, bool allow_via = true) const;

    // ── Trace marking ────────────────────────────────────────────────────────
    /// Mark a routed trace so it becomes an obstacle for other nets.
    /// @param net_id  non-zero identifier for the owning net.
    void markTrace(const GridCoord& c, int net_id);

    /// Remove a trace mark, e.g. during rip-up.
    void unmarkTrace(const GridCoord& c, int net_id);

    /// Return the net that occupies this cell, or 0 if free / obstacle.
    int  getTraceOwner(int gx, int gy, int layer) const;

    // ── Bulk operations ──────────────────────────────────────────────────────
    /// Reset costs to 1.0 everywhere, keep obstacles.
    void resetCosts();

    bool inBounds(int gx, int gy, int layer) const;
    bool inBounds(const GridCoord& c) const { return inBounds(c.x, c.y, c.layer); }

private:
    std::size_t idx(int gx, int gy, int layer) const;

    double x_min_, y_min_;
    double resolution_;
    int    width_, height_, num_layers_;

    std::vector<uint8_t>  obstacle_;   // 1 = blocked
    std::vector<float>    cost_;       // base cost per cell
    std::vector<int32_t>  owner_;      // net id that occupies cell (0 = free)
    std::vector<PreferredDir> layer_dir_;
};

}  // namespace routeai
