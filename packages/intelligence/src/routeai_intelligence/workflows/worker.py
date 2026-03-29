"""Temporal worker that registers RouteAI workflows and activities.

Usage:
    python -m routeai_intelligence.workflows.worker \
        --server localhost:7233 \
        --task-queue routeai-jobs \
        --max-concurrent-activities 10

The worker connects to the Temporal server and begins polling for tasks
on the configured queue.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys

from temporalio.client import Client
from temporalio.worker import Worker

from routeai_intelligence.workflows.activities import (
    execute_routing,
    generate_strategy,
    merge_reports,
    parse_project,
    run_drc,
    run_llm_review,
    run_physics_checks,
)
from routeai_intelligence.workflows.review_workflow import ReviewWorkflow
from routeai_intelligence.workflows.routing_workflow import RoutingWorkflow

logger = logging.getLogger(__name__)

ALL_ACTIVITIES = [
    parse_project,
    run_drc,
    run_llm_review,
    run_physics_checks,
    merge_reports,
    generate_strategy,
    execute_routing,
]

ALL_WORKFLOWS = [
    ReviewWorkflow,
    RoutingWorkflow,
]

DEFAULT_TASK_QUEUE = "routeai-jobs"
DEFAULT_SERVER = "localhost:7233"
DEFAULT_MAX_CONCURRENT_ACTIVITIES = 10
DEFAULT_MAX_CONCURRENT_WORKFLOWS = 100


async def run_worker(
    server_address: str,
    task_queue: str,
    max_concurrent_activities: int,
    max_concurrent_workflows: int,
) -> None:
    """Connect to Temporal and run the worker until interrupted."""
    logger.info("Connecting to Temporal at %s", server_address)
    client = await Client.connect(server_address)

    logger.info(
        "Starting worker on task queue %r (max activities=%d, max workflows=%d)",
        task_queue,
        max_concurrent_activities,
        max_concurrent_workflows,
    )

    worker = Worker(
        client,
        task_queue=task_queue,
        workflows=ALL_WORKFLOWS,
        activities=ALL_ACTIVITIES,
        max_concurrent_activities=max_concurrent_activities,
        max_concurrent_workflow_tasks=max_concurrent_workflows,
    )

    shutdown_event = asyncio.Event()

    def _signal_handler(sig: int, frame: object) -> None:
        logger.info("Received signal %s, initiating graceful shutdown", sig)
        shutdown_event.set()

    signal.signal(signal.SIGINT, _signal_handler)
    signal.signal(signal.SIGTERM, _signal_handler)

    async with worker:
        logger.info("Worker started and polling for tasks")
        await shutdown_event.wait()

    logger.info("Worker shut down cleanly")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="RouteAI Temporal worker for job orchestration",
    )
    parser.add_argument(
        "--server",
        default=DEFAULT_SERVER,
        help=f"Temporal server address (default: {DEFAULT_SERVER})",
    )
    parser.add_argument(
        "--task-queue",
        default=DEFAULT_TASK_QUEUE,
        help=f"Task queue name (default: {DEFAULT_TASK_QUEUE})",
    )
    parser.add_argument(
        "--max-concurrent-activities",
        type=int,
        default=DEFAULT_MAX_CONCURRENT_ACTIVITIES,
        help=f"Max concurrent activities (default: {DEFAULT_MAX_CONCURRENT_ACTIVITIES})",
    )
    parser.add_argument(
        "--max-concurrent-workflows",
        type=int,
        default=DEFAULT_MAX_CONCURRENT_WORKFLOWS,
        help=f"Max concurrent workflow tasks (default: {DEFAULT_MAX_CONCURRENT_WORKFLOWS})",
    )
    parser.add_argument(
        "--log-level",
        default="INFO",
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging level (default: INFO)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    asyncio.run(
        run_worker(
            server_address=args.server,
            task_queue=args.task_queue,
            max_concurrent_activities=args.max_concurrent_activities,
            max_concurrent_workflows=args.max_concurrent_workflows,
        )
    )


if __name__ == "__main__":
    main()
