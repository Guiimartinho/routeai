#include "router.h"

#include <atomic>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

#include <grpcpp/grpcpp.h>
#include <grpcpp/ext/proto_server_reflection_plugin.h>

#include "routing.grpc.pb.h"
#include "routing.pb.h"

using grpc::Server;
using grpc::ServerBuilder;
using grpc::ServerContext;
using grpc::ServerWriter;
using grpc::Status;

namespace routeai {

// ─── Conversion helpers ──────────────────────────────────────────────────────

static BoardDesc boardFromProto(const routing::BoardState& pb) {
    BoardDesc board;
    board.x_min = pb.outline().x_min();
    board.y_min = pb.outline().y_min();
    board.x_max = pb.outline().x_max();
    board.y_max = pb.outline().y_max();
    board.num_layers = pb.layers_size();
    if (board.num_layers < 1) board.num_layers = 2;

    int pad_counter = 0;
    for (auto& comp : pb.components()) {
        for (auto& p : comp.pads()) {
            BoardDesc::PadDesc pd;
            pd.id    = ++pad_counter;
            pd.cx    = p.center().x();
            pd.cy    = p.center().y();
            pd.w     = p.width();
            pd.h     = p.height();
            pd.layer = p.layer_id();
            // net_id resolved below.
            board.pads.push_back(pd);
        }
    }

    for (auto& v : pb.vias()) {
        BoardDesc::ViaDesc vd;
        vd.cx = v.center().x();
        vd.cy = v.center().y();
        vd.drill = v.drill();
        vd.start_layer = v.start_layer();
        vd.end_layer   = v.end_layer();
        board.vias.push_back(vd);
    }

    for (auto& t : pb.traces()) {
        BoardDesc::TraceDesc td;
        td.layer = t.layer_id();
        td.width = t.width();
        for (auto& pt : t.points()) {
            td.points.push_back({pt.x(), pt.y()});
        }
        board.traces.push_back(td);
    }

    for (auto& z : pb.zones()) {
        BoardDesc::ZoneDesc zd;
        zd.layer      = z.layer_id();
        zd.is_keepout = z.is_keepout();
        for (auto& pt : z.outline()) {
            zd.outline.push_back({pt.x(), pt.y()});
        }
        board.zones.push_back(zd);
    }

    int net_counter = 0;
    for (auto& n : pb.nets()) {
        BoardDesc::NetDesc nd;
        nd.id   = ++net_counter;
        nd.name = n.name();
        for (auto& p : n.pads()) {
            // Find pad id by position matching (simplified).
            for (auto& bd_pad : board.pads) {
                if (std::abs(bd_pad.cx - p.center().x()) < 1e-6 &&
                    std::abs(bd_pad.cy - p.center().y()) < 1e-6) {
                    nd.pad_ids.push_back(bd_pad.id);
                    bd_pad.net_id = nd.id;
                    break;
                }
            }
        }
        nd.is_diff_pair          = n.is_diff_pair();
        nd.needs_length_match    = n.needs_length_match();
        nd.length_match_group    = n.length_match_group();
        nd.target_length         = n.target_length();
        nd.length_tolerance      = n.length_tolerance();
        board.nets.push_back(nd);
    }

    return board;
}

static Strategy strategyFromProto(routing::RoutingStrategy s) {
    switch (s) {
        case routing::GLOBAL_FIRST:  return Strategy::GLOBAL_FIRST;
        case routing::DIRECT_ASTAR:  return Strategy::DIRECT_ASTAR;
        case routing::LEE_MAZE:      return Strategy::LEE_MAZE;
        default:                     return Strategy::AUTO;
    }
}

static routing::RouteResult resultToProto(const FullRoutingResult& res, double resolution) {
    routing::RouteResult pb;
    pb.set_success(res.success);
    pb.set_total_wire_length(res.total_wire_length);
    pb.set_total_vias(res.total_vias);
    pb.set_error_message(res.error);

    for (auto& fid : res.failed_net_ids) {
        pb.add_failed_nets(std::to_string(fid));
    }

    // Convert paths to protobuf traces.
    for (auto& [nid, path] : res.net_paths) {
        auto* trace = pb.add_traces();
        trace->set_net_id(std::to_string(nid));
        int layer = path.empty() ? 0 : path.front().layer;
        trace->set_layer_id(layer);
        for (auto& gc : path) {
            auto* pt = trace->add_points();
            pt->set_x(gc.x * resolution);
            pt->set_y(gc.y * resolution);
        }
    }

    return pb;
}

// ─── gRPC service implementation ─────────────────────────────────────────────

class RoutingServiceImpl final : public routing::RoutingService::Service {
public:
    Status RouteNets(ServerContext* context,
                     const routing::RoutingRequest* request,
                     routing::RouteResult* response) override
    {
        auto board = boardFromProto(request->board());
        if (request->grid_resolution() > 0)
            board.grid_resolution = request->grid_resolution();

        auto strategy = strategyFromProto(request->strategy());
        int max_iter = request->max_iterations();
        if (max_iter <= 0) max_iter = 50;

        Router router;
        auto result = router.routeAll(board, strategy, max_iter);
        *response = resultToProto(result, board.grid_resolution);
        return Status::OK;
    }

