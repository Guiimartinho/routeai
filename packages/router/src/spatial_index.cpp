#include "spatial_index.h"

#include <algorithm>
#include <cmath>

namespace routeai {

SpatialIndex::SpatialIndex() = default;

void SpatialIndex::insertRect(double x_min, double y_min, double x_max, double y_max,
                               int id, int layer, int net_id)
{
    SpatialEntry e;
    e.box    = BBox(BPoint(x_min, y_min), BPoint(x_max, y_max));
    e.id     = id;
    e.layer  = layer;
    e.net_id = net_id;
    tree_.insert(e);
}

void SpatialIndex::insertSegment(double x1, double y1, double x2, double y2,
                                  int id, int layer, int net_id)
{
    double xlo = std::min(x1, x2);
    double ylo = std::min(y1, y2);
    double xhi = std::max(x1, x2);
    double yhi = std::max(y1, y2);
    // Give segments a thin bounding box (at least 1e-6 wide).
    if (xhi - xlo < 1e-6) { xlo -= 0.5e-6; xhi += 0.5e-6; }
    if (yhi - ylo < 1e-6) { ylo -= 0.5e-6; yhi += 0.5e-6; }
    insertRect(xlo, ylo, xhi, yhi, id, layer, net_id);
}

std::vector<SpatialEntry> SpatialIndex::queryIntersects(double x_min, double y_min,
                                                         double x_max, double y_max) const
{
    BBox query_box(BPoint(x_min, y_min), BPoint(x_max, y_max));
    std::vector<SpatialEntry> results;
    tree_.query(bgi::intersects(query_box), std::back_inserter(results));
    return results;
}

std::vector<SpatialEntry> SpatialIndex::queryIntersects(double x_min, double y_min,
                                                         double x_max, double y_max,
                                                         int layer) const
{
    auto all = queryIntersects(x_min, y_min, x_max, y_max);
    std::vector<SpatialEntry> filtered;
    filtered.reserve(all.size());
    for (auto& e : all) {
        if (e.layer == layer) filtered.push_back(std::move(e));
    }
    return filtered;
}

std::vector<SpatialEntry> SpatialIndex::queryNearest(double x, double y, unsigned k) const
{
    BPoint pt(x, y);
    std::vector<SpatialEntry> results;
    results.reserve(k);
    tree_.query(bgi::nearest(pt, k), std::back_inserter(results));
    return results;
}

std::vector<SpatialEntry> SpatialIndex::queryNearest(double x, double y,
                                                      unsigned k, int layer) const
{
    // Over-fetch then filter.  Not the most efficient but correct.
    BPoint pt(x, y);
    std::vector<SpatialEntry> buf;
    buf.reserve(k * 4);
    tree_.query(bgi::nearest(pt, k * 4), std::back_inserter(buf));

    std::vector<SpatialEntry> results;
    results.reserve(k);
    for (auto& e : buf) {
        if (e.layer == layer) {
            results.push_back(std::move(e));
            if (results.size() >= k) break;
        }
    }
    return results;
}

void SpatialIndex::remove(int id) {
    std::vector<SpatialEntry> to_remove;
    for (auto it = tree_.begin(); it != tree_.end(); ++it) {
        if (it->id == id) to_remove.push_back(*it);
    }
    for (auto& e : to_remove) {
        tree_.remove(e);
    }
}

void SpatialIndex::clear() {
    tree_.clear();
}

std::size_t SpatialIndex::size() const {
    return tree_.size();
}

// Equality operator needed for R-tree remove.
}  // namespace routeai

// R-tree needs equality comparison for SpatialEntry.
namespace routeai {
inline bool operator==(const SpatialEntry& a, const SpatialEntry& b) {
    return a.id == b.id && a.layer == b.layer && a.net_id == b.net_id
        && bg::equals(a.box, b.box);
}
}  // namespace routeai
