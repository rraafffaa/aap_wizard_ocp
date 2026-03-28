"""Command-line interface for the AAP Deployment Wizard.

Allows running the wizard headlessly (without the web UI).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import yaml

from app.models import DeploymentConfig, HostInfo, PreflightRequest
from app.inventory import InventoryGenerator
from app.preflight import PreflightChecker
from app.services.config_validator import ConfigValidator, ValidationReport
from app.services.profile_service import ProfileService
from app.services.report_generator import ReportGenerator

VERSION = "1.0.0"

# ANSI color codes
COLORS = {
    "red": "\033[31m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "blue": "\033[34m",
    "reset": "\033[0m",
}


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="aap-wizard",
        description="AAP 2.6 Deployment Wizard CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s generate --config config.json
  %(prog)s generate --profile production-ha
  %(prog)s validate --config config.json
  %(prog)s preflight --config config.json
  %(prog)s profiles list
  %(prog)s profiles show production-ha
  %(prog)s profiles export production-ha -o profile.yaml
  %(prog)s report --config config.json --type pre-deploy
  %(prog)s serve --port 8000
        """,
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # generate - Generate inventory file
    gen_parser = subparsers.add_parser("generate", help="Generate inventory file")
    gen_parser.add_argument("--config", "-c", help="Path to config JSON/YAML file")
    gen_parser.add_argument("--profile", "-p", help="Use a preset profile name")
    gen_parser.add_argument("--output", "-o", help="Output file path (default: stdout)")
    gen_parser.add_argument(
        "--format", "-f", choices=["ini", "yaml", "json"], default="ini"
    )
    gen_parser.add_argument("--dry-run", action="store_true", help="Show what would be generated")

    # validate - Validate configuration
    val_parser = subparsers.add_parser("validate", help="Validate configuration")
    val_parser.add_argument("--config", "-c", required=True)
    val_parser.add_argument("--strict", action="store_true", help="Treat warnings as errors")
    val_parser.add_argument("--json", action="store_true", help="Output as JSON")
    val_parser.add_argument("--auto-fix", action="store_true", help="Apply auto-fixes")

    # preflight - Run pre-flight checks
    pre_parser = subparsers.add_parser("preflight", help="Run pre-flight checks")
    pre_parser.add_argument("--config", "-c", required=True)
    pre_parser.add_argument("--json", action="store_true")
    pre_parser.add_argument("--fail-on-warning", action="store_true")

    # profiles - Manage profiles
    prof_parser = subparsers.add_parser("profiles", help="Manage configuration profiles")
    prof_sub = prof_parser.add_subparsers(dest="profile_command")
    prof_sub.add_parser("list", help="List all profiles")
    prof_show = prof_sub.add_parser("show", help="Show profile details")
    prof_show.add_argument("name", help="Profile name or ID")
    prof_export = prof_sub.add_parser("export", help="Export profile")
    prof_export.add_argument("name")
    prof_export.add_argument("--output", "-o")
    prof_export.add_argument("--format", "-f", choices=["json", "yaml"], default="yaml")
    prof_import = prof_sub.add_parser("import", help="Import profile")
    prof_import.add_argument("file", help="Profile file path")

    # report - Generate reports
    rep_parser = subparsers.add_parser("report", help="Generate deployment report")
    rep_parser.add_argument("--config", "-c", required=True)
    rep_parser.add_argument(
        "--type", "-t",
        choices=["pre-deploy", "config", "health"],
        default="config",
    )
    rep_parser.add_argument("--format", "-f", choices=["text", "json", "html"], default="text")
    rep_parser.add_argument("--output", "-o")

    # serve - Start web server
    serve_parser = subparsers.add_parser("serve", help="Start the web server")
    serve_parser.add_argument("--host", default="0.0.0.0")
    serve_parser.add_argument("--port", "-p", type=int, default=8000)
    serve_parser.add_argument("--reload", action="store_true")

    # version
    subparsers.add_parser("version", help="Show version")

    return parser


