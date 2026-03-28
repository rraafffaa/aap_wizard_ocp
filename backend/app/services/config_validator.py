"""Configuration validator for AAP deployments.

Provides comprehensive server-side validation of deployment
configurations with detailed error messages and auto-fix suggestions.
"""
import ipaddress
import logging
import math
import re
import socket
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

_FQDN_RE = re.compile(
    r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.[A-Za-z0-9-]{1,63})*\.[A-Za-z]{2,}$"
)
_COMMON_PASSWORDS = frozenset([
    "password", "admin", "123456", "qwerty", "letmein",
    "welcome", "changeme", "redhat", "ansible", "aap",
    "password1", "admin123", "root", "default",
])
_RESERVED_PORTS = frozenset([0, 1, 7, 9, 11, 13, 15, 17, 19, 25, 53, 67, 68, 69, 111, 514])


class Severity:
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class ValidationResult:
    field: str
    message: str
    severity: str
    category: str
    fix_suggestion: Optional[str] = None
    auto_fixable: bool = False


@dataclass
class ValidationReport:
    valid: bool
    errors: list[ValidationResult] = field(default_factory=list)
    warnings: list[ValidationResult] = field(default_factory=list)
    info: list[ValidationResult] = field(default_factory=list)
    score: int = 0
    categories: dict[str, list[ValidationResult]] = field(default_factory=dict)


