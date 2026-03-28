"""DNS validation service for AAP host configuration.

Validates hostnames, checks DNS resolution, verifies FQDN format,
and performs reverse DNS lookups.
"""
from __future__ import annotations

import asyncio
import logging
import re
import socket
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# FQDN pattern: labels 1-63 chars, TLD at least 2 letters
_FQDN_RE = re.compile(
    r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,}$"
)


@dataclass
class DNSResult:
    hostname: str
    resolved: bool
    ip_addresses: list[str] = field(default_factory=list)
    reverse_dns: str = ""
    is_fqdn: bool = False
    ttl: int = 0
    error: str = ""
    resolution_time_ms: float = 0


class DNSValidator:
    """Validates DNS configuration for AAP hosts."""

    def __init__(self, timeout: int = 5):
        self._timeout = timeout

    async def resolve(self, hostname: str) -> DNSResult:
        """Resolve hostname to IP addresses."""
        if not hostname or hostname.strip() == "":
            return DNSResult(
                hostname=hostname,
                resolved=False,
                error="Empty hostname",
            )

        hostname = hostname.strip()
        is_fqdn = self.is_valid_fqdn(hostname)

        start = time.monotonic()
        try:
            loop = asyncio.get_event_loop()
            addrinfo = await asyncio.wait_for(
                loop.getaddrinfo(hostname, None, socket.AF_UNSPEC),
                timeout=self._timeout,
            )
        except asyncio.TimeoutError:
            return DNSResult(
                hostname=hostname,
                resolved=False,
                is_fqdn=is_fqdn,
                error="DNS resolution timed out",
                resolution_time_ms=(time.monotonic() - start) * 1000,
            )
        except socket.gaierror as e:
            return DNSResult(
                hostname=hostname,
                resolved=False,
                is_fqdn=is_fqdn,
                error=str(e),
                resolution_time_ms=(time.monotonic() - start) * 1000,
            )
        except Exception as e:
            return DNSResult(
                hostname=hostname,
                resolved=False,
                is_fqdn=is_fqdn,
                error=str(e),
                resolution_time_ms=(time.monotonic() - start) * 1000,
            )

        resolution_time_ms = (time.monotonic() - start) * 1000
        ip_addresses = list({a[4][0] for a in addrinfo})

        reverse_dns = ""
        if ip_addresses:
            try:
                reverse_dns = await self.reverse_lookup(ip_addresses[0])
            except Exception:
                pass

        return DNSResult(
            hostname=hostname,
            resolved=True,
            ip_addresses=ip_addresses,
            reverse_dns=reverse_dns,
            is_fqdn=is_fqdn,
            resolution_time_ms=resolution_time_ms,
        )

    async def resolve_all(self, hostnames: list[str]) -> list[DNSResult]:
        """Resolve multiple hostnames in parallel."""
        tasks = [self.resolve(h) for h in hostnames]
        return await asyncio.gather(*tasks)

    async def reverse_lookup(self, ip: str) -> str:
        """Perform reverse DNS lookup for an IP address."""
        try:
            loop = asyncio.get_event_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: socket.gethostbyaddr(ip)),
                timeout=self._timeout,
            )
            return result[0] if result else ""
        except Exception:
            return ""

    def is_valid_fqdn(self, hostname: str) -> bool:
        """Check if hostname is a valid FQDN."""
        if not hostname or len(hostname) > 253:
            return False
        return bool(_FQDN_RE.match(hostname))

    def is_valid_ip(self, address: str) -> bool:
        """Check if string is a valid IPv4 or IPv6 address."""
        try:
            socket.inet_pton(socket.AF_INET, address)
            return True
        except OSError:
            pass
        try:
            socket.inet_pton(socket.AF_INET6, address)
            return True
        except OSError:
            pass
        return False

    async def check_port(self, hostname: str, port: int, timeout: int = 3) -> bool:
        """Check if a port is open on the host."""
        try:
            loop = asyncio.get_event_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: self._sync_check_port(hostname, port, timeout),
                ),
                timeout=timeout + 2,
            )
            return result
        except Exception:
            return False

    def _sync_check_port(self, hostname: str, port: int, timeout: int) -> bool:
        try:
            with socket.create_connection((hostname, port), timeout=timeout):
                return True
        except (socket.error, socket.timeout, OSError):
            return False

    async def check_ports(self, hostname: str, ports: list[int]) -> dict[int, bool]:
        """Check multiple ports on a host. Returns {port: is_open}."""
        tasks = [self.check_port(hostname, p) for p in ports]
        results = await asyncio.gather(*tasks)
        return dict(zip(ports, results))

    async def validate_host_config(
        self,
        hostname: str,
        expected_ports: Optional[list[int]] = None,
    ) -> dict:
        """Comprehensive host validation: DNS, reverse DNS, port checks."""
        result: dict = {
            "hostname": hostname,
            "dns_ok": False,
            "reverse_dns_ok": False,
            "ports_ok": {},
            "is_fqdn": False,
            "ip_addresses": [],
            "errors": [],
            "warnings": [],
        }

        dns_result = await self.resolve(hostname)
        result["dns_ok"] = dns_result.resolved
        result["is_fqdn"] = dns_result.is_fqdn
        result["ip_addresses"] = dns_result.ip_addresses

        if not dns_result.resolved:
            result["errors"].append(f"DNS resolution failed: {dns_result.error}")
            return result

        if dns_result.reverse_dns:
            result["reverse_dns_ok"] = True
            if dns_result.reverse_dns.lower() != hostname.lower():
                result["warnings"].append(
                    f"Reverse DNS '{dns_result.reverse_dns}' does not match hostname '{hostname}'"
                )
        else:
            result["warnings"].append("Reverse DNS not configured")

        if not self.is_valid_fqdn(hostname) and not self.is_valid_ip(hostname):
            if hostname not in ("localhost", "127.0.0.1"):
                result["warnings"].append(
                    f"Hostname '{hostname}' is not a valid FQDN or IP address"
                )

        if expected_ports:
            port_results = await self.check_ports(hostname, expected_ports)
            result["ports_ok"] = port_results
            for port, is_open in port_results.items():
                if not is_open:
                    result["errors"].append(f"Port {port} is not reachable")

        return result

    async def validate_all_hosts(self, config: dict) -> list[dict]:
        """Validate all hosts in the deployment config."""
        hostnames: set[str] = set()

        for comp in ("gateway", "controller", "hub", "eda"):
            hosts = config.get(comp, {}).get("hosts", [])
            hostnames.update(h for h in hosts if h)

        exec_nodes = config.get("execution_nodes", [])
        for node in exec_nodes:
            h = node.get("host", "") if isinstance(node, dict) else str(node)
            if h:
                hostnames.add(h)

        target_host = config.get("target_host", "")
        if target_host:
            hostnames.add(target_host)

        # AAP common ports
        expected_ports = [443, 80, 27199]

        results = []
        for hostname in sorted(hostnames):
            validation = await self.validate_host_config(
                hostname, expected_ports=expected_ports
            )
            results.append(validation)

        return results

    def generate_dns_report(self, results: list[DNSResult]) -> str:
        """Generate a text report of DNS resolution results."""
        lines = [
            "=" * 60,
            "DNS Resolution Report",
            "=" * 60,
        ]

        for r in results:
            status = "OK" if r.resolved else "FAIL"
            lines.append(f"\n{r.hostname}: [{status}]")
            if r.resolved:
                lines.append(f"  IPs: {', '.join(r.ip_addresses)}")
                if r.reverse_dns:
                    lines.append(f"  Reverse: {r.reverse_dns}")
                lines.append(f"  FQDN: {'Yes' if r.is_fqdn else 'No'}")
                lines.append(f"  Resolution time: {r.resolution_time_ms:.0f}ms")
            else:
                lines.append(f"  Error: {r.error}")

        lines.append("\n" + "=" * 60)
        return "\n".join(lines)
