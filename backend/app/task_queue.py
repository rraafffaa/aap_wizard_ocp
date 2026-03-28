"""
Redis-based task queue for inter-pod communication.

WHAT THIS TEACHES:
  - Microservices communicate through a shared message broker (Redis)
  - The API pod enqueues tasks; the Worker pod dequeues and processes them
  - This decoupling lets you scale workers independently from API servers
  - Redis BLPOP provides efficient blocking reads (no busy-polling)
"""

import os
import json
import uuid
import time
import logging

import redis

logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
TASK_QUEUE = "wizard:tasks"
TASK_STATUS_HASH = "wizard:task_status"
TASK_RESULT_TTL = 86400  # 24 hours


class TaskQueue:
    def __init__(self, redis_url: str | None = None):
        self._url = redis_url or REDIS_URL
        self._client: redis.Redis | None = None

    @property
    def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.from_url(self._url, decode_responses=True)
        return self._client

    def enqueue(self, task_type: str, payload: dict) -> str:
        task_id = str(uuid.uuid4())
        task = {
            "id": task_id,
            "type": task_type,
            "payload": payload,
            "status": "pending",
            "created_at": time.time(),
        }
        self.client.rpush(TASK_QUEUE, json.dumps(task))
        self.set_status(task_id, "pending")
        logger.info("Enqueued task %s (type=%s)", task_id[:8], task_type)
        return task_id

    def dequeue(self, timeout: int = 5) -> dict | None:
        result = self.client.blpop(TASK_QUEUE, timeout=timeout)
        if result:
            _, data = result
            task = json.loads(data)
            self.set_status(task["id"], "processing")
            return task
        return None

    def set_status(self, task_id: str, status: str, result: dict | None = None):
        data = json.dumps({"status": status, "result": result, "updated_at": time.time()})
        self.client.hset(TASK_STATUS_HASH, task_id, data)
        self.client.expire(TASK_STATUS_HASH, TASK_RESULT_TTL)

    def get_status(self, task_id: str) -> dict | None:
        data = self.client.hget(TASK_STATUS_HASH, task_id)
        if data:
            return json.loads(data)
        return None

    def health_check(self) -> bool:
        try:
            return self.client.ping()
        except Exception:
            return False

    def queue_length(self) -> int:
        return self.client.llen(TASK_QUEUE)