class ConfigValidator:
    """Comprehensive configuration validator."""

    def __init__(self):
        self._custom_rules: list = []

    def validate(self, config: dict) -> ValidationReport:
        """Run all validators and return comprehensive report."""
        all_results: list[ValidationResult] = []
        all_results.extend(self.validate_topology(config))
        all_results.extend(self.validate_hosts(config))
        all_results.extend(self.validate_database(config))
        all_results.extend(self.validate_network(config))
        all_results.extend(self.validate_credentials(config))
        all_results.extend(self.validate_security(config))
        all_results.extend(self.validate_compatibility(config))

        for rule_fn in self._custom_rules:
            try:
                all_results.extend(rule_fn(config))
            except Exception as exc:
                logger.warning("Custom rule failed: %s", exc)

        errors = [r for r in all_results if r.severity == Severity.ERROR]
        warnings = [r for r in all_results if r.severity == Severity.WARNING]
        info = [r for r in all_results if r.severity == Severity.INFO]

        categories: dict[str, list[ValidationResult]] = {}
        for r in all_results:
            categories.setdefault(r.category, []).append(r)

        report = ValidationReport(
            valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            info=info,
            categories=categories,
        )
        report.score = self.calculate_score(report)
        return report

    # ------------------------------------------------------------------
    # Category validators
    # ------------------------------------------------------------------

    def validate_topology(self, config: dict) -> list[ValidationResult]:
        results: list[ValidationResult] = []
        topology = config.get("topology", "growth")
        if topology not in ("growth", "enterprise"):
            results.append(ValidationResult(
                field="topology",
                message=f"Unknown topology '{topology}'. Must be 'growth' or 'enterprise'.",
                severity=Severity.ERROR,
                category="topology",
                fix_suggestion="Set topology to 'growth' or 'enterprise'.",
                auto_fixable=True,
            ))
        if topology == "growth":
            results.append(ValidationResult(
                field="topology",
                message="Growth topology runs all services on one host (suitable for PoC / small deployments).",
                severity=Severity.INFO,
                category="topology",
            ))
        return results

    def validate_hosts(self, config: dict) -> list[ValidationResult]:
        """Validate host configuration."""
        results: list[ValidationResult] = []
        topology = config.get("topology", "growth")

        component_hosts = {
            "gateway": config.get("gateway", {}).get("hosts", []),
            "controller": config.get("controller", {}).get("hosts", []),
            "hub": config.get("hub", {}).get("hosts", []),
            "eda": config.get("eda", {}).get("hosts", []),
        }

        for comp, hosts in component_hosts.items():
            if not hosts:
                results.append(ValidationResult(
                    field=f"{comp}.hosts",
                    message=f"At least one {comp} host is required.",
                    severity=Severity.ERROR,
                    category="hosts",
                ))

            for h in hosts:
                if not h or h.isspace():
                    results.append(ValidationResult(
                        field=f"{comp}.hosts",
                        message=f"Empty hostname found in {comp} hosts.",
                        severity=Severity.ERROR,
                        category="hosts",
                    ))
                    continue

                if h in ("localhost", "127.0.0.1") and topology == "enterprise":
                    results.append(ValidationResult(
                        field=f"{comp}.hosts",
                        message=f"Enterprise topology should not use localhost for {comp}.",
                        severity=Severity.WARNING,
                        category="hosts",
                    ))

                if not self.is_valid_fqdn(h) and not self.is_valid_ip(h) and h != "localhost":
                    results.append(ValidationResult(
                        field=f"{comp}.hosts",
                        message=f"'{h}' is not a valid FQDN or IP address.",
                        severity=Severity.WARNING,
                        category="hosts",
                        fix_suggestion="Use a fully qualified domain name (e.g., host.example.org) or valid IP.",
                    ))

        if topology == "enterprise":
            gw = component_hosts.get("gateway", [])
            ctrl = component_hosts.get("controller", [])
            if len(gw) < 2:
                results.append(ValidationResult(
                    field="gateway.hosts",
                    message="Enterprise topology requires at least 2 gateway hosts for HA.",
                    severity=Severity.ERROR,
                    category="hosts",
                ))
            if len(ctrl) < 2:
                results.append(ValidationResult(
                    field="controller.hosts",
                    message="Enterprise topology requires at least 2 controller hosts for HA.",
                    severity=Severity.ERROR,
                    category="hosts",
                ))

        all_hosts: list[str] = []
        for hosts in component_hosts.values():
            all_hosts.extend(hosts)
        if topology == "enterprise":
            seen: dict[str, list[str]] = {}
            for comp, hosts in component_hosts.items():
                for h in hosts:
                    seen.setdefault(h, []).append(comp)
            for h, comps in seen.items():
                if len(comps) > 1 and h not in ("localhost", "127.0.0.1"):
                    results.append(ValidationResult(
                        field="hosts",
                        message=f"Host '{h}' appears in multiple components ({', '.join(comps)}). "
                                "Enterprise deployments should use dedicated hosts.",
                        severity=Severity.WARNING,
                        category="hosts",
                    ))

        return results

    def validate_database(self, config: dict) -> list[ValidationResult]:
        """Validate database configuration."""
        results: list[ValidationResult] = []
        db = config.get("database", {})
        db_type = db.get("type", "managed")

        admin_pw = db.get("admin_password", "")
        if not admin_pw:
            results.append(ValidationResult(
                field="database.admin_password",
                message="Database admin password is required.",
                severity=Severity.ERROR,
                category="database",
            ))
        else:
            strength, weaknesses = self.check_password_strength(admin_pw)
            if strength == "weak":
                results.append(ValidationResult(
                    field="database.admin_password",
                    message=f"Weak database password: {', '.join(weaknesses)}.",
                    severity=Severity.WARNING,
                    category="database",
                    fix_suggestion="Use 12+ chars with upper, lower, digits and symbols.",
                ))

        if db_type == "external":
            host = db.get("host", "")
            port = db.get("port", 5432)
            if not host:
                results.append(ValidationResult(
                    field="database.host",
                    message="External database host is required.",
                    severity=Severity.ERROR,
                    category="database",
                ))
            if not (1 <= port <= 65535):
                results.append(ValidationResult(
                    field="database.port",
                    message=f"Invalid database port: {port}.",
                    severity=Severity.ERROR,
                    category="database",
                    fix_suggestion="Use port 5432 (PostgreSQL default).",
                    auto_fixable=True,
                ))

        return results

    def validate_network(self, config: dict) -> list[ValidationResult]:
        """Validate network configuration."""
        results: list[ValidationResult] = []
        net = config.get("network", {})
        http_port = net.get("http_port", 80)
        https_port = net.get("https_port", 443)
        receptor_port = net.get("receptor_port", 27199)

        ports = {"http_port": http_port, "https_port": https_port, "receptor_port": receptor_port}
        for name, port in ports.items():
            if not isinstance(port, int) or not (1 <= port <= 65535):
                results.append(ValidationResult(
                    field=f"network.{name}",
                    message=f"Invalid port value: {port}.",
                    severity=Severity.ERROR,
                    category="network",
                ))
            elif port in _RESERVED_PORTS:
                results.append(ValidationResult(
                    field=f"network.{name}",
                    message=f"Port {port} is a system-reserved port.",
                    severity=Severity.WARNING,
                    category="network",
                ))

        if http_port == https_port:
            results.append(ValidationResult(
                field="network.http_port",
                message="HTTP and HTTPS ports must not be the same.",
                severity=Severity.ERROR,
                category="network",
            ))

        seen_ports: dict[int, list[str]] = {}
        for name, port in ports.items():
            seen_ports.setdefault(port, []).append(name)
        for port, names in seen_ports.items():
            if len(names) > 1:
                results.append(ValidationResult(
                    field="network",
                    message=f"Port {port} is used by multiple settings: {', '.join(names)}.",
                    severity=Severity.ERROR,
                    category="network",
                ))

        tls = net.get("tls", {})
        disable_https = tls.get("disable_https", False)
        if disable_https:
            results.append(ValidationResult(
                field="network.tls.disable_https",
                message="HTTPS is disabled. This is insecure for production deployments.",
                severity=Severity.WARNING,
                category="network",
            ))

        return results

    def validate_credentials(self, config: dict) -> list[ValidationResult]:
        """Validate admin credentials."""
        results: list[ValidationResult] = []
        passwords: dict[str, str] = {}

        for comp in ("gateway", "controller", "hub", "eda"):
            pw = config.get(comp, {}).get("admin_password", "")
            field_name = f"{comp}.admin_password"
            if not pw:
                results.append(ValidationResult(
                    field=field_name,
                    message=f"{comp.title()} admin password is required.",
                    severity=Severity.ERROR,
                    category="credentials",
                ))
                continue
            passwords[field_name] = pw

            strength, weaknesses = self.check_password_strength(pw)
            if strength == "weak":
                results.append(ValidationResult(
                    field=field_name,
                    message=f"Weak {comp} admin password: {', '.join(weaknesses)}.",
                    severity=Severity.WARNING,
                    category="credentials",
                    fix_suggestion="Use 12+ chars with mixed case, digits, and symbols.",
                ))

        unique_pws = set(passwords.values())
        if len(unique_pws) == 1 and len(passwords) > 1:
            results.append(ValidationResult(
                field="admin_passwords",
                message="All component admin passwords are identical. Use unique passwords per component.",
                severity=Severity.WARNING,
                category="credentials",
            ))

        return results

    def validate_security(self, config: dict) -> list[ValidationResult]:
        """Security-specific validations."""
        results: list[ValidationResult] = []
        tls = config.get("network", {}).get("tls", {})

        if tls.get("disable_https", False):
            results.append(ValidationResult(
                field="network.tls.disable_https",
                message="Production deployments should use HTTPS.",
                severity=Severity.WARNING,
                category="security",
                fix_suggestion="Set disable_https to false.",
                auto_fixable=True,
            ))

        for comp in ("gateway", "controller", "hub", "eda"):
            pw = config.get(comp, {}).get("admin_password", "")
            if pw.lower() in _COMMON_PASSWORDS:
                results.append(ValidationResult(
                    field=f"{comp}.admin_password",
                    message=f"{comp.title()} uses a commonly known password.",
                    severity=Severity.ERROR,
                    category="security",
                    fix_suggestion="Choose a strong, unique password.",
                ))

        db_pw = config.get("database", {}).get("admin_password", "")
        if db_pw.lower() in _COMMON_PASSWORDS:
            results.append(ValidationResult(
                field="database.admin_password",
                message="Database uses a commonly known password.",
                severity=Severity.ERROR,
                category="security",
                fix_suggestion="Choose a strong, unique database password.",
            ))

        example_hosts = []
        for comp in ("gateway", "controller", "hub", "eda"):
            for h in config.get(comp, {}).get("hosts", []):
                if "example.org" in h or "example.com" in h:
                    example_hosts.append(h)
        if example_hosts:
            results.append(ValidationResult(
                field="hosts",
                message=f"Default example hostnames detected: {', '.join(example_hosts[:3])}. Replace with real hostnames.",
                severity=Severity.WARNING,
                category="security",
            ))

        cert_fields = [
            ("network.tls.custom_ca_cert", tls.get("custom_ca_cert")),
            ("network.tls.custom_server_cert", tls.get("custom_server_cert")),
            ("network.tls.custom_server_key", tls.get("custom_server_key")),
        ]
        cert_set = [f for f, v in cert_fields if v]
        if cert_set and len(cert_set) < 3:
            results.append(ValidationResult(
                field="network.tls",
                message="Partial TLS certificate config: provide all three (CA cert, server cert, server key) or none.",
                severity=Severity.ERROR,
                category="security",
            ))

        return results

    def validate_compatibility(self, config: dict) -> list[ValidationResult]:
        """Cross-field compatibility checks."""
        results: list[ValidationResult] = []
        topology = config.get("topology", "growth")
        inst_type = config.get("installation_type", "online")
        db_type = config.get("database", {}).get("type", "managed")

        if topology == "enterprise" and db_type == "managed":
            results.append(ValidationResult(
                field="database.type",
                message="Enterprise topology requires an external database.",
                severity=Severity.ERROR,
                category="compatibility",
                fix_suggestion="Set database.type to 'external' and provide host details.",
                auto_fixable=False,
            ))

        if inst_type == "disconnected":
            bundle_dir = config.get("bundle_dir", "")
            if not bundle_dir:
                results.append(ValidationResult(
                    field="bundle_dir",
                    message="Disconnected installation requires bundle_dir.",
                    severity=Severity.WARNING,
                    category="compatibility",
                    fix_suggestion="Set bundle_dir to the path of the AAP installer bundle.",
                ))

        if inst_type == "online":
            reg = config.get("registry", {})
            if not reg.get("username") or not reg.get("password"):
                results.append(ValidationResult(
                    field="registry",
                    message="Online installation requires registry credentials.",
                    severity=Severity.ERROR,
                    category="compatibility",
                ))

        if topology == "growth":
            all_hosts = set()
            for comp in ("gateway", "controller", "hub", "eda"):
                hosts = config.get(comp, {}).get("hosts", [])
                all_hosts.update(hosts)
            if len(all_hosts) > 1:
                results.append(ValidationResult(
                    field="hosts",
                    message="Growth topology should use a single host for all components.",
                    severity=Severity.WARNING,
                    category="compatibility",
                    fix_suggestion="Set all component hosts to the same hostname.",
                ))

        redis_mode = config.get("redis_mode", "standalone")
        if topology == "enterprise" and redis_mode == "standalone":
            results.append(ValidationResult(
                field="redis_mode",
                message="Enterprise topology benefits from clustered Redis for HA.",
                severity=Severity.INFO,
                category="compatibility",
            ))

        return results

    # ------------------------------------------------------------------
    # Auto-fix
    # ------------------------------------------------------------------

    def auto_fix(self, config: dict, report: ValidationReport) -> tuple[dict, list[str]]:
        """Apply auto-fixes where possible. Returns (fixed_config, applied_fixes)."""
        fixed = deepcopy(config)
        applied: list[str] = []

        for result in report.errors + report.warnings:
            if not result.auto_fixable:
                continue

            if result.field == "topology" and fixed.get("topology") not in ("growth", "enterprise"):
                fixed["topology"] = "growth"
                applied.append("Set topology to 'growth' (was invalid).")

            if result.field == "database.port":
                fixed.setdefault("database", {})["port"] = 5432
                applied.append("Set database port to 5432.")

            if result.field == "network.tls.disable_https":
                fixed.setdefault("network", {}).setdefault("tls", {})["disable_https"] = False
                applied.append("Enabled HTTPS (set disable_https to false).")

        return fixed, applied

    def calculate_score(self, report: ValidationReport) -> int:
        """Calculate 0-100 configuration quality score."""
        score = 100
        score -= len(report.errors) * 15
        score -= len(report.warnings) * 5
        score += len(report.info) * 1
        return max(0, min(100, score))

    # ------------------------------------------------------------------
    # Static helpers
    # ------------------------------------------------------------------

    @staticmethod
    def is_valid_fqdn(hostname: str) -> bool:
        if not hostname or len(hostname) > 253:
            return False
        return bool(_FQDN_RE.match(hostname))

    @staticmethod
    def is_valid_ip(address: str) -> bool:
        try:
            ipaddress.ip_address(address)
            return True
        except ValueError:
            return False

    @staticmethod
    def check_password_strength(password: str) -> tuple[str, list[str]]:
        """Returns (strength_level, weakness_list)."""
        weaknesses: list[str] = []
        if len(password) < 8:
            weaknesses.append("fewer than 8 characters")
        if len(password) < 12:
            weaknesses.append("fewer than 12 characters (recommended)")
        if not re.search(r"[A-Z]", password):
            weaknesses.append("no uppercase letter")
        if not re.search(r"[a-z]", password):
            weaknesses.append("no lowercase letter")
        if not re.search(r"\d", password):
            weaknesses.append("no digit")
        if not re.search(r"[^A-Za-z0-9]", password):
            weaknesses.append("no special character")
        if password.lower() in _COMMON_PASSWORDS:
            weaknesses.append("commonly used password")

        if any(w.startswith("fewer than 8") or w == "commonly used password" for w in weaknesses):
            return "weak", weaknesses
        if len(weaknesses) >= 3:
            return "weak", weaknesses
        if weaknesses:
            return "moderate", weaknesses
        return "strong", []

    @staticmethod
    def check_port_availability(port: int) -> bool:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                s.bind(("0.0.0.0", port))
                return True
        except OSError:
            return False

    @staticmethod
    def resolve_hostname(hostname: str) -> Optional[str]:
        try:
            return socket.gethostbyname(hostname)
        except socket.gaierror:
            return None
