"""Tests for the port scanner service."""
import pytest
import asyncio
from unittest.mock import patch, AsyncMock

from app.services.port_scanner import (
    PortScanner,
    PortScanResult,
    HostScanResult,
    AAP_REQUIRED_PORTS,
)


class TestPortScanner:
    @pytest.fixture
    def scanner(self):
        return PortScanner(timeout=1.0)

    # Port identification
    def test_identify_http(self, scanner):
        assert scanner.get_service_name(80) == "HTTP (Gateway redirect)"

    def test_identify_https(self, scanner):
        assert scanner.get_service_name(443) == "HTTPS (Gateway)"

    def test_identify_postgres(self, scanner):
        assert scanner.get_service_name(5432) == "PostgreSQL"

    def test_identify_redis(self, scanner):
        assert scanner.get_service_name(6379) == "Redis"

    def test_identify_receptor(self, scanner):
        assert scanner.get_service_name(27199) == "Receptor mesh"

    def test_identify_unknown(self, scanner):
        assert scanner.get_service_name(99999) == "port/99999"

    # AAP ports
    def test_aap_required_ports_defined(self):
        assert 80 in AAP_REQUIRED_PORTS
        assert 443 in AAP_REQUIRED_PORTS
        assert 5432 in AAP_REQUIRED_PORTS
        assert 6379 in AAP_REQUIRED_PORTS

    def test_aap_required_ports_count(self):
        assert len(AAP_REQUIRED_PORTS) >= 6

    # Single port scan
    @pytest.mark.asyncio
    async def test_scan_closed_port(self, scanner):
        result = await scanner.scan_port("127.0.0.1", 59999)
        assert result.host == "127.0.0.1"
        assert result.port == 59999
        assert result.state in ("closed", "filtered", "error")

    @pytest.mark.asyncio
    async def test_scan_returns_result(self, scanner):
        result = await scanner.scan_port("127.0.0.1", 59998)
        assert isinstance(result, PortScanResult)
        assert result.host == "127.0.0.1"
        assert result.port == 59998
        assert result.state in ("open", "closed", "filtered", "error")
        assert "service" in dir(result) or result.service is not None

    @pytest.mark.asyncio
    async def test_scan_timeout(self, scanner):
        with patch("asyncio.open_connection", new_callable=AsyncMock) as mock_conn:
            mock_conn.side_effect = asyncio.TimeoutError()
            result = await scanner.scan_port("192.0.2.1", 80)
            assert result.state in ("filtered", "error")

    # Host scan
    @pytest.mark.asyncio
    async def test_scan_host(self, scanner):
        result = await scanner.scan_host("127.0.0.1", [59997, 59996])
        assert isinstance(result, HostScanResult)
        assert result.host == "127.0.0.1"
        assert len(result.ports) == 2
        assert all(isinstance(p, PortScanResult) for p in result.ports)

    @pytest.mark.asyncio
    async def test_scan_host_default_ports(self, scanner):
        result = await scanner.scan_host("127.0.0.1")
        assert result.host == "127.0.0.1"
        assert len(result.ports) == len(AAP_REQUIRED_PORTS)

    # Multiple hosts
    @pytest.mark.asyncio
    async def test_scan_hosts(self, scanner):
        results = await scanner.scan_hosts(
            ["127.0.0.1", "127.0.0.1"],
            [59995, 59994],
        )
        assert len(results) == 2
        assert all(isinstance(r, HostScanResult) for r in results)
        assert results[0].host == "127.0.0.1"
        assert results[1].host == "127.0.0.1"

    # Port conflicts
    @pytest.mark.asyncio
    async def test_find_conflicts(self, scanner):
        conflicts = await scanner.find_port_conflicts("127.0.0.1", [59993, 59992])
        assert isinstance(conflicts, list)
        assert all(c.state == "open" for c in conflicts)

    # Report
    def test_generate_report_empty(self, scanner):
        report = scanner.generate_report([])
        assert "Port Scan Report" in report
        assert "=" in report

    def test_generate_report_with_results(self, scanner):
        results = [
            HostScanResult(
                host="test.example.org",
                ports=[
                    PortScanResult("test.example.org", 80, "open", "HTTP", 1.5),
                    PortScanResult("test.example.org", 443, "closed", "HTTPS", 0.5),
                ],
                scan_time_ms=10.0,
            )
        ]
        report = scanner.generate_report(results)
        assert "test.example.org" in report
        assert "80" in report
        assert "443" in report
        assert "OPEN" in report
        assert "closed" in report.lower()

    # Service names
    def test_get_service_name_known(self, scanner):
        assert "PostgreSQL" in scanner.get_service_name(5432)
        assert "Redis" in scanner.get_service_name(6379)

    def test_get_service_name_unknown(self, scanner):
        assert "port/" in scanner.get_service_name(12345)
