"""Comprehensive tests for the system info collector."""
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from app.services.system_info import (
    SystemInfoCollector,
    OSInfo,
    HardwareInfo,
    SoftwareInfo,
    NetworkInfo,
    SystemInfo,
    AAP_MIN_CPU,
    AAP_MIN_MEMORY_GB,
    AAP_MIN_DISK_GB,
)


class TestSystemInfoCollector:
    @pytest.fixture
    def collector(self):
        return SystemInfoCollector()

    # OS parsing
    def test_parse_os_release_rhel(self, collector):
        content = '''
NAME="Red Hat Enterprise Linux"
VERSION="9.4 (Plow)"
VERSION_ID="9.4"
'''
        result = collector._parse_os_release(content, "host.example.org")
        assert result.name == "Red Hat Enterprise Linux"
        assert result.version == "9.4"
        assert result.hostname == "host.example.org"

    def test_parse_os_release_centos(self, collector):
        content = '''
NAME="CentOS Stream"
VERSION="9"
VERSION_ID="9"
'''
        result = collector._parse_os_release(content, "centos.example.org")
        assert result.name == "CentOS Stream"
        assert result.version == "9"

    def test_parse_os_release_empty(self, collector):
        result = collector._parse_os_release("", "localhost")
        assert result.name == "Unknown"
        assert result.version == ""

    # CPU parsing
    def test_parse_cpu_info(self, collector):
        content = """
processor	: 0
model name	: Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz
"""
        count, model = collector._parse_cpu_info(content)
        assert count == 1
        assert "Xeon" in model or "Intel" in model

    def test_parse_cpu_info_multi_core(self, collector):
        content = """
processor	: 0
model name	: Intel Xeon
processor	: 1
processor	: 2
processor	: 3
"""
        count, model = collector._parse_cpu_info(content)
        assert count == 4

    # Memory parsing
    def test_parse_memory_info(self, collector):
        content = """
MemTotal:       32768000 kB
MemFree:        8192000 kB
MemAvailable:   16384000 kB
"""
        total, avail = collector._parse_memory_info(content)
        assert total > 0
        assert avail > 0
        assert total > avail

    def test_parse_memory_info_low(self, collector):
        content = """
MemTotal:       4194304 kB
MemAvailable:   1048576 kB
"""
        total, avail = collector._parse_memory_info(content)
        assert total == 4.0  # 4GB in GB
        assert avail == 1.0

    # Disk parsing
    def test_parse_disk_info(self, collector):
        content = """
Filesystem     1G-blocks  Used Available Use% Mounted on
/dev/sda1            100     20        80  20% /
"""
        total, avail = collector._parse_disk_info(content)
        assert total == 100.0
        assert avail == 80.0

    def test_parse_disk_info_512_blocks(self, collector):
        content = """
Filesystem     512-blocks      Used Available Capacity Mounted on
/dev/sda1       209715200  41943040 167772160    20% /
"""
        total, avail = collector._parse_disk_info(content)
        assert total > 0
        assert avail > 0

    # Software checks (indirect via _check_software - we test _extract_version)
    def test_extract_version(self, collector):
        assert collector._extract_version("Python 3.12.6") == "3.12.6"
        assert collector._extract_version("ansible [core 2.16.12]") == "2.16.12"
        assert collector._extract_version("podman version 5.2.2") == "5.2.2"
        assert collector._extract_version("no version here") == ""

    # AAP requirements
    def test_check_requirements_pass(self, collector):
        info = SystemInfo(
            os=OSInfo("RHEL", "9.4", "5.14", "x86_64", "host", "host.example.org"),
            hardware=HardwareInfo(8, "Intel Xeon", 32.0, 16.0, 100.0, 80.0),
            software=SoftwareInfo("3.12", "2.16", "5.0", "OpenSSL 3.0", True, "enforcing", False),
            network=NetworkInfo([], "", [], [], []),
            collection_time=0,
        )
        results = collector.check_aap_requirements(info)
        passed = [r for r in results if r["status"] == "passed"]
        assert len(passed) >= 4
        assert any(r["check"] == "cpu_count" and r["status"] == "passed" for r in results)
        assert any(r["check"] == "memory" and r["status"] == "passed" for r in results)
        assert any(r["check"] == "disk" and r["status"] == "passed" for r in results)

    def test_check_requirements_low_memory(self, collector):
        info = SystemInfo(
            os=OSInfo("RHEL", "9.4", "5.14", "x86_64", "host", "host.example.org"),
            hardware=HardwareInfo(8, "Intel Xeon", 8.0, 4.0, 100.0, 80.0),
            software=SoftwareInfo("3.12", "2.16", "5.0", "OpenSSL", True, "enforcing", False),
            network=NetworkInfo([], "", [], [], []),
            collection_time=0,
        )
        results = collector.check_aap_requirements(info)
        mem_check = next(r for r in results if r["check"] == "memory")
        assert mem_check["status"] == "failed"
        assert str(AAP_MIN_MEMORY_GB) in mem_check["message"]

    def test_check_requirements_low_cpu(self, collector):
        info = SystemInfo(
            os=OSInfo("RHEL", "9.4", "5.14", "x86_64", "host", "host.example.org"),
            hardware=HardwareInfo(2, "Intel", 32.0, 16.0, 100.0, 80.0),
            software=SoftwareInfo("3.12", "2.16", "5.0", "OpenSSL", True, "enforcing", False),
            network=NetworkInfo([], "", [], [], []),
            collection_time=0,
        )
        results = collector.check_aap_requirements(info)
        cpu_check = next(r for r in results if r["check"] == "cpu_count")
        assert cpu_check["status"] == "failed"
        assert str(AAP_MIN_CPU) in cpu_check["message"]

    def test_check_requirements_low_disk(self, collector):
        info = SystemInfo(
            os=OSInfo("RHEL", "9.4", "5.14", "x86_64", "host", "host.example.org"),
            hardware=HardwareInfo(8, "Intel", 32.0, 16.0, 100.0, 20.0),
            software=SoftwareInfo("3.12", "2.16", "5.0", "OpenSSL", True, "enforcing", False),
            network=NetworkInfo([], "", [], [], []),
            collection_time=0,
        )
        results = collector.check_aap_requirements(info)
        disk_check = next(r for r in results if r["check"] == "disk")
        assert disk_check["status"] == "failed"
        assert str(AAP_MIN_DISK_GB) in disk_check["message"]

    def test_check_requirements_missing_python(self, collector):
        info = SystemInfo(
            os=OSInfo("RHEL", "9.4", "5.14", "x86_64", "host", "host.example.org"),
            hardware=HardwareInfo(8, "Intel", 32.0, 16.0, 100.0, 80.0),
            software=SoftwareInfo("", "2.16", "5.0", "OpenSSL", True, "enforcing", False),
            network=NetworkInfo([], "", [], [], []),
            collection_time=0,
        )
        results = collector.check_aap_requirements(info)
        py_check = next(r for r in results if r["check"] == "python")
        assert py_check["status"] == "failed"

    # Report
    def test_generate_report(self, collector):
        info = SystemInfo(
            os=OSInfo("RHEL", "9.4", "5.14", "x86_64", "host", "host.example.org"),
            hardware=HardwareInfo(8, "Intel Xeon", 32.0, 16.0, 100.0, 80.0),
            software=SoftwareInfo("3.12", "2.16", "5.0", "OpenSSL 3.0", True, "enforcing", False),
            network=NetworkInfo(["192.168.1.10"], "192.168.1.1", [], [], []),
            collection_time=0,
        )
        report = collector.generate_compatibility_report(info)
        assert "AAP 2.6 System Compatibility Report" in report
        assert "Requirements Check:" in report

    def test_generate_report_contains_os(self, collector):
        info = SystemInfo(
            os=OSInfo("Red Hat Enterprise Linux", "9.4", "5.14", "x86_64", "myhost", "myhost.example.org"),
            hardware=HardwareInfo(8, "Intel", 32.0, 16.0, 100.0, 80.0),
            software=SoftwareInfo("3.12", "2.16", "5.0", "OpenSSL", True, "enforcing", False),
            network=NetworkInfo([], "", [], [], []),
            collection_time=0,
        )
        report = collector.generate_compatibility_report(info)
        assert "Red Hat Enterprise Linux" in report
        assert "9.4" in report
        assert "myhost" in report

    def test_generate_report_contains_hardware(self, collector):
        info = SystemInfo(
            os=OSInfo("RHEL", "9.4", "5.14", "x86_64", "host", "host.example.org"),
            hardware=HardwareInfo(8, "Intel Xeon E5", 32.0, 16.0, 100.0, 80.0),
            software=SoftwareInfo("", "", "", "", False, "", False),
            network=NetworkInfo([], "", [], [], []),
            collection_time=0,
        )
        report = collector.generate_compatibility_report(info)
        assert "8 cores" in report
        assert "32.0" in report
        assert "100.0" in report

    # Caching
    def test_cache_stores_result(self, collector):
        info = SystemInfo(
            os=OSInfo("RHEL", "9.4", "", "", "cached-host", "cached-host.example.org"),
            hardware=HardwareInfo(0, "", 0, 0, 0, 0),
            software=SoftwareInfo("", "", "", "", False, "", False),
            network=NetworkInfo([], "", [], [], []),
            collection_time=0,
        )
        collector._cache["cached-host"] = info
        result = collector.get_cached("cached-host")
        assert result is not None
        assert result.os.hostname == "cached-host"

    def test_cache_returns_stored(self, collector):
        collector._cache["test-host"] = "stored_value"
        result = collector.get_cached("test-host")
        assert result == "stored_value"

    def test_cache_missing_returns_none(self, collector):
        assert collector.get_cached("nonexistent") is None

    # Local collection
    @pytest.mark.asyncio
    async def test_collect_local(self, collector):
        result = await collector.collect_local()
        assert isinstance(result, SystemInfo)
        assert result.os is not None
        assert result.hardware is not None
        assert result.software is not None
        assert result.network is not None
        assert result.collection_time > 0

    @pytest.mark.asyncio
    async def test_collect_local_caches_result(self, collector):
        result1 = await collector.collect_local()
        result2 = await collector.collect_local()
        assert result1 is result2
