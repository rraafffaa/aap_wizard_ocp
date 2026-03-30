"""Extended API integration tests using FastAPI TestClient.

Tests all endpoints added to main.py including health, profiles,
audit, backups, certificates, deploy, notifications, reports, and validation.
"""

import json
import subprocess
import uuid

import pytest


def _has_openssl():
    try:
        subprocess.run(
            ["openssl", "version"],
            capture_output=True,
            timeout=2,
            check=True,
        )
        return True
    except Exception:
        return False
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock, MagicMock

from app.main import app, DEPLOY_SESSIONS, profile_service, backup_service, audit_service
from app.deployer import Deployer
from app.middleware import reset_rate_limits


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Reset rate-limit buckets before each test to avoid 429 cascades."""
    reset_rate_limits()


@pytest.fixture(autouse=True)
def use_temp_dirs_for_services(tmp_path):
    """Use temp dirs for profile, backup, and audit to avoid sandbox permission errors."""
    orig_profile = profile_service._dir
    orig_backup = backup_service._dir
    orig_audit = audit_service._log_dir
    profile_service._dir = tmp_path / "profiles"
    profile_service._dir.mkdir(parents=True, exist_ok=True)
    backup_service._dir = tmp_path / "backups"
    backup_service._dir.mkdir(parents=True, exist_ok=True)
    audit_service._log_dir = tmp_path / "audit"
    audit_service._log_dir.mkdir(parents=True, exist_ok=True)
    audit_service._log_file = audit_service._log_dir / "audit.jsonl"
    yield
    profile_service._dir = orig_profile
    backup_service._dir = orig_backup
    audit_service._log_dir = orig_audit
    audit_service._log_file = orig_audit / "audit.jsonl"


client = TestClient(app)


def get_default_config():
    return {
        "topology": "growth",
        "installation_type": "online",
        "registry": {"username": "testuser", "password": "testpass"},
        "database": {
            "type": "managed",
            "host": "",
            "port": 5432,
            "admin_username": "postgres",
            "admin_password": "SecurePass123!",
        },
        "gateway": {
            "hosts": ["aap.example.org"],
            "admin_password": "GwPass123!",
            "pg_host": "",
            "pg_database": "gateway",
            "pg_username": "gateway",
            "pg_password": "GwDbPass!1",
        },
        "controller": {
            "hosts": ["aap.example.org"],
            "admin_password": "CtrlPass123!",
            "pg_host": "",
            "pg_database": "controller",
            "pg_username": "controller",
            "pg_password": "CtrlDb!1",
            "percent_memory_capacity": 0.5,
        },
        "hub": {
            "hosts": ["aap.example.org"],
            "admin_password": "HubPass123!",
            "pg_host": "",
            "pg_database": "hub",
            "pg_username": "hub",
            "pg_password": "HubDb!1",
            "seed_collections": False,
        },
        "eda": {
            "hosts": ["aap.example.org"],
            "admin_password": "EdaPass123!",
            "pg_host": "",
            "pg_database": "eda",
            "pg_username": "eda",
            "pg_password": "EdaDb!1",
            "safe_plugins": ["ansible.eda.webhook"],
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
        "eula_accepted": True,
        "dry_run": False,
        "target_host": "aap.example.org",
        "target_user": "aap",
        "target_password": "testpass",
        "target_ssh_port": 22,
    }


class TestHealthEndpoints:
    def test_basic_health(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_platform_health(self):
        resp = client.get("/api/health/platform")
        assert resp.status_code == 200

    def test_platform_health_response_structure(self):
        resp = client.get("/api/health/platform")
        data = resp.json()
        assert "overall" in data
        assert "components" in data
        assert "database" in data
        assert "last_updated" in data
        assert "uptime_seconds" in data

    def test_platform_health_has_components(self):
        resp = client.get("/api/health/platform")
        data = resp.json()
        assert isinstance(data["components"], list)

    def test_platform_health_has_database(self):
        resp = client.get("/api/health/platform")
        data = resp.json()
        assert isinstance(data["database"], dict)


class TestProfileEndpoints:
    def test_list_profiles(self):
        resp = client.get("/api/profiles")
        assert resp.status_code == 200
        data = resp.json()
        assert "profiles" in data
        assert isinstance(data["profiles"], list)

    def test_list_includes_presets(self):
        resp = client.get("/api/profiles")
        profiles = resp.json()["profiles"]
        preset_ids = [p["id"] for p in profiles if p.get("category") == "preset"]
        assert len(preset_ids) > 0
        assert any("preset-" in pid for pid in preset_ids)

    def test_get_preset_by_id(self):
        resp = client.get("/api/profiles")
        profiles = resp.json()["profiles"]
        preset = next(p for p in profiles if p.get("category") == "preset")
        resp2 = client.get(f"/api/profiles/{preset['id']}")
        assert resp2.status_code == 200
        assert resp2.json()["id"] == preset["id"]

    def test_get_nonexistent_profile_404(self):
        resp = client.get("/api/profiles/nonexistent-profile-xyz")
        assert resp.status_code == 404

    def test_create_custom_profile(self):
        resp = client.post(
            "/api/profiles",
            json={
                "name": "Test Custom Profile",
                "description": "A test profile",
                "config": {"topology": "growth"},
                "tags": ["test"],
                "topology": "growth",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Test Custom Profile"
        assert data["category"] == "custom"
        assert "custom-" in data["id"]

    def test_create_profile_returns_id(self):
        resp = client.post(
            "/api/profiles",
            json={
                "name": "Profile With ID",
                "config": {"topology": "growth"},
            },
        )
        data = resp.json()
        assert "id" in data
        assert len(data["id"]) > 0

    def test_update_custom_profile(self):
        create_resp = client.post(
            "/api/profiles",
            json={"name": "To Update", "config": {"topology": "growth"}},
        )
        profile_id = create_resp.json()["id"]
        resp = client.put(
            f"/api/profiles/{profile_id}",
            json={"name": "Updated Name", "description": "Updated desc"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Updated Name"

    def test_delete_custom_profile(self):
        create_resp = client.post(
            "/api/profiles",
            json={"name": "To Delete", "config": {"topology": "growth"}},
        )
        profile_id = create_resp.json()["id"]
        resp = client.delete(f"/api/profiles/{profile_id}")
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

    def test_cannot_delete_preset(self):
        resp = client.get("/api/profiles")
        preset = next(p for p in resp.json()["profiles"] if p.get("category") == "preset")
        resp2 = client.delete(f"/api/profiles/{preset['id']}")
        assert resp2.status_code == 404

    def test_export_yaml(self):
        resp = client.get("/api/profiles")
        preset = next(p for p in resp.json()["profiles"] if p.get("category") == "preset")
        resp2 = client.get(f"/api/profiles/{preset['id']}/yaml")
        assert resp2.status_code == 200
        assert "yaml" in resp2.json()
        assert "name" in resp2.json()["yaml"].lower() or "topology" in resp2.json()["yaml"].lower()

    def test_import_yaml(self):
        yaml_content = """
