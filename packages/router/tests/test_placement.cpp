#include "placement.h"

#include <cmath>
#include <gtest/gtest.h>

using namespace routeai;

// ═══════════════════════════════════════════════════════════════════════════════
//  Force-Directed Placer Tests
// ═══════════════════════════════════════════════════════════════════════════════

class ForceDirectedPlacerTest : public ::testing::Test {
protected:
    PlaceBounds bounds{0, 0, 100, 100};
    ForceDirectedPlacer placer{bounds};
};

TEST_F(ForceDirectedPlacerTest, SingleComponent) {
    std::vector<PlaceComponent> comps = {{0, 50, 50, 5, 5, false}};
    auto res = placer.place(comps, {});
    ASSERT_TRUE(res.success);
    EXPECT_EQ(res.components.size(), 1u);
}

TEST_F(ForceDirectedPlacerTest, TwoConnectedComponents) {
    // Two components connected by a net should be pulled toward each other.
    std::vector<PlaceComponent> comps = {
        {0, 10, 50, 5, 5, false},
        {1, 90, 50, 5, 5, false}
    };
    std::vector<PlaceNet> nets = {{/*component_ids=*/{0, 1}}};

    double initial_dist = std::abs(comps[0].x - comps[1].x);
    auto res = placer.place(comps, nets, 200);
    ASSERT_TRUE(res.success);

    double final_dist = std::abs(res.components[0].x - res.components[1].x);
    EXPECT_LT(final_dist, initial_dist);
}

TEST_F(ForceDirectedPlacerTest, FixedComponent) {
    std::vector<PlaceComponent> comps = {
        {0, 10, 50, 5, 5, true},   // fixed
        {1, 90, 50, 5, 5, false}
    };
    std::vector<PlaceNet> nets = {{/*component_ids=*/{0, 1}}};

    auto res = placer.place(comps, nets, 100);
    ASSERT_TRUE(res.success);
    // Fixed component should not move.
    EXPECT_DOUBLE_EQ(res.components[0].x, 10.0);
    EXPECT_DOUBLE_EQ(res.components[0].y, 50.0);
}

TEST_F(ForceDirectedPlacerTest, Keepout) {
    PlaceKeepout ko{40, 40, 60, 60};
    ForceDirectedPlacer placer_ko{bounds, {ko}};

    std::vector<PlaceComponent> comps = {
        {0, 50, 50, 5, 5, false},  // starts inside keepout
    };

    auto res = placer_ko.place(comps, {}, 100);
    ASSERT_TRUE(res.success);
    // Should have been pushed out of the keepout.
    auto& c = res.components[0];
    bool inside = (c.x - c.w / 2 < ko.x_max && c.x + c.w / 2 > ko.x_min &&
                   c.y - c.h / 2 < ko.y_max && c.y + c.h / 2 > ko.y_min);
    EXPECT_FALSE(inside);
}

TEST_F(ForceDirectedPlacerTest, StaysInBounds) {
    std::vector<PlaceComponent> comps = {
        {0, -10, -10, 5, 5, false},  // starts out of bounds
    };

    auto res = placer.place(comps, {}, 10);
    ASSERT_TRUE(res.success);
    auto& c = res.components[0];
    EXPECT_GE(c.x - c.w / 2.0, bounds.x_min);
    EXPECT_LE(c.x + c.w / 2.0, bounds.x_max);
    EXPECT_GE(c.y - c.h / 2.0, bounds.y_min);
    EXPECT_LE(c.y + c.h / 2.0, bounds.y_max);
}

TEST_F(ForceDirectedPlacerTest, HPWLReduces) {
    // 4 components in a star pattern connected to a central net.
    std::vector<PlaceComponent> comps = {
        {0,  5,  50, 3, 3, false},
        {1, 95,  50, 3, 3, false},
        {2, 50,   5, 3, 3, false},
        {3, 50,  95, 3, 3, false},
    };
    std::vector<PlaceNet> nets = {{{0, 1, 2, 3}}};

    auto res = placer.place(comps, nets, 300);
    ASSERT_TRUE(res.success);
    EXPECT_LT(res.total_wirelength, 180.0);  // Initial HPWL = 90+90=180
}

// ═══════════════════════════════════════════════════════════════════════════════
//  FM Partitioner Tests
// ═══════════════════════════════════════════════════════════════════════════════

class FMPartitionerTest : public ::testing::Test {
protected:
    FMPartitioner partitioner;
};

TEST_F(FMPartitionerTest, TwoDisconnected) {
    // Two groups of components with no cross-connections.
    std::vector<PlaceComponent> comps(6);
    for (int i = 0; i < 6; ++i) comps[i].id = i;

    std::vector<PlaceNet> nets = {
        {{0, 1, 2}},  // group A internal
        {{3, 4, 5}},  // group B internal
    };

    auto part = partitioner.partition(comps, nets);
    ASSERT_EQ(part.size(), 6u);

    // All of group A should be on the same side, all of group B on the other.
    EXPECT_EQ(part[0], part[1]);
    EXPECT_EQ(part[1], part[2]);
    EXPECT_EQ(part[3], part[4]);
    EXPECT_EQ(part[4], part[5]);
    EXPECT_NE(part[0], part[3]);
}

TEST_F(FMPartitionerTest, MinimalCut) {
    // 4 components: (0,1) tightly connected, (2,3) tightly connected,
    // with one cross-net.
    std::vector<PlaceComponent> comps(4);
    for (int i = 0; i < 4; ++i) comps[i].id = i;

    std::vector<PlaceNet> nets = {
        {{0, 1}},
        {{0, 1}},  // double-weight internal
        {{2, 3}},
        {{2, 3}},
        {{1, 2}},  // single cross-net
    };

    auto part = partitioner.partition(comps, nets);
    // Components 0,1 should be together and 2,3 together.
    EXPECT_EQ(part[0], part[1]);
    EXPECT_EQ(part[2], part[3]);
}

TEST_F(FMPartitionerTest, RecursiveBisection) {
    std::vector<PlaceComponent> comps;
    for (int i = 0; i < 8; ++i) {
        comps.push_back({i, 50.0, 50.0, 3.0, 3.0, false});
    }

    std::vector<PlaceNet> nets = {
        {{0, 1}}, {{2, 3}}, {{4, 5}}, {{6, 7}},
        {{0, 4}}, {{1, 5}}, {{2, 6}}, {{3, 7}},
    };

    PlaceBounds bounds{0, 0, 100, 100};
    auto res = partitioner.recursiveBisectionPlace(comps, nets, bounds, 3);
    ASSERT_TRUE(res.success);
    EXPECT_EQ(res.components.size(), 8u);

    // All components should be within bounds.
    for (auto& c : res.components) {
        EXPECT_GE(c.x, bounds.x_min);
        EXPECT_LE(c.x, bounds.x_max);
        EXPECT_GE(c.y, bounds.y_min);
        EXPECT_LE(c.y, bounds.y_max);
    }
}

TEST_F(FMPartitionerTest, EmptyInput) {
    auto part = partitioner.partition({}, {});
    EXPECT_TRUE(part.empty());
}