    Status RouteInteractive(ServerContext* context,
                             const routing::RoutingRequest* request,
                             ServerWriter<routing::RoutingProgress>* writer) override
    {
        auto board = boardFromProto(request->board());
        if (request->grid_resolution() > 0)
            board.grid_resolution = request->grid_resolution();

        auto strategy = strategyFromProto(request->strategy());
        int max_iter = request->max_iterations();
        if (max_iter <= 0) max_iter = 50;

        std::string session_id = context->peer();

        {
            std::lock_guard<std::mutex> lock(sessions_mutex_);
            active_sessions_[session_id] = std::make_shared<Router>();
        }

        auto router = active_sessions_[session_id];

        router->setProgressCallback([&](const ProgressInfo& info) {
            routing::RoutingProgress prog;
            prog.set_nets_total(info.nets_total);
            prog.set_nets_completed(info.nets_completed);
            prog.set_nets_failed(info.nets_failed);
            prog.set_iteration(info.iteration);
            prog.set_completion_pct(info.completion_pct);
            prog.set_current_net(info.current_net);
            prog.set_status_message(info.status);
            writer->Write(prog);
        });

        router->routeAll(board, strategy, max_iter);

        {
            std::lock_guard<std::mutex> lock(sessions_mutex_);
            active_sessions_.erase(session_id);
        }

        return Status::OK;
    }

    Status CancelRouting(ServerContext* /*context*/,
                          const routing::CancelRequest* request,
                          routing::CancelResponse* response) override
    {
        std::lock_guard<std::mutex> lock(sessions_mutex_);
        auto it = active_sessions_.find(request->session_id());
        if (it != active_sessions_.end()) {
            it->second->cancel();
            response->set_acknowledged(true);
        } else {
            response->set_acknowledged(false);
        }
        return Status::OK;
    }

    Status GetStatus(ServerContext* /*context*/,
                      const routing::StatusRequest* /*request*/,
                      routing::RoutingProgress* response) override
    {
        response->set_status_message("status polling not yet implemented");
        return Status::OK;
    }

private:
    std::mutex sessions_mutex_;
    std::unordered_map<std::string, std::shared_ptr<Router>> active_sessions_;
};

}  // namespace routeai

// ─── main ────────────────────────────────────────────────────────────────────

int main(int argc, char** argv) {
    std::string address = "0.0.0.0:50051";
    if (argc > 1) address = argv[1];

    routeai::RoutingServiceImpl service;

    grpc::EnableDefaultHealthCheckService(true);
    grpc::reflection::InitProtoReflectionServerBuilderPlugin();

    ServerBuilder builder;
    builder.AddListeningPort(address, grpc::InsecureServerCredentials());
    builder.RegisterService(&service);

    std::unique_ptr<Server> server(builder.BuildAndStart());
    std::cout << "RouteAI routing server listening on " << address << std::endl;
    server->Wait();

    return 0;
}