name: Imported Profile
description: Imported via YAML
topology: growth
tags: [imported]
config:
  topology: growth
  installation_type: online
"""
        resp = client.post("/api/profiles/import", json={"yaml": yaml_content})
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Imported Profile"
        assert data["topology"] == "growth"

    def test_profile_round_trip(self):
        create_resp = client.post(
            "/api/profiles",
            json={"name": "Round Trip", "config": {"topology": "growth", "redis_mode": "standalone"}},
        )
        profile_id = create_resp.json()["id"]
        export_resp = client.get(f"/api/profiles/{profile_id}/yaml")
        yaml_content = export_resp.json()["yaml"]
        client.delete(f"/api/profiles/{profile_id}")
        import_resp = client.post("/api/profiles/import", json={"yaml": yaml_content})
        assert import_resp.status_code == 200
        assert import_resp.json()["name"] == "Round Trip"


class TestAuditEndpoints:
    def test_get_audit_log(self):
        resp = client.get("/api/audit")
        assert resp.status_code == 200
        data = resp.json()
        assert "entries" in data
        assert "count" in data

    def test_audit_log_structure(self):
        resp = client.get("/api/audit")
        entries = resp.json()["entries"]
        for entry in entries[:3]:
            assert "id" in entry
            assert "timestamp" in entry
            assert "action" in entry
            assert "category" in entry

    def test_audit_log_with_limit(self):
        resp = client.get("/api/audit?limit=5")
        data = resp.json()
        assert len(data["entries"]) <= 5

    def test_audit_log_with_category(self):
        resp = client.get("/api/audit?category=config")
        data = resp.json()
        for entry in data["entries"]:
            assert entry["category"] == "config"

    def test_audit_stats(self):
        resp = client.get("/api/audit/stats")
        assert resp.status_code == 200
        data = resp.json()
        assert "total_entries" in data
        assert "by_category" in data
        assert "by_action" in data

    def test_audit_stats_structure(self):
        resp = client.get("/api/audit/stats")
        data = resp.json()
        assert isinstance(data["by_category"], dict)
        assert isinstance(data["by_action"], dict)

    def test_audit_export(self):
        for fmt in ("json", "csv", "text"):
            resp = client.get(f"/api/audit/export?format={fmt}")
            assert resp.status_code == 200
            data = resp.json()
            assert data["format"] == fmt
            assert "content" in data
            assert len(data["content"]) >= 0


class TestBackupEndpoints:
    def test_list_backups(self):
        resp = client.get("/api/backups")
        assert resp.status_code == 200
        data = resp.json()
        assert "backups" in data
        assert "stats" in data
        assert "total_backups" in data["stats"]

    def test_create_backup(self):
        config = get_default_config()
        resp = client.post(
            "/api/backups",
            json={
                "name": "Test Backup",
                "config": config,
                "inventory": "[automationgateway]\naap.example.org\n",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert data["name"] == "Test Backup"

    def test_create_backup_returns_manifest(self):
        config = get_default_config()
        resp = client.post(
            "/api/backups",
            json={"name": "Manifest Backup", "config": config},
        )
        data = resp.json()
        assert "timestamp" in data
        assert "contents" in data
        assert "version" in data

    def test_get_backup(self):
        config = get_default_config()
        create_resp = client.post(
            "/api/backups",
            json={"name": "Get Test", "config": config, "inventory": "test"},
        )
        backup_id = create_resp.json()["id"]
        resp = client.get(f"/api/backups/{backup_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "manifest" in data or "config" in data

    def test_delete_backup(self):
        config = get_default_config()
        create_resp = client.post(
            "/api/backups",
            json={"name": "Delete Test", "config": config},
        )
        backup_id = create_resp.json()["id"]
        resp = client.delete(f"/api/backups/{backup_id}")
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True

    def test_restore_backup(self):
        config = get_default_config()
        create_resp = client.post(
            "/api/backups",
            json={"name": "Restore Test", "config": config, "inventory": "inv"},
        )
        backup_id = create_resp.json()["id"]
        resp = client.post(f"/api/backups/{backup_id}/restore")
        assert resp.status_code == 200
        data = resp.json()
        assert "backup_id" in data
        assert "contents" in data
        client.delete(f"/api/backups/{backup_id}")

    def test_backup_round_trip(self):
        config = get_default_config()
        create_resp = client.post(
            "/api/backups",
            json={"name": "Round Trip", "config": config, "inventory": "inv"},
        )
        backup_id = create_resp.json()["id"]
        restore_resp = client.post(f"/api/backups/{backup_id}/restore")
        assert restore_resp.status_code == 200
        assert "config" in restore_resp.json() or "contents" in restore_resp.json()
        client.delete(f"/api/backups/{backup_id}")


class TestCertificateEndpoints:
    @pytest.mark.skipif(not _has_openssl(), reason="openssl not available")
    def test_generate_certificate(self):
        resp = client.post(
            "/api/certificates/generate",
            json={"hostnames": ["aap.example.org"], "days": 365},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "ca_cert" in data
        assert "server_cert" in data
        assert "server_key" in data

    @pytest.mark.skipif(not _has_openssl(), reason="openssl not available")
    def test_generate_certificate_returns_pem(self):
        resp = client.post(
            "/api/certificates/generate",
            json={"hostnames": ["localhost"]},
        )
        data = resp.json()
        assert "-----BEGIN CERTIFICATE-----" in data["server_cert"]
        assert "-----BEGIN PRIVATE KEY-----" in data["server_key"]

    def test_validate_certificate(self):
        pem = """-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDU+pQ4pHgSpDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7
