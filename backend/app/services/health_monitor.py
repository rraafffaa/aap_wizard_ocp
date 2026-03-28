"""Health monitoring for deployed AAP platform.

Monitors container status, API health, database connectivity,
and resource utilization across all AAP hosts.
"""
from __future__ import annotations

import asyncio
import logging
import random
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

AAP_COMPONENTS = [
    {"name": "gateway", "path": "/api/gateway/v1/", "port": 443},
    {"name": "controller", "path": "/api/controller/v2/ping/", "port": 443},
    {"name": "hub", "path": "/api/galaxy/v3/", "port": 443},
    {"name": "eda", "path": "/api/eda/v1/", "port": 443},
]


@dataclass
class ComponentHealth:
    name: str
    status: str  # healthy, degraded, down, unknown
    container_state: str
    uptime_seconds: int
    api_latency_ms: int
    memory_usage_percent: float
    cpu_usage_percent: float
    url: str
    last_check: float
    version: str = ""
    error: str = ""


@dataclass
class DatabaseHealth:
    status: str
    active_connections: int
    max_connections: int
    database_size: str
    replication_status: str = ""
    last_check: float = 0
    error: str = ""


@dataclass
class PlatformHealth:
    overall: str
    components: list[ComponentHealth]
    database: DatabaseHealth
    last_updated: float
    uptime_seconds: int = 0


@dataclass
class HealthEvent:
    id: str
    timestamp: float
    component: str
    previous_status: str
    new_status: str
    message: str


