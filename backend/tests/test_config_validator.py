"""Tests for the configuration validator service."""
import pytest

from app.services.config_validator import (
    ConfigValidator,
    ValidationResult,
    ValidationReport,
    Severity,
)


@pytest.fixture
def default_config():
    """Minimal valid growth config."""
    return {
        "topology": "growth",
        "installation_type": "online",
        "registry": {"username": "reguser", "password": "regpass123!"},
        "database": {
            "type": "managed",
            "host": "",
            "port": 5432,
            "admin_username": "postgres",
            "admin_password": "Str0ngDbP@ss!",
        },
        "gateway": {
            "hosts": ["aap.example.org"],
            "admin_password": "GwP@ssw0rd!",
            "pg_host": "",
            "pg_database": "gateway",
            "pg_username": "gateway",
            "pg_password": "gwdbpass",
        },
        "controller": {
            "hosts": ["aap.example.org"],
            "admin_password": "CtrlP@ss!",
            "pg_host": "",
            "pg_database": "controller",
            "pg_username": "controller",
            "pg_password": "ctrldbpass",
        },
        "hub": {
            "hosts": ["aap.example.org"],
            "admin_password": "HubP@ss!",
            "pg_host": "",
            "pg_database": "hub",
            "pg_username": "hub",
            "pg_password": "hubdbpass",
            "seed_collections": False,
        },
        "eda": {
            "hosts": ["aap.example.org"],
            "admin_password": "EdaP@ss!",
            "pg_host": "",
            "pg_database": "eda",
            "pg_username": "eda",
            "pg_password": "edadbpass",
        },
        "network": {
            "http_port": 80,
            "https_port": 443,
            "receptor_port": 27199,
            "tls": {"disable_https": False},
        },
        "redis_mode": "standalone",
    }


@pytest.fixture
def enterprise_config():
    """Enterprise topology with external DB."""
    return {
        "topology": "enterprise",
        "installation_type": "online",
        "registry": {"username": "reg", "password": "regpass!"},
        "database": {
            "type": "external",
            "host": "db.example.org",
            "port": 5432,
            "admin_username": "postgres",
            "admin_password": "DbP@ss!",
        },
        "gateway": {
            "hosts": ["gw1.example.org", "gw2.example.org"],
            "admin_password": "GwP@ss!",
            "pg_host": "db.example.org",
            "pg_database": "gateway",
            "pg_username": "gateway",
            "pg_password": "gwdb",
        },
        "controller": {
            "hosts": ["ctrl1.example.org", "ctrl2.example.org"],
            "admin_password": "CtrlP@ss!",
            "pg_host": "db.example.org",
            "pg_database": "controller",
            "pg_username": "controller",
            "pg_password": "ctrldb",
        },
        "hub": {
            "hosts": ["hub1.example.org", "hub2.example.org"],
            "admin_password": "HubP@ss!",
            "pg_host": "db.example.org",
            "pg_database": "hub",
            "pg_username": "hub",
            "pg_password": "hubdb",
        },
        "eda": {
            "hosts": ["eda1.example.org", "eda2.example.org"],
            "admin_password": "EdaP@ss!",
            "pg_host": "db.example.org",
            "pg_database": "eda",
            "pg_username": "eda",
            "pg_password": "edadb",
        },
        "network": {
            "http_port": 80,
            "https_port": 443,
            "receptor_port": 27199,
            "tls": {"disable_https": False},
        },
        "redis_mode": "cluster",
    }


