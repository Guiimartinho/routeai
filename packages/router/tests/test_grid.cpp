#include "grid.h"

#include <gtest/gtest.h>

using namespace routeai;

class GridTest : public ::testing::Test {
protected:
    // 10mm x 10mm board, 1mm resolution, 2 layers → 10x10x2 grid.
    RoutingGrid grid{0.0, 0.0, 10.0, 10.0, 1.0, 2};
};

TEST_F(GridTest, Dimensions) {
    EXPECT_EQ(grid.width(), 10);
    EXPECT_EQ(grid.height(), 10);
    EXPECT_EQ(grid.numLayers(), 2);
    EXPECT_DOUBLE_EQ(grid.resolution(), 1.0);
}

TEST_F(GridTest, InBounds) {
    EXPECT_TRUE(grid.inBounds(0, 0, 0));
    EXPECT_TRUE(grid.inBounds(9, 9, 1));
    EXPECT_FALSE(grid.inBounds(10, 0, 0));
    EXPECT_FALSE(grid.inBounds(0, 0, 2));
    EXPECT_FALSE(grid.inBounds(-1, 0, 0));
}

TEST_F(GridTest, WorldToGridRoundTrip) {
    auto gc = grid.worldToGrid(5.5, 3.2, 0);
    EXPECT_EQ(gc.x, 5);
    EXPECT_EQ(gc.y, 3);
    EXPECT_EQ(gc.layer, 0);

    double wx, wy;
    grid.gridToWorld(gc, wx, wy);
    // Cell center should be at (5.5, 3.5) for cell (5,3) with 1mm resolution.
    EXPECT_DOUBLE_EQ(wx, 5.5);
    EXPECT_DOUBLE_EQ(wy, 3.5);
}

TEST_F(GridTest, Obstacles) {
    EXPECT_FALSE(grid.isBlocked(3, 3, 0));
    grid.setObstacle(3, 3, 0, true);
    EXPECT_TRUE(grid.isBlocked(3, 3, 0));
    // Other layer unaffected.
    EXPECT_FALSE(grid.isBlocked(3, 3, 1));
    // Out of bounds is blocked.
    EXPECT_TRUE(grid.isBlocked(100, 100, 0));
}

TEST_F(GridTest, ObstacleRect) {
    grid.setObstacleRect(2, 2, 4, 4, 0, true);
    EXPECT_TRUE(grid.isBlocked(2, 2, 0));
    EXPECT_TRUE(grid.isBlocked(3, 3, 0));
    EXPECT_TRUE(grid.isBlocked(4, 4, 0));
    EXPECT_FALSE(grid.isBlocked(5, 5, 0));
    EXPECT_FALSE(grid.isBlocked(2, 2, 1));
}

TEST_F(GridTest, CostMap) {
    EXPECT_FLOAT_EQ(grid.getCost(0, 0, 0), 1.0f);
    grid.setCost(0, 0, 0, 5.0f);
    EXPECT_FLOAT_EQ(grid.getCost(0, 0, 0), 5.0f);
    grid.addCost(0, 0, 0, 2.5f);
    EXPECT_FLOAT_EQ(grid.getCost(0, 0, 0), 7.5f);

    grid.resetCosts();
    EXPECT_FLOAT_EQ(grid.getCost(0, 0, 0), 1.0f);
}

TEST_F(GridTest, Neighbors_Interior) {
    auto nb = grid.getNeighbors({5, 5, 0}, true);
    // Interior cell, layer 0 with 2 layers: 4 coplanar + 1 via up = 5.
    EXPECT_EQ(nb.size(), 5u);
}

TEST_F(GridTest, Neighbors_Corner) {
    auto nb = grid.getNeighbors({0, 0, 0}, true);
    // Corner: 2 coplanar + 1 via = 3.
    EXPECT_EQ(nb.size(), 3u);
}

TEST_F(GridTest, Neighbors_Blocked) {
    grid.setObstacle(6, 5, 0, true);
    grid.setObstacle(4, 5, 0, true);
    grid.setObstacle(5, 6, 0, true);
    grid.setObstacle(5, 4, 0, true);
    auto nb = grid.getNeighbors({5, 5, 0}, true);
    // All 4 coplanar blocked, only via up remains.
    EXPECT_EQ(nb.size(), 1u);
    EXPECT_EQ(nb[0].layer, 1);
}

TEST_F(GridTest, Neighbors_NoVia) {
    auto nb = grid.getNeighbors({5, 5, 0}, false);
    EXPECT_EQ(nb.size(), 4u);
    for (auto& n : nb) EXPECT_EQ(n.layer, 0);
}

TEST_F(GridTest, TraceMarking) {
    GridCoord c{3, 4, 0};
    EXPECT_EQ(grid.getTraceOwner(3, 4, 0), 0);
    grid.markTrace(c, 42);
    EXPECT_EQ(grid.getTraceOwner(3, 4, 0), 42);
    EXPECT_TRUE(grid.isBlocked(c));

    grid.unmarkTrace(c, 42);
    EXPECT_EQ(grid.getTraceOwner(3, 4, 0), 0);
    EXPECT_FALSE(grid.isBlocked(c));

    // Unmark with wrong net_id does nothing.
    grid.markTrace(c, 42);
    grid.unmarkTrace(c, 99);
    EXPECT_EQ(grid.getTraceOwner(3, 4, 0), 42);
    EXPECT_TRUE(grid.isBlocked(c));
}

TEST_F(GridTest, LayerDirection) {
    // Default: alternating H/V.
    EXPECT_EQ(grid.getLayerDirection(0), PreferredDir::HORIZONTAL);
    EXPECT_EQ(grid.getLayerDirection(1), PreferredDir::VERTICAL);

    grid.setLayerDirection(0, PreferredDir::BOTH);
    EXPECT_EQ(grid.getLayerDirection(0), PreferredDir::BOTH);
}

TEST_F(GridTest, InvalidConstruction) {
    EXPECT_THROW(RoutingGrid(0, 0, 10, 10, -1.0, 2), std::invalid_argument);
    EXPECT_THROW(RoutingGrid(0, 0, 10, 10, 1.0, 0), std::invalid_argument);
}
