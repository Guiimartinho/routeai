#include "grid.h"
#include "lee_router.h"

#include <gtest/gtest.h>

using namespace routeai;

class LeeRouterTest : public ::testing::Test {
protected:
    // 20x20 grid, 1 layer.
    RoutingGrid grid{0.0, 0.0, 20.0, 20.0, 1.0, 1};
    LeeRouter router{grid};
};

TEST_F(LeeRouterTest, StraightLine) {
    // Route from (0,0) to (10,0) on a clear grid.
    auto res = router.route(1, {{0, 0, 0}}, {{10, 0, 0}});
    ASSERT_TRUE(res.success);
    EXPECT_EQ(res.path.front(), (GridCoord{0, 0, 0}));
    EXPECT_EQ(res.path.back(), (GridCoord{10, 0, 0}));
    EXPECT_EQ(res.wire_length, 10.0);
    EXPECT_EQ(res.via_count, 0);
}

TEST_F(LeeRouterTest, RouteAroundObstacle) {
    // Place a wall from (5,0) to (5,8).
    for (int y = 0; y <= 8; ++y) {
        grid.setObstacle(5, y, 0, true);
    }

    auto res = router.route(1, {{0, 5, 0}}, {{10, 5, 0}});
    ASSERT_TRUE(res.success);
    EXPECT_EQ(res.path.front(), (GridCoord{0, 5, 0}));
    EXPECT_EQ(res.path.back(), (GridCoord{10, 5, 0}));
    // Path must be longer than Manhattan distance due to detour.
    EXPECT_GT(res.wire_length, 10.0);
}

TEST_F(LeeRouterTest, NoPath) {
    // Completely surround target.
    for (int dx = -1; dx <= 1; ++dx)
        for (int dy = -1; dy <= 1; ++dy)
            if (dx != 0 || dy != 0)
                grid.setObstacle(10 + dx, 10 + dy, 0, true);

    auto res = router.route(1, {{0, 0, 0}}, {{10, 10, 0}});
    EXPECT_FALSE(res.success);
    EXPECT_FALSE(res.error.empty());
}

TEST_F(LeeRouterTest, MultiLayerWithVia) {
    // 2-layer grid.
    RoutingGrid grid2{0.0, 0.0, 20.0, 20.0, 1.0, 2};
    LeeRouter router2{grid2};

    // Block horizontal path on layer 0.
    for (int x = 0; x < 20; ++x) {
        grid2.setObstacle(x, 5, 0, true);
    }
    // Leave layer 0 start and end clear.
    grid2.setObstacle(0, 5, 0, false);
    grid2.setObstacle(10, 5, 0, false);

    auto res = router2.route(1, {{0, 0, 0}}, {{10, 10, 0}});
    ASSERT_TRUE(res.success);
    // Must use via(s) to get around.
    EXPECT_GT(res.via_count, 0);
}

TEST_F(LeeRouterTest, MazeWithCorridor) {
    // Classic maze: two rooms connected by a narrow corridor.
    // Block a partition wall from y=0 to y=18, leaving gap at y=19.
    for (int y = 0; y <= 18; ++y) {
        grid.setObstacle(10, y, 0, true);
    }

    auto res = router.route(1, {{0, 10, 0}}, {{19, 10, 0}});
    ASSERT_TRUE(res.success);
    // The path must go around through the gap at y=19.
    bool passes_gap = false;
    for (auto& c : res.path) {
        if (c.x == 10 && c.y == 19) passes_gap = true;
    }
    EXPECT_TRUE(passes_gap);
}

TEST_F(LeeRouterTest, MultipleStartsEnds) {
    // Multiple start and end points; router should pick the closest pair.
    auto res = router.route(1,
        {{0, 0, 0}, {0, 19, 0}},   // starts: two corners
        {{19, 0, 0}, {19, 19, 0}}); // ends: two corners
    ASSERT_TRUE(res.success);
    // Should be 19 cells long (Manhattan to nearest pair).
    EXPECT_LE(res.wire_length, 19.0 + 1.0);  // tolerance for BFS
}

TEST_F(LeeRouterTest, ExpansionLimit) {
    router.setExpansionLimit(5);
    // With limit of 5, a long route should fail.
    auto res = router.route(1, {{0, 0, 0}}, {{19, 19, 0}});
    EXPECT_FALSE(res.success);
}

TEST_F(LeeRouterTest, SameNetPassthrough) {
    // Mark cells as belonging to net 1, then route net 1 through them.
    for (int x = 3; x <= 7; ++x) {
        grid.markTrace({x, 5, 0}, 1);
    }

    auto res = router.route(1, {{0, 5, 0}}, {{10, 5, 0}});
    ASSERT_TRUE(res.success);
}