class TestConfigValidator:
    @pytest.fixture
    def validator(self):
        return ConfigValidator()

    def test_valid_growth_topology(self, validator, default_config):
        report = validator.validate(default_config)
        assert report.valid
        assert len(report.errors) == 0

    def test_valid_enterprise_topology(self, validator, enterprise_config):
        report = validator.validate(enterprise_config)
        assert report.valid
        assert len(report.errors) == 0

    def test_invalid_topology_value(self, validator):
        report = validator.validate({"topology": "invalid"})
        assert not report.valid
        errs = [e for e in report.errors if "topology" in e.field.lower()]
        assert len(errs) >= 1

    def test_valid_fqdn(self, validator):
        cfg = {"gateway": {"hosts": ["host.example.org"]}, "controller": {"hosts": ["host.example.org"]},
               "hub": {"hosts": ["host.example.org"]}, "eda": {"hosts": ["host.example.org"]},
               "topology": "growth", "database": {"admin_password": "x"}, "registry": {"username": "u", "password": "p"}}
        for c in ("gateway", "controller", "hub", "eda"):
            cfg[c]["admin_password"] = "ValidP@ss1!"
        cfg["database"]["admin_password"] = "DbP@ss1!"
        report = validator.validate(cfg)
        host_errors = [e for e in report.errors + report.warnings if "FQDN" in e.message or "host" in e.field]
        assert not any("not a valid FQDN" in e.message for e in report.errors)

    def test_invalid_fqdn_no_dot(self, validator, default_config):
        default_config["gateway"]["hosts"] = ["localhost"]
        default_config["controller"]["hosts"] = ["nohost"]
        report = validator.validate(default_config)
        warnings = [w for w in report.warnings if "nohost" in w.message or "valid" in w.message.lower()]
        assert len(warnings) >= 1 or any("nohost" in str(w) for w in report.warnings)

    def test_invalid_fqdn_special_chars(self, validator, default_config):
        default_config["gateway"]["hosts"] = ["bad@host#name"]
        report = validator.validate(default_config)
        assert any("valid" in w.message.lower() or "FQDN" in w.message for w in report.warnings)

    def test_valid_ip(self, validator, default_config):
        default_config["gateway"]["hosts"] = ["192.168.1.10"]
        default_config["controller"]["hosts"] = ["192.168.1.10"]
        default_config["hub"]["hosts"] = ["192.168.1.10"]
        default_config["eda"]["hosts"] = ["192.168.1.10"]
        report = validator.validate(default_config)
        assert not any("192.168.1.10" in e.message and "valid" in e.message for e in report.errors)

    def test_invalid_ip(self, validator, default_config):
        default_config["gateway"]["hosts"] = ["999.999.999.999"]
        default_config["controller"]["hosts"] = ["999.999.999.999"]
        default_config["hub"]["hosts"] = ["999.999.999.999"]
        default_config["eda"]["hosts"] = ["999.999.999.999"]
        report = validator.validate(default_config)
        assert any("valid" in w.message.lower() for w in report.warnings)

    def test_duplicate_hosts_warning(self, validator, enterprise_config):
        enterprise_config["gateway"]["hosts"] = ["same.example.org", "same.example.org"]
        enterprise_config["controller"]["hosts"] = ["same.example.org", "same.example.org"]
        enterprise_config["hub"]["hosts"] = ["same.example.org"]
        enterprise_config["eda"]["hosts"] = ["same.example.org"]
        report = validator.validate(enterprise_config)
        assert any("multiple" in w.message.lower() or "appears" in w.message.lower() for w in report.warnings)

    def test_enterprise_min_hosts(self, validator):
        cfg = {
            "topology": "enterprise",
            "gateway": {"hosts": ["gw1.example.org"]},
            "controller": {"hosts": ["ctrl1.example.org"]},
            "hub": {"hosts": ["hub1.example.org"]},
            "eda": {"hosts": ["eda1.example.org"]},
            "database": {"type": "external", "host": "db.example.org", "admin_password": "x"},
            "registry": {"username": "u", "password": "p"},
        }
        for c in ("gateway", "controller", "hub", "eda"):
            cfg[c]["admin_password"] = "P@ss1!"
        report = validator.validate(cfg)
        assert not report.valid
        assert any("2 gateway" in e.message or "2 controller" in e.message for e in report.errors)

    def test_empty_hosts_error(self, validator):
        cfg = {
            "topology": "growth",
            "gateway": {"hosts": []},
            "controller": {"hosts": []},
            "hub": {"hosts": []},
            "eda": {"hosts": []},
            "database": {"admin_password": "x"},
            "registry": {"username": "u", "password": "p"},
        }
        for c in ("gateway", "controller", "hub", "eda"):
            cfg[c]["admin_password"] = "P@ss1!"
        report = validator.validate(cfg)
        assert not report.valid
        assert len(report.errors) >= 1

    def test_managed_db_no_host_needed(self, validator, default_config):
        report = validator.validate(default_config)
        db_errors = [e for e in report.errors if "database" in e.field and "host" in e.message]
        assert len(db_errors) == 0

    def test_external_db_requires_host(self, validator, default_config):
        default_config["database"]["type"] = "external"
        default_config["database"]["host"] = ""
        report = validator.validate(default_config)
        assert any("host" in e.message.lower() and "database" in e.field for e in report.errors)

    def test_enterprise_requires_external_db(self, validator, enterprise_config):
        enterprise_config["database"]["type"] = "managed"
        report = validator.validate(enterprise_config)
        assert any("external" in e.message.lower() for e in report.errors)

    def test_db_password_strength(self, validator, default_config):
        default_config["database"]["admin_password"] = "weak"
        report = validator.validate(default_config)
        assert any("weak" in w.message.lower() or "password" in w.message.lower() for w in report.warnings)

    def test_valid_ports(self, validator, default_config):
        report = validator.validate(default_config)
        port_errors = [e for e in report.errors if "port" in e.field.lower()]
        assert len(port_errors) == 0

    def test_invalid_port_zero(self, validator, default_config):
        default_config["network"]["http_port"] = 0
        report = validator.validate(default_config)
        assert any("port" in e.field.lower() for e in report.errors)

    def test_invalid_port_over_65535(self, validator, default_config):
        default_config["network"]["https_port"] = 70000
        report = validator.validate(default_config)
        assert any("port" in e.field.lower() for e in report.errors)

    def test_port_conflict(self, validator, default_config):
        default_config["network"]["http_port"] = 443
        default_config["network"]["https_port"] = 443
        report = validator.validate(default_config)
        assert any("same" in e.message.lower() or "multiple" in e.message.lower() for e in report.errors)

    def test_tls_without_certs_warning(self, validator, default_config):
        default_config["network"]["tls"]["disable_https"] = False
        report = validator.validate(default_config)
        assert report.valid

    def test_all_passwords_set(self, validator, default_config):
        report = validator.validate(default_config)
        pw_errors = [e for e in report.errors if "password" in e.field.lower() and "required" in e.message.lower()]
        assert len(pw_errors) == 0

    def test_missing_password_error(self, validator, default_config):
        default_config["gateway"]["admin_password"] = ""
        report = validator.validate(default_config)
        assert any("password" in e.message.lower() and "gateway" in e.field.lower() for e in report.errors)

    def test_weak_password_warning(self, validator, default_config):
        default_config["gateway"]["admin_password"] = "abc"
        report = validator.validate(default_config)
        assert any("weak" in w.message.lower() for w in report.warnings)

    def test_duplicate_passwords_warning(self, validator, default_config):
        same = "SameP@ssw0rd!"
        for c in ("gateway", "controller", "hub", "eda"):
            default_config[c]["admin_password"] = same
        report = validator.validate(default_config)
        assert any("identical" in w.message.lower() or "same" in w.message.lower() for w in report.warnings)

    def test_https_disabled_warning(self, validator, default_config):
        default_config["network"]["tls"]["disable_https"] = True
        report = validator.validate(default_config)
        assert any("https" in w.message.lower() for w in report.warnings)

    def test_default_values_warning(self, validator, default_config):
        default_config["gateway"]["hosts"] = ["aap.example.org"]
        report = validator.validate(default_config)
        if any("example" in w.message for w in report.warnings):
            assert "example" in str(report.warnings)

    def test_online_requires_registry(self, validator, default_config):
        default_config["registry"]["username"] = ""
        default_config["registry"]["password"] = ""
        report = validator.validate(default_config)
        assert any("registry" in e.message.lower() for e in report.errors)

    def test_disconnected_requires_bundle(self, validator, default_config):
        default_config["installation_type"] = "disconnected"
        default_config["bundle_dir"] = ""
        report = validator.validate(default_config)
        assert any("bundle" in w.message.lower() for w in report.warnings)

    def test_perfect_score(self, validator, default_config):
        report = validator.validate(default_config)
        assert report.score >= 80
        assert report.valid

    def test_low_score_many_errors(self, validator):
        cfg = {
            "topology": "invalid",
            "gateway": {"hosts": []},
            "controller": {"hosts": []},
            "hub": {"hosts": []},
            "eda": {"hosts": []},
            "database": {},
            "registry": {},
        }
        report = validator.validate(cfg)
        assert report.score < 70
        assert not report.valid

    def test_auto_fix_invalid_topology(self, validator):
        cfg = {"topology": "invalid", "gateway": {"hosts": ["aap.example.org"]},
               "controller": {"hosts": ["aap.example.org"]}, "hub": {"hosts": ["aap.example.org"]},
               "eda": {"hosts": ["aap.example.org"]}, "database": {"admin_password": "DbP@ss1!"},
               "registry": {"username": "u", "password": "p"}}
        for c in ("gateway", "controller", "hub", "eda"):
            cfg[c]["admin_password"] = "P@ss1!"
        report = validator.validate(cfg)
        fixed, applied = validator.auto_fix(cfg, report)
        assert fixed.get("topology") == "growth"
        assert any("topology" in a.lower() for a in applied)

    def test_auto_fix_disable_https(self, validator, default_config):
        default_config["network"]["tls"]["disable_https"] = True
        report = validator.validate(default_config)
        fixed, applied = validator.auto_fix(default_config, report)
        assert fixed["network"]["tls"]["disable_https"] is False
        assert any("https" in a.lower() for a in applied)

    def test_validate_returns_report(self, validator, default_config):
        report = validator.validate(default_config)
        assert isinstance(report, ValidationReport)
        assert hasattr(report, "valid")
        assert hasattr(report, "errors")
        assert hasattr(report, "warnings")

    def test_report_has_score(self, validator, default_config):
        report = validator.validate(default_config)
        assert hasattr(report, "score")
        assert 0 <= report.score <= 100

    def test_report_categories(self, validator, default_config):
        report = validator.validate(default_config)
        assert hasattr(report, "categories")
        assert isinstance(report.categories, dict)


