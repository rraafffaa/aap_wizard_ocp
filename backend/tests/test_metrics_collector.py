"""Tests for the metrics collector service."""
import pytest
import time
import threading
from app.services.metrics_collector import (
    MetricsCollector,
    RequestMetric,
    DeploymentMetric,
)


class TestMetricsCollector:
    @pytest.fixture
    def collector(self):
        return MetricsCollector(max_history=100)

    # Request recording
    def test_record_request(self, collector):
        collector.record_request("GET", "/api/health", 200, 5.0)
        metrics = collector.get_request_metrics()
        assert len(metrics) == 1
        assert metrics[0].method == "GET"
        assert metrics[0].path == "/api/health"
        assert metrics[0].status_code == 200
        assert metrics[0].duration_ms == 5.0

    def test_record_multiple_requests(self, collector):
        for i in range(5):
            collector.record_request("GET", f"/api/endpoint{i}", 200, float(i))
        metrics = collector.get_request_metrics()
        assert len(metrics) == 5

    def test_request_limit(self, collector):
        for i in range(150):
            collector.record_request("GET", "/api/test", 200, 1.0)
        metrics = collector.get_request_metrics()
        assert len(metrics) <= 100

    # Deployment recording
    def test_record_deployment(self, collector):
        collector.record_deployment(
            DeploymentMetric(
                session_id="sess-1",
                topology="growth",
                installation_type="online",
                status="success",
                total_duration_ms=120000.0,
                host_count=1,
            )
        )
        deployments = collector.get_deployment_metrics()
        assert len(deployments) == 1
        assert deployments[0].session_id == "sess-1"
        assert deployments[0].status == "success"

    def test_record_failed_deployment(self, collector):
        collector.record_deployment(
            DeploymentMetric(
                session_id="sess-2",
                topology="enterprise",
                installation_type="disconnected",
                status="failed",
                total_duration_ms=5000.0,
                host_count=5,
            )
        )
        summary = collector.get_summary()
        assert summary.deployments_failed >= 1

    # Counters
    def test_increment_counter(self, collector):
        collector.increment_counter("api_calls")
        collector.increment_counter("api_calls")
        assert collector.get_counters()["api_calls"] == 2

    def test_increment_by_value(self, collector):
        collector.increment_counter("errors", 5)
        assert collector.get_counters()["errors"] == 5

    def test_get_counters(self, collector):
        collector.increment_counter("a")
        collector.increment_counter("b", 3)
        counters = collector.get_counters()
        assert counters["a"] == 1
        assert counters["b"] == 3

    # Gauges
    def test_set_gauge(self, collector):
        collector.set_gauge("active_sessions", 3.0)
        assert collector.get_gauges()["active_sessions"] == 3.0

    def test_get_gauges(self, collector):
        collector.set_gauge("memory_mb", 256.0)
        gauges = collector.get_gauges()
        assert gauges["memory_mb"] == 256.0

    # Summary
    def test_summary_empty(self, collector):
        summary = collector.get_summary()
        assert summary.total_requests == 0
        assert summary.avg_latency_ms == 0.0
        assert summary.error_rate == 0.0
        assert summary.deployments_total == 0

    def test_summary_with_requests(self, collector):
        collector.record_request("GET", "/api/a", 200, 10.0)
        collector.record_request("GET", "/api/b", 200, 20.0)
        summary = collector.get_summary()
        assert summary.total_requests == 2
        assert summary.avg_latency_ms == 15.0

    def test_summary_error_rate(self, collector):
        collector.record_request("GET", "/api/a", 200, 1.0)
        collector.record_request("GET", "/api/b", 500, 1.0)
        summary = collector.get_summary()
        assert summary.error_rate == 0.5

    def test_summary_uptime(self, collector):
        time.sleep(0.05)
        assert collector.get_uptime() >= 0.05

    # Percentile
    def test_percentile_p50(self, collector):
        vals = [1.0, 2.0, 3.0, 4.0, 5.0]
        p50 = collector.get_percentile(vals, 50)
        assert 2.0 <= p50 <= 4.0

    def test_percentile_p95(self, collector):
        vals = list(range(1, 101))
        p95 = collector.get_percentile(vals, 95)
        assert 90 <= p95 <= 100

    def test_percentile_p99(self, collector):
        vals = list(range(1, 101))
        p99 = collector.get_percentile(vals, 99)
        assert 95 <= p99 <= 100

    def test_percentile_empty(self, collector):
        assert collector.get_percentile([], 50) == 0.0

    # Export
    def test_export_json(self, collector):
        collector.record_request("GET", "/api/health", 200, 1.0)
        data = collector.export_json()
        assert "summary" in data
        assert "counters" in data
        assert "gauges" in data
        assert data["summary"]["total_requests"] == 1

    def test_export_prometheus(self, collector):
        collector.record_request("GET", "/api/health", 200, 1.0)
        output = collector.export_prometheus()
        assert "aap_wizard" in output
        assert "requests_total" in output or "uptime" in output

    def test_export_prometheus_format(self, collector):
        collector.increment_counter("test_counter")
        collector.set_gauge("test_gauge", 42.0)
        output = collector.export_prometheus()
        assert "test_counter" in output or "counter" in output
        assert "42" in output

    # Reset
    def test_reset(self, collector):
        collector.record_request("GET", "/api/test", 200, 1.0)
        collector.increment_counter("x")
        collector.set_gauge("y", 1.0)
        collector.reset()
        assert len(collector.get_request_metrics()) == 0
        assert collector.get_counters() == {}
        assert collector.get_gauges() == {}

    # Thread safety
    def test_concurrent_recording(self, collector):
        def record_many():
            for i in range(50):
                collector.record_request("GET", "/api/test", 200, 1.0)
                collector.increment_counter("concurrent")

        threads = [threading.Thread(target=record_many) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert collector.get_counters().get("concurrent", 0) == 200
        assert len(collector.get_request_metrics()) >= 100
