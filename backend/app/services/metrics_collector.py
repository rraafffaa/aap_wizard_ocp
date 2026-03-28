"""Metrics collector for the AAP Deployment Wizard.

Tracks API request metrics, deployment statistics,
and system resource usage for monitoring and debugging.
"""
from __future__ import annotations

import logging
import time
import threading
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

@dataclass
class RequestMetric:
    method: str
    path: str
    status_code: int
    duration_ms: float
    timestamp: float
    request_size: int = 0
    response_size: int = 0

@dataclass
class DeploymentMetric:
    session_id: str
    topology: str
    installation_type: str
    status: str
    total_duration_ms: float
    phase_durations: dict[str, float] = field(default_factory=dict)
    host_count: int = 0
    timestamp: float = 0

@dataclass
class MetricsSummary:
    total_requests: int
    avg_latency_ms: float
    p50_latency_ms: float
    p95_latency_ms: float
    p99_latency_ms: float
    error_rate: float
    requests_per_second: float
    top_endpoints: list[dict]
    status_codes: dict[int, int]
    deployments_total: int
    deployments_success: int
    deployments_failed: int
    avg_deploy_duration_ms: float
    uptime_seconds: float


class MetricsCollector:
    """Thread-safe metrics collector."""

    def __init__(self, max_history: int = 10000):
        self._requests: list[RequestMetric] = []
        self._deployments: list[DeploymentMetric] = []
        self._start_time = time.time()
        self._max_history = max_history
        self._lock = threading.Lock()
        self._counters: dict[str, int] = defaultdict(int)
        self._gauges: dict[str, float] = {}

    def record_request(
        self,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
        request_size: int = 0,
        response_size: int = 0,
    ) -> None:
        """Record an API request metric."""
        with self._lock:
            metric = RequestMetric(
                method=method,
                path=path,
                status_code=status_code,
                duration_ms=duration_ms,
                timestamp=time.time(),
                request_size=request_size,
                response_size=response_size,
            )
            self._requests.append(metric)
            self._cleanup_old()

    def record_deployment(self, metric: DeploymentMetric) -> None:
        """Record a deployment metric."""
        with self._lock:
            if not metric.timestamp:
                metric = DeploymentMetric(
                    session_id=metric.session_id,
                    topology=metric.topology,
                    installation_type=metric.installation_type,
                    status=metric.status,
                    total_duration_ms=metric.total_duration_ms,
                    phase_durations=metric.phase_durations,
                    host_count=metric.host_count,
                    timestamp=time.time(),
                )
            self._deployments.append(metric)
            if len(self._deployments) > self._max_history:
                self._deployments = self._deployments[-self._max_history:]

    def increment_counter(self, name: str, value: int = 1) -> None:
        """Increment a counter."""
        with self._lock:
            self._counters[name] += value

    def set_gauge(self, name: str, value: float) -> None:
        """Set a gauge value."""
        with self._lock:
            self._gauges[name] = value

    def get_summary(self, window_seconds: int = 3600) -> MetricsSummary:
        """Get a summary of metrics within the time window."""
        with self._lock:
            cutoff = time.time() - window_seconds
            recent_requests = [r for r in self._requests if r.timestamp >= cutoff]
            recent_deployments = [d for d in self._deployments if d.timestamp >= cutoff]

            total_requests = len(recent_requests)
            durations = [r.duration_ms for r in recent_requests]
            errors = sum(1 for r in recent_requests if r.status_code >= 400)
            error_rate = errors / total_requests if total_requests else 0.0
            rps = total_requests / window_seconds if window_seconds else 0.0

            endpoint_counts: dict[str, int] = defaultdict(int)
            for r in recent_requests:
                endpoint_counts[f"{r.method} {r.path}"] += 1
            top_endpoints = sorted(
                [{"endpoint": k, "count": v} for k, v in endpoint_counts.items()],
                key=lambda x: -x["count"],
            )[:10]

            status_codes: dict[int, int] = defaultdict(int)
            for r in recent_requests:
                status_codes[r.status_code] += 1

            deploy_success = sum(1 for d in recent_deployments if d.status == "success")
            deploy_failed = sum(1 for d in recent_deployments if d.status == "failed")
            deploy_durations = [d.total_duration_ms for d in recent_deployments]
            avg_deploy = sum(deploy_durations) / len(deploy_durations) if deploy_durations else 0.0

            return MetricsSummary(
                total_requests=total_requests,
                avg_latency_ms=sum(durations) / len(durations) if durations else 0.0,
                p50_latency_ms=self.get_percentile(durations, 50),
                p95_latency_ms=self.get_percentile(durations, 95),
                p99_latency_ms=self.get_percentile(durations, 99),
                error_rate=error_rate,
                requests_per_second=rps,
                top_endpoints=top_endpoints,
                status_codes=dict(status_codes),
                deployments_total=len(recent_deployments),
                deployments_success=deploy_success,
                deployments_failed=deploy_failed,
                avg_deploy_duration_ms=avg_deploy,
                uptime_seconds=time.time() - self._start_time,
            )

    def get_request_metrics(
        self,
        path: Optional[str] = None,
        limit: int = 100,
    ) -> list[RequestMetric]:
        """Get recent request metrics, optionally filtered by path."""
        with self._lock:
            metrics = self._requests
            if path:
                metrics = [r for r in metrics if path in r.path]
            return list(metrics[-limit:])

    def get_deployment_metrics(self, limit: int = 50) -> list[DeploymentMetric]:
        """Get recent deployment metrics."""
        with self._lock:
            return list(self._deployments[-limit:])

    def get_counters(self) -> dict[str, int]:
        """Get all counter values."""
        with self._lock:
            return dict(self._counters)

    def get_gauges(self) -> dict[str, float]:
        """Get all gauge values."""
        with self._lock:
            return dict(self._gauges)

    def get_percentile(self, values: list[float], percentile: float) -> float:
        """Compute percentile of a list of values."""
        if not values:
            return 0.0
        sorted_vals = sorted(values)
        idx = (percentile / 100.0) * (len(sorted_vals) - 1)
        lower = int(idx)
        upper = min(lower + 1, len(sorted_vals) - 1)
        frac = idx - lower
        return sorted_vals[lower] * (1 - frac) + sorted_vals[upper] * frac

    def get_uptime(self) -> float:
        """Get collector uptime in seconds."""
        return time.time() - self._start_time

    def export_prometheus(self) -> str:
        """Export metrics in Prometheus text format."""
        with self._lock:
            lines = [
                "# HELP aap_wizard_requests_total Total API requests",
                "# TYPE aap_wizard_requests_total counter",
                f"aap_wizard_requests_total {len(self._requests)}",
                "# HELP aap_wizard_deployments_total Total deployments",
                "# TYPE aap_wizard_deployments_total counter",
                f"aap_wizard_deployments_total {len(self._deployments)}",
                "# HELP aap_wizard_uptime_seconds Collector uptime",
                "# TYPE aap_wizard_uptime_seconds gauge",
                f"aap_wizard_uptime_seconds {self.get_uptime()}",
            ]
            for name, val in self._counters.items():
                safe_name = name.replace(".", "_").replace("-", "_")
                lines.append(f"aap_wizard_counter_{safe_name} {val}")
            for name, val in self._gauges.items():
                safe_name = name.replace(".", "_").replace("-", "_")
                lines.append(f"aap_wizard_gauge_{safe_name} {val}")
            return "\n".join(lines)

    def export_json(self) -> dict:
        """Export metrics as JSON-serializable dict."""
        summary = self.get_summary()
        return {
            "summary": {
                "total_requests": summary.total_requests,
                "avg_latency_ms": summary.avg_latency_ms,
                "p50_latency_ms": summary.p50_latency_ms,
                "p95_latency_ms": summary.p95_latency_ms,
                "p99_latency_ms": summary.p99_latency_ms,
                "error_rate": summary.error_rate,
                "requests_per_second": summary.requests_per_second,
                "deployments_total": summary.deployments_total,
                "deployments_success": summary.deployments_success,
                "deployments_failed": summary.deployments_failed,
                "avg_deploy_duration_ms": summary.avg_deploy_duration_ms,
                "uptime_seconds": summary.uptime_seconds,
            },
            "counters": self.get_counters(),
            "gauges": self.get_gauges(),
            "top_endpoints": summary.top_endpoints,
            "status_codes": summary.status_codes,
        }

    def reset(self) -> None:
        """Reset all metrics."""
        with self._lock:
            self._requests = []
            self._deployments = []
            self._counters = defaultdict(int)
            self._gauges = {}
            self._start_time = time.time()

    def _cleanup_old(self) -> None:
        """Remove old request metrics beyond max_history."""
        if len(self._requests) > self._max_history:
            self._requests = self._requests[-self._max_history:]


# Global instance
metrics = MetricsCollector()
