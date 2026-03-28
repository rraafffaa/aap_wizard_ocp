"""Tests for the configuration migrator service."""
import copy
import pytest
from app.services.config_migrator import (
    ConfigMigrator,
    CURRENT_VERSION,
    migrate_v1_to_v2,
    migrate_v2_to_v3,
)


def _base_config():
    """Minimal config with all required keys for migration tests."""
    return {
        "topology": "growth",
        "installation_type": "online",
        "gateway": {"hosts": ["aap.example.org"], "admin_password": "gwpass"},
        "controller": {"hosts": ["aap.example.org"], "admin_password": "ctrlpass"},
        "hub": {"hosts": ["aap.example.org"], "admin_password": "hubpass"},
        "eda": {"hosts": ["aap.example.org"], "admin_password": "edapass"},
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
        "execution_nodes": [],
    }


@pytest.fixture
def default_config():
    """Full v3-compatible config."""
    config = copy.deepcopy(_base_config())
    config["_version"] = 3
    config["notification_config"] = {
        "webhook_url": "",
        "enabled": False,
        "events": ["deploy_complete", "deploy_fail"],
    }
    config["redis_mode"] = "standalone"
    config["backup_settings"] = {
        "auto_backup": True,
        "max_backups": 20,
        "max_age_days": 30,
    }
    config["applied_profile"] = None
    return config


class TestConfigMigrator:
    @pytest.fixture
    def migrator(self):
        return ConfigMigrator()

    @pytest.fixture
    def v1_config(self, default_config):
        config = copy.deepcopy(default_config)
        if "_version" in config:
            del config["_version"]
        if "notification_config" in config:
            del config["notification_config"]
        if "redis_mode" in config:
            del config["redis_mode"]
        if "backup_settings" in config:
            del config["backup_settings"]
        if "applied_profile" in config:
            del config["applied_profile"]
        return config

    @pytest.fixture
    def v2_config(self, default_config):
        config = copy.deepcopy(default_config)
        config["_version"] = 2
        config["notification_config"] = {"webhook_url": "", "enabled": False, "events": []}
        if "backup_settings" in config:
            del config["backup_settings"]
        if "applied_profile" in config:
            del config["applied_profile"]
        return config

    # Version detection
    def test_detect_v1(self, migrator, v1_config):
        assert migrator.detect_version(v1_config) == 1

    def test_detect_v2(self, migrator, v2_config):
        assert migrator.detect_version(v2_config) == 2

    def test_detect_current(self, migrator, default_config):
        assert migrator.detect_version(default_config) == CURRENT_VERSION

    # Needs migration
    def test_needs_migration_v1(self, migrator, v1_config):
        assert migrator.needs_migration(v1_config) is True

    def test_needs_migration_current(self, migrator, default_config):
        assert migrator.needs_migration(default_config) is False

    # V1 -> V2
    def test_migrate_v1_adds_notification(self, migrator, v1_config):
        result = migrator.migrate(v1_config)
        assert "notification_config" in result
        assert "webhook_url" in result["notification_config"]
        assert "enabled" in result["notification_config"]
        assert "events" in result["notification_config"]

    def test_migrate_v1_adds_redis_mode(self, migrator, v1_config):
        result = migrator.migrate(v1_config)
        assert "redis_mode" in result
        assert result["redis_mode"] == "standalone"

    def test_migrate_v1_adds_receptor_type(self, migrator, v1_config):
        v1_config["execution_nodes"] = [{"host": "exec1.example.org"}]
        result = migrator.migrate(v1_config)
        assert result["execution_nodes"][0]["receptor_type"] == "execution"

    # V2 -> V3
    def test_migrate_v2_adds_backup_settings(self, migrator, v2_config):
        result = migrator.migrate(v2_config)
        assert "backup_settings" in result
        assert result["backup_settings"]["auto_backup"] is True
        assert "max_backups" in result["backup_settings"]

    def test_migrate_v2_adds_applied_profile(self, migrator, v2_config):
        result = migrator.migrate(v2_config)
        assert "applied_profile" in result
        assert result["applied_profile"] is None

    def test_migrate_v2_normalizes_tls(self, migrator, v2_config):
        v2_config["network"] = {"tls": True}
        result = migrator.migrate(v2_config)
        assert isinstance(result["network"]["tls"], dict)
        assert "disable_https" in result["network"]["tls"]
        assert result["network"]["tls"]["disable_https"] is False

    # Full migration
    def test_migrate_v1_to_current(self, migrator, v1_config):
        result = migrator.migrate(v1_config)
        assert result["_version"] == CURRENT_VERSION
        assert "notification_config" in result
        assert "backup_settings" in result
        assert "applied_profile" in result

    def test_migrate_preserves_hosts(self, migrator, v1_config):
        v1_config["gateway"]["hosts"] = ["gw1.example.org", "gw2.example.org"]
        result = migrator.migrate(v1_config)
        assert result["gateway"]["hosts"] == ["gw1.example.org", "gw2.example.org"]

    def test_migrate_preserves_passwords(self, migrator, v1_config):
        v1_config["gateway"]["admin_password"] = "secret123"
        result = migrator.migrate(v1_config)
        assert result["gateway"]["admin_password"] == "secret123"

    # Validation
    def test_validate_migration_success(self, migrator, v1_config):
        migrated = migrator.migrate(v1_config)
        errors = migrator.validate_migration(v1_config, migrated)
        assert len(errors) == 0

    def test_validate_migration_missing_key(self, migrator):
        old = {"gateway": {"hosts": ["a"]}, "controller": {"hosts": ["b"]}}
        new = {"gateway": {"hosts": ["a"]}}
        errors = migrator.validate_migration(old, new)
        assert any("Required key" in e for e in errors)
        assert any("controller" in e or "hub" in e or "eda" in e for e in errors)

    # Migration log
    def test_migration_log_v1(self, migrator, v1_config):
        log = migrator.get_migration_log(v1_config)
        assert len(log) >= 2
        assert log[0]["from_version"] == 1
        assert log[0]["to_version"] == 2
        assert "description" in log[0]

    def test_migration_log_current(self, migrator, default_config):
        log = migrator.get_migration_log(default_config)
        assert len(log) == 0

    # Custom migration
    def test_register_custom_migration(self, migrator):
        def custom_v3_to_v4(config):
            c = copy.deepcopy(config)
            c["custom_field"] = "added"
            c["_version"] = 4
            return c

        migrator.register_migration(3, custom_v3_to_v4)
        config = {"_version": 3, "topology": "growth", "gateway": {}, "controller": {}, "hub": {}, "eda": {}, "network": {}, "installation_type": "online"}
        result = migrator.migrate(config, target_version=4)
        assert result["custom_field"] == "added"
        assert result["_version"] == 4
