"""Pre-flight validation checks before deployment.

Runs checks on the target host (remote via SSH or local) to verify
system requirements for AAP 2.6 containerized deployment.
"""

from __future__ import annotations

import asyncio
import shlex
import re
from typing import Optional

from app.models import (
    PreflightRequest,
    PreflightResult,
    PreflightCheck,
    PrepareRequest,
    PrepareResult,
)

REMEDIATION_COMMANDS: dict[str, list[str]] = {
    "podman": [
        "sudo dnf install -y podman",
    ],
    "ansible": [
        "sudo dnf install -y ansible-core",
    ],
    "python3": [
        "sudo dnf install -y python3",
    ],
    "dns_utils": [
        "sudo dnf install -y bind-utils",
    ],
    "hostname_set": [
        'sudo hostnamectl set-hostname $(hostname -s).$(dnsdomainname 2>/dev/null || echo "local")',
    ],
    "firewall_ports": [
        "sudo firewall-cmd --permanent --add-port=443/tcp --add-port=80/tcp --add-port=27199/tcp",
        "sudo firewall-cmd --reload",
    ],
    "sshpass": [
        "sudo dnf install -y sshpass",
    ],
}


class PreflightChecker:
    """Runs preflight checks on the target host (local or remote via SSH)."""

    def __init__(self, request: PreflightRequest):
        self.request = request
        self.checks: list[PreflightCheck] = []
        self._is_remote = bool(request.target_host)

    def _ssh_prefix(self) -> str:
        r = self.request
        parts = [
            "sshpass", "-e",
            "ssh",
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=10",
            "-o", "ServerAliveInterval=15",
            "-p", str(int(r.target_ssh_port)),
            f"{shlex.quote(r.target_user)}@{shlex.quote(r.target_host)}",
        ]
        return " ".join(parts)

    def _ssh_env(self) -> dict:
        import os
        return {**os.environ, "SSHPASS": self.request.target_password}

    @staticmethod
    def _clean_ssh_output(output: str) -> str:
        """Strip SSH warning banners and sudo lecture from command output."""
        lines = output.split("\n")
        cleaned = [
            line for line in lines
            if not line.startswith("** ") and not line.startswith("Warning:")
            and "post-quantum" not in line and "store now, decrypt later" not in line
            and "server may need to be upgraded" not in line
            and "We trust you" not in line and "Respect the privacy" not in line
            and "Think before you type" not in line
            and "With great power" not in line
            and "#1)" not in line and "#2)" not in line and "#3)" not in line
            and "password for" not in line.lower()
        ]
        return "\n".join(cleaned).strip()

    async def _run_cmd(self, cmd: str) -> tuple[int, str]:
        if self._is_remote:
            full_cmd = f"{self._ssh_prefix()} {shlex.quote(cmd)}"
            env = self._ssh_env()
        else:
            full_cmd = cmd
            env = None
        try:
            proc = await asyncio.create_subprocess_shell(
                full_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
            raw = stdout.decode().strip()
            if self._is_remote:
                raw = self._clean_ssh_output(raw)
            return proc.returncode or 0, raw
        except asyncio.TimeoutError:
            return 1, "Command timed out"
        except Exception as exc:
            return 1, str(exc)

    async def run(self) -> PreflightResult:
        if self._is_remote:
            conn_ok = await self._check_ssh_to_target()
            if not conn_ok:
                return PreflightResult(overall="failed", checks=self.checks)

        await asyncio.gather(
            self._check_os(),
            self._check_python(),
            self._check_ansible(),
            self._check_podman(),
            self._check_disk_space(),
            self._check_memory(),
            self._check_cpu(),
            self._check_dns(),
            self._check_ports(),
            self._check_ssh_connectivity(),
        )

        failed = any(c.status == "failed" for c in self.checks)
        warning = any(c.status == "warning" for c in self.checks)
        overall = "failed" if failed else ("warning" if warning else "passed")

        for check in self.checks:
            check.details = self._add_remediation_hint(check)

        return PreflightResult(overall=overall, checks=self.checks)

    async def _check_ssh_to_target(self) -> bool:
        rc, output = await self._run_cmd("echo 'connection_ok'")
        if rc != 0 or "connection_ok" not in output:
            self.checks.append(PreflightCheck(
                name="SSH Connection",
                status="failed",
                message=f"Cannot connect to {self.request.target_host}",
                details=output[:300],
            ))
            return False
        self.checks.append(PreflightCheck(
            name="SSH Connection",
            status="passed",
            message=f"Connected to {self.request.target_user}@{self.request.target_host}",
        ))
        return True

    async def _check_os(self):
        rc, output = await self._run_cmd("cat /etc/redhat-release 2>/dev/null || echo 'Not RHEL'")
        is_rhel = "Red Hat Enterprise Linux" in output
        version_ok = False
        if is_rhel:
            m = re.search(r"release (\d+)\.?(\d*)", output)
            if m:
                major = int(m.group(1))
                minor = int(m.group(2)) if m.group(2) else 0
                version_ok = (major == 10) or (major == 9 and minor >= 4)

        if is_rhel and version_ok:
            self.checks.append(PreflightCheck(name="Operating System", status="passed", message=output))
        elif is_rhel:
            self.checks.append(PreflightCheck(
                name="Operating System", status="failed",
                message=f"RHEL version too old: {output}",
                details="Requires RHEL 9.4+ or RHEL 10+",
            ))
        else:
            self.checks.append(PreflightCheck(
                name="Operating System", status="warning",
                message=f"Non-RHEL detected: {output}",
                details="AAP 2.6 officially supports RHEL 9.4+ or RHEL 10+.",
            ))

    async def _check_python(self):
        rc, output = await self._run_cmd("python3 --version")
        self.checks.append(PreflightCheck(
            name="Python 3",
            status="passed" if rc == 0 else "warning",
            message=output if rc == 0 else "Python 3 not found",
            remediation="python3",
        ))

    async def _check_ansible(self):
        rc, output = await self._run_cmd("ansible --version 2>/dev/null | head -1")
        self.checks.append(PreflightCheck(
            name="Ansible Core",
            status="passed" if rc == 0 and output else "warning",
            message=output or "ansible-core not installed",
            remediation="ansible",
        ))

    async def _check_podman(self):
        rc, output = await self._run_cmd("podman --version 2>/dev/null")
        self.checks.append(PreflightCheck(
            name="Podman",
            status="passed" if rc == 0 else "warning",
            message=output or "Podman not found",
            remediation="podman",
        ))

    async def _check_disk_space(self):
        rc, output = await self._run_cmd(
            "df -BG / /var /home /tmp 2>/dev/null | awk 'NR>1 {gsub(\"G\",\"\",$4); sum+=$4} END {print sum}'"
        )
        try:
            available_gb = int(output.strip())
            status = "passed" if available_gb >= 60 else ("warning" if available_gb >= 30 else "failed")
            self.checks.append(PreflightCheck(
                name="Disk Space", status=status,
                message=f"{available_gb} GB available across filesystems",
                details="Minimum 60 GB recommended (/ + /var combined)",
            ))
        except (ValueError, AttributeError):
            self.checks.append(PreflightCheck(name="Disk Space", status="warning", message="Could not determine disk space"))

    async def _check_memory(self):
        rc, output = await self._run_cmd(
            "grep MemTotal /proc/meminfo 2>/dev/null | awk '{printf \"%d\", $2/1024/1024}'"
        )
        if rc != 0 or not output.strip():
            rc, output = await self._run_cmd("free -g | awk '/Mem:/ {print $2}'")
        try:
            ram_gb = int(output.strip())
            if ram_gb == 0:
                rc2, output2 = await self._run_cmd("free -m | awk '/Mem:/ {print $2}'")
                ram_mb = int(output2.strip())
                ram_gb = max(1, ram_mb // 1024)
            status = "passed" if ram_gb >= 15 else ("warning" if ram_gb >= 8 else "failed")
            self.checks.append(PreflightCheck(
                name="Memory (RAM)", status=status,
                message=f"{ram_gb} GB RAM detected",
                details="Minimum 16 GB required (32 GB for bundled with collection seeding)",
            ))
        except (ValueError, AttributeError):
            self.checks.append(PreflightCheck(name="Memory (RAM)", status="warning", message="Could not determine RAM"))

    async def _check_cpu(self):
        rc, output = await self._run_cmd("nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null")
        try:
            cpus = int(output)
            status = "passed" if cpus >= 4 else "failed"
            self.checks.append(PreflightCheck(
                name="CPU Cores", status=status,
                message=f"{cpus} CPU cores detected",
                details="Minimum 4 CPU cores required",
            ))
        except (ValueError, AttributeError):
            self.checks.append(PreflightCheck(name="CPU Cores", status="warning", message="Could not determine CPU count"))

    async def _check_dns(self):
        rc, output = await self._run_cmd("hostname -f 2>/dev/null")
        is_fqdn = output and "." in output
        self.checks.append(PreflightCheck(
            name="FQDN Hostname",
            status="passed" if is_fqdn else "warning",
            message=output or "Could not resolve hostname",
            details="A fully qualified domain name is recommended" if not is_fqdn else "",
            remediation="hostname_set" if not is_fqdn else "",
        ))

    async def _check_ports(self):
        ports = [80, 443, 27199]
        blocked = []
        for port in ports:
            rc, out = await self._run_cmd(f"ss -tlnp 2>/dev/null | grep ':{port} '")
            if rc == 0 and out:
                blocked.append(port)

        if blocked:
            self.checks.append(PreflightCheck(
                name="Required Ports",
                status="warning",
                message=f"Ports already in use: {', '.join(str(p) for p in blocked)}",
                details="Ports 80, 443, and 27199 should be available",
            ))
        else:
            self.checks.append(PreflightCheck(
                name="Required Ports",
                status="passed",
                message=f"Ports {', '.join(str(p) for p in ports)} are available",
            ))

    async def _check_ssh_connectivity(self):
        if not self.request.hosts:
            if not self._is_remote:
                self.checks.append(PreflightCheck(
                    name="SSH Connectivity", status="passed",
                    message="Local installation — no remote hosts to check",
                ))
            return

        for host in self.request.hosts:
            conn_spec = f"{shlex.quote(host.ssh_user)}@{shlex.quote(host.hostname)}"
            rc, output = await self._run_cmd(
                f"ssh -o ConnectTimeout=5 -o BatchMode=yes {conn_spec} 'echo ok' 2>&1"
            )
            self.checks.append(PreflightCheck(
                name=f"SSH to {host.hostname}",
                status="passed" if rc == 0 else "warning",
                message=output[:200],
            ))

    def _add_remediation_hint(self, check: PreflightCheck) -> str:
        if check.status == "passed":
            return check.details
        remediation_key = getattr(check, 'remediation', '') or ''
        if remediation_key and remediation_key in REMEDIATION_COMMANDS:
            cmds = REMEDIATION_COMMANDS[remediation_key]
            return f"{check.details}\nAuto-fix available: {'; '.join(cmds)}".strip()
        return check.details


class HostPreparer:
    """Prepares a target host by installing missing dependencies over SSH."""

    def __init__(self, request: PrepareRequest):
        self.request = request
        self.actions: list[dict] = []
        self.errors: list[str] = []

    def _ssh_prefix(self) -> str:
        r = self.request
        return (
            f"sshpass -e "
            f"ssh -o StrictHostKeyChecking=no -o ConnectTimeout=15 "
            f"-p {int(r.target_ssh_port)} {shlex.quote(r.target_user)}@{shlex.quote(r.target_host)}"
        )

    def _ssh_env(self) -> dict:
        import os
        return {**os.environ, "SSHPASS": self.request.target_password}

    @staticmethod
    def _clean_output(output: str) -> str:
        lines = output.split("\n")
        cleaned = [
            line for line in lines
            if not line.startswith("** ") and not line.startswith("Warning:")
            and "post-quantum" not in line and "store now, decrypt later" not in line
            and "server may need to be upgraded" not in line
            and "We trust you" not in line and "Respect the privacy" not in line
            and "Think before you type" not in line and "#1)" not in line
            and "#2)" not in line and "#3)" not in line
            and "password for" not in line.lower()
        ]
        return "\n".join(cleaned).strip()

    def _wrap_sudo_cmd(self, cmd: str) -> str:
        """Wrap sudo commands for non-interactive execution."""
        if cmd.strip().startswith("sudo "):
            inner = cmd.strip()[5:]
            return f"sudo -n {inner}"
        return cmd

    async def _run_remote(self, cmd: str, description: str) -> bool:
        wrapped_cmd = self._wrap_sudo_cmd(cmd)
        full_cmd = f"{self._ssh_prefix()} {shlex.quote(wrapped_cmd)}"
        env = self._ssh_env()
        self.actions.append({"command": cmd, "description": description, "status": "running"})
        try:
            proc = await asyncio.create_subprocess_shell(
                full_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=300)
            raw_output = stdout.decode().strip()
            output = self._clean_output(raw_output)
            success = proc.returncode == 0
            self.actions[-1]["status"] = "success" if success else "failed"
            self.actions[-1]["output"] = output[:500]
            if not success:
                self.errors.append(f"{description}: {output[:200]}")
            return success
        except asyncio.TimeoutError:
            self.actions[-1]["status"] = "failed"
            self.actions[-1]["output"] = "Command timed out"
            self.errors.append(f"{description}: timed out")
            return False
        except Exception as exc:
            self.actions[-1]["status"] = "failed"
            self.actions[-1]["output"] = str(exc)
            self.errors.append(f"{description}: {exc}")
            return False

    async def prepare(self) -> PrepareResult:
        fix_items = self.request.fix_items

        if not fix_items or "all" in fix_items:
            fix_items = ["podman", "ansible", "firewall_ports"]

        for item in fix_items:
            commands = REMEDIATION_COMMANDS.get(item, [])
            for cmd in commands:
                await self._run_remote(cmd, f"Install/configure {item}")

        await self._run_remote(
            "sudo dnf install -y sshpass rsync tar",
            "Install utility packages"
        )

        return PrepareResult(
            success=len(self.errors) == 0,
            actions=self.actions,
            errors=self.errors,
        )
