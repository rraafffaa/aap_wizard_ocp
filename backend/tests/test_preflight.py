import pytest
from unittest.mock import AsyncMock, patch

from app.models import PreflightRequest, HostInfo
from app.preflight import PreflightChecker


def _checker(topology="growth", hosts=None):
    return PreflightChecker(
        PreflightRequest(
            topology=topology,
            installation_type="online",
            hosts=hosts or [],
        )
    )


async def _run_with_mocked_cmd(checker, return_values: dict | None = None):
    """Run all checks with _run_cmd returning controlled outputs.

    *return_values* maps a substring of the command string to its (rc, output).
    Unmatched commands get (0, "ok").
    """
    defaults = {
        "redhat-release": (0, "Red Hat Enterprise Linux release 9.4 (Plow)"),
        "python3 --version": (0, "Python 3.12.6"),
        "ansible --version": (0, "ansible [core 2.16.12]"),
        "podman --version": (0, "podman version 5.2.2"),
        "df -BG": (0, "100"),
        "MemTotal": (0, "32"),
        "nproc": (0, "8"),
        "hostname -f": (0, "host.example.com"),
        "ss -tlnp": (1, ""),
        "ssh -o": (0, "ok"),
    }
    if return_values:
        defaults.update(return_values)

    async def _mock_run_cmd(cmd: str):
        for key, val in defaults.items():
            if key in cmd:
                return val
        return (0, "ok")

    with patch.object(checker, "_run_cmd", side_effect=_mock_run_cmd):
        return await checker.run()


