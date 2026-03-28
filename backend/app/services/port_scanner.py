"""Port scanner for AAP deployment validation.

Scans required ports on target hosts to verify availability
and detect conflicts before deployment.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

@dataclass
class PortScanResult:
    host: str
    port: int
    state: str  # open, closed, filtered, error
    service: str = ""
    latency_ms: float = 0
    error: str = ""

@dataclass
class HostScanResult:
    host: str
    ports: list[PortScanResult] = field(default_factory=list)
    scan_time_ms: float = 0
    reachable: bool = True
    error: str = ""

AAP_REQUIRED_PORTS = {
    80: "HTTP (Gateway redirect)",
    443: "HTTPS (Gateway)",
    5432: "PostgreSQL",
    6379: "Redis",
    27199: "Receptor mesh",
    8443: "Automation Hub API",
    8444: "Automation Hub Content",
}

AAP_INTERNAL_PORTS = {
    8013: "Controller",
    8043: "Controller WebSocket",
    5672: "AMQP",
    6380: "Redis Sentinel",
}

# Combined map for service lookup
_ALL_KNOWN_PORTS = {**AAP_REQUIRED_PORTS, **AAP_INTERNAL_PORTS}


class PortScanner:
    """Async port scanner for AAP deployment validation."""

    def __init__(self, timeout: float = 3.0, max_concurrent: int = 50):
        self._timeout = timeout
        self._max_concurrent = max_concurrent
        self._semaphore = asyncio.Semaphore(max_concurrent)

    async def scan_port(self, host: str, port: int) -> PortScanResult:
        """Scan a single port on a host."""
        service = self._identify_service(port)
        start = time.monotonic()
        async with self._semaphore:
            try:
                conn = asyncio.open_connection(host, port)
                reader, writer = await asyncio.wait_for(conn, timeout=self._timeout)
                writer.close()
                await writer.wait_closed()
                latency_ms = (time.monotonic() - start) * 1000
                return PortScanResult(
                    host=host,
                    port=port,
                    state="open",
                    service=service,
                    latency_ms=latency_ms,
                )
            except asyncio.TimeoutError:
                return PortScanResult(
                    host=host,
                    port=port,
                    state="filtered",
                    service=service,
                    latency_ms=(time.monotonic() - start) * 1000,
                    error="Connection timed out",
                )
            except ConnectionRefusedError:
                return PortScanResult(
                    host=host,
                    port=port,
                    state="closed",
                    service=service,
                    latency_ms=(time.monotonic() - start) * 1000,
                )
            except OSError as e:
                return PortScanResult(
                    host=host,
                    port=port,
                    state="error",
                    service=service,
                    latency_ms=(time.monotonic() - start) * 1000,
                    error=str(e),
                )
            except Exception as e:
                return PortScanResult(
                    host=host,
                    port=port,
                    state="error",
                    service=service,
                    latency_ms=(time.monotonic() - start) * 1000,
                    error=str(e),
                )

    async def scan_host(self, host: str, ports: list[int] | None = None) -> HostScanResult:
        """Scan multiple ports on a single host."""
        if ports is None:
            ports = list(AAP_REQUIRED_PORTS.keys())
        start = time.monotonic()
        tasks = [self.scan_port(host, p) for p in ports]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        scan_time_ms = (time.monotonic() - start) * 1000
        port_results: list[PortScanResult] = []
        reachable = True
        error_msg = ""
        for r in results:
            if isinstance(r, Exception):
                reachable = False
                error_msg = str(r)
                logger.warning("Port scan failed for %s: %s", host, r)
            else:
                port_results.append(r)
        return HostScanResult(
            host=host,
            ports=port_results,
            scan_time_ms=scan_time_ms,
            reachable=reachable,
            error=error_msg,
        )

    async def scan_hosts(self, hosts: list[str], ports: list[int] | None = None) -> list[HostScanResult]:
        """Scan multiple hosts in parallel."""
        tasks = [self.scan_host(h, ports) for h in hosts]
        return list(await asyncio.gather(*tasks))

    async def check_aap_ports(self, config: dict) -> dict:
        """Check all AAP-required ports based on deployment config."""
        hosts: set[str] = set()
        network = config.get("network", {})
        http_port = network.get("http_port", 80)
        https_port = network.get("https_port", 443)
        receptor_port = network.get("receptor_port", 27199)
        ports_to_check = list(AAP_REQUIRED_PORTS.keys())
        if http_port not in ports_to_check:
            ports_to_check.append(http_port)
        if https_port not in ports_to_check:
            ports_to_check.append(https_port)
        if receptor_port not in ports_to_check:
            ports_to_check.append(receptor_port)
        for comp in ["gateway", "controller", "hub", "eda"]:
            for h in config.get(comp, {}).get("hosts", []):
                if h:
                    hosts.add(h)
        db_host = config.get("database", {}).get("host")
        if db_host:
            hosts.add(db_host)
        for node in config.get("execution_nodes", []):
            h = node.get("host") if isinstance(node, dict) else getattr(node, "host", None)
            if h:
                hosts.add(h)
        if not hosts:
            return {"hosts": [], "results": [], "summary": {"total_hosts": 0, "all_ok": True}}
        results = await self.scan_hosts(list(hosts), ports_to_check)
        all_ok = all(
            all(p.state == "closed" or p.state == "open" for p in r.ports)
            and not any(p.state == "error" for p in r.ports)
            for r in results
        )
        return {
            "hosts": list(hosts),
            "results": [
                {
                    "host": r.host,
                    "reachable": r.reachable,
                    "ports": [
                        {
                            "port": p.port,
                            "state": p.state,
                            "service": p.service,
                            "latency_ms": p.latency_ms,
                        }
                        for p in r.ports
                    ],
                }
                for r in results
            ],
            "summary": {"total_hosts": len(hosts), "all_ok": all_ok},
        }

    async def find_port_conflicts(self, host: str, ports: list[int]) -> list[PortScanResult]:
        """Find ports that are already in use (open) on the host."""
        results = await asyncio.gather(*[self.scan_port(host, p) for p in ports])
        return [r for r in results if r.state == "open"]

    async def scan_range(self, host: str, start_port: int, end_port: int) -> list[PortScanResult]:
        """Scan a range of ports."""
        ports = list(range(start_port, end_port + 1))
        return list(await asyncio.gather(*[self.scan_port(host, p) for p in ports]))

    def generate_report(self, results: list[HostScanResult]) -> str:
        """Generate a text report of scan results."""
        lines = ["=" * 60, "Port Scan Report", "=" * 60]
        for r in results:
            lines.append(f"\nHost: {r.host}")
            lines.append(f"  Reachable: {r.reachable}")
            if r.error:
                lines.append(f"  Error: {r.error}")
            lines.append(f"  Scan time: {r.scan_time_ms:.1f} ms")
            for p in r.ports:
                status = "OPEN" if p.state == "open" else p.state.upper()
                lines.append(f"    Port {p.port} ({p.service}): {status}")
                if p.latency_ms:
                    lines.append(f"      Latency: {p.latency_ms:.1f} ms")
                if p.error:
                    lines.append(f"      Error: {p.error}")
        lines.append("\n" + "=" * 60)
        return "\n".join(lines)

    def get_service_name(self, port: int) -> str:
        """Get common service name for a port number."""
        return self._identify_service(port)

    @staticmethod
    def _identify_service(port: int) -> str:
        """Identify known service for a port."""
        return _ALL_KNOWN_PORTS.get(port, f"port/{port}")
