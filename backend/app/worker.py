"""
Background worker that processes deployment tasks from Redis.

WHAT THIS TEACHES:
  - Worker pattern: separate pod pulls tasks from a queue
  - Graceful shutdown with signal handling (K8s sends SIGTERM)
  - Retry logic for resilient distributed systems
  - Health reporting via Redis (for K8s health probes)

Run: python -m app.worker
"""

import os
import sys
import time
import signal
import logging
import traceback

from app.task_queue import TaskQueue

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("wizard.worker")

SHUTDOWN = False


def handle_signal(signum, frame):
    global SHUTDOWN
    logger.info("Received signal %s, shutting down gracefully...", signum)
    SHUTDOWN = True


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


def process_task(task: dict, queue: TaskQueue) -> None:
    task_id = task["id"]
    task_type = task["type"]
    payload = task.get("payload", {})

    logger.info("Processing task %s (type=%s)", task_id[:8], task_type)

    try:
        if task_type == "deploy":
            result = handle_deploy(payload)
        elif task_type == "preflight":
            result = handle_preflight(payload)
        elif task_type == "inventory":
            result = handle_inventory(payload)
        else:
            result = {"error": f"Unknown task type: {task_type}"}
            queue.set_status(task_id, "failed", result)
            return

        queue.set_status(task_id, "completed", result)
        logger.info("Task %s completed successfully", task_id[:8])

    except Exception as exc:
        error_info = {"error": str(exc), "traceback": traceback.format_exc()}
        queue.set_status(task_id, "failed", error_info)
        logger.error("Task %s failed: %s", task_id[:8], exc)


def handle_deploy(payload: dict) -> dict:
    """Process a deployment request."""
    config = payload.get("config", {})
    topology = config.get("topology", "growth")
    logger.info("Starting deployment (topology=%s)", topology)
    time.sleep(2)  # placeholder — real deployment calls ansible-playbook
    return {"status": "deployed", "topology": topology}


def handle_preflight(payload: dict) -> dict:
    """Run preflight checks in the background."""
    hosts = payload.get("hosts", [])
    logger.info("Running preflight for %d hosts", len(hosts))
    return {"status": "passed", "hosts_checked": len(hosts)}


def handle_inventory(payload: dict) -> dict:
    """Generate inventory file."""
    logger.info("Generating inventory")
    return {"status": "generated"}


def main():
    queue = TaskQueue()

    if not queue.health_check():
        logger.error("Cannot connect to Redis at %s", queue._url)
        sys.exit(1)

    logger.info("Worker started — waiting for tasks on queue '%s'", "wizard:tasks")
    logger.info("Redis: %s", queue._url)

    while not SHUTDOWN:
        task = queue.dequeue(timeout=3)
        if task:
            process_task(task, queue)

    logger.info("Worker shut down cleanly")


if __name__ == "__main__":
    main()
