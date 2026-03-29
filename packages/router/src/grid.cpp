#include "grid.h"

#include <algorithm>
#include <cassert>
#include <cmath>
#include <stdexcept>

namespace routeai {

RoutingGrid::RoutingGrid(double x_min, double y_min, double x_max, double y_max,
                         double resolution, int num_layers)
    : x_min_(x_min)
    , y_min_(y_min)
    , resolution_(resolution)
    , num_layers_(num_layers)
{
    if (resolution <= 0.0) throw std::invalid_argument("resolution must be > 0");
    if (num_layers <= 0)   throw std::invalid_argument("num_layers must be > 0");

    width_  = static_cast<int>(std::ceil((x_max - x_min) / resolution));
    height_ = static_cast<int>(std::ceil((y_max - y_min) / resolution));

    if (width_ <= 0 || height_ <= 0)
        throw std::invalid_argument("board extents produce empty grid");

    const std::size_t total = static_cast<std::size_t>(width_) * height_ * num_layers;
    obstacle_.assign(total, 0);
    cost_.assign(total, 1.0f);
    owner_.assign(total, 0);
    layer_dir_.resize(num_layers, PreferredDir::BOTH);

    // Default: alternate H/V on successive layers.
    for (int l = 0; l < num_layers; ++l) {
        layer_dir_[l] = (l % 2 == 0) ? PreferredDir::HORIZONTAL : PreferredDir::VERTICAL;
    }
}

// ── Coordinate conversion ────────────────────────────────────────────────────

GridCoord RoutingGrid::worldToGrid(double wx, double wy, int layer) const {
    int gx = static_cast<int>(std::floor((wx - x_min_) / resolution_));
    int gy = static_cast<int>(std::floor((wy - y_min_) / resolution_));
    gx = std::clamp(gx, 0, width_ - 1);
    gy = std::clamp(gy, 0, height_ - 1);
    return {gx, gy, layer};
}

void RoutingGrid::gridToWorld(const GridCoord& gc, double& wx, double& wy) const {
    wx = x_min_ + (gc.x + 0.5) * resolution_;
    wy = y_min_ + (gc.y + 0.5) * resolution_;
}

// ── Index helper ─────────────────────────────────────────────────────────────

std::size_t RoutingGrid::idx(int gx, int gy, int layer) const {
    return static_cast<std::size_t>(layer) * (width_ * height_)
         + static_cast<std::size_t>(gy) * width_
         + gx;
}

bool RoutingGrid::inBounds(int gx, int gy, int layer) const {
    return gx >= 0 && gx < width_
        && gy >= 0 && gy < height_
        && layer >= 0 && layer < num_layers_;
}

// ── Obstacle map ─────────────────────────────────────────────────────────────

void RoutingGrid::setObstacle(int gx, int gy, int layer, bool blocked) {
    if (!inBounds(gx, gy, layer)) return;
    obstacle_[idx(gx, gy, layer)] = blocked ? 1 : 0;
}

bool RoutingGrid::isBlocked(int gx, int gy, int layer) const {
    if (!inBounds(gx, gy, layer)) return true;
    return obstacle_[idx(gx, gy, layer)] != 0;
}

void RoutingGrid::setObstacleRect(int gx1, int gy1, int gx2, int gy2, int layer, bool blocked) {
    int xlo = std::max(0, std::min(gx1, gx2));
    int xhi = std::min(width_ - 1, std::max(gx1, gx2));
    int ylo = std::max(0, std::min(gy1, gy2));
    int yhi = std::min(height_ - 1, std::max(gy1, gy2));
    for (int y = ylo; y <= yhi; ++y)
        for (int x = xlo; x <= xhi; ++x)
            obstacle_[idx(x, y, layer)] = blocked ? 1 : 0;
}

// ── Cost map ─────────────────────────────────────────────────────────────────

float RoutingGrid::getCost(int gx, int gy, int layer) const {
    if (!inBounds(gx, gy, layer)) return std::numeric_limits<float>::infinity();
    return cost_[idx(gx, gy, layer)];
}

void RoutingGrid::setCost(int gx, int gy, int layer, float cost) {
    if (!inBounds(gx, gy, layer)) return;
    cost_[idx(gx, gy, layer)] = cost;
}

void RoutingGrid::addCost(int gx, int gy, int layer, float delta) {
    if (!inBounds(gx, gy, layer)) return;
    cost_[idx(gx, gy, layer)] += delta;
}

void RoutingGrid::setLayerDirection(int layer, PreferredDir dir) {
    if (layer < 0 || layer >= num_layers_) return;
    layer_dir_[layer] = dir;
}

PreferredDir RoutingGrid::getLayerDirection(int layer) const {
    if (layer < 0 || layer >= num_layers_) return PreferredDir::BOTH;
    return layer_dir_[layer];
}

// ── Neighbors ────────────────────────────────────────────────────────────────

std::vector<GridCoord> RoutingGrid::getNeighbors(const GridCoord& c, bool allow_via) const {
    std::vector<GridCoord> result;
    result.reserve(6);

    static constexpr int dx[] = {1, -1, 0, 0};
    static constexpr int dy[] = {0, 0, 1, -1};

    for (int i = 0; i < 4; ++i) {
        int nx = c.x + dx[i];
        int ny = c.y + dy[i];
        if (inBounds(nx, ny, c.layer) && !isBlocked(nx, ny, c.layer)) {
            result.push_back({nx, ny, c.layer});
        }
    }

    if (allow_via) {
        // Layer above
        if (c.layer + 1 < num_layers_ && !isBlocked(c.x, c.y, c.layer + 1)) {
            result.push_back({c.x, c.y, c.layer + 1});
        }
        // Layer below
        if (c.layer - 1 >= 0 && !isBlocked(c.x, c.y, c.layer - 1)) {
            result.push_back({c.x, c.y, c.layer - 1});
        }
    }

    return result;
}

// ── Trace marking ────────────────────────────────────────────────────────────

void RoutingGrid::markTrace(const GridCoord& c, int net_id) {
    if (!inBounds(c.x, c.y, c.layer)) return;
    auto i = idx(c.x, c.y, c.layer);
    owner_[i] = net_id;
    obstacle_[i] = 1;
}

void RoutingGrid::unmarkTrace(const GridCoord& c, int net_id) {
    if (!inBounds(c.x, c.y, c.layer)) return;
    auto i = idx(c.x, c.y, c.layer);
    if (owner_[i] == net_id) {
        owner_[i] = 0;
        obstacle_[i] = 0;
    }
}

int RoutingGrid::getTraceOwner(int gx, int gy, int layer) const {
    if (!inBounds(gx, gy, layer)) return 0;
    return owner_[idx(gx, gy, layer)];
}

void RoutingGrid::resetCosts() {
    std::fill(cost_.begin(), cost_.end(), 1.0f);
}

}  // namespace routeai
