#pragma once

#include "astar_router.h"
#include "diff_pair_router.h"
#include "global_router.h"
#include "grid.h"
#include "lee_router.h"
#include "length_matcher.h"
#include "ripup_reroute.h"
#include "spatial_index.h"

#include <atomic>
#include <functional>
#include <memory>
#include <string>
#include <unordered_map>
#include <vector>

namespace routeai {

/// Routing strategy.
enum class Strategy {
    AUTO,           // Global first, then A* per net, fallback Lee, rip-up.
    GLOBAL_FIRST,   // Global routing only (guides).
    DIRECT_ASTAR,   // Skip global, A* per net directly.
    LEE_MAZE        // Use Lee/BFS only.
};

/// Progress update callback.
struct ProgressInfo {
    int    nets_total     = 0;
    int    nets_completed = 0;
    int    nets_failed    = 0;
    int    iteration      = 0;
    double completion_pct = 0.0;
    std::string current_net;
    std::string status;
};
using ProgressCallback = std::function<void(const ProgressInfo&)>;

/// Board description (C++ side, populated from protobuf or directly).
struct BoardDesc {
    double x_min = 0, y_min = 0, x_max = 100, y_max = 100;
    int    num_layers = 2;
    double grid_resolution = 0.25;  // mm

    struct PadDesc {
        int    id = 0;
        double cx, cy;
        double w, h;
        int    layer = 0;
        int    net_id = 0;
    };
    struct ViaDesc {
        double cx, cy;
        double drill;
        int    start_layer, end_layer;
        int    net_id = 0;
    };
    struct TraceDesc {
        int net_id = 0;
        int layer  = 0;
        double width = 0.0;
        std::vector<std::pair<double, double>> points;
    };
    struct ZoneDesc {
        int  layer = 0;
        bool is_keepout = false;
        int  net_id = 0;
        std::vector<std::pair<double, double>> outline;
    };
    struct NetDesc {
        int    id = 0;
        std::string name;
        std::vector<int> pad_ids;
        bool   is_diff_pair = false;
        int    diff_pair_partner_id = -1;
        bool   needs_length_match = false;
        std::string length_match_group;
        double target_length = 0.0;
        double length_tolerance = 0.1;
    };

    std::vector<PadDesc>   pads;
    std::vector<ViaDesc>   vias;
    std::vector<TraceDesc> traces;
    std::vector<ZoneDesc>  zones;
    std::vector<NetDesc>   nets;
};

/// Full routing result.
struct FullRoutingResult {
    bool success = false;
    std::unordered_map<int, std::vector<GridCoord>> net_paths;
    std::vector<GridCoord> all_vias;
    std::vector<int> failed_net_ids;
    double total_wire_length = 0.0;
    int    total_vias = 0;
    std::string error;
};

/// Main Router orchestrator.
///
/// Combines GlobalRouter, AStarRouter, LeeRouter, RipupRerouter,
/// DiffPairRouter, and LengthMatcher into a complete routing pipeline.
class Router {
public:
    Router();

    /// Route all nets on the given board.
    FullRoutingResult routeAll(const BoardDesc& board, Strategy strategy = Strategy::AUTO,
                               int max_rip_iterations = 50);

    /// Set progress callback.
    void setProgressCallback(ProgressCallback cb) { progress_cb_ = std::move(cb); }

    /// Request cancellation (can be called from another thread).
    void cancel() { cancelled_.store(true); }
    bool isCancelled() const { return cancelled_.load(); }

private:
    void buildGrid(const BoardDesc& board);
    void populateObstacles(const BoardDesc& board);
    std::vector<NetDescriptor> buildNetDescriptors(const BoardDesc& board) const;
    void reportProgress(const ProgressInfo& info);

    std::unique_ptr<RoutingGrid>      grid_;
    std::unique_ptr<SpatialIndex>     spatial_;
    std::unique_ptr<AStarRouter>      astar_;
    std::unique_ptr<LeeRouter>        lee_;
    std::unique_ptr<GlobalRouter>     global_;
    std::unique_ptr<RipupRerouter>    ripup_;
    std::unique_ptr<DiffPairRouter>   diff_pair_;
    std::unique_ptr<LengthMatcher>    length_matcher_;

    ProgressCallback progress_cb_;
    std::atomic<bool> cancelled_{false};

    // Pad id -> grid coord lookup.
    std::unordered_map<int, GridCoord> pad_coords_;
};

}  // namespace routeai
