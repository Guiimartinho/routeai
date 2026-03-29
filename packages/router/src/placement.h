#pragma once

#include <cmath>
#include <functional>
#include <string>
#include <vector>

namespace routeai {

/// A component to be placed.
struct PlaceComponent {
    int    id = 0;
    double x  = 0.0;     // center X
    double y  = 0.0;     // center Y
    double w  = 1.0;     // width
    double h  = 1.0;     // height
    bool   fixed = false; // if true, position is locked
};

/// A net connecting pads on components (for force computation).
struct PlaceNet {
    std::vector<int> component_ids;  // 2 or more
};

/// A rectangular keepout zone.
struct PlaceKeepout {
    double x_min, y_min, x_max, y_max;
};

/// Placement result.
struct PlacementResult {
    bool success = false;
    std::vector<PlaceComponent> components;  // with updated x,y
    double total_wirelength = 0.0;           // HPWL
    std::string error;
};

/// Board outline for placement bounds.
struct PlaceBounds {
    double x_min = 0, y_min = 0, x_max = 100, y_max = 100;
};

// ─── Force-Directed Placer ──────────────────────────────────────────────────

/// Iterative force-directed placement.
///
/// Each net acts as a spring between connected components.
/// Components repel each other at short range to avoid overlap.
/// Iteratively updates positions until convergence.
class ForceDirectedPlacer {
public:
    ForceDirectedPlacer(const PlaceBounds& bounds,
                        const std::vector<PlaceKeepout>& keepouts = {});

    PlacementResult place(std::vector<PlaceComponent> components,
                          const std::vector<PlaceNet>& nets,
                          int max_iterations = 200,
                          double convergence_threshold = 0.01);

    void setAttractionWeight(double w) { attraction_weight_ = w; }
    void setRepulsionWeight(double w)  { repulsion_weight_ = w; }

private:
    bool isInKeepout(double x, double y, double w, double h) const;
    void clampToBounds(PlaceComponent& c) const;
    double computeHPWL(const std::vector<PlaceComponent>& comps,
                       const std::vector<PlaceNet>& nets) const;

    PlaceBounds bounds_;
    std::vector<PlaceKeepout> keepouts_;
    double attraction_weight_ = 1.0;
    double repulsion_weight_  = 50.0;
};

// ─── Fiduccia-Mattheyses Min-Cut Partitioner ────────────────────────────────

/// FM partitioning for placement: divides components into two balanced sets
/// minimizing the number of nets crossing the partition boundary.
class FMPartitioner {
public:
    /// Partition components into two sets (left/right or top/bottom).
    /// Returns the partition assignment: false = partition A, true = partition B.
    /// @param balance_ratio  target |A|/|B| ratio (1.0 = balanced).
    std::vector<bool> partition(const std::vector<PlaceComponent>& components,
                                const std::vector<PlaceNet>& nets,
                                double balance_ratio = 1.0,
                                int max_passes = 20);

    /// Recursive bisection placement.
    PlacementResult recursiveBisectionPlace(
        std::vector<PlaceComponent> components,
        const std::vector<PlaceNet>& nets,
        const PlaceBounds& bounds,
        int depth = 4);

private:
    int computeCutSize(const std::vector<bool>& part,
                       const std::vector<PlaceNet>& nets) const;
};

}  // namespace routeai
