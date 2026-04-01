"""Generates AnsibleAutomationPlatform Custom Resource YAML for OpenShift deployment."""

from __future__ import annotations

import logging
from typing import Any

import yaml

logger = logging.getLogger(__name__)


def generate_cr(config: dict) -> dict:
    """
    Generate an AnsibleAutomationPlatform Custom Resource from wizard config.

    Args:
        config: The full DeploymentConfig dict from the wizard

    Returns:
        Python dict representing the CR (ready for yaml.dump)
    """
    ocp = config.get("ocp", {})
    gateway = config.get("gateway", {})
    controller = config.get("controller", {})
    hub = config.get("hub", {})
    eda = config.get("eda", {})
    database = config.get("database", {})

    namespace = ocp.get("namespace", "aap")

    # Base CR structure
    cr: dict[str, Any] = {
        "apiVersion": "aap.ansible.com/v1alpha1",
        "kind": "AnsibleAutomationPlatform",
        "metadata": {
            "name": "aap",
            "namespace": namespace,
        },
        "spec": {},
    }

    spec = cr["spec"]

    # Admin credentials
    spec["admin_user"] = "admin"
    spec["admin_password_secret"] = "aap-admin-password"

    # Gateway configuration
    gateway_replicas = ocp.get("gateway_replicas", 1)
    if gateway_replicas > 1:
        spec["gateway"] = {"replicas": gateway_replicas}

    # Controller configuration
    controller_config: dict[str, Any] = {}
    controller_replicas = ocp.get("controller_replicas", 1)
    if controller_replicas > 1:
        controller_config["replicas"] = controller_replicas

    resource_preset = ocp.get("controller_resource_preset", "medium")
    if resource_preset and resource_preset != "medium":
        controller_config["resource_preset"] = resource_preset

    if controller_config:
        spec["controller"] = controller_config

    # Hub configuration
    hub_config: dict[str, Any] = {}
    hub_replicas = ocp.get("hub_replicas", 1)
    if hub_replicas > 1:
        hub_config["replicas"] = hub_replicas

    hub_storage_backend = ocp.get("hub_storage_backend", "file")
    if hub_storage_backend != "file":
        hub_config["storage_type"] = hub_storage_backend

    hub_storage_size = ocp.get("hub_storage_size", "100Gi")
    if hub_storage_size != "100Gi":
        hub_config["storage_size"] = hub_storage_size

    # Hub file storage requires RWX — if the selected storage class is RBD (RWO only),
    # use CephFS for hub file storage instead
    storage_class = ocp.get("storage_class", "")
    if storage_class and "ceph-rbd" in storage_class:
        cephfs_class = storage_class.replace("ceph-rbd", "cephfs").removesuffix("-immediate")
        hub_config["file_storage_storage_class"] = cephfs_class
    elif storage_class:
        hub_config["file_storage_storage_class"] = storage_class

    if hub_config:
        spec["hub"] = hub_config

    # EDA configuration
    eda_replicas = ocp.get("eda_replicas", 1)
    if eda_replicas > 1:
        spec["eda"] = {"replicas": eda_replicas}

    # PostgreSQL configuration
    postgres_config: dict[str, Any] = {}

    db_type = database.get("type", "managed")
    if db_type == "external":
        # External database — use postgres_configuration_secret
        spec["postgres_configuration_secret"] = "aap-postgres-config"
    else:
        # Managed database
        storage_class = ocp.get("storage_class", "")
        if storage_class:
            postgres_config["storage_class"] = storage_class

        postgres_storage_size = ocp.get("postgres_storage_size", "50Gi")
        if postgres_storage_size != "50Gi":
            postgres_config["storage_size"] = postgres_storage_size

        if postgres_config:
            spec["postgres"] = postgres_config

    # Route configuration
    custom_route_host = ocp.get("custom_route_host", "")
    if custom_route_host:
        spec["route_host"] = custom_route_host

    tls_termination = ocp.get("tls_termination", "edge")
    if tls_termination != "edge":
        spec["tls_termination"] = tls_termination

    # Merge user-provided CR overrides
    cr_overrides = ocp.get("cr_overrides", "")
    if cr_overrides and cr_overrides.strip():
        try:
            overrides = yaml.safe_load(cr_overrides)
            if overrides and isinstance(overrides, dict):
                cr = merge_cr_overrides(cr, overrides)
        except yaml.YAMLError as e:
            logger.warning(f"Failed to parse CR overrides: {e}")

    return cr