-----END CERTIFICATE-----"""
        resp = client.post(
            "/api/certificates/validate",
            json={"cert_pem": pem},
        )
        assert resp.status_code in (200, 400)

    def test_certificate_info(self):
        pem = """-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDU+pQ4pHgSpDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7
-----END CERTIFICATE-----"""
        resp = client.post("/api/certificates/info", json={"cert_pem": pem})
        assert resp.status_code in (200, 400)


class TestDeployExtendedEndpoints:
    def test_deploy_start_returns_session(self):
        config = get_default_config()
        with patch.object(Deployer, "run", new_callable=AsyncMock):
            with patch("app.main.notification_service") as mock_ns:
                mock_ns.notify_deploy_start = AsyncMock()
                resp = client.post("/api/deploy/start", json=config)
        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data
        assert len(data["session_id"]) > 0
        DEPLOY_SESSIONS.pop(data["session_id"], None)

    def test_deploy_status_unknown_404(self):
        resp = client.get(f"/api/deploy/{uuid.uuid4()}/status")
        assert resp.status_code == 404

    def test_deploy_snapshots(self):
        session_id = str(uuid.uuid4())
        resp = client.get(f"/api/deploy/{session_id}/snapshots")
        assert resp.status_code == 200
        data = resp.json()
        assert "snapshots" in data
        assert isinstance(data["snapshots"], list)


class TestNotificationEndpoints:
    def test_get_notification_config(self):
        resp = client.get("/api/notifications/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "webhook_url" in data
        assert "enabled" in data
        assert "events" in data

    def test_update_notification_config(self):
        resp = client.post(
            "/api/notifications/config",
            json={
                "webhook_url": "https://hooks.example.com/test",
                "enabled": True,
                "events": ["deploy_complete", "deploy_fail"],
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "updated"

    def test_test_notification(self):
        resp = client.post("/api/notifications/test")
        assert resp.status_code == 200
        data = resp.json()
        assert "delivered" in data
        assert "notification_id" in data

    def test_notification_history(self):
        resp = client.get("/api/notifications/history")
        assert resp.status_code == 200
        data = resp.json()
        assert "notifications" in data
        assert isinstance(data["notifications"], list)


class TestReportEndpoints:
    def test_generate_config_report(self):
        config = get_default_config()
        resp = client.post(
            "/api/reports/generate",
            json={"type": "config", "config": config},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "report" in data
        assert len(data["report"]) > 0

    def test_generate_pre_deploy_report(self):
        config = get_default_config()
        resp = client.post(
            "/api/reports/generate",
            json={"type": "pre-deploy", "config": config},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "report" in data

    def test_report_contains_content(self):
        config = get_default_config()
        resp = client.post(
            "/api/reports/generate",
            json={"type": "config", "config": config},
        )
        report = resp.json()["report"]
        assert "Configuration" in report or "Topology" in report or "topology" in report


class TestValidationEndpoint:
    def test_validate_valid_config(self):
        config = get_default_config()
        resp = client.post("/api/config/validate", json={"config": config})
        assert resp.status_code == 200
        data = resp.json()
        assert "valid" in data
        assert "errors" in data
        assert "warnings" in data

    def test_validate_returns_score(self):
        config = get_default_config()
        resp = client.post("/api/config/validate", json={"config": config})
        data = resp.json()
        assert "score" in data
        assert isinstance(data["score"], (int, float))
        assert 0 <= data["score"] <= 100

    def test_validate_invalid_config_has_errors(self):
        bad_config = {
            "topology": "invalid",
            "gateway": {"hosts": []},
            "controller": {"hosts": []},
            "database": {"admin_password": ""},
        }
        resp = client.post("/api/config/validate", json={"config": bad_config})
        data = resp.json()
        assert data["valid"] is False
        assert len(data["errors"]) > 0

    def test_validate_response_structure(self):
        config = get_default_config()
        resp = client.post("/api/config/validate", json={"config": config})
        data = resp.json()
        assert "valid" in data
        assert "errors" in data
        assert "warnings" in data
        assert "score" in data
        for err in data["errors"][:3]:
            assert "field" in err
            assert "message" in err
            assert "severity" in err
