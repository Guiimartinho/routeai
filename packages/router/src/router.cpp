#include "router.h"

#include <algorithm>
#include <climits>
#include <cmath>
#include <unordered_set>

namespace routeai {

Router::Router() = default;

void Router::buildGrid(const BoardDesc& board) {
    double res = board.grid_resolution;
    if (res <= 0.0) res = 0.25;  // default 0.25mm

    grid_ = std::make_unique<RoutingGrid>(
        board.x_min, board.y_min, board.x_max, board.y_max,
        res, board.num_layers);

    spatial_       = std::make_unique<SpatialIndex>();
    astar_         = std::make_unique<AStarRouter>(*grid_);
    lee_           = std::make_unique<LeeRouter>(*grid_);
    global_        = std::make_unique<GlobalRouter>(*grid_, 10);
    ripup_         = std::make_unique<RipupRerouter>(*grid_);
    diff_pair_     = std::make_unique<DiffPairRouter>(*grid_);
    length_matcher_ = std::make_unique<LengthMatcher>(*grid_);
}

void Router::populateObstacles(const BoardDesc& board) {
    // Pads: register in spatial index and mark grid.
    for (auto& pad : board.pads) {
        double hw = pad.w / 2.0, hh = pad.h / 2.0;
        spatial_->insertRect(pad.cx - hw, pad.cy - hh, pad.cx + hw, pad.cy + hh,
                             pad.id, pad.layer, pad.net_id);
        // Mark pad area as obstacle for other nets (will be unblocked for own net).
        auto gc = grid_->worldToGrid(pad.cx, pad.cy, pad.layer);
        pad_coords_[pad.id] = gc;
        // Mark the pad footprint.
        int half_gw = static_cast<int>(std::ceil(hw / grid_->resolution()));
        int half_gh = static_cast<int>(std::ceil(hh / grid_->resolution()));
        grid_->setObstacleRect(gc.x - half_gw, gc.y - half_gh,
                               gc.x + half_gw, gc.y + half_gh,
                               pad.layer, true);
        // Store owner so same-net routing can pass through.
        for (int dy = -half_gh; dy <= half_gh; ++dy)
            for (int dx = -half_gw; dx <= half_gw; ++dx)
                grid_->markTrace({gc.x + dx, gc.y + dy, pad.layer}, pad.net_id);
    }

    // Vias.
    for (auto& via : board.vias) {
        int r = static_cast<int>(std::ceil(via.drill / (2.0 * grid_->resolution())));
        for (int layer = via.start_layer; layer <= via.end_layer; ++layer) {
            auto gc = grid_->worldToGrid(via.cx, via.cy, layer);
            grid_->setObstacleRect(gc.x - r, gc.y - r, gc.x + r, gc.y + r, layer, true);
        }
    }

    // Existing traces.
    for (auto& tr : board.traces) {
        for (std::size_t i = 1; i < tr.points.size(); ++i) {
            auto g0 = grid_->worldToGrid(tr.points[i - 1].first, tr.points[i - 1].second, tr.layer);
            auto g1 = grid_->worldToGrid(tr.points[i].first, tr.points[i].second, tr.layer);
            // Mark cells along the segment.
            int steps = std::max(std::abs(g1.x - g0.x), std::abs(g1.y - g0.y));
            for (int s = 0; s <= steps; ++s) {
                int gx = (steps > 0) ? g0.x + (g1.x - g0.x) * s / steps : g0.x;
                int gy = (steps > 0) ? g0.y + (g1.y - g0.y) * s / steps : g0.y;
                grid_->markTrace({gx, gy, tr.layer}, tr.net_id);
            }
        }
    }

    // Zones (keepout).
    for (auto& zone : board.zones) {
        if (!zone.is_keepout) continue;
        if (zone.outline.size() < 3) continue;
        // Simple approach: rasterize the bounding box of the keepout polygon.
        double xmin = 1e18, ymin = 1e18, xmax = -1e18, ymax = -1e18;
        for (auto& [px, py] : zone.outline) {
            xmin = std::min(xmin, px); ymin = std::min(ymin, py);
            xmax = std::max(xmax, px); ymax = std::max(ymax, py);
        }
        auto gc0 = grid_->worldToGrid(xmin, ymin, zone.layer);
        auto gc1 = grid_->worldToGrid(xmax, ymax, zone.layer);
        grid_->setObstacleRect(gc0.x, gc0.y, gc1.x, gc1.y, zone.layer, true);
    }
}

std::vector<NetDescriptor> Router::buildNetDescriptors(const BoardDesc& board) const {
    std::vector<NetDescriptor> descs;
    descs.reserve(board.nets.size());

    for (auto& net : board.nets) {
        NetDescriptor nd;
        nd.net_id = net.id;

        // Collect pad grid coords; first pad is start, rest are ends.
        for (std::size_t i = 0; i < net.pad_ids.size(); ++i) {
            auto it = pad_coords_.find(net.pad_ids[i]);
            if (it == pad_coords_.end()) continue;
            if (i == 0) {
                nd.starts.push_back(it->second);
            } else {
                nd.ends.push_back(it->second);
            }
        }

        // Skip diff pair nets here; they'll be handled separately.
        if (net.is_diff_pair) continue;
        // Skip nets with < 2 pads.
        if (nd.starts.empty() || nd.ends.empty()) continue;

        descs.push_back(std::move(nd));
    }

    return descs;
}

void Router::reportProgress(const ProgressInfo& info) {
    if (progress_cb_) progress_cb_(info);
}

FullRoutingResult Router::routeAll(const BoardDesc& board, Strategy strategy,
                                    int max_rip_iterations) {
    cancelled_.store(false);
    FullRoutingResult result;

    // ── Build grid and populate obstacles ────────────────────────────────────
    buildGrid(board);
    populateObstacles(board);

    auto net_descs = buildNetDescriptors(board);
    int total_nets = static_cast<int>(net_descs.size());

    ProgressInfo progress;
    progress.nets_total = total_nets;
    progress.status = "starting";
    reportProgress(progress);

    // ── Identify special nets (diff pair, length match) ──────────────────────
    std::unordered_map<int, const BoardDesc::NetDesc*> net_map;
    for (auto& n : board.nets) net_map[n.id] = &n;

    // Collect diff pair nets.
    std::vector<std::pair<int, int>> diff_pairs;
    std::unordered_set<int> diff_pair_ids;
    for (auto& n : board.nets) {
        if (n.is_diff_pair && n.diff_pair_partner_id > n.id) {
            diff_pairs.push_back({n.id, n.diff_pair_partner_id});
            diff_pair_ids.insert(n.id);
            diff_pair_ids.insert(n.diff_pair_partner_id);
        }
    }

    // Collect length match groups.
    std::unordered_map<std::string, std::vector<int>> length_groups;
    for (auto& n : board.nets) {
        if (n.needs_length_match && !n.length_match_group.empty()) {
            length_groups[n.length_match_group].push_back(n.id);
        }
    }

    // ── Phase 1: Global routing (if strategy calls for it) ───────────────────
    std::unordered_map<int, GlobalRoute> global_guides;

    if (strategy == Strategy::AUTO || strategy == Strategy::GLOBAL_FIRST) {
        progress.status = "global routing";
        reportProgress(progress);

        std::vector<std::pair<int, std::vector<GridCoord>>> pin_lists;
        for (auto& nd : net_descs) {
            std::vector<GridCoord> all_pins = nd.starts;
            all_pins.insert(all_pins.end(), nd.ends.begin(), nd.ends.end());
            pin_lists.push_back({nd.net_id, std::move(all_pins)});
        }

        auto guides = global_->guide(pin_lists);
        for (auto& gr : guides) {
            global_guides[gr.net_id] = std::move(gr);
        }

        if (strategy == Strategy::GLOBAL_FIRST) {
            // Only return global guides, skip detailed routing.
            result.success = true;
            result.total_wire_length = 0;
            for (auto& [nid, gr] : global_guides) {
                result.total_wire_length += gr.estimated_length;
            }
            return result;
        }
    }

    // ── Phase 2: Detailed routing ────────────────────────────────────────────
    std::vector<NetDescriptor> failed_nets;
    int completed = 0;

    // Sort nets: shortest bounding box first.
    std::sort(net_descs.begin(), net_descs.end(),
              [](const NetDescriptor& a, const NetDescriptor& b) {
        auto bbox = [](const NetDescriptor& n) {
            int xmin = INT_MAX, xmax = INT_MIN, ymin = INT_MAX, ymax = INT_MIN;
            for (auto& c : n.starts) { xmin = std::min(xmin, c.x); xmax = std::max(xmax, c.x);
                                        ymin = std::min(ymin, c.y); ymax = std::max(ymax, c.y); }
            for (auto& c : n.ends)   { xmin = std::min(xmin, c.x); xmax = std::max(xmax, c.x);
                                        ymin = std::min(ymin, c.y); ymax = std::max(ymax, c.y); }
            return (xmax - xmin) + (ymax - ymin);
        };
        return bbox(a) < bbox(b);
    });

    for (auto& nd : net_descs) {
        if (isCancelled()) {
            result.error = "cancelled";
            return result;
        }

        progress.current_net = std::to_string(nd.net_id);
        progress.status = "routing net " + progress.current_net;
        reportProgress(progress);

        RoutingResult rr;

        if (strategy == Strategy::LEE_MAZE) {
            rr = lee_->route(nd.net_id, nd.starts, nd.ends);
        } else {
            // A* with optional global guide cost bias.
            rr = astar_->route(nd.net_id, nd.starts, nd.ends, nd.constraints);
            if (!rr.success) {
                // Fallback to Lee.
                for (auto& c : rr.path) grid_->unmarkTrace(c, nd.net_id);
                rr = lee_->route(nd.net_id, nd.starts, nd.ends);
            }
        }

        if (rr.success) {
            result.net_paths[nd.net_id] = std::move(rr.path);
            result.total_vias += rr.via_count;
            result.total_wire_length += rr.wire_length * grid_->resolution();
            ++completed;
        } else {
            failed_nets.push_back(nd);
        }

        progress.nets_completed = completed;
        progress.nets_failed = static_cast<int>(failed_nets.size());
        progress.completion_pct = 100.0 * completed / std::max(1, total_nets);
        reportProgress(progress);
    }

    // ── Phase 3: Rip-up & reroute for failed nets ────────────────────────────
    if (!failed_nets.empty() && strategy != Strategy::LEE_MAZE) {
        progress.status = "rip-up & reroute";
        reportProgress(progress);

        ripup_->setProgressCallback([&](int iter, int remaining) {
            progress.iteration = iter;
            progress.nets_failed = remaining;
            progress.status = "rip-up iteration " + std::to_string(iter);
            reportProgress(progress);
        });

        auto rr = ripup_->reroute(failed_nets, max_rip_iterations);

        for (auto& [nid, path] : rr.paths) {
            result.net_paths[nid] = std::move(path);
            ++completed;
        }
        failed_nets.clear();
        for (int fid : rr.failed_net_ids) {
            result.failed_net_ids.push_back(fid);
        }
    }

    // ── Phase 4: Differential pair routing ───────────────────────────────────
    for (auto& [pos_id, neg_id] : diff_pairs) {
        if (isCancelled()) break;

        progress.status = "routing diff pair " + std::to_string(pos_id);
        reportProgress(progress);

        // Gather pads.
        std::vector<GridCoord> pos_starts, pos_ends, neg_starts, neg_ends;
        auto* pos_net = net_map.count(pos_id) ? net_map[pos_id] : nullptr;
        auto* neg_net = net_map.count(neg_id) ? net_map[neg_id] : nullptr;
        if (!pos_net || !neg_net) continue;

        for (std::size_t i = 0; i < pos_net->pad_ids.size(); ++i) {
            auto it = pad_coords_.find(pos_net->pad_ids[i]);
            if (it == pad_coords_.end()) continue;
            if (i == 0) pos_starts.push_back(it->second);
            else pos_ends.push_back(it->second);
        }
        for (std::size_t i = 0; i < neg_net->pad_ids.size(); ++i) {
            auto it = pad_coords_.find(neg_net->pad_ids[i]);
            if (it == pad_coords_.end()) continue;
            if (i == 0) neg_starts.push_back(it->second);
            else neg_ends.push_back(it->second);
        }

        if (pos_starts.empty() || pos_ends.empty() ||
            neg_starts.empty() || neg_ends.empty()) continue;

        auto dpr = diff_pair_->route(pos_id, neg_id,
                                      pos_starts, pos_ends,
                                      neg_starts, neg_ends,
                                      3 /* gap in grid cells */);
        if (dpr.success) {
            result.net_paths[pos_id] = std::move(dpr.pos_path);
            result.net_paths[neg_id] = std::move(dpr.neg_path);
        } else {
            result.failed_net_ids.push_back(pos_id);
            result.failed_net_ids.push_back(neg_id);
        }
    }

    // ── Phase 5: Length matching ─────────────────────────────────────────────
    for (auto& [group, nids] : length_groups) {
        if (isCancelled()) break;

        progress.status = "length matching group " + group;
        reportProgress(progress);

        std::unordered_map<int, std::vector<GridCoord>> group_traces;
        double target = 0.0;
        double tol = 0.1;

        for (int nid : nids) {
            auto pit = result.net_paths.find(nid);
            if (pit != result.net_paths.end()) {
                group_traces[nid] = pit->second;
            }
            auto* nd = net_map.count(nid) ? net_map[nid] : nullptr;
            if (nd) {
                if (nd->target_length > 0.0) target = nd->target_length / grid_->resolution();
                tol = nd->length_tolerance / grid_->resolution();
            }
        }

        if (group_traces.size() >= 2) {
            auto mr = length_matcher_->match(group_traces, target, tol);
            if (mr.success) {
                for (auto& [nid, path] : mr.adjusted_paths) {
                    result.net_paths[nid] = std::move(path);
                }
            }
        }
    }

    // ── Final report ─────────────────────────────────────────────────────────
    result.success = result.failed_net_ids.empty();
    progress.nets_completed = static_cast<int>(result.net_paths.size());
    progress.nets_failed = static_cast<int>(result.failed_net_ids.size());
    progress.completion_pct = 100.0 * progress.nets_completed / std::max(1, total_nets);
    progress.status = result.success ? "complete" : "completed with failures";
    reportProgress(progress);

    return result;
}

}  // namespace routeai