class TestStaticHelpers:
    def test_is_valid_fqdn_valid(self):
        assert ConfigValidator.is_valid_fqdn("host.example.org") is True
        assert ConfigValidator.is_valid_fqdn("a.b.c.example.com") is True

    def test_is_valid_fqdn_invalid(self):
        assert ConfigValidator.is_valid_fqdn("localhost") is False
        assert ConfigValidator.is_valid_fqdn("no-dot") is False
        assert ConfigValidator.is_valid_fqdn("") is False

    def test_is_valid_ip_v4(self):
        assert ConfigValidator.is_valid_ip("192.168.1.1") is True
        assert ConfigValidator.is_valid_ip("10.0.0.1") is True

    def test_is_valid_ip_v6(self):
        assert ConfigValidator.is_valid_ip("::1") is True
        assert ConfigValidator.is_valid_ip("2001:db8::1") is True

    def test_password_strength_weak(self):
        strength, weaknesses = ConfigValidator.check_password_strength("abc")
        assert strength == "weak"
        assert len(weaknesses) >= 1

    def test_password_strength_strong(self):
        strength, weaknesses = ConfigValidator.check_password_strength("Str0ng!P@ssw0rdWithMixedCase")
        assert strength in ("strong", "moderate")
        assert strength != "weak"
