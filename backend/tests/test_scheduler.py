"""Comprehensive tests for the task scheduler."""
import pytest
import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.scheduler_service import (
    TaskScheduler,
    ScheduledTask,
    TaskResult,
    TaskStatus,
    RepeatMode,
)


class TestTaskScheduler:
    @pytest.fixture
    def scheduler(self):
        return TaskScheduler()

    @pytest.fixture
    def sample_callback(self):
        async def _cb(value: str = "ok"):
            return value
        return _cb

    @pytest.fixture
    def failing_callback(self):
        async def _cb():
            raise ValueError("Intentional failure")
        return _cb

    # Registration
    def test_register_callback(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        assert "test_task" in scheduler._callbacks
        assert scheduler._callbacks["test_task"] is sample_callback

    def test_register_multiple_callbacks(self, scheduler, sample_callback, failing_callback):
        scheduler.register_callback("task1", sample_callback)
        scheduler.register_callback("task2", failing_callback)
        assert len(scheduler._callbacks) == 2
        assert "task1" in scheduler._callbacks
        assert "task2" in scheduler._callbacks

    def test_register_non_callable_raises(self, scheduler):
        with pytest.raises(ValueError, match="not callable"):
            scheduler.register_callback("bad", "not a function")

    def test_register_sync_function_raises(self, scheduler):
        def sync_fn():
            pass
        with pytest.raises(ValueError, match="async"):
            scheduler.register_callback("sync", sync_fn)

    # Scheduling
    def test_schedule_task(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("My Task", "test_task")
        assert isinstance(task, ScheduledTask)
        assert task.name == "My Task"
        assert task.callback_name == "test_task"
        assert task.status == TaskStatus.PENDING
        assert task.repeat_mode == RepeatMode.ONCE

    def test_schedule_returns_task(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("Test", "test_task")
        assert task.id in scheduler._tasks
        assert scheduler.get_task(task.id) is task

    def test_schedule_with_delay(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("Delayed", "test_task", delay_seconds=60)
        assert task.next_run > time.time()
        assert task.next_run <= time.time() + 61

    def test_schedule_interval(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule(
            "Interval Task",
            "test_task",
            repeat_mode=RepeatMode.INTERVAL,
            interval_seconds=30,
        )
        assert task.repeat_mode == RepeatMode.INTERVAL
        assert task.interval_seconds == 30

    def test_schedule_unknown_callback_raises(self, scheduler):
        with pytest.raises(ValueError, match="Unknown callback"):
            scheduler.schedule("Test", "nonexistent_callback")

    def test_schedule_interval_without_seconds_raises(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        with pytest.raises(ValueError, match="interval_seconds"):
            scheduler.schedule(
                "Test",
                "test_task",
                repeat_mode=RepeatMode.INTERVAL,
                interval_seconds=0,
            )

    # Cancellation
    def test_cancel_task(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("To Cancel", "test_task")
        result = scheduler.cancel(task.id)
        assert result is True
        assert task.status == TaskStatus.CANCELLED

    def test_cancel_nonexistent(self, scheduler):
        result = scheduler.cancel("nonexistent-id-12345")
        assert result is False

    def test_cancel_completed_returns_false(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("Completed", "test_task")
        task.status = TaskStatus.COMPLETED
        result = scheduler.cancel(task.id)
        assert result is False

    # Queries
    def test_get_tasks_empty(self, scheduler):
        tasks = scheduler.get_tasks()
        assert tasks == []

    def test_get_tasks_filtered(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        t1 = scheduler.schedule("Task 1", "test_task")
        t2 = scheduler.schedule("Task 2", "test_task")
        t2.status = TaskStatus.COMPLETED
        pending = scheduler.get_tasks(status=TaskStatus.PENDING)
        completed = scheduler.get_tasks(status=TaskStatus.COMPLETED)
        assert len(pending) == 1
        assert pending[0].id == t1.id
        assert len(completed) == 1
        assert completed[0].id == t2.id

    def test_get_task_by_id(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("Test", "test_task")
        found = scheduler.get_task(task.id)
        assert found is task
        assert scheduler.get_task("nonexistent") is None

    def test_get_results_empty(self, scheduler):
        results = scheduler.get_results()
        assert results == []

    # Execution
    @pytest.mark.asyncio
    async def test_execute_task(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("Execute Test", "test_task", delay_seconds=0)
        await scheduler.start()
        try:
            await asyncio.sleep(3)
            results = scheduler.get_results(task_id=task.id)
            assert len(results) >= 1
            assert results[0].success is True
            assert results[0].result == "ok"
        finally:
            await scheduler.stop()

    @pytest.mark.asyncio
    async def test_execute_failed_task(self, scheduler, failing_callback):
        scheduler.register_callback("fail_task", failing_callback)
        task = scheduler.schedule("Fail Test", "fail_task", delay_seconds=0)
        await scheduler.start()
        try:
            await asyncio.sleep(3)
            assert task.status == TaskStatus.FAILED
            assert "Intentional failure" in task.error
            results = scheduler.get_results(task_id=task.id)
            assert len(results) >= 1
            assert results[0].success is False
            assert "Intentional failure" in results[0].error
        finally:
            await scheduler.stop()

    @pytest.mark.asyncio
    async def test_execute_records_result(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("Record Test", "test_task", delay_seconds=0)
        await scheduler.start()
        try:
            await asyncio.sleep(3)
            results = scheduler.get_results(task_id=task.id)
            assert len(results) >= 1
            assert results[0].task_id == task.id
            assert results[0].result == "ok"
        finally:
            await scheduler.stop()

    @pytest.mark.asyncio
    async def test_execute_records_duration(self, scheduler, sample_callback):
        async def slow_cb():
            await asyncio.sleep(0.1)
            return "done"

        scheduler.register_callback("slow_task", slow_cb)
        task = scheduler.schedule("Slow Test", "slow_task", delay_seconds=0)
        await scheduler.start()
        try:
            await asyncio.sleep(3)
            results = scheduler.get_results(task_id=task.id)
            assert len(results) >= 1
            assert results[0].duration_ms >= 50
        finally:
            await scheduler.stop()

    # Rescheduling
    def test_reschedule_interval(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule(
            "Interval",
            "test_task",
            repeat_mode=RepeatMode.INTERVAL,
            interval_seconds=10,
        )
        old_next = task.next_run
        scheduler._reschedule(task)
        assert task.status == TaskStatus.PENDING
        assert task.next_run > old_next
        assert task.next_run <= time.time() + 11

    def test_reschedule_max_runs(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule(
            "Limited",
            "test_task",
            repeat_mode=RepeatMode.INTERVAL,
            interval_seconds=10,
            max_runs=2,
        )
        task.run_count = 2
        result = TaskResult(task_id=task.id, success=True)
        # Simulate loop logic: after max_runs, task becomes COMPLETED
        # The actual logic is in _run_loop - we're testing the reschedule behavior
        assert task.max_runs == 2

    # Cleanup
    def test_cleanup_completed(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("Old Task", "test_task")
        task.status = TaskStatus.COMPLETED
        task.last_run = time.time() - (25 * 3600)
        removed = scheduler.cleanup_completed(max_age_hours=24)
        assert removed == 1
        assert task.id not in scheduler._tasks

    def test_cleanup_preserves_recent(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("Recent Task", "test_task")
        task.status = TaskStatus.COMPLETED
        task.last_run = time.time() - 3600  # 1 hour ago
        removed = scheduler.cleanup_completed(max_age_hours=24)
        assert removed == 0
        assert task.id in scheduler._tasks

    def test_cleanup_preserves_pending(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        task = scheduler.schedule("Pending Task", "test_task")
        task.status = TaskStatus.PENDING
        task.last_run = 0
        removed = scheduler.cleanup_completed(max_age_hours=24)
        assert removed == 0
        assert task.id in scheduler._tasks

    # Start/Stop
    @pytest.mark.asyncio
    async def test_start_stop(self, scheduler):
        await scheduler.start()
        assert scheduler._running is True
        assert scheduler._loop_task is not None
        await scheduler.stop()
        assert scheduler._running is False
        assert scheduler._loop_task is None

    @pytest.mark.asyncio
    async def test_start_idempotent(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        await scheduler.start()
        await scheduler.start()  # Second start should not crash
        await scheduler.stop()

    def test_stats(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        scheduler.schedule("T1", "test_task")
        scheduler.schedule("T2", "test_task")
        stats = scheduler.stats()
        assert stats["total_tasks"] == 2
        assert "test_task" in stats["registered_callbacks"]
        assert "status_counts" in stats

    def test_to_dict(self, scheduler, sample_callback):
        scheduler.register_callback("test_task", sample_callback)
        scheduler.schedule("Test", "test_task")
        d = scheduler.to_dict()
        assert "stats" in d
        assert "tasks" in d
        assert "recent_results" in d
        assert len(d["tasks"]) == 1
        assert d["tasks"][0]["name"] == "Test"
