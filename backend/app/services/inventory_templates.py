"""Inventory template engine for AAP deployments.

Provides advanced inventory generation with templates,
variable interpolation, and multi-format output.
"""
import json
import logging
import re
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Optional

import yaml

logger = logging.getLogger(__name__)


@dataclass
class InventoryHost:
    hostname: str
    variables: dict = field(default_factory=dict)
    groups: list[str] = field(default_factory=list)


@dataclass
class InventoryGroup:
    name: str
    hosts: list[InventoryHost] = field(default_factory=list)
    children: list[str] = field(default_factory=list)
    variables: dict = field(default_factory=dict)


@dataclass
class Inventory:
    groups: dict[str, InventoryGroup] = field(default_factory=dict)
    all_variables: dict = field(default_factory=dict)


_VAR_RE = re.compile(r"\{\{\s*(\w+(?:\.\w+)*)\s*\}\}")


class InventoryTemplateEngine:
    """Advanced inventory generation with templates."""

    def __init__(self):
        self._templates: dict[str, dict] = {}
        self._register_builtin_templates()

    # ------------------------------------------------------------------
    # Built-in templates
    # ------------------------------------------------------------------

    def _register_builtin_templates(self):
        """Register built-in inventory templates."""
        self._templates["growth"] = {
            "description": "Growth (all-in-one) topology on a single host",
            "groups": {
                "automationgateway": {"hosts": ["{{ gateway_host }}"]},
                "automationcontroller": {"hosts": ["{{ controller_host }}"]},
                "automationhub": {"hosts": ["{{ hub_host }}"]},
                "automationeda": {"hosts": ["{{ eda_host }}"]},
                "database": {"hosts": ["{{ gateway_host }}"]},
            },
            "defaults": {
                "gateway_host": "aap.example.org",
                "controller_host": "aap.example.org",
                "hub_host": "aap.example.org",
                "eda_host": "aap.example.org",
                "ansible_connection": "local",
                "redis_mode": "standalone",
            },
            "all_vars": {
                "ansible_connection": "{{ ansible_connection }}",
                "redis_mode": "{{ redis_mode }}",
            },
        }

        self._templates["enterprise_basic"] = {
            "description": "Enterprise topology with 2 gateways, 2 controllers",
            "groups": {
                "automationgateway": {
                    "hosts": ["{{ gateway_host_1 }}", "{{ gateway_host_2 }}"],
                },
                "automationcontroller": {
                    "hosts": ["{{ controller_host_1 }}", "{{ controller_host_2 }}"],
                },
                "automationhub": {"hosts": ["{{ hub_host }}"]},
                "automationeda": {"hosts": ["{{ eda_host }}"]},
                "redis": {
                    "hosts": [
                        "{{ gateway_host_1 }}",
                        "{{ gateway_host_2 }}",
                        "{{ hub_host }}",
                        "{{ eda_host }}",
                    ],
                },
            },
            "defaults": {
                "gateway_host_1": "gw1.example.org",
                "gateway_host_2": "gw2.example.org",
                "controller_host_1": "ctrl1.example.org",
                "controller_host_2": "ctrl2.example.org",
                "hub_host": "hub.example.org",
                "eda_host": "eda.example.org",
                "redis_mode": "standalone",
            },
            "all_vars": {"redis_mode": "{{ redis_mode }}"},
        }

        self._templates["enterprise_ha"] = {
            "description": "Enterprise HA with clustered Redis and execution nodes",
            "groups": {
                "automationgateway": {
                    "hosts": ["{{ gateway_host_1 }}", "{{ gateway_host_2 }}"],
                },
                "automationcontroller": {
                    "hosts": ["{{ controller_host_1 }}", "{{ controller_host_2 }}"],
                },
                "automationhub": {
                    "hosts": ["{{ hub_host_1 }}", "{{ hub_host_2 }}"],
                },
                "automationeda": {
                    "hosts": ["{{ eda_host_1 }}", "{{ eda_host_2 }}"],
                },
                "execution_nodes": {
                    "hosts": ["{{ exec_host_1 }}", "{{ exec_host_2 }}"],
                },
                "redis": {
                    "hosts": [
                        "{{ gateway_host_1 }}",
                        "{{ gateway_host_2 }}",
                        "{{ hub_host_1 }}",
                        "{{ hub_host_2 }}",
                        "{{ eda_host_1 }}",
                        "{{ eda_host_2 }}",
                    ],
                },
            },
            "defaults": {
                "gateway_host_1": "gw1.example.org",
                "gateway_host_2": "gw2.example.org",
                "controller_host_1": "ctrl1.example.org",
                "controller_host_2": "ctrl2.example.org",
                "hub_host_1": "hub1.example.org",
                "hub_host_2": "hub2.example.org",
                "eda_host_1": "eda1.example.org",
                "eda_host_2": "eda2.example.org",
                "exec_host_1": "exec1.example.org",
                "exec_host_2": "exec2.example.org",
                "redis_mode": "cluster",
            },
            "all_vars": {"redis_mode": "{{ redis_mode }}"},
        }

        self._templates["enterprise_max"] = {
            "description": "Large enterprise with 3 gateways, 3 controllers, hop nodes",
            "groups": {
                "automationgateway": {
                    "hosts": [
                        "{{ gateway_host_1 }}",
                        "{{ gateway_host_2 }}",
                        "{{ gateway_host_3 }}",
                    ],
                },
                "automationcontroller": {
                    "hosts": [
                        "{{ controller_host_1 }}",
                        "{{ controller_host_2 }}",
                        "{{ controller_host_3 }}",
                    ],
                },
                "automationhub": {
                    "hosts": ["{{ hub_host_1 }}", "{{ hub_host_2 }}"],
                },
                "automationeda": {
                    "hosts": ["{{ eda_host_1 }}", "{{ eda_host_2 }}"],
                },
                "execution_nodes": {
                    "hosts": [
                        "{{ exec_host_1 }}",
                        "{{ exec_host_2 }}",
                        "{{ exec_host_3 }}",
                    ],
                },
                "redis": {
                    "hosts": [
                        "{{ gateway_host_1 }}",
                        "{{ gateway_host_2 }}",
                        "{{ gateway_host_3 }}",
                        "{{ hub_host_1 }}",
                        "{{ hub_host_2 }}",
                        "{{ eda_host_1 }}",
                        "{{ eda_host_2 }}",
                    ],
                },
            },
            "defaults": {
                "gateway_host_1": "gw1.example.org",
                "gateway_host_2": "gw2.example.org",
                "gateway_host_3": "gw3.example.org",
                "controller_host_1": "ctrl1.example.org",
                "controller_host_2": "ctrl2.example.org",
                "controller_host_3": "ctrl3.example.org",
                "hub_host_1": "hub1.example.org",
                "hub_host_2": "hub2.example.org",
                "eda_host_1": "eda1.example.org",
                "eda_host_2": "eda2.example.org",
                "exec_host_1": "exec1.example.org",
                "exec_host_2": "exec2.example.org",
                "exec_host_3": "exec3.example.org",
                "redis_mode": "cluster",
            },
            "all_vars": {"redis_mode": "{{ redis_mode }}"},
        }

        self._templates["air_gapped"] = {
            "description": "Disconnected / air-gapped growth deployment",
            "groups": {
                "automationgateway": {"hosts": ["{{ gateway_host }}"]},
                "automationcontroller": {"hosts": ["{{ controller_host }}"]},
                "automationhub": {"hosts": ["{{ hub_host }}"]},
                "automationeda": {"hosts": ["{{ eda_host }}"]},
                "database": {"hosts": ["{{ gateway_host }}"]},
            },
            "defaults": {
                "gateway_host": "aap.internal.local",
                "controller_host": "aap.internal.local",
                "hub_host": "aap.internal.local",
                "eda_host": "aap.internal.local",
                "ansible_connection": "local",
                "redis_mode": "standalone",
                "bundle_install": "true",
            },
            "all_vars": {
                "ansible_connection": "{{ ansible_connection }}",
                "redis_mode": "{{ redis_mode }}",
                "bundle_install": "{{ bundle_install }}",
            },
        }

        self._templates["development"] = {
            "description": "Minimal development / test deployment",
            "groups": {
                "automationgateway": {"hosts": ["{{ dev_host }}"]},
                "automationcontroller": {"hosts": ["{{ dev_host }}"]},
                "automationhub": {"hosts": ["{{ dev_host }}"]},
                "automationeda": {"hosts": ["{{ dev_host }}"]},
                "database": {"hosts": ["{{ dev_host }}"]},
            },
            "defaults": {
                "dev_host": "localhost",
                "ansible_connection": "local",
                "redis_mode": "standalone",
            },
            "all_vars": {
                "ansible_connection": "{{ ansible_connection }}",
                "redis_mode": "{{ redis_mode }}",
            },
        }

        self._templates["ci_cd"] = {
            "description": "CI/CD pipeline ephemeral deployment",
            "groups": {
                "automationgateway": {"hosts": ["{{ ci_host }}"]},
                "automationcontroller": {"hosts": ["{{ ci_host }}"]},
                "automationhub": {"hosts": ["{{ ci_host }}"]},
                "automationeda": {"hosts": ["{{ ci_host }}"]},
                "database": {"hosts": ["{{ ci_host }}"]},
            },
            "defaults": {
                "ci_host": "ci-runner.example.org",
                "ansible_connection": "local",
                "redis_mode": "standalone",
            },
            "all_vars": {
                "ansible_connection": "{{ ansible_connection }}",
                "redis_mode": "{{ redis_mode }}",
            },
        }

    # ------------------------------------------------------------------
    # Rendering
    # ------------------------------------------------------------------

    def render_ini(self, inventory: Inventory) -> str:
        """Render inventory in INI format."""
        lines: list[str] = []
        lines.append("# AAP Inventory — generated by InventoryTemplateEngine")
        lines.append("")

        for gname, group in inventory.groups.items():
            lines.append(f"[{gname}]")
            for host in group.hosts:
                parts = [host.hostname]
                for k, v in host.variables.items():
                    parts.append(self._format_variable(k, v))
                lines.append(" ".join(parts))
            lines.append("")

            if group.children:
                lines.append(f"[{gname}:children]")
                for child in group.children:
                    lines.append(child)
                lines.append("")

            if group.variables:
                lines.append(f"[{gname}:vars]")
                for k, v in group.variables.items():
                    lines.append(f"{k}={self._escape_value(str(v))}")
                lines.append("")

        if inventory.all_variables:
            lines.append("[all:vars]")
            for k, v in inventory.all_variables.items():
                lines.append(f"{k}={self._escape_value(str(v))}")
            lines.append("")

        return "\n".join(lines)

    def render_yaml(self, inventory: Inventory) -> str:
        """Render inventory in YAML format."""
        data: dict = {"all": {"vars": inventory.all_variables or {}, "children": {}}}

        for gname, group in inventory.groups.items():
            g_data: dict = {}
            if group.hosts:
                g_data["hosts"] = {}
                for host in group.hosts:
                    g_data["hosts"][host.hostname] = host.variables or None
            if group.children:
                g_data["children"] = {c: {} for c in group.children}
            if group.variables:
                g_data["vars"] = group.variables
            data["all"]["children"][gname] = g_data

        return yaml.dump(data, default_flow_style=False, sort_keys=False)

    def render_json(self, inventory: Inventory) -> str:
        """Render inventory in JSON format."""
        data: dict = {"_meta": {"hostvars": {}}}

        for gname, group in inventory.groups.items():
            hostnames = [h.hostname for h in group.hosts]
            data[gname] = {
                "hosts": hostnames,
                "children": group.children,
                "vars": group.variables,
            }
            for host in group.hosts:
                if host.variables:
                    data["_meta"]["hostvars"].setdefault(host.hostname, {}).update(
                        host.variables
                    )

        data["all"] = {"vars": inventory.all_variables}
        return json.dumps(data, indent=2)

    # ------------------------------------------------------------------
    # Construction helpers
    # ------------------------------------------------------------------

    def from_config(self, config: dict) -> Inventory:
        """Build Inventory from a deployment config dict (matching DeploymentConfig shape)."""
        inv = Inventory()
        topology = config.get("topology", "growth")
        is_growth = topology == "growth"

        gw_hosts = config.get("gateway", {}).get("hosts", ["aap.example.org"])
        ctrl_hosts = config.get("controller", {}).get("hosts", ["aap.example.org"])
        hub_hosts = config.get("hub", {}).get("hosts", ["aap.example.org"])
        eda_hosts = config.get("eda", {}).get("hosts", ["aap.example.org"])

        inv.groups["automationgateway"] = InventoryGroup(
            name="automationgateway",
            hosts=[InventoryHost(hostname=h) for h in gw_hosts],
        )
        inv.groups["automationcontroller"] = InventoryGroup(
            name="automationcontroller",
            hosts=[InventoryHost(hostname=h) for h in ctrl_hosts],
        )
        inv.groups["automationhub"] = InventoryGroup(
            name="automationhub",
            hosts=[InventoryHost(hostname=h) for h in hub_hosts],
        )
        inv.groups["automationeda"] = InventoryGroup(
            name="automationeda",
            hosts=[InventoryHost(hostname=h) for h in eda_hosts],
        )

        exec_nodes = config.get("execution_nodes", [])
        if exec_nodes:
            inv.groups["execution_nodes"] = InventoryGroup(
                name="execution_nodes",
                hosts=[
                    InventoryHost(
                        hostname=n.get("host", n) if isinstance(n, dict) else n,
                        variables=(
                            {"receptor_type": n["receptor_type"]}
                            if isinstance(n, dict) and n.get("receptor_type", "execution") != "execution"
                            else {}
                        ),
                    )
                    for n in exec_nodes
                ],
            )

        db_type = config.get("database", {}).get("type", "managed")
        if is_growth and db_type == "managed":
            inv.groups["database"] = InventoryGroup(
                name="database",
                hosts=[InventoryHost(hostname=gw_hosts[0])],
            )

        if not is_growth:
            redis_hosts_list = list(dict.fromkeys(gw_hosts + hub_hosts + eda_hosts))
            inv.groups["redis"] = InventoryGroup(
                name="redis",
                hosts=[InventoryHost(hostname=h) for h in redis_hosts_list],
            )

        all_vars: dict = {}
        if is_growth:
            all_vars["ansible_connection"] = "local"
        all_vars["redis_mode"] = config.get("redis_mode", "standalone")

        db_cfg = config.get("database", {})
        all_vars["postgresql_admin_username"] = db_cfg.get("admin_username", "postgres")
        all_vars["postgresql_admin_password"] = db_cfg.get("admin_password", "")

        inst_type = config.get("installation_type", "online")
        if inst_type == "online":
            reg = config.get("registry", {})
            all_vars["registry_username"] = reg.get("username", "")
            all_vars["registry_password"] = reg.get("password", "")
        else:
            all_vars["bundle_install"] = "true"
            bundle_dir = config.get("bundle_dir", "")
            if bundle_dir:
                all_vars["bundle_dir"] = bundle_dir

        for comp_name in ("gateway", "controller", "hub", "eda"):
            comp = config.get(comp_name, {})
            all_vars[f"{comp_name}_admin_password"] = comp.get("admin_password", "")
            all_vars[f"{comp_name}_pg_password"] = comp.get("pg_password", "")

        inv.all_variables = all_vars
        return inv

    def from_template(self, template_name: str, variables: dict) -> Inventory:
        """Build Inventory from a named template."""
        tmpl = self._templates.get(template_name)
        if not tmpl:
            raise ValueError(
                f"Unknown template '{template_name}'. "
                f"Available: {list(self._templates.keys())}"
            )

        merged_vars = {**tmpl.get("defaults", {}), **variables}

        inv = Inventory()
        for gname, gdef in tmpl["groups"].items():
            raw_hosts = gdef.get("hosts", [])
            hosts = [
                InventoryHost(hostname=self._interpolate(h, merged_vars))
                for h in raw_hosts
            ]
            inv.groups[gname] = InventoryGroup(
                name=gname,
                hosts=hosts,
                children=gdef.get("children", []),
                variables={
                    k: self._interpolate(str(v), merged_vars)
                    for k, v in gdef.get("vars", {}).items()
                },
            )

        inv.all_variables = {
            k: self._interpolate(str(v), merged_vars)
            for k, v in tmpl.get("all_vars", {}).items()
        }
        for k, v in variables.items():
            if k not in inv.all_variables and not k.endswith("_host"):
                inv.all_variables[k] = v

        return inv

    # ------------------------------------------------------------------
    # Validation / diff / merge
    # ------------------------------------------------------------------

    def validate_inventory(self, inventory: Inventory) -> list[str]:
        """Validate inventory structure and return errors."""
        errors: list[str] = []

        if not inventory.groups:
            errors.append("Inventory has no groups defined")
            return errors

        core_groups = {"automationgateway", "automationcontroller"}
        present = set(inventory.groups.keys())
        missing = core_groups - present
        if missing:
            errors.append(f"Missing required groups: {', '.join(sorted(missing))}")

        all_hostnames: list[str] = []
        for gname, group in inventory.groups.items():
            if not group.hosts:
                errors.append(f"Group '{gname}' has no hosts")
            for host in group.hosts:
                if not host.hostname or host.hostname.isspace():
                    errors.append(f"Group '{gname}' has an empty hostname")
                all_hostnames.append(host.hostname)

            for child in group.children:
                if child not in inventory.groups:
                    errors.append(
                        f"Group '{gname}' references unknown child group '{child}'"
                    )

        seen: set[str] = set()
        for h in all_hostnames:
            if h in seen:
                continue
            seen.add(h)

        return errors

    def diff_inventories(self, old: Inventory, new: Inventory) -> list[dict]:
        """Compare two inventories and return differences."""
        diffs: list[dict] = []

        all_groups = set(old.groups.keys()) | set(new.groups.keys())
        for gname in sorted(all_groups):
            old_g = old.groups.get(gname)
            new_g = new.groups.get(gname)

            if old_g is None:
                diffs.append({"type": "group_added", "group": gname})
                continue
            if new_g is None:
                diffs.append({"type": "group_removed", "group": gname})
                continue

            old_hosts = {h.hostname for h in old_g.hosts}
            new_hosts = {h.hostname for h in new_g.hosts}
            for h in sorted(new_hosts - old_hosts):
                diffs.append({"type": "host_added", "group": gname, "host": h})
            for h in sorted(old_hosts - new_hosts):
                diffs.append({"type": "host_removed", "group": gname, "host": h})

            if old_g.variables != new_g.variables:
                diffs.append({
                    "type": "group_vars_changed",
                    "group": gname,
                    "old": old_g.variables,
                    "new": new_g.variables,
                })

        if old.all_variables != new.all_variables:
            all_keys = set(old.all_variables.keys()) | set(new.all_variables.keys())
            for k in sorted(all_keys):
                ov = old.all_variables.get(k)
                nv = new.all_variables.get(k)
                if ov != nv:
                    diffs.append({
                        "type": "all_var_changed",
                        "key": k,
                        "old": ov,
                        "new": nv,
                    })

        return diffs

    def merge_inventories(self, base: Inventory, overlay: Inventory) -> Inventory:
        """Merge overlay inventory into base (overlay wins on conflict)."""
        merged = deepcopy(base)

        for gname, ogroup in overlay.groups.items():
            if gname not in merged.groups:
                merged.groups[gname] = deepcopy(ogroup)
                continue

            existing = merged.groups[gname]
            existing_hosts = {h.hostname for h in existing.hosts}
            for host in ogroup.hosts:
                if host.hostname not in existing_hosts:
                    existing.hosts.append(deepcopy(host))
                else:
                    for eh in existing.hosts:
                        if eh.hostname == host.hostname:
                            eh.variables.update(host.variables)
                            break

            for child in ogroup.children:
                if child not in existing.children:
                    existing.children.append(child)

            existing.variables.update(ogroup.variables)

        merged.all_variables.update(overlay.all_variables)
        return merged

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    @property
    def available_templates(self) -> list[dict]:
        return [
            {"name": name, "description": t.get("description", "")}
            for name, t in self._templates.items()
        ]

    def _format_variable(self, key: str, value) -> str:
        """Format a variable for INI output."""
        val = str(value)
        if " " in val or "'" in val or '"' in val:
            val = self._escape_value(val)
        return f"{key}={val}"

    def _escape_value(self, value: str) -> str:
        """Escape special characters in inventory values."""
        if not value:
            return "''"
        if " " in value or "'" in value or "#" in value or "=" in value:
            escaped = value.replace("'", "'\\''")
            return f"'{escaped}'"
        return value

    def _interpolate(self, template: str, variables: dict) -> str:
        """Interpolate {{ variable }} placeholders."""

        def _replace(match: re.Match) -> str:
            key = match.group(1)
            parts = key.split(".")
            val = variables
            for part in parts:
                if isinstance(val, dict):
                    val = val.get(part, match.group(0))
                else:
                    return match.group(0)
            return str(val)

        return _VAR_RE.sub(_replace, template)
