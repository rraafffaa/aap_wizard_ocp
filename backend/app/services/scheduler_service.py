"""Task scheduler for automated wizard operations.

Supports scheduling preflight checks, health monitoring,
backup creation, and deployment retry operations.
"""
import asyncio
import inspect
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Callable, Coroutine, Optional, Any

logger = logging.getLogger(__name__)


class TaskStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class RepeatMode(Enum):
    ONCE = "once"
    INTERVAL = "interval"
    CRON = "cron"


@dataclass
class ScheduledTask:
    id: str
    name: str
    description: str
    callback_name: str
    args: dict = field(default_factory=dict)
    status: TaskStatus = TaskStatus.PENDING
    repeat_mode: RepeatMode = RepeatMode.ONCE
    interval_seconds: int = 0
    next_run: float = 0
    last_run: float = 0
    run_count: int = 0
    max_runs: int = 0
    error: str = ""
    created_at: float = field(default_factory=time.time)


@dataclass
class TaskResult:
    task_id: str
    success: bool
    result: Any = None
    error: str = ""
    duration_ms: int = 0
    timestamp: float = field(default_factory=time.time)


class TaskScheduler:
    """Async task scheduler with interval and one-shot support."""

    MAX_RESULTS = 1000

    def __init__(self):
        self._tasks: dict[str, ScheduledTask] = {}
        self._callbacks: dict[str, Callable] = {}
        self._results: list[TaskResult] = []
        self._running = False
        self._loop_task: Optional[asyncio.Task] = None

    def register_callback(self, name: str, callback: Callable[..., Coroutine]) -> None:
        """Register a named callback for scheduled tasks."""
        if not callable(callback):
            raise ValueError(f"Callback '{name}' is not callable")
        if not inspect.iscoroutinefunction(callback):
            raise ValueError(f"Callback '{name}' must be an async function")
        self._callbacks[name] = callback
        logger.info("Registered scheduler callback: %s", name)

    def schedule(
        self,
        name: str,
        callback_name: str,
        args: dict = None,
        delay_seconds: int = 0,
        repeat_mode: RepeatMode = RepeatMode.ONCE,
        interval_seconds: int = 0,
        max_runs: int = 0,
    ) -> ScheduledTask:
        """Schedule a new task."""
        if callback_name not in self._callbacks:
            raise ValueError(
                f"Unknown callback '{callback_name}'. "
                f"Available: {list(self._callbacks.keys())}"
            )

        if repeat_mode == RepeatMode.INTERVAL and interval_seconds <= 0:
            raise ValueError("interval_seconds must be > 0 for INTERVAL repeat mode")

        task = ScheduledTask(
            id=str(uuid.uuid4()),
            name=name,
            description=f"Scheduled {callback_name}",
            callback_name=callback_name,
            args=args or {},
            repeat_mode=repeat_mode,
            interval_seconds=interval_seconds,
            next_run=time.time() + delay_seconds,
            max_runs=max_runs,
        )
        self._tasks[task.id] = task
        logger.info(
            "Scheduled task '%s' (id=%s, mode=%s, delay=%ds)",
            name,
            task.id,
            repeat_mode.value,
            delay_seconds,
        )
        return task

    def cancel(self, task_id: str) -> bool:
        """Cancel a scheduled task."""
        task = self._tasks.get(task_id)
        if not task:
            return False
        if task.status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
            return False
        task.status = TaskStatus.CANCELLED
        logger.info("Cancelled task '%s' (id=%s)", task.name, task.id)
        return True

    def get_tasks(self, status: Optional[TaskStatus] = None) -> list[ScheduledTask]:
        """Get all tasks, optionally filtered by status."""
        tasks = list(self._tasks.values())
        if status is not None:
            tasks = [t for t in tasks if t.status == status]
        return sorted(tasks, key=lambda t: t.created_at, reverse=True)

    def get_task(self, task_id: str) -> Optional[ScheduledTask]:
        return self._tasks.get(task_id)

    def get_results(self, task_id: Optional[str] = None, limit: int = 50) -> list[TaskResult]:
        results = self._results
        if task_id:
            results = [r for r in results if r.task_id == task_id]
        return sorted(results, key=lambda r: r.timestamp, reverse=True)[:limit]

    async def start(self) -> None:
        """Start the scheduler loop."""
        if self._running:
            logger.warning("Scheduler already running")
            return
        self._running = True
        self._loop_task = asyncio.create_task(self._run_loop())
        logger.info("Task scheduler started")

    async def stop(self) -> None:
        """Stop the scheduler loop."""
        if not self._running:
            return
        self._running = False
        if self._loop_task and not self._loop_task.done():
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
        self._loop_task = None
        logger.info("Task scheduler stopped")

    async def _run_loop(self) -> None:
        """Main scheduler loop - checks for due tasks every second."""
        logger.debug("Scheduler loop entered")
        try:
            while self._running:
                now = time.time()
                due_tasks = [
                    t
                    for t in self._tasks.values()
                    if t.status == TaskStatus.PENDING and t.next_run <= now
                ]

                for task in due_tasks:
                    result = await self._execute_task(task)
                    self._results.append(result)
                    if len(self._results) > self.MAX_RESULTS:
                        self._results = self._results[-self.MAX_RESULTS:]

                    if task.repeat_mode == RepeatMode.INTERVAL:
                        hit_limit = task.max_runs > 0 and task.run_count >= task.max_runs
                        if result.success and not hit_limit:
                            self._reschedule(task)
                        elif hit_limit:
                            task.status = TaskStatus.COMPLETED
                            logger.info(
                                "Task '%s' completed after %d runs",
                                task.name,
                                task.run_count,
                            )
                    elif task.repeat_mode == RepeatMode.ONCE:
                        task.status = (
                            TaskStatus.COMPLETED if result.success else TaskStatus.FAILED
                        )

                await asyncio.sleep(1)
        except asyncio.CancelledError:
            logger.debug("Scheduler loop cancelled")
        except Exception:
            logger.exception("Scheduler loop crashed")
            self._running = False

    async def _execute_task(self, task: ScheduledTask) -> TaskResult:
        """Execute a single task and record the result."""
        task.status = TaskStatus.RUNNING
        start = time.monotonic()

        callback = self._callbacks.get(task.callback_name)
        if not callback:
            error_msg = f"Callback '{task.callback_name}' not found"
            task.status = TaskStatus.FAILED
            task.error = error_msg
            logger.error("Task '%s': %s", task.name, error_msg)
            return TaskResult(
                task_id=task.id,
                success=False,
                error=error_msg,
                duration_ms=0,
            )

        try:
            result_value = await callback(**task.args)
            elapsed = int((time.monotonic() - start) * 1000)
            task.last_run = time.time()
            task.run_count += 1
            task.error = ""
            logger.info(
                "Task '%s' completed in %dms (run #%d)",
                task.name,
                elapsed,
                task.run_count,
            )
            return TaskResult(
                task_id=task.id,
                success=True,
                result=result_value,
                duration_ms=elapsed,
            )
        except Exception as exc:
            elapsed = int((time.monotonic() - start) * 1000)
            task.last_run = time.time()
            task.run_count += 1
            task.error = str(exc)
            task.status = TaskStatus.FAILED
            logger.error(
                "Task '%s' failed after %dms: %s",
                task.name,
                elapsed,
                exc,
            )
            return TaskResult(
                task_id=task.id,
                success=False,
                error=str(exc),
                duration_ms=elapsed,
            )

    def _reschedule(self, task: ScheduledTask) -> None:
        """Reschedule a repeating task for its next run."""
        task.next_run = time.time() + task.interval_seconds
        task.status = TaskStatus.PENDING
        logger.debug(
            "Rescheduled task '%s' for +%ds",
            task.name,
            task.interval_seconds,
        )

    def cleanup_completed(self, max_age_hours: int = 24) -> int:
        """Remove old completed tasks and their results."""
        cutoff = time.time() - (max_age_hours * 3600)
        to_remove = [
            tid
            for tid, t in self._tasks.items()
            if t.status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.FAILED)
            and t.last_run > 0
            and t.last_run < cutoff
        ]
        for tid in to_remove:
            del self._tasks[tid]
        self._results = [
            r for r in self._results if r.task_id not in to_remove
        ]
        if to_remove:
            logger.info("Cleaned up %d old tasks", len(to_remove))
        return len(to_remove)

    def stats(self) -> dict:
        """Return scheduler statistics."""
        counts: dict[str, int] = {}
        for t in self._tasks.values():
            counts[t.status.value] = counts.get(t.status.value, 0) + 1
        return {
            "running": self._running,
            "total_tasks": len(self._tasks),
            "total_results": len(self._results),
            "registered_callbacks": list(self._callbacks.keys()),
            "status_counts": counts,
        }

    def to_dict(self) -> dict:
        """Serialise full state for API responses."""
        return {
            "stats": self.stats(),
            "tasks": [
                {
                    "id": t.id,
                    "name": t.name,
                    "description": t.description,
                    "callback": t.callback_name,
                    "status": t.status.value,
                    "repeat_mode": t.repeat_mode.value,
                    "interval_seconds": t.interval_seconds,
                    "next_run_iso": (
                        datetime.fromtimestamp(t.next_run).isoformat()
                        if t.next_run
                        else None
                    ),
                    "last_run_iso": (
                        datetime.fromtimestamp(t.last_run).isoformat()
                        if t.last_run
                        else None
                    ),
                    "run_count": t.run_count,
                    "max_runs": t.max_runs,
                    "error": t.error,
                }
                for t in self.get_tasks()
            ],
            "recent_results": [
                {
                    "task_id": r.task_id,
                    "success": r.success,
                    "error": r.error,
                    "duration_ms": r.duration_ms,
                    "timestamp_iso": datetime.fromtimestamp(r.timestamp).isoformat(),
                }
                for r in self.get_results(limit=20)
            ],
        }