class TestPreflightChecker:
    """Core behaviour of the preflight checker."""

    @pytest.mark.asyncio
    async def test_growth_topology_checks(self):
        checker = _checker("growth")
        result = await _run_with_mocked_cmd(checker)
        assert len(result.checks) == 10
        assert result.overall in {"passed", "warning", "failed"}

    @pytest.mark.asyncio
    async def test_enterprise_topology_checks(self):
        hosts = [HostInfo(hostname="node1.example.org", ssh_user="aap")]
        checker = _checker("enterprise", hosts=hosts)
        result = await _run_with_mocked_cmd(checker)
        ssh_checks = [c for c in result.checks if "SSH" in c.name]
        assert len(ssh_checks) >= 1

    @pytest.mark.asyncio
    async def test_check_names_present(self):
        checker = _checker()
        result = await _run_with_mocked_cmd(checker)
        names = {c.name for c in result.checks}
        for expected in [
            "Operating System",
            "Python 3",
            "Ansible Core",
            "Podman",
            "Disk Space",
            "Memory (RAM)",
            "CPU Cores",
            "FQDN Hostname",
            "Required Ports",
            "SSH Connectivity",
        ]:
            assert expected in names, f"Missing check: {expected}"

    @pytest.mark.asyncio
    async def test_all_checks_have_status(self):
        checker = _checker()
        result = await _run_with_mocked_cmd(checker)
        valid_statuses = {"passed", "failed", "warning", "pending", "running"}
        for check in result.checks:
            assert check.status in valid_statuses

    @pytest.mark.asyncio
    async def test_overall_passed_when_all_pass(self):
        checker = _checker()
        result = await _run_with_mocked_cmd(checker)
        statuses = {c.status for c in result.checks}
        if statuses == {"passed"}:
            assert result.overall == "passed"

    @pytest.mark.asyncio
    async def test_overall_failed_when_any_fail(self):
        checker = _checker()
        overrides = {"nproc": (0, "1")}
        result = await _run_with_mocked_cmd(checker, overrides)
        failed = [c for c in result.checks if c.name == "CPU Cores"]
        assert failed[0].status == "failed"
        assert result.overall == "failed"

    @pytest.mark.asyncio
    async def test_overall_warning_when_warnings_only(self):
        checker = _checker()
        overrides = {
            "redhat-release": (0, "Ubuntu 22.04"),
        }
        result = await _run_with_mocked_cmd(checker, overrides)
        os_check = next(c for c in result.checks if c.name == "Operating System")
        assert os_check.status == "warning"
        has_failed = any(c.status == "failed" for c in result.checks)
        if not has_failed:
            assert result.overall == "warning"

    @pytest.mark.asyncio
    async def test_os_check(self):
        checker = _checker()
        overrides = {
            "redhat-release": (0, "Red Hat Enterprise Linux release 9.4 (Plow)"),
        }
        result = await _run_with_mocked_cmd(checker, overrides)
        os_check = next(c for c in result.checks if c.name == "Operating System")
        assert os_check.status == "passed"
        assert "9.4" in os_check.message

    @pytest.mark.asyncio
    async def test_os_check_old_rhel(self):
        checker = _checker()
        overrides = {
            "redhat-release": (0, "Red Hat Enterprise Linux release 8.6 (Ootpa)"),
        }
        result = await _run_with_mocked_cmd(checker, overrides)
        os_check = next(c for c in result.checks if c.name == "Operating System")
        assert os_check.status == "failed"

    @pytest.mark.asyncio
    async def test_os_check_rhel10(self):
        checker = _checker()
        overrides = {
            "redhat-release": (0, "Red Hat Enterprise Linux release 10.0 (Coughlan)"),
        }
        result = await _run_with_mocked_cmd(checker, overrides)
        os_check = next(c for c in result.checks if c.name == "Operating System")
        assert os_check.status == "passed"

    @pytest.mark.asyncio
    async def test_cpu_check(self):
        checker = _checker()
        overrides = {"nproc": (0, "8")}
        result = await _run_with_mocked_cmd(checker, overrides)
        cpu = next(c for c in result.checks if c.name == "CPU Cores")
        assert cpu.status == "passed"
        assert "8" in cpu.message

    @pytest.mark.asyncio
    async def test_cpu_check_insufficient(self):
        checker = _checker()
        overrides = {"nproc": (0, "2")}
        result = await _run_with_mocked_cmd(checker, overrides)
        cpu = next(c for c in result.checks if c.name == "CPU Cores")
        assert cpu.status == "failed"

    @pytest.mark.asyncio
    async def test_memory_check(self):
        checker = _checker()
        overrides = {"MemTotal": (0, "32")}
        result = await _run_with_mocked_cmd(checker, overrides)
        mem = next(c for c in result.checks if c.name == "Memory (RAM)")
        assert mem.status == "passed"

    @pytest.mark.asyncio
    async def test_memory_check_low(self):
        checker = _checker()
        overrides = {"MemTotal": (0, "4")}
        result = await _run_with_mocked_cmd(checker, overrides)
        mem = next(c for c in result.checks if c.name == "Memory (RAM)")
        assert mem.status == "failed"

    @pytest.mark.asyncio
    async def test_memory_check_warning(self):
        checker = _checker()
        overrides = {"MemTotal": (0, "12")}
        result = await _run_with_mocked_cmd(checker, overrides)
        mem = next(c for c in result.checks if c.name == "Memory (RAM)")
        assert mem.status == "warning"

    @pytest.mark.asyncio
    async def test_disk_check(self):
        checker = _checker()
        overrides = {"df -BG": (0, "100")}
        result = await _run_with_mocked_cmd(checker, overrides)
        disk = next(c for c in result.checks if c.name == "Disk Space")
        assert disk.status == "passed"

    @pytest.mark.asyncio
    async def test_disk_check_low(self):
        checker = _checker()
        overrides = {"df -BG": (0, "20")}
        result = await _run_with_mocked_cmd(checker, overrides)
        disk = next(c for c in result.checks if c.name == "Disk Space")
        assert disk.status == "failed"

    @pytest.mark.asyncio
    async def test_disk_check_warning(self):
        checker = _checker()
        overrides = {"df -BG": (0, "40")}
        result = await _run_with_mocked_cmd(checker, overrides)
        disk = next(c for c in result.checks if c.name == "Disk Space")
        assert disk.status == "warning"

    @pytest.mark.asyncio
    async def test_python_check(self):
        checker = _checker()
        overrides = {"python3 --version": (0, "Python 3.12.6")}
        result = await _run_with_mocked_cmd(checker, overrides)
        py = next(c for c in result.checks if c.name == "Python 3")
        assert py.status == "passed"
        assert "3.12" in py.message

    @pytest.mark.asyncio
    async def test_python_check_missing(self):
        checker = _checker()
        overrides = {"python3 --version": (1, "command not found")}
        result = await _run_with_mocked_cmd(checker, overrides)
        py = next(c for c in result.checks if c.name == "Python 3")
        assert py.status == "warning"

    @pytest.mark.asyncio
    async def test_ansible_check(self):
        checker = _checker()
        overrides = {"ansible --version": (0, "ansible [core 2.16.12]")}
        result = await _run_with_mocked_cmd(checker, overrides)
        ans = next(c for c in result.checks if c.name == "Ansible Core")
        assert ans.status == "passed"

    @pytest.mark.asyncio
    async def test_ansible_check_missing(self):
        checker = _checker()
        overrides = {"ansible --version": (1, "")}
        result = await _run_with_mocked_cmd(checker, overrides)
        ans = next(c for c in result.checks if c.name == "Ansible Core")
        assert ans.status == "warning"

    @pytest.mark.asyncio
    async def test_podman_check(self):
        checker = _checker()
        overrides = {"podman --version": (0, "podman version 5.2.2")}
        result = await _run_with_mocked_cmd(checker, overrides)
        pod = next(c for c in result.checks if c.name == "Podman")
        assert pod.status == "passed"

    @pytest.mark.asyncio
    async def test_podman_check_missing(self):
        checker = _checker()
        overrides = {"podman --version": (1, "")}
        result = await _run_with_mocked_cmd(checker, overrides)
        pod = next(c for c in result.checks if c.name == "Podman")
        assert pod.status == "warning"

    @pytest.mark.asyncio
    async def test_fqdn_check(self):
        checker = _checker()
        overrides = {"hostname -f": (0, "host.example.com")}
        result = await _run_with_mocked_cmd(checker, overrides)
        fqdn = next(c for c in result.checks if c.name == "FQDN Hostname")
        assert fqdn.status == "passed"
        assert "host.example.com" in fqdn.message

    @pytest.mark.asyncio
    async def test_fqdn_check_no_fqdn(self):
        checker = _checker()
        overrides = {"hostname -f": (0, "localhost")}
        result = await _run_with_mocked_cmd(checker, overrides)
        fqdn = next(c for c in result.checks if c.name == "FQDN Hostname")
        assert fqdn.status == "warning"

    @pytest.mark.asyncio
    async def test_ports_check(self):
        checker = _checker()
        result = await _run_with_mocked_cmd(checker)
        ports = next(c for c in result.checks if c.name == "Required Ports")
        assert ports.status == "passed"
        assert "80" in ports.message

    @pytest.mark.asyncio
    async def test_ssh_check_local_no_hosts(self):
        checker = _checker()
        result = await _run_with_mocked_cmd(checker)
        ssh = next(c for c in result.checks if "SSH" in c.name)
        assert ssh.status == "passed"
        assert "local" in ssh.message.lower() or "no remote" in ssh.message.lower()

    @pytest.mark.asyncio
    async def test_ssh_check_enterprise(self):
        hosts = [
            HostInfo(hostname="gw1.example.org", ssh_user="aap"),
            HostInfo(hostname="ctrl1.example.org", ssh_user="aap"),
        ]
        checker = _checker("enterprise", hosts=hosts)
        overrides = {"ssh -o": (0, "ok")}
        result = await _run_with_mocked_cmd(checker, overrides)
        ssh_checks = [c for c in result.checks if "SSH" in c.name]
        assert len(ssh_checks) == 2
        for sc in ssh_checks:
            assert sc.status == "passed"

    @pytest.mark.asyncio
    async def test_ssh_check_enterprise_failure(self):
        hosts = [HostInfo(hostname="unreachable.example.org", ssh_user="aap")]
        checker = _checker("enterprise", hosts=hosts)
        overrides = {"ssh -o": (1, "Connection refused")}
        result = await _run_with_mocked_cmd(checker, overrides)
        ssh_checks = [c for c in result.checks if "SSH" in c.name]
        assert len(ssh_checks) == 1
        assert ssh_checks[0].status == "warning"

    @pytest.mark.asyncio
    async def test_result_model_structure(self):
        checker = _checker()
        result = await _run_with_mocked_cmd(checker)
        assert hasattr(result, "overall")
        assert hasattr(result, "checks")
        assert isinstance(result.checks, list)
        for c in result.checks:
            assert hasattr(c, "name")
            assert hasattr(c, "status")
            assert hasattr(c, "message")