def load_config(path: str) -> dict:
    """Load config from JSON or YAML file."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Config file not found: {path}")

    content = p.read_text()
    suffix = p.suffix.lower()

    if suffix in (".json",):
        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON in {path}: {e}") from e
    if suffix in (".yaml", ".yml"):
        try:
            data = yaml.safe_load(content)
            if data is None:
                return {}
            return data
        except yaml.YAMLError as e:
            raise ValueError(f"Invalid YAML in {path}: {e}") from e

    raise ValueError(f"Unsupported config format: {suffix}. Use .json or .yaml")


def print_table(headers: list, rows: list, padding: int = 2) -> None:
    """Print a formatted table to stdout."""
    if not headers:
        return

    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            if i < len(col_widths):
                col_widths[i] = max(col_widths[i], len(str(cell)))

    pad = " " * padding
    header_line = pad.join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    print(header_line)
    print("-" * len(header_line))

    for row in rows:
        cells = [str(c) for c in row]
        while len(cells) < len(headers):
            cells.append("")
        line = pad.join(cells[i].ljust(col_widths[i]) for i in range(len(headers)))
        print(line)


def print_colored(text: str, color: str) -> None:
    """Print colored text using ANSI codes."""
    code = COLORS.get(color, COLORS["reset"])
    reset = COLORS["reset"]
    print(f"{code}{text}{reset}")


def _profile_to_config(profile_service: ProfileService, profile_id: str) -> dict:
    """Build full deployment config from a profile."""
    profile = profile_service.get_by_id(profile_id)
    if not profile:
        raise ValueError(f"Profile not found: {profile_id}")

    base = {
        "topology": "growth",
        "installation_type": "online",
        "registry": {"username": "CHANGE_ME", "password": "CHANGE_ME"},
        "database": {
            "type": "managed",
            "host": "",
            "port": 5432,
            "admin_username": "postgres",
            "admin_password": "CHANGE_ME",
        },
        "gateway": {
            "hosts": ["aap.example.org"],
            "admin_password": "CHANGE_ME",
            "pg_host": "",
            "pg_database": "gateway",
            "pg_username": "gateway",
            "pg_password": "CHANGE_ME",
        },
        "controller": {
            "hosts": ["aap.example.org"],
            "admin_password": "CHANGE_ME",
            "pg_host": "",
            "pg_database": "controller",
            "pg_username": "controller",
            "pg_password": "CHANGE_ME",
            "percent_memory_capacity": 0.5,
        },
        "hub": {
            "hosts": ["aap.example.org"],
            "admin_password": "CHANGE_ME",
            "pg_host": "",
            "pg_database": "hub",
            "pg_username": "hub",
            "pg_password": "CHANGE_ME",
            "seed_collections": False,
        },
        "eda": {
            "hosts": ["aap.example.org"],
            "admin_password": "CHANGE_ME",
            "pg_host": "",
            "pg_database": "eda",
            "pg_username": "eda",
            "pg_password": "CHANGE_ME",
            "safe_plugins": ["ansible.eda.webhook", "ansible.eda.alertmanager"],
        },
        "execution_nodes": [],
        "hosts": [],
        "network": {
            "http_port": 80,
            "https_port": 443,
            "receptor_port": 27199,
            "tls": {
                "custom_ca_cert": "",
                "custom_server_cert": "",
                "custom_server_key": "",
                "disable_https": False,
            },
        },
        "redis_mode": "standalone",
        "bundle_dir": "",
        "install_dir": "/opt/aap",
        "eula_accepted": False,
        "dry_run": False,
        "target_host": "",
        "target_user": "aap",
        "target_password": "",
        "target_ssh_port": 22,
    }

    cfg = profile.config
    topology = cfg.get("topology", "growth")
    base["topology"] = topology
    base["installation_type"] = cfg.get("installation_type", "online")
    base["redis_mode"] = cfg.get("redis_mode", "standalone")
    base["database"]["type"] = cfg.get("database_type", "managed")
    base["hub"]["seed_collections"] = cfg.get("hub_seed_collections", False)
    base["controller"]["percent_memory_capacity"] = (
        cfg.get("controller_memory_percent", 50) / 100.0
    )

    ports = cfg.get("ports", {})
    if isinstance(ports, dict):
        base["network"]["http_port"] = ports.get("http", 80)
        base["network"]["https_port"] = ports.get("https", 443)
        base["network"]["receptor_port"] = ports.get("receptor", 27199)

    base["network"]["tls"]["disable_https"] = not cfg.get("tls_enabled", False)
    base["bundle_dir"] = cfg.get("bundle_dir", "")

    if topology == "enterprise":
        base["gateway"]["hosts"] = ["gw1.example.org", "gw2.example.org"]
        base["controller"]["hosts"] = ["ctrl1.example.org", "ctrl2.example.org"]
        base["hub"]["hosts"] = ["hub1.example.org", "hub2.example.org"]
        base["eda"]["hosts"] = ["eda1.example.org", "eda2.example.org"]
        base["database"]["type"] = "external"
        base["database"]["host"] = "db.example.org"

    return base


def cmd_generate(args) -> int:
    """Generate inventory file."""
    profile_service = ProfileService()
    config_dict: dict

    if args.config:
        config_dict = load_config(args.config)
    elif args.profile:
        config_dict = _profile_to_config(profile_service, args.profile)
        print_colored("Note: Profile-based config uses placeholder passwords. Set them before deployment.", "yellow")
    else:
        print_colored("Error: Either --config or --profile is required.", "red")
        return 1

    try:
        deployment_config = DeploymentConfig(**config_dict)
    except Exception as e:
        print_colored(f"Error: Invalid config: {e}", "red")
        return 1

    gen = InventoryGenerator(deployment_config)
    errors = gen.validate()
    if errors:
        for err in errors:
            print_colored(f"  - {err}", "red")
        return 1

    output = gen.render()

    if args.format == "yaml":
        groups = {}
        current_group = None
        for line in output.splitlines():
            if line.startswith("[") and ":" not in line:
                current_group = line.strip("[]")
                groups[current_group] = []
            elif current_group and line and not line.startswith("#"):
                groups[current_group].append(line)
        output = yaml.dump(groups, default_flow_style=False, sort_keys=False)
    elif args.format == "json":
        groups = {}
        current_group = None
        for line in output.splitlines():
            if line.startswith("[") and ":" not in line:
                current_group = line.strip("[]")
                groups[current_group] = []
            elif current_group and line and not line.startswith("#"):
                groups[current_group].append(line)
        output = json.dumps(groups, indent=2)

    if args.dry_run:
        print("--- Dry run: would generate ---")
        print(output)
        return 0

    if args.output:
        Path(args.output).write_text(output)
        print_colored(f"Inventory written to {args.output}", "green")
    else:
        print(output)

    return 0


def cmd_validate(args) -> int:
    """Validate configuration."""
    config_dict = load_config(args.config)
    validator = ConfigValidator()
    report = validator.validate(config_dict)

    if args.auto_fix:
        fixed, applied = validator.auto_fix(config_dict, report)
        if applied:
            print_colored("Auto-fixes applied:", "green")
            for fix in applied:
                print(f"  - {fix}")
            config_dict = fixed
            report = validator.validate(config_dict)

    if args.json:
        out = {
            "valid": report.valid,
            "score": report.score,
            "errors": [{"field": r.field, "message": r.message} for r in report.errors],
            "warnings": [{"field": r.field, "message": r.message} for r in report.warnings],
        }
        print(json.dumps(out, indent=2))
    else:
        status = "PASS" if report.valid else "FAIL"
        color = "green" if report.valid else "red"
        print_colored(f"Validation: {status} (score: {report.score}/100)", color)

        if report.errors:
            print_colored("\nErrors:", "red")
            for r in report.errors:
                print(f"  [{r.field}] {r.message}")

        if report.warnings:
            print_colored("\nWarnings:", "yellow")
            for r in report.warnings:
                print(f"  [{r.field}] {r.message}")

    if args.strict and report.warnings:
        return 1
    return 0 if report.valid else 1


def cmd_preflight(args) -> int:
    """Run pre-flight checks."""
    config_dict = load_config(args.config)
    try:
        deployment_config = DeploymentConfig(**config_dict)
    except Exception as e:
        print_colored(f"Error: Invalid config: {e}", "red")
        return 1

    hosts = [
        HostInfo(hostname=h.get("hostname", h) if isinstance(h, dict) else h)
        for h in config_dict.get("hosts", [])
    ]
    if not hosts and deployment_config.gateway.hosts:
        hosts = [HostInfo(hostname=h) for h in deployment_config.gateway.hosts]

    request = PreflightRequest(
        topology=deployment_config.topology.value,
        installation_type=deployment_config.installation_type.value,
        hosts=hosts,
    )

    async def _run():
        checker = PreflightChecker(request)
        return await checker.run()

    result = asyncio.run(_run())

    if args.json:
        out = {
            "overall": result.overall,
            "checks": [
                {"name": c.name, "status": c.status, "message": c.message}
                for c in result.checks
            ],
        }
        print(json.dumps(out, indent=2))
    else:
        color = "green" if result.overall == "passed" else ("yellow" if result.overall == "warning" else "red")
        print_colored(f"Preflight: {result.overall.upper()}", color)
        for c in result.checks:
            icon = {"passed": "[OK]", "failed": "[FAIL]", "warning": "[WARN]"}.get(c.status, "[??]")
            print(f"  {icon} {c.name}: {c.message}")

    if args.fail_on_warning and result.overall != "passed":
        return 1
    return 0 if result.overall != "failed" else 1


def cmd_profiles(args) -> int:
    """Manage profiles."""
    profile_service = ProfileService()

    if args.profile_command == "list":
        profiles = profile_service.get_all()
        print_table(
            ["ID", "Name", "Topology", "Category"],
            [
                [p.id, p.name, p.topology, p.category]
                for p in profiles
            ],
        )
        return 0

    if args.profile_command == "show":
        profile = profile_service.get_by_id(args.name)
        if not profile:
            print_colored(f"Profile not found: {args.name}", "red")
            return 1
        print(f"ID:          {profile.id}")
        print(f"Name:        {profile.name}")
        print(f"Description: {profile.description}")
        print(f"Topology:    {profile.topology}")
        print(f"Category:    {profile.category}")
        print(f"Tags:        {', '.join(profile.tags)}")
        print("\nConfig:")
        print(json.dumps(profile.config, indent=2))
        return 0

    if args.profile_command == "export":
        try:
            content = profile_service.export_yaml(args.name)
            if args.format == "json":
                profile = profile_service.get_by_id(args.name)
                content = json.dumps(
                    {"name": profile.name, "description": profile.description, "config": profile.config},
                    indent=2,
                )
        except ValueError as e:
            print_colored(str(e), "red")
            return 1

        if args.output:
            Path(args.output).write_text(content)
            print_colored(f"Exported to {args.output}", "green")
        else:
            print(content)
        return 0

    if args.profile_command == "import":
        path = Path(args.file)
        if not path.exists():
            print_colored(f"File not found: {args.file}", "red")
            return 1
        try:
            profile = profile_service.import_yaml(path.read_text())
            print_colored(f"Imported profile: {profile.name} ({profile.id})", "green")
        except ValueError as e:
            print_colored(str(e), "red")
            return 1
        return 0

    print_colored("Use: profiles list | show | export | import", "yellow")
    return 0


def cmd_report(args) -> int:
    """Generate deployment report."""
    config_dict = load_config(args.config)
    report_gen = ReportGenerator()

    if args.type == "pre-deploy":
        validator = ConfigValidator()
        report = validator.validate(config_dict)
        validation_dict = {
            "valid": report.valid,
            "score": report.score,
            "errors": [{"field": r.field, "message": r.message} for r in report.errors],
            "warnings": [{"field": r.field, "message": r.message} for r in report.warnings],
        }
        content = report_gen.generate_pre_deploy_report(
            config_dict, validation=validation_dict
        )
    elif args.type == "config":
        content = report_gen.generate_config_report(config_dict)
    elif args.type == "health":
        content = report_gen.generate_health_report(config_dict)
    else:
        content = report_gen.generate_config_report(config_dict)

    if args.format == "json":
        sections = report_gen._sections
        content = report_gen.render_json(sections)
    elif args.format == "html":
        sections = report_gen._sections
        content = report_gen.render_html(sections)

    if args.output:
        Path(args.output).write_text(content)
        print_colored(f"Report written to {args.output}", "green")
    else:
        print(content)

    return 0


def cmd_serve(args) -> int:
    """Start the web server."""
    import subprocess

    cmd = [
        sys.executable, "-m", "uvicorn", "app.main:app",
        "--host", args.host,
        "--port", str(args.port),
        "--app-dir", str(Path(__file__).parent.parent),
    ]
    if args.reload:
        cmd.append("--reload")

    print_colored(f"Serving at http://{args.host}:{args.port}", "green")
    try:
        subprocess.run(cmd, check=True)
    except KeyboardInterrupt:
        pass
    return 0


def cmd_version(args) -> int:
    """Show version."""
    print(f"AAP Deployment Wizard CLI v{VERSION}")
    return 0


def main() -> int:
    parser = create_parser()
    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return 0

    commands = {
        "generate": cmd_generate,
        "validate": cmd_validate,
        "preflight": cmd_preflight,
        "profiles": cmd_profiles,
        "report": cmd_report,
        "serve": cmd_serve,
        "version": cmd_version,
    }

    try:
        return commands[args.command](args)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130
    except FileNotFoundError as e:
        print_colored(str(e), "red")
        return 1
    except ValueError as e:
        print_colored(str(e), "red")
        return 1
    except Exception as e:
        print_colored(f"Error: {e}", "red")
        return 1


if __name__ == "__main__":
    sys.exit(main())
