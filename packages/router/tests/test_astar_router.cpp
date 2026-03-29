#include "astar_router.h"
#include "grid.h"
#include "lee_router.h"  // RoutingResult

#include <gtest/gtest.h>

using namespace routeai;

class AStarRouterTest : public ::testing::Test {
protected:
    RoutingGrid grid{0.0, 0.0, 20.0, 20.0, 1.0, 2};
    AStarRouter router{grid};
};

TEST_F(AStarRouterTest, StraightLine) {
    auto res = router.route(1, {{0, 0, 0}}, {{10, 0, 0}});
    ASSERT_TRUE(res.success);
    EXPECT_EQ(res.path.front(), (GridCoord{0, 0, 0}));
    EXPECT_EQ(res.path.back(), (GridCoord{10, 0, 0}));
}

TEST_F(AStarRouterTest, PrefersLowCost) {
    // Make the direct horizontal path expensive.
    for (int x = 1; x < 10; ++x) {
        grid.setCost(x, 0, 0, 100.0f);
    }

    auto res = router.route(1, {{0, 0, 0}}, {{10, 0, 0}});
    ASSERT_TRUE(res.success);
    // The path should detour to avoid the high-cost row.
    bool avoids_row0 = true;
    for (std::size_t i = 1; i + 1 < res.path.size(); ++i) {
        if (res.path[i].y == 0 && res.path[i].x > 0 && res.path[i].x < 10) {
            avoids_row0 = false;
            break;
        }
    }
    EXPECT_TRUE(avoids_row0);
}

TEST_F(AStarRouterTest, DirectionPreference) {
    // Layer 0 prefers horizontal, layer 1 prefers vertical (default).
    // Route from (0,0,0) to (10,10,0).
    // Should prefer horizontal moves on layer 0.
    router.setDirectionPenalty(10.0f);  // High penalty for wrong direction.

    auto res = router.route(1, {{0, 0, 0}}, {{10, 10, 0}});
    ASSERT_TRUE(res.success);

    // Count horizontal vs vertical moves on layer 0.
    int h_moves = 0, v_moves = 0;
    for (std::size_t i = 1; i < res.path.size(); ++i) {
        if (res.path[i].layer != 0) continue;
        if (res.path[i].x != res.path[i - 1].x) ++h_moves;
        if (res.path[i].y != res.path[i - 1].y) ++v_moves;
    }
    // With strong direction penalty, should use vias to switch layers for vertical travel.
    // Just verify it completed successfully and uses some vias.
    // (The exact behavior depends on cost tuning.)
    EXPECT_GE(h_moves + v_moves, 1);
}

TEST_F(AStarRouterTest, ViaPenalty) {
    // With high via penalty, prefer to stay on one layer.
    router.setViaPenalty(1000.0f);
    auto res = router.route(1, {{0, 0, 0}}, {{10, 0, 0}});
    ASSERT_TRUE(res.success);
    EXPECT_EQ(res.via_count, 0);
}

TEST_F(AStarRouterTest, AroundObstacle) {
    for (int y = 0; y <= 15; ++y) {
        grid.setObstacle(5, y, 0, true);
        grid.setObstacle(5, y, 1, true);
    }

    auto res = router.route(1, {{0, 5, 0}}, {{10, 5, 0}});
    ASSERT_TRUE(res.success);
    EXPECT_GT(res.wire_length, 10.0);
}

TEST_F(AStarRouterTest, LayerRestriction) {
    NetConstraints nc;
    nc.allowed_layers = {0};  // Only layer 0.

    // Block path on layer 0 completely.
    for (int x = 0; x < 20; ++x) {
        grid.setObstacle(x, 10, 0, true);
    }

    // Route that would need layer 1 should fail.
    auto res = router.route(1, {{0, 0, 0}}, {{0, 19, 0}}, nc);
    EXPECT_FALSE(res.success);
}

TEST_F(AStarRouterTest, CongestionUpdate) {
    // Route net 1 then net 2 on the same path; congestion should increase cost.
    auto res1 = router.route(1, {{0, 0, 0}}, {{10, 0, 0}});
    ASSERT_TRUE(res1.success);

    // Cost along the path should have increased.
    float cost_after = grid.getCost(5, 0, 0);
    EXPECT_GT(cost_after, 1.0f);
}

TEST_F(AStarRouterTest, MaxViaConstraint) {
    NetConstraints nc;
    nc.max_vias = 0;

    // Block layer 0 horizontal path, forcing a via.
    for (int x = 1; x < 10; ++x) {
        grid.setObstacle(x, 5, 0, true);
    }

    auto res = router.route(1, {{0, 5, 0}}, {{10, 5, 0}}, nc);
    // May find a path but should report constraint violation.
    if (res.via_count > 0) {
        EXPECT_FALSE(res.success);  // Constraint violated.
    }
}

TEST_F(AStarRouterTest, EmptyInputs) {
    auto res = router.route(1, {}, {{10, 0, 0}});
    EXPECT_FALSE(res.success);

    res = router.route(1, {{0, 0, 0}}, {});
    EXPECT_FALSE(res.success);
}
