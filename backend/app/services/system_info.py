"""System information service for AAP target hosts.

Gathers OS, hardware, software, and network information
from target hosts for pre-flight validation and reporting.
"""
from __future__ import annotations

import asyncio
import logging
import os
import platform
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

AAP_MIN_CPU = 4
AAP_MIN_MEMORY_GB = 16
AAP_MIN_DISK_GB = 50
AAP_REQUIRED_PYTHON = "3.9"
AAP_REQUIRED_ANSIBLE = "2.15"
AAP_REQUIRED_PODMAN = "4.0"


@dataclass
class OSInfo:
    name: str  # "Red Hat Enterprise Linux"
    version: str  # "9.4"
    kernel: str
    architecture: str
    hostname: str
    fqdn: str


@dataclass
class HardwareInfo:
    cpu_count: int
    cpu_model: str
    total_memory_gb: float
    available_memory_gb: float
    total_disk_gb: float
    available_disk_gb: float


@dataclass
class SoftwareInfo:
    python_version: str
    ansible_version: str
    podman_version: str
    openssl_version: str
    has_systemd: bool
    selinux_mode: str
    firewall_active: bool


@dataclass
class NetworkInfo:
    ip_addresses: list[str]
    default_gateway: str
    dns_servers: list[str]
    open_ports: list[int]
    listening_ports: list[int]


@dataclass
class SystemInfo:
    os: OSInfo
    hardware: HardwareInfo
    software: SoftwareInfo
    network: NetworkInfo
    collection_time: float
    errors: list[str] = field(default_factory=list)


