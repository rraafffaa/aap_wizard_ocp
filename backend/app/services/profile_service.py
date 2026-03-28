"""Configuration profile management for the AAP Deployment Wizard.

Provides preset configurations for common deployment scenarios
and supports custom user profiles with YAML import/export.
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
import yaml
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

PRESET_PROFILES = [
    {
        "id": "preset-growth-dev",
        "name": "Growth — Development",
        "description": "Single-host development environment with all components. Minimal resource usage.",
        "category": "preset",
        "topology": "growth",
        "tags": ["development", "single-host", "quick-start"],
        "config": {
            "topology": "growth",
            "installation_type": "online",
            "tls_enabled": False,
            "hub_seed_collections": False,
            "controller_memory_percent": 50,
            "redis_mode": "standalone",
            "database_type": "managed",
            "ports": {"https": 443, "http": 80, "receptor": 27199},
        },
    },
    {
        "id": "preset-growth-production",
        "name": "Growth — Production",
        "description": "Single-host production setup with TLS, seeded collections, and optimized memory.",
        "category": "preset",
        "topology": "growth",
        "tags": ["production", "single-host", "tls"],
        "config": {
            "topology": "growth",
            "installation_type": "online",
            "tls_enabled": True,
            "hub_seed_collections": True,
            "controller_memory_percent": 75,
            "redis_mode": "standalone",
            "database_type": "managed",
            "ports": {"https": 443, "http": 80, "receptor": 27199},
        },
    },
    {
        "id": "preset-enterprise-basic",
        "name": "Enterprise — Basic HA",
        "description": "Multi-node deployment with 2 gateway and 2 controller nodes for basic high availability.",
        "category": "preset",
        "topology": "enterprise",
        "tags": ["enterprise", "ha", "multi-node"],
        "config": {
            "topology": "enterprise",
            "installation_type": "online",
            "tls_enabled": True,
            "hub_seed_collections": True,
            "controller_memory_percent": 75,
            "redis_mode": "standalone",
            "database_type": "external",
            "ports": {"https": 443, "http": 80, "receptor": 27199},
        },
    },
    {
        "id": "preset-enterprise-full",
        "name": "Enterprise — Full Scale",
        "description": "Large-scale distributed deployment with Redis cluster, execution nodes, and hop nodes.",
        "category": "preset",
        "topology": "enterprise",
        "tags": ["enterprise", "scale", "redis-cluster", "execution-nodes"],
        "config": {
            "topology": "enterprise",
            "installation_type": "online",
            "tls_enabled": True,
            "hub_seed_collections": True,
            "controller_memory_percent": 85,
            "redis_mode": "cluster",
            "database_type": "external",
            "ports": {"https": 443, "http": 80, "receptor": 27199},
        },
    },
    {
        "id": "preset-disconnected-growth",
        "name": "Disconnected — Growth",
        "description": "Air-gapped single-host deployment using a pre-packaged bundle.",
        "category": "preset",
        "topology": "growth",
        "tags": ["disconnected", "air-gapped", "bundle", "single-host"],
        "config": {
            "topology": "growth",
            "installation_type": "disconnected",
            "tls_enabled": True,
            "hub_seed_collections": False,
            "controller_memory_percent": 75,
            "redis_mode": "standalone",
            "database_type": "managed",
            "ports": {"https": 443, "http": 80, "receptor": 27199},
        },
    },
    {
        "id": "preset-disconnected-enterprise",
        "name": "Disconnected — Enterprise",
        "description": "Air-gapped multi-node deployment for secure, isolated environments.",
        "category": "preset",
        "topology": "enterprise",
        "tags": ["disconnected", "air-gapped", "enterprise"],
        "config": {
            "topology": "enterprise",
            "installation_type": "disconnected",
            "tls_enabled": True,
            "hub_seed_collections": False,
            "controller_memory_percent": 75,
            "redis_mode": "standalone",
            "database_type": "external",
            "ports": {"https": 443, "http": 80, "receptor": 27199},
        },
    },
    {
        "id": "preset-demo",
        "name": "Demo / Lab",
        "description": "Quick-start demo environment with all defaults. No TLS, no seeding, minimal config.",
        "category": "preset",
        "topology": "growth",
        "tags": ["demo", "lab", "quick-start", "defaults"],
        "config": {
            "topology": "growth",
            "installation_type": "online",
            "tls_enabled": False,
            "hub_seed_collections": False,
            "controller_memory_percent": 50,
            "redis_mode": "standalone",
            "database_type": "managed",
            "ports": {"https": 443, "http": 80, "receptor": 27199},
        },
    },
    {
        "id": "preset-eda-focused",
        "name": "EDA-Focused",
        "description": "Optimized for Event-Driven Ansible workloads with extra EDA worker capacity.",
        "category": "preset",
        "topology": "growth",
        "tags": ["eda", "event-driven", "webhooks"],
        "config": {
            "topology": "growth",
            "installation_type": "online",
            "tls_enabled": True,
            "hub_seed_collections": False,
            "controller_memory_percent": 50,
            "redis_mode": "standalone",
            "database_type": "managed",
            "eda_worker_count": 4,
            "eda_plugins": ["webhook", "kafka", "alertmanager"],
            "ports": {"https": 443, "http": 80, "receptor": 27199},
        },
    },
    {
        "id": "preset-ci-cd",
        "name": "CI/CD Pipeline",
        "description": "Tuned for CI/CD with high job concurrency and fast execution node turnover.",
        "category": "preset",
        "topology": "enterprise",
        "tags": ["ci-cd", "pipeline", "high-concurrency"],
        "config": {
            "topology": "enterprise",
            "installation_type": "online",
            "tls_enabled": True,
            "hub_seed_collections": True,
            "controller_memory_percent": 90,
            "controller_forks": 50,
            "redis_mode": "cluster",
            "database_type": "external",
            "ports": {"https": 443, "http": 80, "receptor": 27199},
        },
    },
    {
        "id": "preset-security-hardened",
        "name": "Security Hardened",
        "description": "Maximum-security deployment with TLS enforced, strong passwords, and restricted ports.",
        "category": "preset",
        "topology": "enterprise",
        "tags": ["security", "hardened", "compliance", "tls"],
        "config": {
            "topology": "enterprise",
            "installation_type": "disconnected",
            "tls_enabled": True,
            "hub_seed_collections": False,
            "controller_memory_percent": 75,
            "redis_mode": "standalone",
            "database_type": "external",
            "db_ssl_mode": "verify-full",
            "ports": {"https": 8443, "http": 0, "receptor": 27199},
        },
    },
]


@dataclass
class ConfigProfile:
    id: str
    name: str
    description: str
    category: str
    topology: str
    config: dict
    tags: list[str] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


class ProfileService:
    """Manages configuration profiles with file-backed storage for custom profiles."""

    def __init__(self, profiles_dir: Optional[str] = None):
        self._dir = Path(profiles_dir) if profiles_dir else Path.home() / ".aap-wizard" / "profiles"
        self._dir.mkdir(parents=True, exist_ok=True)
        self._presets = self._build_presets()

    def get_all(self) -> list[ConfigProfile]:
        return self._presets + self._load_custom()

    def get_presets(self) -> list[ConfigProfile]:
        return list(self._presets)

    def get_custom(self) -> list[ConfigProfile]:
        return self._load_custom()

    def get_by_id(self, profile_id: str) -> Optional[ConfigProfile]:
        for p in self._presets:
            if p.id == profile_id:
                return p
        return self._load_one(profile_id)

    def create(self, name: str, description: str, config: dict,
               tags: Optional[list[str]] = None, topology: str = "") -> ConfigProfile:
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        profile = ConfigProfile(
            id=f"custom-{uuid.uuid4().hex[:12]}",
            name=name,
            description=description,
            category="custom",
            topology=topology or config.get("topology", "growth"),
            config=config,
            tags=tags or [],
            created_at=now,
            updated_at=now,
        )
        self._save(profile)
        logger.info("Created custom profile '%s' (%s)", name, profile.id)
        return profile

    def update(self, profile_id: str, updates: dict) -> Optional[ConfigProfile]:
        if profile_id.startswith("preset-"):
            logger.warning("Cannot update preset profile '%s'", profile_id)
            return None

        profile = self._load_one(profile_id)
        if not profile:
            return None

        for key in ("name", "description", "tags", "topology"):
            if key in updates:
                setattr(profile, key, updates[key])

        if "config" in updates:
            profile.config.update(updates["config"])

        profile.updated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self._save(profile)
        logger.info("Updated profile '%s' (%s)", profile.name, profile_id)
        return profile

    def delete(self, profile_id: str) -> bool:
        if profile_id.startswith("preset-"):
            logger.warning("Cannot delete preset profile '%s'", profile_id)
            return False

        path = self._dir / f"{profile_id}.json"
        if not path.exists():
            return False

        path.unlink()
        logger.info("Deleted profile '%s'", profile_id)
        return True

    def export_yaml(self, profile_id: str) -> str:
        profile = self.get_by_id(profile_id)
        if not profile:
            raise ValueError(f"Profile not found: {profile_id}")

        data = {
            "name": profile.name,
            "description": profile.description,
            "topology": profile.topology,
            "tags": profile.tags,
            "config": profile.config,
        }
        return yaml.dump(data, default_flow_style=False, sort_keys=False, allow_unicode=True)

    def import_yaml(self, yaml_content: str) -> ConfigProfile:
        try:
            data = yaml.safe_load(yaml_content)
        except yaml.YAMLError as exc:
            raise ValueError(f"Invalid YAML: {exc}") from exc

        if not isinstance(data, dict):
            raise ValueError("YAML content must be a mapping/object")

        name = data.get("name", "Imported Profile")
        description = data.get("description", "")
        config = data.get("config", {})
        tags = data.get("tags", [])
        topology = data.get("topology", config.get("topology", "growth"))

        if not isinstance(config, dict):
            raise ValueError("'config' field must be a mapping/object")

        return self.create(
            name=name,
            description=description,
            config=config,
            tags=tags if isinstance(tags, list) else [],
            topology=topology,
        )

    def diff_configs(self, config_a: dict, config_b: dict,
                     path: str = "") -> list[dict]:
        """Compute a flat list of differences between two config dicts."""
        diffs: list[dict] = []
        all_keys = set(list(config_a.keys()) + list(config_b.keys()))

        for key in sorted(all_keys):
            current_path = f"{path}.{key}" if path else key
            val_a = config_a.get(key)
            val_b = config_b.get(key)

            if key not in config_a:
                diffs.append({"path": current_path, "type": "added", "old": None, "new": val_b})
            elif key not in config_b:
                diffs.append({"path": current_path, "type": "removed", "old": val_a, "new": None})
            elif isinstance(val_a, dict) and isinstance(val_b, dict):
                diffs.extend(self.diff_configs(val_a, val_b, current_path))
            elif val_a != val_b:
                diffs.append({"path": current_path, "type": "changed", "old": val_a, "new": val_b})

        return diffs

    def search(self, query: str) -> list[ConfigProfile]:
        query_lower = query.lower()
        results = []
        for profile in self.get_all():
            if (query_lower in profile.name.lower()
                    or query_lower in profile.description.lower()
                    or any(query_lower in t.lower() for t in profile.tags)):
                results.append(profile)
        return results

    def _build_presets(self) -> list[ConfigProfile]:
        presets = []
        for data in PRESET_PROFILES:
            presets.append(ConfigProfile(
                id=data["id"],
                name=data["name"],
                description=data["description"],
                category="preset",
                topology=data["topology"],
                config=data["config"],
                tags=data.get("tags", []),
                created_at="2025-01-01T00:00:00Z",
                updated_at="2025-01-01T00:00:00Z",
            ))
        return presets

    def _save(self, profile: ConfigProfile) -> None:
        path = self._dir / f"{profile.id}.json"
        try:
            path.write_text(json.dumps(asdict(profile), indent=2, default=str))
        except Exception as exc:
            logger.error("Failed to save profile '%s': %s", profile.id, exc)
            raise

    def _load_one(self, profile_id: str) -> Optional[ConfigProfile]:
        path = self._dir / f"{profile_id}.json"
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text())
            return ConfigProfile(**data)
        except Exception as exc:
            logger.error("Failed to load profile '%s': %s", profile_id, exc)
            return None

    def _load_custom(self) -> list[ConfigProfile]:
        profiles = []
        for path in sorted(self._dir.glob("custom-*.json")):
            try:
                data = json.loads(path.read_text())
                profiles.append(ConfigProfile(**data))
            except Exception as exc:
                logger.debug("Skipping invalid profile %s: %s", path.name, exc)
        return profiles
