"""Configuration migrator for the AAP Deployment Wizard.

Handles migration of saved configurations between wizard versions,
adding new fields, renaming changed fields, and maintaining
backwards compatibility.
"""
from __future__ import annotations

import copy
import logging
from typing import Callable, Optional

logger = logging.getLogger(__name__)

CURRENT_VERSION = 3

# Migration registry
MIGRATIONS: dict[int, Callable[[dict], dict]] = {}


def migration(from_version: int):
    """Decorator to register a migration function."""

    def decorator(fn: Callable[[dict], dict]):
        MIGRATIONS[from_version] = fn
        return fn

    return decorator


@migration(1)
def migrate_v1_to_v2(config: dict) -> dict:
    """V1 -> V2: Added notification settings, execution node types."""
    config = copy.deepcopy(config)
    if "notification_config" not in config:
        config["notification_config"] = {
            "webhook_url": "",
            "enabled": False,
            "events": ["deploy_complete", "deploy_fail"],
        }
    for node in config.get("execution_nodes", []):
        if "receptor_type" not in node:
            node["receptor_type"] = "execution"
    if "redis_mode" not in config:
        config["redis_mode"] = "standalone"
    config["_version"] = 2
    return config


@migration(2)
def migrate_v2_to_v3(config: dict) -> dict:
    """V2 -> V3: Added TLS refactor, backup settings, audit preferences."""
    config = copy.deepcopy(config)
    network = config.setdefault("network", {})
    tls = network.get("tls", {})
    if isinstance(tls, bool):
        network["tls"] = {
            "custom_ca_cert": "",
            "custom_server_cert": "",
            "custom_server_key": "",
            "disable_https": not tls,
        }
    if "backup_settings" not in config:
        config["backup_settings"] = {
            "auto_backup": True,
            "max_backups": 20,
            "max_age_days": 30,
        }
    if "applied_profile" not in config:
        config["applied_profile"] = None
    config["_version"] = 3
    return config


class ConfigMigrator:
    """Migrates configurations between wizard versions."""

    def __init__(self):
        self._migrations = dict(MIGRATIONS)
        self._custom_migrations: dict[int, Callable] = {}

    def detect_version(self, config: dict) -> int:
        """Detect the version of a configuration."""
        if "_version" in config:
            return config["_version"]
        if "notification_config" not in config:
            return 1
        if "backup_settings" not in config:
            return 2
        return CURRENT_VERSION

    def needs_migration(self, config: dict) -> bool:
        """Check if a config needs migration."""
        return self.detect_version(config) < CURRENT_VERSION

    def migrate(self, config: dict, target_version: int = CURRENT_VERSION) -> dict:
        """Migrate a config to the target version."""
        current = self.detect_version(config)
        result = copy.deepcopy(config)

        while current < target_version:
            migration_fn = self._migrations.get(current) or self._custom_migrations.get(current)
            if not migration_fn:
                raise ValueError(f"No migration found for version {current} -> {current + 1}")

            logger.info("Migrating config from v%d to v%d", current, current + 1)
            result = migration_fn(result)
            current += 1

        result["_version"] = target_version
        return result

    def register_migration(self, from_version: int, fn: Callable[[dict], dict]) -> None:
        """Register a custom migration function."""
        self._custom_migrations[from_version] = fn

    def validate_migration(self, old_config: dict, new_config: dict) -> list[str]:
        """Validate that a migration preserved required fields."""
        errors = []
        required_keys = [
            "topology",
            "installation_type",
            "gateway",
            "controller",
            "hub",
            "eda",
            "network",
        ]
        for key in required_keys:
            if key not in new_config:
                errors.append(f"Required key '{key}' missing after migration")
        for component in ["gateway", "controller", "hub", "eda"]:
            old_hosts = old_config.get(component, {}).get("hosts", [])
            new_hosts = new_config.get(component, {}).get("hosts", [])
            if old_hosts and not new_hosts:
                errors.append(f"{component} hosts were lost during migration")
        return errors

    def get_migration_log(self, config: dict) -> list[dict]:
        """Get the chain of migrations that would be applied."""
        log = []
        current = self.detect_version(config)
        while current < CURRENT_VERSION:
            fn = self._migrations.get(current) or self._custom_migrations.get(current)
            if fn:
                log.append(
                    {
                        "from_version": current,
                        "to_version": current + 1,
                        "description": fn.__doc__ or f"Migration v{current} -> v{current + 1}",
                    }
                )
            current += 1
        return log