class SystemInfoCollector:
    """Collects system information from local or remote hosts."""

    def __init__(self):
        self._cache: dict[str, SystemInfo] = {}

    async def collect_local(self) -> SystemInfo:
        """Collect system info from the local machine."""
        hostname = platform.node()
        if hostname in self._cache:
            return self._cache[hostname]

        errors: list[str] = []
        collection_time = __import__("time").time()

        # OS
        os_info = self._get_os_info_local(errors)

        # Hardware
        hardware_info = self._get_hardware_info_local(errors)

        # Software
        software_info = self._check_software(errors)

        # Network
        network_info = self._get_network_info(errors)

        info = SystemInfo(
            os=os_info,
            hardware=hardware_info,
            software=software_info,
            network=network_info,
            collection_time=collection_time,
            errors=errors,
        )
        self._cache[hostname] = info
        return info

    async def collect_remote(self, ssh_config: dict) -> SystemInfo:
        """Collect system info from a remote host via SSH."""
        host = ssh_config.get("host", ssh_config.get("hostname", "unknown"))
        cache_key = str(host)
        if cache_key in self._cache:
            return self._cache[cache_key]

        errors: list[str] = []
        collection_time = __import__("time").time()

        try:
            from app.services.ssh_manager import SSHConfig, SSHConnection

            config = SSHConfig(
                hostname=ssh_config.get("host") or ssh_config.get("hostname", str(host)),
                port=int(ssh_config.get("port") or ssh_config.get("ssh_port", 22)),
                username=ssh_config.get("username") or ssh_config.get("user", "aap"),
                password=ssh_config.get("password"),
                key_path=ssh_config.get("key_path") or ssh_config.get("ssh_key_path"),
            )
            conn = SSHConnection(config)
            await conn.connect()

            try:
                # Run commands in parallel where possible
                os_content = await conn.execute("cat /etc/os-release 2>/dev/null || true", timeout=5)
                cpu_content = await conn.execute("cat /proc/cpuinfo 2>/dev/null || true", timeout=5)
                mem_content = await conn.execute("cat /proc/meminfo 2>/dev/null || true", timeout=5)
                df_content = await conn.execute("df -BG / 2>/dev/null || df -B1G / 2>/dev/null || true", timeout=5)
                hostname_cmd = await conn.execute("hostname -f 2>/dev/null; hostname 2>/dev/null", timeout=5)
                uname_cmd = await conn.execute("uname -r -m 2>/dev/null", timeout=5)

                os_info = self._parse_os_release(
                    os_content.stdout if os_content.ok else "",
                    hostname_cmd.stdout.strip().split("\n")[-1] if hostname_cmd.ok else host,
                )
                hardware_info = HardwareInfo(
                    cpu_count=0,
                    cpu_model="",
                    total_memory_gb=0,
                    available_memory_gb=0,
                    total_disk_gb=0,
                    available_disk_gb=0,
                )
                if cpu_content.ok:
                    cnt, model = self._parse_cpu_info(cpu_content.stdout)
                    hardware_info.cpu_count = cnt
                    hardware_info.cpu_model = model
                if mem_content.ok:
                    hardware_info.total_memory_gb, hardware_info.available_memory_gb = self._parse_memory_info(
                        mem_content.stdout
                    )
                if df_content.ok:
                    hardware_info.total_disk_gb, hardware_info.available_disk_gb = self._parse_disk_info(
                        df_content.stdout
                    )

                # Software checks
                py_ver = await conn.execute("python3 --version 2>&1 || python --version 2>&1", timeout=5)
                ansible_ver = await conn.execute("ansible --version 2>&1 | head -1", timeout=5)
                podman_ver = await conn.execute("podman --version 2>&1", timeout=5)
                openssl_ver = await conn.execute("openssl version 2>&1", timeout=5)
                systemd_check = await conn.execute("systemctl --version >/dev/null 2>&1 && echo yes || echo no", timeout=5)
                selinux_check = await conn.execute("getenforce 2>/dev/null || echo disabled", timeout=5)
                firewall_check = await conn.execute(
                    "systemctl is-active firewalld 2>/dev/null || systemctl is-active iptables 2>/dev/null || echo inactive",
                    timeout=5,
                )

                software_info = SoftwareInfo(
                    python_version=self._extract_version(py_ver.stdout) if py_ver.ok else "",
                    ansible_version=self._extract_version(ansible_ver.stdout) if ansible_ver.ok else "",
                    podman_version=self._extract_version(podman_ver.stdout) if podman_ver.ok else "",
                    openssl_version=openssl_ver.stdout.strip() if openssl_ver.ok else "",
                    has_systemd=systemd_check.stdout.strip().lower() == "yes" if systemd_check.ok else False,
                    selinux_mode=selinux_check.stdout.strip() if selinux_check.ok else "unknown",
                    firewall_active=firewall_check.stdout.strip().lower() in ("active", "running")
                    if firewall_check.ok
                    else False,
                )

                # Network
                ip_cmd = await conn.execute(
                    "hostname -I 2>/dev/null | tr ' ' '\\n' | grep -v '^$' || ip -4 addr show 2>/dev/null | grep inet",
                    timeout=5,
                )
                ip_addresses: list[str] = []
                if ip_cmd.ok and ip_cmd.stdout:
                    for line in ip_cmd.stdout.strip().split():
                        ip = line.split()[-1].split("/")[0] if "/" in line else line.strip()
                        if re.match(r"^\d+\.\d+\.\d+\.\d+$", ip):
                            ip_addresses.append(ip)

                network_info = NetworkInfo(
                    ip_addresses=ip_addresses or ["unknown"],
                    default_gateway="",
                    dns_servers=[],
                    open_ports=[],
                    listening_ports=[],
                )

                info = SystemInfo(
                    os=os_info,
                    hardware=hardware_info,
                    software=software_info,
                    network=network_info,
                    collection_time=collection_time,
                    errors=errors,
                )
            finally:
                await conn.disconnect()

        except Exception as exc:
            logger.warning("Failed to collect remote system info from %s: %s", host, exc)
            errors.append(str(exc))
            info = SystemInfo(
                os=OSInfo("", "", "", "", host, host),
                hardware=HardwareInfo(0, "", 0, 0, 0, 0),
                software=SoftwareInfo("", "", "", "", False, "", False),
                network=NetworkInfo([], "", [], [], []),
                collection_time=collection_time,
                errors=errors,
            )

        self._cache[cache_key] = info
        return info

    async def collect_all_hosts(self, configs: list[dict]) -> dict[str, SystemInfo]:
        """Collect system info from multiple hosts in parallel."""
        tasks = []
        keys = []
        for cfg in configs:
            if cfg.get("host") or cfg.get("hostname"):
                keys.append(cfg.get("host") or cfg.get("hostname"))
                tasks.append(self.collect_remote(cfg))
            else:
                keys.append("local")
                tasks.append(self.collect_local())

        results = await asyncio.gather(*tasks, return_exceptions=True)
        out: dict[str, SystemInfo] = {}
        for key, result in zip(keys, results):
            if isinstance(result, Exception):
                logger.warning("System info collection failed for %s: %s", key, result)
                out[str(key)] = SystemInfo(
                    os=OSInfo("", "", "", "", str(key), str(key)),
                    hardware=HardwareInfo(0, "", 0, 0, 0, 0),
                    software=SoftwareInfo("", "", "", "", False, "", False),
                    network=NetworkInfo([], "", [], [], []),
                    collection_time=0,
                    errors=[str(result)],
                )
            else:
                out[str(key)] = result
        return out

    def get_cached(self, hostname: str) -> Optional[SystemInfo]:
        return self._cache.get(hostname)

    def _get_os_info_local(self, errors: list[str]) -> OSInfo:
        os_release_path = Path("/etc/os-release")
        if os_release_path.exists():
            try:
                content = os_release_path.read_text()
                return self._parse_os_release(content, platform.node())
            except Exception as exc:
                errors.append(f"Failed to read /etc/os-release: {exc}")
        return OSInfo(
            name=platform.system(),
            version=platform.version(),
            kernel=platform.release(),
            architecture=platform.machine(),
            hostname=platform.node(),
            fqdn=platform.node(),
        )

    def _parse_os_release(self, content: str, hostname: str = "") -> OSInfo:
        name = "Unknown"
        version = ""
        for line in content.splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                v = v.strip('"').strip("'")
                if k == "NAME":
                    name = v
                elif k == "VERSION_ID":
                    version = v
        return OSInfo(
            name=name,
            version=version,
            kernel=platform.release(),
            architecture=platform.machine(),
            hostname=hostname or platform.node(),
            fqdn=hostname or platform.node(),
        )

    def _get_hardware_info_local(self, errors: list[str]) -> HardwareInfo:
        cpu_count = 0
        cpu_model = ""
        total_mem = 0.0
        avail_mem = 0.0
        total_disk = 0.0
        avail_disk = 0.0

        try:
            cpu_path = Path("/proc/cpuinfo")
            if cpu_path.exists():
                cpu_count, cpu_model = self._parse_cpu_info(cpu_path.read_text())
        except Exception as exc:
            errors.append(f"Failed to parse CPU info: {exc}")

        try:
            mem_path = Path("/proc/meminfo")
            if mem_path.exists():
                total_mem, avail_mem = self._parse_memory_info(mem_path.read_text())
        except Exception as exc:
            errors.append(f"Failed to parse memory info: {exc}")

        try:
            total, free = shutil.disk_usage("/")
            total_disk = total / (1024**3)
            avail_disk = free / (1024**3)
        except Exception as exc:
            errors.append(f"Failed to get disk info: {exc}")

        return HardwareInfo(
            cpu_count=cpu_count,
            cpu_model=cpu_model,
            total_memory_gb=total_mem,
            available_memory_gb=avail_mem,
            total_disk_gb=total_disk,
            available_disk_gb=avail_disk,
        )

    def _parse_cpu_info(self, content: str) -> tuple[int, str]:
        count = 0
        model = ""
        for line in content.splitlines():
            if line.startswith("processor"):
                count += 1
            elif line.startswith("model name") and not model:
                model = line.split(":", 1)[-1].strip()
        if count == 0:
            count = os.cpu_count() or 1
        return count, model or "Unknown"

    def _parse_memory_info(self, content: str) -> tuple[float, float]:
        mem_total = 0
        mem_avail = 0
        for line in content.splitlines():
            if line.startswith("MemTotal:"):
                parts = line.split()
                if len(parts) >= 3:
                    mem_total = int(parts[1]) / 1024 / 1024  # KB -> GB
            elif line.startswith("MemAvailable:") or line.startswith("MemFree:"):
                parts = line.split()
                if len(parts) >= 3:
                    mem_avail = int(parts[1]) / 1024 / 1024
        return mem_total, mem_avail

    def _parse_disk_info(self, content: str) -> tuple[float, float]:
        total = 0.0
        avail = 0.0
        for line in content.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 4:
                try:
                    val_total = int(parts[1])
                    val_avail = int(parts[3])
                    # df -BG uses 1G blocks; default df uses 512-byte blocks
                    if val_total > 100000:
                        total = val_total * 512 / (1024**3)
                        avail = val_avail * 512 / (1024**3)
                    else:
                        total = float(val_total)
                        avail = float(val_avail)
                    break
                except (ValueError, IndexError):
                    pass
        return total, avail

    def _check_software(self, errors: list[str]) -> SoftwareInfo:
        python_version = ""
        ansible_version = ""
        podman_version = ""
        openssl_version = ""
        has_systemd = False
        selinux_mode = "unknown"
        firewall_active = False

        try:
            r = subprocess.run(
                ["python3", "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if r.returncode == 0:
                python_version = self._extract_version(r.stdout or r.stderr or "")
        except Exception:
            pass

        try:
            r = subprocess.run(
                ["ansible", "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if r.returncode == 0:
                ansible_version = self._extract_version(r.stdout or r.stderr or "")
        except Exception:
            pass

        try:
            r = subprocess.run(
                ["podman", "--version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if r.returncode == 0:
                podman_version = self._extract_version(r.stdout or r.stderr or "")
        except Exception:
            pass

        try:
            r = subprocess.run(
                ["openssl", "version"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if r.returncode == 0:
                openssl_version = (r.stdout or "").strip()
        except Exception:
            pass

        try:
            r = subprocess.run(
                ["systemctl", "--version"],
                capture_output=True,
                timeout=5,
            )
            has_systemd = r.returncode == 0
        except Exception:
            pass

        try:
            r = subprocess.run(
                ["getenforce"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if r.returncode == 0:
                selinux_mode = (r.stdout or "").strip().lower()
        except Exception:
            pass

        try:
            r = subprocess.run(
                ["systemctl", "is-active", "firewalld"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            firewall_active = (r.stdout or "").strip().lower() in ("active", "running")
        except Exception:
            pass

        return SoftwareInfo(
            python_version=python_version,
            ansible_version=ansible_version,
            podman_version=podman_version,
            openssl_version=openssl_version,
            has_systemd=has_systemd,
            selinux_mode=selinux_mode,
            firewall_active=firewall_active,
        )

    def _extract_version(self, text: str) -> str:
        m = re.search(r"(\d+\.\d+(?:\.\d+)?)", text)
        return m.group(1) if m else ""

    def _get_network_info(self, errors: list[str]) -> NetworkInfo:
        ip_addresses: list[str] = []
        try:
            import socket
            hostname = socket.gethostname()
            ip_addresses = [socket.gethostbyname(hostname)]
        except Exception:
            ip_addresses = ["127.0.0.1"]
        return NetworkInfo(
            ip_addresses=ip_addresses,
            default_gateway="",
            dns_servers=[],
            open_ports=[],
            listening_ports=[],
        )

    def check_aap_requirements(self, info: SystemInfo) -> list[dict]:
        """Check if system meets AAP 2.6 minimum requirements.
        Returns list of {check, status, message, details}."""
        results: list[dict] = []

        # CPU
        if info.hardware.cpu_count >= AAP_MIN_CPU:
            results.append(
                {"check": "cpu_count", "status": "passed", "message": "CPU count meets minimum", "details": f"{info.hardware.cpu_count} cores"}
            )
        else:
            results.append(
                {
                    "check": "cpu_count",
                    "status": "failed",
                    "message": f"CPU count below minimum ({AAP_MIN_CPU} required)",
                    "details": f"Found {info.hardware.cpu_count} cores",
                }
            )

        # Memory
        if info.hardware.total_memory_gb >= AAP_MIN_MEMORY_GB:
            results.append(
                {"check": "memory", "status": "passed", "message": "Memory meets minimum", "details": f"{info.hardware.total_memory_gb:.1f} GB"}
            )
        else:
            results.append(
                {
                    "check": "memory",
                    "status": "failed",
                    "message": f"Memory below minimum ({AAP_MIN_MEMORY_GB} GB required)",
                    "details": f"Found {info.hardware.total_memory_gb:.1f} GB",
                }
            )

        # Disk
        if info.hardware.available_disk_gb >= AAP_MIN_DISK_GB:
            results.append(
                {"check": "disk", "status": "passed", "message": "Disk space meets minimum", "details": f"{info.hardware.available_disk_gb:.1f} GB available"}
            )
        else:
            results.append(
                {
                    "check": "disk",
                    "status": "failed",
                    "message": f"Disk space below minimum ({AAP_MIN_DISK_GB} GB required)",
                    "details": f"Found {info.hardware.available_disk_gb:.1f} GB available",
                }
            )

        # Python
        if info.software.python_version:
            results.append(
                {"check": "python", "status": "passed", "message": "Python available", "details": info.software.python_version}
            )
        else:
            results.append({"check": "python", "status": "failed", "message": "Python not found", "details": "Python 3.9+ required"})

        # Podman
        if info.software.podman_version:
            results.append(
                {"check": "podman", "status": "passed", "message": "Podman available", "details": info.software.podman_version}
            )
        else:
            results.append({"check": "podman", "status": "failed", "message": "Podman not found", "details": "Podman 4.0+ required"})

        # Systemd
        if info.software.has_systemd:
            results.append({"check": "systemd", "status": "passed", "message": "Systemd available", "details": ""})
        else:
            results.append({"check": "systemd", "status": "warning", "message": "Systemd not detected", "details": "May affect service management"})

        return results

    def generate_compatibility_report(self, info: SystemInfo) -> str:
        """Generate a text report of system compatibility."""
        lines = [
            "=" * 60,
            "AAP 2.6 System Compatibility Report",
            "=" * 60,
            f"Host: {info.os.hostname}",
            f"OS: {info.os.name} {info.os.version}",
            f"Kernel: {info.os.kernel}",
            f"Architecture: {info.os.architecture}",
            "",
            "Hardware:",
            f"  CPU: {info.hardware.cpu_count} cores - {info.hardware.cpu_model}",
            f"  Memory: {info.hardware.total_memory_gb:.1f} GB total, {info.hardware.available_memory_gb:.1f} GB available",
            f"  Disk: {info.hardware.total_disk_gb:.1f} GB total, {info.hardware.available_disk_gb:.1f} GB available",
            "",
            "Software:",
            f"  Python: {info.software.python_version or 'Not found'}",
            f"  Ansible: {info.software.ansible_version or 'Not found'}",
            f"  Podman: {info.software.podman_version or 'Not found'}",
            f"  OpenSSL: {info.software.openssl_version or 'Not found'}",
            f"  Systemd: {'Yes' if info.software.has_systemd else 'No'}",
            f"  SELinux: {info.software.selinux_mode}",
            f"  Firewall: {'Active' if info.software.firewall_active else 'Inactive'}",
            "",
        ]

        checks = self.check_aap_requirements(info)
        lines.append("Requirements Check:")
        for c in checks:
            icon = {"passed": "[PASS]", "failed": "[FAIL]", "warning": "[WARN]"}.get(c["status"], "[??]")
            lines.append(f"  {icon} {c['check']}: {c['message']}")

        if info.errors:
            lines.append("")
            lines.append("Errors during collection:")
            for e in info.errors:
                lines.append(f"  - {e}")

        lines.append("=" * 60)
        return "\n".join(lines)
