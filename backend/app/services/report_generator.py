"""Report generator for AAP deployments.

Creates comprehensive deployment reports including configuration
summary, validation results, deployment timeline, and health status.
"""
import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

_SECRET_RE = re.compile(
    r"(password|secret|token|key|credential|registry_password|admin_password"
    r"|pg_password|ssh_password|target_password)"
    r"(\s*[=:]\s*)(\S+)",
    re.IGNORECASE,
)


@dataclass
class ReportSection:
    title: str
    content: str
    data: dict = field(default_factory=dict)


class ReportGenerator:
    """Generate deployment reports in multiple formats."""

    def __init__(self):
        self._sections: list[ReportSection] = []

    # ------------------------------------------------------------------
    # High-level report builders
    # ------------------------------------------------------------------

    def generate_pre_deploy_report(
        self,
        config: dict,
        validation: dict = None,
        preflight: dict = None,
    ) -> str:
        """Generate pre-deployment summary report."""
        sections: list[ReportSection] = []
        sections.append(self._make_header_section("Pre-Deployment Report"))
        sections.append(self._format_config_section(config))
        sections.append(self._format_hosts_section(config))
        sections.append(self._format_security_section(config))

        if validation:
            sections.append(self._format_validation_section(validation))
        if preflight:
            sections.append(self._format_preflight_section(preflight))

        self._sections = sections
        return self.render_text(sections)

    def generate_post_deploy_report(
        self,
        config: dict,
        deploy_result: dict,
        health: dict = None,
        logs: list[str] = None,
    ) -> str:
        """Generate post-deployment report."""
        sections: list[ReportSection] = []
        sections.append(self._make_header_section("Post-Deployment Report"))
        sections.append(self._format_config_section(config))

        sections.append(self._format_deploy_result_section(deploy_result))
        sections.append(self._format_timeline_section(deploy_result))

        if health:
            sections.append(self._format_health_section(health))
        if logs:
            sections.append(ReportSection(
                title="Deployment Logs (last 50 lines)",
                content="\n".join(logs[-50:]),
            ))

        self._sections = sections
        return self.render_text(sections)

    def generate_config_report(self, config: dict) -> str:
        """Generate configuration-only report."""
        sections = [
            self._make_header_section("Configuration Report"),
            self._format_config_section(config),
            self._format_hosts_section(config),
            self._format_security_section(config),
        ]
        self._sections = sections
        return self.render_text(sections)

    def generate_health_report(self, health: dict) -> str:
        sections = [
            self._make_header_section("Health Report"),
            self._format_health_section(health),
        ]
        self._sections = sections
        return self.render_text(sections)

    # ------------------------------------------------------------------
    # Renderers
    # ------------------------------------------------------------------

    def render_text(self, sections: list[ReportSection]) -> str:
        lines: list[str] = []
        for sec in sections:
            lines.append("=" * 64)
            lines.append(f"  {sec.title}")
            lines.append("=" * 64)
            if sec.content:
                lines.append(self._mask_secrets(sec.content))
            lines.append("")
        return "\n".join(lines)

    def render_json(self, sections: list[ReportSection]) -> str:
        data = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "sections": [
                {
                    "title": sec.title,
                    "content": self._mask_secrets(sec.content),
                    "data": sec.data,
                }
                for sec in sections
            ],
        }
        return json.dumps(data, indent=2, default=str)

    def render_html(self, sections: list[ReportSection]) -> str:
        parts: list[str] = [
            "<!DOCTYPE html>",
            "<html><head><meta charset='utf-8'>",
            "<title>AAP Deployment Report</title>",
            "<style>",
            "body{font-family:'Segoe UI',sans-serif;margin:2em auto;max-width:900px;color:#333;line-height:1.6}",
            "h1{color:#1a1a2e;border-bottom:2px solid #e94560;padding-bottom:.4em}",
            "h2{color:#16213e;margin-top:1.5em}",
            "pre{background:#f4f4f8;padding:1em;border-radius:6px;overflow-x:auto;font-size:.9em}",
            ".label{font-weight:600;color:#555;min-width:200px;display:inline-block}",
            ".ok{color:#27ae60}.warn{color:#f39c12}.fail{color:#c0392b}",
            "table{border-collapse:collapse;width:100%;margin:1em 0}",
            "th,td{border:1px solid #ddd;padding:8px}th{background:#f9f9f9}",
            "footer{margin-top:2em;color:#999;font-size:.8em}",
            "</style></head><body>",
        ]

        for sec in sections:
            parts.append(f"<h2>{_h(sec.title)}</h2>")
            masked = self._mask_secrets(sec.content)
            parts.append(f"<pre>{_h(masked)}</pre>")

        parts.append(
            f"<footer>Generated by AAP Deployment Wizard at "
            f"{datetime.now(timezone.utc).isoformat()}</footer>"
        )
        parts.append("</body></html>")
        return "\n".join(parts)

    # ------------------------------------------------------------------
    # Section builders
    # ------------------------------------------------------------------

    @staticmethod
    def _make_header_section(title: str) -> ReportSection:
        return ReportSection(
            title=title,
            content=(
                f"Generated: {datetime.now(timezone.utc).isoformat()}\n"
                "Tool:      AAP Deployment Wizard"
            ),
            data={"generated_at": datetime.now(timezone.utc).isoformat()},
        )

    def _format_config_section(self, config: dict) -> ReportSection:
        topology = config.get("topology", "growth")
        inst = config.get("installation_type", "online")
        redis = config.get("redis_mode", "standalone")
        db_type = config.get("database", {}).get("type", "managed")

        lines = [
            f"Topology:          {topology.title()}",
            f"Installation:      {inst.title()}",
            f"Database:          {db_type.title()}",
            f"Redis:             {redis.title()}",
        ]

        bundle = config.get("bundle_dir", "")
        if bundle:
            lines.append(f"Bundle dir:        {bundle}")
        install_dir = config.get("install_dir", "/opt/aap")
        lines.append(f"Install dir:       {install_dir}")
        lines.append(f"EULA accepted:     {config.get('eula_accepted', False)}")
        lines.append(f"Dry run:           {config.get('dry_run', False)}")

        return ReportSection(
            title="Configuration Overview",
            content="\n".join(lines),
            data={"topology": topology, "installation_type": inst},
        )

    def _format_hosts_section(self, config: dict) -> ReportSection:
        lines: list[str] = []
        for comp in ("gateway", "controller", "hub", "eda"):
            hosts = config.get(comp, {}).get("hosts", [])
            lines.append(f"{comp.title():15s}  {', '.join(hosts) if hosts else '(none)'}")

        exec_nodes = config.get("execution_nodes", [])
        if exec_nodes:
            nodes_str = ", ".join(
                n.get("host", str(n)) if isinstance(n, dict) else str(n)
                for n in exec_nodes
            )
            lines.append(f"{'Exec Nodes':15s}  {nodes_str}")

        target = config.get("target_host", "")
        if target:
            lines.append(f"{'Target host':15s}  {target} (user={config.get('target_user','aap')})")

        return ReportSection(
            title="Host Layout",
            content="\n".join(lines),
            data={"host_count": sum(
                len(config.get(c, {}).get("hosts", []))
                for c in ("gateway", "controller", "hub", "eda")
            )},
        )

    def _format_security_section(self, config: dict) -> ReportSection:
        tls = config.get("network", {}).get("tls", {})
        net = config.get("network", {})
        lines = [
            f"HTTPS:             {'Disabled' if tls.get('disable_https') else 'Enabled'}",
            f"HTTPS port:        {net.get('https_port', 443)}",
            f"HTTP port:         {net.get('http_port', 80)}",
            f"Receptor port:     {net.get('receptor_port', 27199)}",
            f"Custom CA cert:    {'Yes' if tls.get('custom_ca_cert') else 'No'}",
            f"Custom server cert:{'Yes' if tls.get('custom_server_cert') else 'No'}",
        ]
        return ReportSection(
            title="Security & Network",
            content="\n".join(lines),
            data={"https_enabled": not tls.get("disable_https", False)},
        )

    def _format_timeline_section(self, deploy_result: dict) -> ReportSection:
        phases = deploy_result.get("phases", [])
        if not phases:
            return ReportSection(title="Deployment Timeline", content="No phase data available.")

        lines: list[str] = []
        for phase in phases:
            status_icon = {
                "completed": "[OK]",
                "failed": "[FAIL]",
                "skipped": "[SKIP]",
                "running": "[..]",
            }.get(phase.get("status", ""), "[??]")
            label = phase.get("label", phase.get("id", "?"))
            duration = phase.get("duration_seconds", 0)
            lines.append(f"  {status_icon:6s} {label:40s}  {duration:6.1f}s")

        total = deploy_result.get("duration_seconds", 0)
        lines.append(f"\n  Total: {total:.1f}s")
        return ReportSection(
            title="Deployment Timeline",
            content="\n".join(lines),
            data={"total_duration": total},
        )

    @staticmethod
    def _format_validation_section(validation: dict) -> ReportSection:
        lines: list[str] = []
        lines.append(f"Valid:    {validation.get('valid', '?')}")
        lines.append(f"Score:    {validation.get('score', '?')}/100")

        for severity in ("errors", "warnings", "info"):
            items = validation.get(severity, [])
            if not items:
                continue
            lines.append(f"\n{severity.upper()} ({len(items)}):")
            for item in items:
                if isinstance(item, dict):
                    lines.append(f"  - [{item.get('field','')}] {item.get('message','')}")
                else:
                    lines.append(f"  - {item}")

        return ReportSection(
            title="Validation Results",
            content="\n".join(lines),
            data=validation,
        )

    @staticmethod
    def _format_preflight_section(preflight: dict) -> ReportSection:
        lines: list[str] = []
        overall = preflight.get("overall", "unknown")
        lines.append(f"Overall: {overall.upper()}")

        checks = preflight.get("checks", [])
        for check in checks:
            name = check.get("name", "?")
            status = check.get("status", "?")
            msg = check.get("message", "")
            icon = {"passed": "[OK]", "failed": "[FAIL]", "warning": "[WARN]"}.get(status, "[??]")
            line = f"  {icon:6s} {name:30s}"
            if msg:
                line += f"  {msg}"
            lines.append(line)

        return ReportSection(
            title="Preflight Checks",
            content="\n".join(lines),
            data=preflight,
        )

    @staticmethod
    def _format_deploy_result_section(deploy_result: dict) -> ReportSection:
        status = deploy_result.get("status", "unknown")
        duration = deploy_result.get("duration_seconds", 0)
        session = deploy_result.get("session_id", "n/a")
        lines = [
            f"Status:     {status.upper()}",
            f"Session:    {session}",
            f"Duration:   {duration:.1f}s",
        ]
        error = deploy_result.get("error", "")
        if error:
            lines.append(f"Error:      {error[:300]}")
        return ReportSection(
            title="Deployment Result",
            content="\n".join(lines),
            data={"status": status},
        )

    def _format_health_section(self, health: dict) -> ReportSection:
        lines: list[str] = []
        overall = health.get("overall", "unknown")
        lines.append(f"Overall: {overall.upper()}")
        lines.append(f"Uptime:  {health.get('uptime_seconds', 0)}s")
        lines.append("")

        components = health.get("components", [])
        if components:
            lines.append(f"{'Component':15s} {'Status':10s} {'Latency':>8s}  {'CPU':>5s}  {'Mem':>5s}")
            lines.append("-" * 55)
            for c in components:
                name = c.get("name", "?")
                status = c.get("status", "?")
                latency = f"{c.get('api_latency_ms', 0)}ms"
                cpu = f"{c.get('cpu_usage_percent', 0):.0f}%"
                mem = f"{c.get('memory_usage_percent', 0):.0f}%"
                lines.append(f"{name:15s} {status:10s} {latency:>8s}  {cpu:>5s}  {mem:>5s}")

        db = health.get("database", {})
        if db:
            lines.append("")
            lines.append(f"Database status:      {db.get('status', '?')}")
            lines.append(f"Active connections:   {db.get('active_connections', '?')}/{db.get('max_connections', '?')}")
            lines.append(f"Database size:        {db.get('database_size', '?')}")

        return ReportSection(
            title="Platform Health",
            content="\n".join(lines),
            data=health,
        )

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    def _mask_secrets(self, text: str) -> str:
        def _replacer(m: re.Match) -> str:
            return f"{m.group(1)}{m.group(2)}********"
        return _SECRET_RE.sub(_replacer, text)


def _h(text: str) -> str:
    """HTML-escape helper."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