def generate_cr_yaml(config: dict) -> str:
    """
    Generate CR as YAML string.

    Args:
        config: The full DeploymentConfig dict

    Returns:
        YAML string with nice formatting
    """
    cr = generate_cr(config)
    return yaml.dump(
        cr,
        default_flow_style=False,
        sort_keys=False,
        allow_unicode=True,
        width=120,
    )


def generate_admin_secret(config: dict) -> dict:
    """
    Generate a K8s Secret for the AAP admin password.

    Args:
        config: The full DeploymentConfig dict

    Returns:
        Secret resource dict
    """
    ocp = config.get("ocp", {})
    gateway = config.get("gateway", {})
    namespace = ocp.get("namespace", "aap")
    admin_password = gateway.get("admin_password", "")

    secret: dict[str, Any] = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {
            "name": "aap-admin-password",
            "namespace": namespace,
        },
        "type": "Opaque",
        "stringData": {
            "password": admin_password,
        },
    }

    return secret


def generate_postgres_secret(config: dict) -> dict | None:
    """
    Generate a K8s Secret for external PostgreSQL configuration.

    Only generated if database type is 'external'.

    Args:
        config: The full DeploymentConfig dict

    Returns:
        Secret resource dict or None if not using external DB
    """
    database = config.get("database", {})
    ocp = config.get("ocp", {})

    db_type = database.get("type", "managed")
    if db_type != "external":
        return None

    namespace = ocp.get("namespace", "aap")
    gateway = config.get("gateway", {})
    controller = config.get("controller", {})
    hub = config.get("hub", {})
    eda = config.get("eda", {})

    # External DB configuration requires connection details for each component
    secret: dict[str, Any] = {
        "apiVersion": "v1",
        "kind": "Secret",
        "metadata": {
            "name": "aap-postgres-config",
            "namespace": namespace,
        },
        "type": "Opaque",
        "stringData": {
            "host": database.get("host", ""),
            "port": str(database.get("port", 5432)),
            "username": database.get("admin_username", "postgres"),
            "password": database.get("admin_password", ""),
            "database": "postgres",
            "sslmode": "prefer",
            "type": "unmanaged",
        },
    }

    return secret


def merge_cr_overrides(cr: dict, overrides: dict) -> dict:
    """
    Deep-merge user-provided CR overrides into the generated CR.

    Args:
        cr: The generated CR dict
        overrides: User-provided overrides (can be partial CR or just spec)

    Returns:
        Merged CR dict
    """

    def deep_merge(base: dict, override: dict) -> dict:
        """Recursively merge override into base."""
        result = base.copy()
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    # If overrides contain a full CR structure, merge at top level
    if "spec" in overrides:
        return deep_merge(cr, overrides)

    # If overrides are just spec fields, merge into spec
    if "spec" in cr:
        cr["spec"] = deep_merge(cr["spec"], overrides)

    return cr


def generate_all_resources(config: dict) -> list[dict]:
    """
    Generate all K8s resources needed for AAP deployment.

    Args:
        config: The full DeploymentConfig dict

    Returns:
        List of resource dicts (Secret(s) + CR)
    """
    resources: list[dict] = []

    # Admin password secret (always needed)
    resources.append(generate_admin_secret(config))

    # External DB secret (if applicable)
    postgres_secret = generate_postgres_secret(config)
    if postgres_secret:
        resources.append(postgres_secret)

    # Main CR
    resources.append(generate_cr(config))

    return resources


def generate_all_resources_yaml(config: dict) -> str:
    """
    Generate all resources as a multi-document YAML string.

    Args:
        config: The full DeploymentConfig dict

    Returns:
        YAML string with all resources separated by '---'
    """
    resources = generate_all_resources(config)

    yaml_docs: list[str] = []
    for resource in resources:
        yaml_doc = yaml.dump(
            resource,
            default_flow_style=False,
            sort_keys=False,
            allow_unicode=True,
            width=120,
        )
        yaml_docs.append(yaml_doc)

    return "---\n" + "---\n".join(yaml_docs)