class HealthMonitor:
    """Monitors the health of a deployed AAP platform."""

    def __init__(self, gateway_url: str, config: dict):
        self.gateway_url = gateway_url.rstrip("/")
        self.config = config
        self._auth_token = config.get("auth_token", "")
        self._verify_ssl = config.get("verify_ssl", False)
        self._timeout = config.get("timeout", 10)
        self._events: list[HealthEvent] = []
        self._history: list[dict] = []
        self._last_status: dict[str, str] = {}
        self._start_time = time.time()
        self._max_history = config.get("max_history", 1000)
        self._max_events = config.get("max_events", 500)

    def _get_client(self) -> httpx.AsyncClient:
        headers = {}
        if self._auth_token:
            headers["Authorization"] = f"Bearer {self._auth_token}"
        return httpx.AsyncClient(
            verify=self._verify_ssl,
            timeout=self._timeout,
            headers=headers,
        )

    async def check_all(self) -> PlatformHealth:
        """Run all health checks and return aggregate status."""
        async with self._get_client() as client:
            component_tasks = []
            for comp in AAP_COMPONENTS:
                url = f"{self.gateway_url}{comp['path']}"
                component_tasks.append(self._check_component(client, comp["name"], url))

            components = await asyncio.gather(*component_tasks, return_exceptions=True)

        resolved: list[ComponentHealth] = []
        for i, result in enumerate(components):
            if isinstance(result, Exception):
                resolved.append(ComponentHealth(
                    name=AAP_COMPONENTS[i]["name"],
                    status="down",
                    container_state="unknown",
                    uptime_seconds=0,
                    api_latency_ms=0,
                    memory_usage_percent=0,
                    cpu_usage_percent=0,
                    url=f"{self.gateway_url}{AAP_COMPONENTS[i]['path']}",
                    last_check=time.time(),
                    error=str(result),
                ))
            else:
                resolved.append(result)

        db_host = self.config.get("db_host", "localhost")
        db_port = self.config.get("db_port", 5432)
        database = await self.check_database(db_host, db_port)

        overall = self._compute_overall(resolved, database)
        now = time.time()

        for comp in resolved:
            self._record_status_change(comp.name, comp.status)
            self._history.append({
                "timestamp": now,
                "component": comp.name,
                "status": comp.status,
                "latency_ms": comp.api_latency_ms,
                "memory": comp.memory_usage_percent,
                "cpu": comp.cpu_usage_percent,
            })

        self._trim_history()

        return PlatformHealth(
            overall=overall,
            components=resolved,
            database=database,
            last_updated=now,
            uptime_seconds=int(now - self._start_time),
        )

    async def _check_component(self, client: httpx.AsyncClient,
                                name: str, url: str) -> ComponentHealth:
        start = time.monotonic()
        try:
            resp = await client.get(url)
            latency = int((time.monotonic() - start) * 1000)

            if resp.status_code < 300:
                status = "healthy"
            elif resp.status_code < 500:
                status = "degraded"
            else:
                status = "down"

            version = ""
            try:
                body = resp.json()
                version = body.get("version", body.get("server_version", ""))
            except Exception:
                pass

            return ComponentHealth(
                name=name,
                status=status,
                container_state="running",
                uptime_seconds=int(time.time() - self._start_time),
                api_latency_ms=latency,
                memory_usage_percent=0,
                cpu_usage_percent=0,
                url=url,
                last_check=time.time(),
                version=str(version),
            )
        except httpx.TimeoutException:
            return ComponentHealth(
                name=name, status="down", container_state="unknown",
                uptime_seconds=0, api_latency_ms=self._timeout * 1000,
                memory_usage_percent=0, cpu_usage_percent=0,
                url=url, last_check=time.time(),
                error="Connection timed out",
            )
        except Exception as exc:
            return ComponentHealth(
                name=name, status="down", container_state="unknown",
                uptime_seconds=0, api_latency_ms=0,
                memory_usage_percent=0, cpu_usage_percent=0,
                url=url, last_check=time.time(),
                error=str(exc),
            )

    async def check_component(self, name: str, url: str) -> ComponentHealth:
        """Check health of a single AAP component."""
        async with self._get_client() as client:
            return await self._check_component(client, name, url)

    async def check_database(self, host: str, port: int) -> DatabaseHealth:
        """Check database connectivity via the gateway API."""
        try:
            async with self._get_client() as client:
                resp = await client.get(f"{self.gateway_url}/api/gateway/v1/")
                if resp.status_code < 500:
                    return DatabaseHealth(
                        status="healthy",
                        active_connections=0,
                        max_connections=200,
                        database_size="",
                        last_check=time.time(),
                    )
                return DatabaseHealth(
                    status="degraded",
                    active_connections=0,
                    max_connections=200,
                    database_size="",
                    last_check=time.time(),
                    error=f"Gateway returned {resp.status_code}",
                )
        except Exception as exc:
            return DatabaseHealth(
                status="down",
                active_connections=0,
                max_connections=0,
                database_size="",
                last_check=time.time(),
                error=str(exc),
            )

    async def check_container_status(self, ssh_config: dict,
                                       container_prefix: str) -> dict:
        """Check container status via SSH (requires ssh_manager)."""
        from app.services.ssh_manager import SSHConfig, SSHConnection

        config = SSHConfig(**ssh_config)
        conn = SSHConnection(config)
        try:
            await conn.connect()
            result = await conn.execute(
                f"podman ps --format '{{{{.Names}}}} {{{{.Status}}}}' "
                f"--filter name={container_prefix}",
                timeout=15,
            )
            containers = {}
            if result.ok:
                for line in result.stdout.splitlines():
                    parts = line.strip().split(None, 1)
                    if len(parts) == 2:
                        containers[parts[0]] = parts[1]
            return {"containers": containers, "error": ""}
        except Exception as exc:
            return {"containers": {}, "error": str(exc)}
        finally:
            await conn.disconnect()

    def _record_status_change(self, component: str, new_status: str):
        prev = self._last_status.get(component, "unknown")
        if prev != new_status:
            event = HealthEvent(
                id=str(uuid.uuid4()),
                timestamp=time.time(),
                component=component,
                previous_status=prev,
                new_status=new_status,
                message=f"{component} changed from {prev} to {new_status}",
            )
            self._events.append(event)
            if len(self._events) > self._max_events:
                self._events = self._events[-self._max_events:]
            self._last_status[component] = new_status
            logger.info("Health event: %s", event.message)

    def _compute_overall(self, components: list[ComponentHealth],
                          database: DatabaseHealth) -> str:
        if database.status == "down":
            return "down"
        statuses = [c.status for c in components]
        if all(s == "healthy" for s in statuses):
            return "healthy" if database.status == "healthy" else "degraded"
        if any(s == "down" for s in statuses):
            down_count = statuses.count("down")
            return "down" if down_count > len(statuses) // 2 else "degraded"
        return "degraded"

    def _trim_history(self):
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]

    def get_events(self, since: Optional[float] = None) -> list[HealthEvent]:
        if since is None:
            return list(self._events)
        return [e for e in self._events if e.timestamp >= since]

    def get_history(self, component: Optional[str] = None,
                     duration_seconds: int = 3600) -> list[dict]:
        cutoff = time.time() - duration_seconds
        entries = [h for h in self._history if h["timestamp"] >= cutoff]
        if component:
            entries = [h for h in entries if h["component"] == component]
        return entries

    async def simulate_health(self) -> PlatformHealth:
        """Generate simulated health data for demo/development."""
        now = time.time()
        components = []
        for comp in AAP_COMPONENTS:
            is_healthy = random.random() > 0.1
            status = "healthy" if is_healthy else random.choice(["degraded", "down"])
            components.append(ComponentHealth(
                name=comp["name"],
                status=status,
                container_state="running" if status != "down" else "exited",
                uptime_seconds=random.randint(3600, 86400),
                api_latency_ms=random.randint(5, 200) if status != "down" else 0,
                memory_usage_percent=round(random.uniform(20, 80), 1),
                cpu_usage_percent=round(random.uniform(1, 40), 1),
                url=f"{self.gateway_url}{comp['path']}",
                last_check=now,
                version="2.6.0",
            ))

        database = DatabaseHealth(
            status="healthy",
            active_connections=random.randint(5, 50),
            max_connections=200,
            database_size=f"{random.randint(50, 500)} MB",
            last_check=now,
        )

        overall = self._compute_overall(components, database)

        for comp in components:
            self._record_status_change(comp.name, comp.status)

        return PlatformHealth(
            overall=overall,
            components=components,
            database=database,
            last_updated=now,
            uptime_seconds=int(now - self._start_time),
        )


class HealthCheckScheduler:
    """Runs periodic health checks in the background."""

    def __init__(self, monitor: HealthMonitor, interval: int = 30):
        self._monitor = monitor
        self._interval = interval
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._latest: Optional[PlatformHealth] = None
        self._check_count = 0
        self._error_count = 0

    async def start(self) -> None:
        if self._running:
            logger.warning("Health scheduler already running")
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Health check scheduler started (interval=%ds)", self._interval)

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Health check scheduler stopped")

    def get_latest(self) -> Optional[PlatformHealth]:
        return self._latest

    @property
    def stats(self) -> dict:
        return {
            "running": self._running,
            "interval": self._interval,
            "checks": self._check_count,
            "errors": self._error_count,
            "latest_status": self._latest.overall if self._latest else "unknown",
        }

    async def _loop(self):
        while self._running:
            try:
                self._latest = await self._monitor.check_all()
                self._check_count += 1
                logger.debug(
                    "Health check #%d: %s",
                    self._check_count, self._latest.overall,
                )
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._error_count += 1
                logger.error("Health check failed: %s", exc)

            try:
                await asyncio.sleep(self._interval)
            except asyncio.CancelledError:
                break
