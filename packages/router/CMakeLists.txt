cmake_minimum_required(VERSION 3.20)
project(routeai-router VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ── Dependencies ──────────────────────────────────────────────────────────────
find_package(Boost REQUIRED COMPONENTS headers)
find_package(Protobuf REQUIRED)
find_package(gRPC CONFIG REQUIRED)
find_package(GTest CONFIG REQUIRED)

# ── Protobuf / gRPC code generation ──────────────────────────────────────────
set(PROTO_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/proto")
set(PROTO_GEN_DIR "${CMAKE_CURRENT_BINARY_DIR}/generated")
file(MAKE_DIRECTORY ${PROTO_GEN_DIR})

set(ROUTING_PROTO "${PROTO_SRC_DIR}/routing.proto")

find_program(GRPC_CPP_PLUGIN grpc_cpp_plugin)

add_custom_command(
    OUTPUT
        "${PROTO_GEN_DIR}/routing.pb.h"
        "${PROTO_GEN_DIR}/routing.pb.cc"
        "${PROTO_GEN_DIR}/routing.grpc.pb.h"
        "${PROTO_GEN_DIR}/routing.grpc.pb.cc"
    COMMAND protobuf::protoc
        --proto_path=${PROTO_SRC_DIR}
        --cpp_out=${PROTO_GEN_DIR}
        --grpc_out=${PROTO_GEN_DIR}
        --plugin=protoc-gen-grpc=${GRPC_CPP_PLUGIN}
        ${ROUTING_PROTO}
    DEPENDS ${ROUTING_PROTO}
    COMMENT "Generating protobuf/gRPC sources for routing.proto"
)

add_library(routeai_proto STATIC
    "${PROTO_GEN_DIR}/routing.pb.cc"
    "${PROTO_GEN_DIR}/routing.grpc.pb.cc"
)
target_include_directories(routeai_proto PUBLIC ${PROTO_GEN_DIR})
target_link_libraries(routeai_proto PUBLIC
    protobuf::libprotobuf
    gRPC::grpc++
)

# ── Core shared library ──────────────────────────────────────────────────────
add_library(routeai_router SHARED
    src/grid.cpp
    src/spatial_index.cpp
    src/lee_router.cpp
    src/astar_router.cpp
    src/ripup_reroute.cpp
    src/global_router.cpp
    src/diff_pair_router.cpp
    src/length_matcher.cpp
    src/placement.cpp
    src/router.cpp
)
target_include_directories(routeai_router PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${PROTO_GEN_DIR}
)
target_link_libraries(routeai_router PUBLIC
    Boost::headers
    routeai_proto
)

# ── gRPC server executable ───────────────────────────────────────────────────
add_executable(routeai_router_server
    src/server.cpp
)
target_link_libraries(routeai_router_server PRIVATE
    routeai_router
    routeai_proto
    gRPC::grpc++
    gRPC::grpc++_reflection
)

# ── Tests ─────────────────────────────────────────────────────────────────────
enable_testing()

add_executable(routeai_router_tests
    tests/test_grid.cpp
    tests/test_lee_router.cpp
    tests/test_astar_router.cpp
    tests/test_placement.cpp
)
target_link_libraries(routeai_router_tests PRIVATE
    routeai_router
    GTest::gtest
    GTest::gtest_main
)
include(GoogleTest)
gtest_discover_tests(routeai_router_tests)
