#pragma once

#include <cstdint>
#include <vector>

#include <boost/geometry.hpp>
#include <boost/geometry/geometries/box.hpp>
#include <boost/geometry/geometries/point.hpp>
#include <boost/geometry/geometries/segment.hpp>
#include <boost/geometry/index/rtree.hpp>

namespace routeai {

namespace bg  = boost::geometry;
namespace bgi = boost::geometry::index;

using BPoint   = bg::model::point<double, 2, bg::cs::cartesian>;
using BBox     = bg::model::box<BPoint>;
using BSegment = bg::model::segment<BPoint>;

/// Value stored in the R-tree: bounding box + user payload id.
struct SpatialEntry {
    BBox   box;
    int    id      = 0;   // user-defined identifier
    int    layer   = 0;
    int    net_id  = 0;
};

/// Indexable adapter – tells R-tree how to get the bbox from SpatialEntry.
struct SpatialEntryIndexable {
    using result_type = const BBox&;
    result_type operator()(const SpatialEntry& e) const { return e.box; }
};

/// R-tree based spatial index for rectangles and segments.
class SpatialIndex {
public:
    SpatialIndex();

    /// Insert a rectangle with metadata.
    void insertRect(double x_min, double y_min, double x_max, double y_max,
                    int id, int layer, int net_id = 0);

    /// Insert a segment (internally stored as its bounding box).
    void insertSegment(double x1, double y1, double x2, double y2,
                       int id, int layer, int net_id = 0);

    /// Query all entries whose bbox intersects the given rectangle.
    std::vector<SpatialEntry> queryIntersects(double x_min, double y_min,
                                              double x_max, double y_max) const;

    /// Query entries intersecting the rect, filtered by layer.
    std::vector<SpatialEntry> queryIntersects(double x_min, double y_min,
                                              double x_max, double y_max,
                                              int layer) const;

    /// K-nearest neighbors to a point.
    std::vector<SpatialEntry> queryNearest(double x, double y, unsigned k) const;

    /// K-nearest neighbors to a point, filtered by layer.
    std::vector<SpatialEntry> queryNearest(double x, double y, unsigned k, int layer) const;

    /// Remove all entries with the given id.
    void remove(int id);

    /// Remove all entries.
    void clear();

    std::size_t size() const;

private:
    using RTree = bgi::rtree<SpatialEntry, bgi::quadratic<16>, SpatialEntryIndexable>;
    RTree tree_;
};

}  // namespace routeai
