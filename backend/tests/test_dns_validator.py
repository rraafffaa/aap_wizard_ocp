"""Comprehensive tests for the DNS validator."""
import pytest
from unittest.mock import patch, AsyncMock

from app.services.dns_validator import DNSValidator, DNSResult


class TestDNSValidator:
    @pytest.fixture
    def validator(self):
        return DNSValidator(timeout=2)

    # FQDN validation
    def test_valid_fqdn(self, validator):
        assert validator.is_valid_fqdn("host.example.org") is True
        assert validator.is_valid_fqdn("aap.example.com") is True
        assert validator.is_valid_fqdn("sub.domain.example.co.uk") is True

    def test_invalid_fqdn_no_dot(self, validator):
        assert validator.is_valid_fqdn("localhost") is False
        assert validator.is_valid_fqdn("hostname") is False

    def test_invalid_fqdn_starts_dash(self, validator):
        assert validator.is_valid_fqdn("-invalid.example.org") is False

    def test_invalid_fqdn_too_long(self, validator):
        long_label = "a" * 64 + ".example.org"
        assert validator.is_valid_fqdn(long_label) is False
        assert validator.is_valid_fqdn("x" * 254) is False

    def test_valid_fqdn_subdomain(self, validator):
        assert validator.is_valid_fqdn("gw1.aap.internal.example.org") is True

    # IP validation
    def test_valid_ipv4(self, validator):
        assert validator.is_valid_ip("192.168.1.1") is True
        assert validator.is_valid_ip("127.0.0.1") is True
        assert validator.is_valid_ip("10.0.0.1") is True

    def test_valid_ipv6(self, validator):
        assert validator.is_valid_ip("::1") is True
        assert validator.is_valid_ip("2001:db8::1") is True
        assert validator.is_valid_ip("fe80::1") is True

    def test_invalid_ip(self, validator):
        assert validator.is_valid_ip("not-an-ip") is False
        assert validator.is_valid_ip("256.256.256.256") is False
        assert validator.is_valid_ip("192.168.1") is False
        assert validator.is_valid_ip("") is False

    # Resolution
    @pytest.mark.asyncio
    async def test_resolve_localhost(self, validator):
        with patch.object(validator, "resolve", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = DNSResult(
                hostname="localhost",
                resolved=True,
                ip_addresses=["127.0.0.1"],
                is_fqdn=False,
                resolution_time_ms=1.0,
            )
            result = await validator.resolve("localhost")
        assert result.resolved is True
        assert "127.0.0.1" in result.ip_addresses

    @pytest.mark.asyncio
    async def test_resolve_nonexistent(self, validator):
        result = await validator.resolve("this-hostname-definitely-does-not-exist-12345.invalid")
        assert result.resolved is False
        assert result.error != ""

    @pytest.mark.asyncio
    async def test_resolve_empty_hostname(self, validator):
        result = await validator.resolve("")
        assert result.resolved is False
        assert "Empty" in result.error or "empty" in result.error.lower()

    # Port checking
    @pytest.mark.asyncio
    async def test_check_port_closed(self, validator):
        # Use a high port that's typically not in use
        is_open = await validator.check_port("127.0.0.1", 59999)
        assert is_open is False

    @pytest.mark.asyncio
    async def test_check_ports_returns_dict(self, validator):
        results = await validator.check_ports("127.0.0.1", [59998, 59999])
        assert isinstance(results, dict)
        assert 59998 in results
        assert 59999 in results
        assert isinstance(results[59998], bool)
        assert isinstance(results[59999], bool)

    # Report
    def test_generate_report_empty(self, validator):
        report = validator.generate_dns_report([])
        assert "DNS Resolution Report" in report
        assert "=" * 60 in report

    def test_generate_report_with_results(self, validator):
        results = [
            DNSResult(
                hostname="host1.example.org",
                resolved=True,
                ip_addresses=["192.168.1.10"],
                reverse_dns="host1.example.org",
                is_fqdn=True,
                resolution_time_ms=5.2,
            ),
            DNSResult(
                hostname="bad.example.org",
                resolved=False,
                error="Name or service not known",
            ),
        ]
        report = validator.generate_dns_report(results)
        assert "host1.example.org" in report
        assert "192.168.1.10" in report
        assert "bad.example.org" in report
        assert "FAIL" in report or "OK" in report

    # Host config validation
    @pytest.mark.asyncio
    async def test_validate_host_config(self, validator):
        result = await validator.validate_host_config("localhost")
        assert "hostname" in result
        assert result["hostname"] == "localhost"
        assert "dns_ok" in result
        assert "is_fqdn" in result
        assert "errors" in result
        assert "warnings" in result
        assert isinstance(result["errors"], list)
        assert isinstance(result["warnings"], list)

    @pytest.mark.asyncio
    async def test_validate_host_config_resolved(self, validator):
        with patch.object(validator, "resolve", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = DNSResult(
                hostname="localhost",
                resolved=True,
                ip_addresses=["127.0.0.1"],
                is_fqdn=False,
                resolution_time_ms=1.0,
            )
            result = await validator.validate_host_config("localhost", expected_ports=[])
        assert result["dns_ok"] is True
        assert len(result["ip_addresses"]) > 0

    @pytest.mark.asyncio
    async def test_validate_host_config_with_ports(self, validator):
        with patch.object(validator, "resolve", new_callable=AsyncMock) as mock_resolve:
            mock_resolve.return_value = DNSResult(
                hostname="127.0.0.1",
                resolved=True,
                ip_addresses=["127.0.0.1"],
                is_fqdn=False,
                resolution_time_ms=1.0,
            )
            result = await validator.validate_host_config(
                "127.0.0.1",
                expected_ports=[59997, 59998],
            )
        assert "ports_ok" in result
        assert 59997 in result["ports_ok"]
        assert 59998 in result["ports_ok"]
        # These ports should be closed
        assert isinstance(result["ports_ok"][59997], bool)
        assert result["ports_ok"][59997] is False

    @pytest.mark.asyncio
    async def test_resolve_all_parallel(self, validator):
        results = await validator.resolve_all(["localhost", "127.0.0.1"])
        assert len(results) == 2
        assert all(isinstance(r, DNSResult) for r in results)
        assert results[0].hostname == "localhost"
        assert results[1].hostname == "127.0.0.1"

    def test_dns_result_dataclass(self):
        r = DNSResult(
            hostname="test.example.org",
            resolved=True,
            ip_addresses=["10.0.0.1"],
            reverse_dns="test.example.org",
            is_fqdn=True,
            ttl=300,
            error="",
            resolution_time_ms=1.5,
        )
        assert r.hostname == "test.example.org"
        assert r.resolved is True
        assert r.ip_addresses == ["10.0.0.1"]
        assert r.is_fqdn is True
