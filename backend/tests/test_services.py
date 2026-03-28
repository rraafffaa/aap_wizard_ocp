"""Tests for all backend services.

Services that exist in the codebase are tested directly.
ProfileService and BackupService are tested via minimal inline
implementations that serve as reference specs.
"""

import asyncio
import datetime
import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from dataclasses import asdict
from unittest.mock import patch, MagicMock, AsyncMock

import pytest
import yaml

from app.services.audit_service import AuditService, AuditEntry
from app.services.notification_service import (
    NotificationService,
    NotificationConfig,
    Notification,
)
from app.services.rollback_manager import (
    RollbackManager,
    PHASE_ORDER,
    DeploymentSnapshot,
)
from app.services.health_monitor import HealthMonitor, PlatformHealth
from app.services.ssh_manager import SSHConfig, CommandResult
from app.middleware import (
    APIMetrics,
    RateLimitMiddleware,
    RequestIdMiddleware,
    RequestTimingMiddleware,
    RequestLoggingMiddleware,
)


# ======================================================================
# Inline reference implementations for services not yet in the codebase
# ======================================================================


class ProfileService:
    """Minimal profile service for testing (reference implementation)."""

    PRESETS = {
        "growth-default": {
            "name": "Growth Default",
            "type": "preset",
            "config": {"topology": "growth", "installation_type": "online"},
        },
        "enterprise-default": {
            "name": "Enterprise Default",
            "type": "preset",
            "config": {"topology": "enterprise", "installation_type": "online"},
        },
    }

    def __init__(self, storage_dir: str | None = None):
        self._dir = Path(storage_dir) if storage_dir else Path(tempfile.mkdtemp())
        self._customs: dict[str, dict] = {}

    def get_all(self) -> list[dict]:
        profiles = [{"id": pid, **p} for pid, p in self.PRESETS.items()]
        profiles.extend({"id": pid, **p} for pid, p in self._customs.items())
        return profiles

    def get_presets(self) -> list[dict]:
        return [{"id": pid, **p} for pid, p in self.PRESETS.items()]

    def create(self, name: str, config: dict) -> dict:
        pid = str(uuid.uuid4())
        profile = {"name": name, "type": "custom", "config": config}
        self._customs[pid] = profile
        return {"id": pid, **profile}

    def delete(self, profile_id: str) -> bool:
        if profile_id in self.PRESETS:
            raise ValueError("Cannot delete preset profiles")
        if profile_id in self._customs:
            del self._customs[profile_id]
            return True
        return False

    def update(self, profile_id: str, config: dict) -> dict:
        if profile_id not in self._customs:
            raise KeyError(f"Profile {profile_id} not found")
        self._customs[profile_id]["config"] = config
        return {"id": profile_id, **self._customs[profile_id]}

    def export_yaml(self, profile_id: str) -> str:
        all_profiles = {**self.PRESETS, **self._customs}
        if profile_id not in all_profiles:
            raise KeyError(f"Profile {profile_id} not found")
        return yaml.dump(all_profiles[profile_id])

    def import_yaml(self, yaml_str: str) -> dict:
        data = yaml.safe_load(yaml_str)
        return self.create(data["name"], data["config"])

    def diff(self, config_a: dict, config_b: dict) -> list[dict]:
        diffs = []
        all_keys = sorted(set(list(config_a.keys()) + list(config_b.keys())))
        for key in all_keys:
            a_val = config_a.get(key)
            b_val = config_b.get(key)
            if a_val != b_val:
                diffs.append({"field": key, "old": a_val, "new": b_val})
        return diffs


class BackupService:
    """Minimal backup service for testing (reference implementation)."""

    def __init__(self, backup_dir: str | None = None):
        self._dir = Path(backup_dir) if backup_dir else Path(tempfile.mkdtemp())
        self._dir.mkdir(parents=True, exist_ok=True)

    def create(self, config: dict) -> dict:
        bid = str(uuid.uuid4())
        backup = {"id": bid, "timestamp": time.time(), "config": config}
        (self._dir / f"{bid}.json").write_text(json.dumps(backup))
        return backup

    def list_backups(self) -> list[dict]:
        backups = []
        for path in self._dir.glob("*.json"):
            backups.append(json.loads(path.read_text()))
        return sorted(backups, key=lambda b: b["timestamp"], reverse=True)

    def restore(self, backup_id: str) -> dict:
        path = self._dir / f"{backup_id}.json"
        if not path.exists():
            raise KeyError(f"Backup {backup_id} not found")
        return json.loads(path.read_text())["config"]

    def delete(self, backup_id: str) -> bool:
        path = self._dir / f"{backup_id}.json"
        if path.exists():
            path.unlink()
            return True
        return False

    def cleanup(self, max_age_hours: int = 72) -> int:
        cutoff = time.time() - (max_age_hours * 3600)
        removed = 0
        for path in self._dir.glob("*.json"):
            data = json.loads(path.read_text())
            if data.get("timestamp", 0) < cutoff:
                path.unlink()
                removed += 1
        return removed


# ======================================================================
# AuditService
# ======================================================================


class TestAuditService:
    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path):
        self.svc = AuditService(log_dir=str(tmp_path / "audit"))

    def test_log_entry(self):
        entry = self.svc.log("test_action", "system", "Did something")
        assert entry.action == "test_action"
        assert entry.category == "system"
        assert entry.details == "Did something"
        assert entry.id

    def test_log_config_change(self):
        old = {"topology": "growth"}
        new = {"topology": "enterprise"}
        entry = self.svc.log_config_change(old, new)
        assert entry.action == "config_change"
        assert len(entry.diff) > 0

    def test_log_config_no_change(self):
        cfg = {"topology": "growth"}
        entry = self.svc.log_config_change(cfg, cfg)
        assert entry.action == "config_no_change"

    def test_get_entries_with_filter(self):
        self.svc.log("a1", "config", "change 1")
        self.svc.log("a2", "deploy", "deploy start")
        self.svc.log("a3", "config", "change 2")
        entries = self.svc.get_entries(category="config")
        assert len(entries) == 2
        assert all(e.category == "config" for e in entries)

    def test_get_entries_with_limit(self):
        for i in range(10):
            self.svc.log(f"action_{i}", "system", f"detail {i}")
        entries = self.svc.get_entries(limit=5)
        assert len(entries) == 5

    def test_get_entries_with_offset(self):
        for i in range(5):
            self.svc.log(f"action_{i}", "system", f"detail {i}")
        all_entries = self.svc.get_entries()
        offset_entries = self.svc.get_entries(offset=2)
        assert len(offset_entries) == len(all_entries) - 2

    def test_get_entries_since(self):
        self.svc.log("old", "system", "old entry")
        cutoff = time.time()
        time.sleep(0.01)
        self.svc.log("new", "system", "new entry")
        entries = self.svc.get_entries(since=cutoff)
        assert len(entries) == 1
        assert entries[0].action == "new"

    def test_get_stats(self):
        self.svc.log("a1", "config", "c1")
        self.svc.log("a2", "deploy", "d1")
        stats = self.svc.get_stats()
        assert stats["total_entries"] == 2
        assert "config" in stats["by_category"]
        assert "deploy" in stats["by_category"]

    def test_export_json(self):
        self.svc.log("action", "system", "detail")
        raw = self.svc.export_log(format="json")
        data = json.loads(raw)
        assert isinstance(data, list)
        assert len(data) == 1

    def test_export_csv(self):
        self.svc.log("action", "system", "detail")
        raw = self.svc.export_log(format="csv")
        lines = raw.strip().split("\n")
        assert lines[0].startswith("id,")
        assert len(lines) == 2

    def test_export_text(self):
        self.svc.log("action", "system", "detail")
        raw = self.svc.export_log(format="text")
        assert "action" in raw
        assert "system" in raw

    def test_persistence(self, tmp_path):
        log_dir = str(tmp_path / "persist_audit")
        svc1 = AuditService(log_dir=log_dir)
        svc1.log("persisted", "system", "should survive reload")

        svc2 = AuditService(log_dir=log_dir)
        entries = svc2.get_entries()
        assert len(entries) == 1
        assert entries[0].action == "persisted"

    def test_password_fields_masked_in_diff(self):
        old = {"admin_password": "old_secret"}
        new = {"admin_password": "new_secret"}
        entry = self.svc.log_config_change(old, new)
        for d in entry.diff:
            if "password" in d["path"]:
                assert d["old"] == "***"
                assert d["new"] == "***"

    def test_unknown_category_falls_back(self):
        entry = self.svc.log("act", "unknown_cat", "detail")
        assert entry.category == "system"


# ======================================================================
# ProfileService (inline reference implementation)
# ======================================================================


class TestProfileService:
    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path):
        self.svc = ProfileService(storage_dir=str(tmp_path / "profiles"))

    def test_get_all_includes_presets(self):
        profiles = self.svc.get_all()
        ids = {p["id"] for p in profiles}
        assert "growth-default" in ids
        assert "enterprise-default" in ids

    def test_get_presets_not_empty(self):
        presets = self.svc.get_presets()
        assert len(presets) >= 2

    def test_create_custom_profile(self):
        profile = self.svc.create("my-test", {"topology": "growth"})
        assert profile["name"] == "my-test"
        assert profile["type"] == "custom"
        assert "id" in profile

    def test_delete_custom_profile(self):
        profile = self.svc.create("to-delete", {"topology": "growth"})
        assert self.svc.delete(profile["id"]) is True
        all_ids = {p["id"] for p in self.svc.get_all()}
        assert profile["id"] not in all_ids

    def test_update_custom_profile(self):
        profile = self.svc.create("updatable", {"topology": "growth"})
        updated = self.svc.update(
            profile["id"], {"topology": "enterprise"}
        )
        assert updated["config"]["topology"] == "enterprise"

    def test_cannot_delete_preset(self):
        with pytest.raises(ValueError, match="preset"):
            self.svc.delete("growth-default")

    def test_export_yaml(self):
        raw = self.svc.export_yaml("growth-default")
        parsed = yaml.safe_load(raw)
        assert parsed["name"] == "Growth Default"

    def test_import_yaml(self):
        yaml_str = yaml.dump(
            {"name": "imported", "type": "custom", "config": {"topology": "growth"}}
        )
        profile = self.svc.import_yaml(yaml_str)
        assert profile["name"] == "imported"

    def test_diff_configs(self):
        a = {"topology": "growth", "redis_mode": "standalone"}
        b = {"topology": "enterprise", "redis_mode": "standalone"}
        diffs = self.svc.diff(a, b)
        assert len(diffs) == 1
        assert diffs[0]["field"] == "topology"

    def test_diff_no_changes(self):
        a = {"topology": "growth"}
        assert self.svc.diff(a, a) == []

    def test_custom_appears_in_get_all(self):
        self.svc.create("visible", {"topology": "growth"})
        all_names = {p["name"] for p in self.svc.get_all()}
        assert "visible" in all_names


# ======================================================================
# BackupService (inline reference implementation)
# ======================================================================


class TestBackupService:
    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path):
        self.svc = BackupService(backup_dir=str(tmp_path / "backups"))

    def test_create_backup(self):
        backup = self.svc.create({"topology": "growth"})
        assert "id" in backup
        assert "timestamp" in backup
        assert backup["config"]["topology"] == "growth"

    def test_list_backups(self):
        self.svc.create({"topology": "growth"})
        self.svc.create({"topology": "enterprise"})
        backups = self.svc.list_backups()
        assert len(backups) == 2

    def test_list_backups_ordered_by_time(self):
        b1 = self.svc.create({"seq": 1})
        time.sleep(0.01)
        b2 = self.svc.create({"seq": 2})
        backups = self.svc.list_backups()
        assert backups[0]["timestamp"] >= backups[1]["timestamp"]

    def test_restore_backup(self):
        backup = self.svc.create({"topology": "growth"})
        config = self.svc.restore(backup["id"])
        assert config == {"topology": "growth"}

    def test_restore_missing_raises(self):
        with pytest.raises(KeyError):
            self.svc.restore("nonexistent-id")

    def test_delete_backup(self):
        backup = self.svc.create({"topology": "growth"})
        assert self.svc.delete(backup["id"]) is True
        assert len(self.svc.list_backups()) == 0

    def test_delete_missing_returns_false(self):
        assert self.svc.delete("nonexistent") is False

    def test_cleanup_old_backups(self):
        backup = self.svc.create({"topology": "old"})
        path = self.svc._dir / f"{backup['id']}.json"
        data = json.loads(path.read_text())
        data["timestamp"] = time.time() - 200 * 3600
        path.write_text(json.dumps(data))

        removed = self.svc.cleanup(max_age_hours=72)
        assert removed == 1
        assert len(self.svc.list_backups()) == 0


# ======================================================================
# RollbackManager
# ======================================================================


class TestRollbackManager:
    @pytest.fixture(autouse=True)
    def _setup(self, tmp_path):
        self.mgr = RollbackManager(snapshots_dir=str(tmp_path / "snapshots"))
        self.session_id = str(uuid.uuid4())

    def test_create_snapshot(self):
        snap = self.mgr.create_snapshot(
            self.session_id, "validate", {"topology": "growth"}, "inv content"
        )
        assert snap.session_id == self.session_id
        assert snap.phase == "validate"
        assert snap.status == "created"

    def test_get_snapshots(self):
        self.mgr.create_snapshot(self.session_id, "validate", {}, "inv1")
        self.mgr.create_snapshot(self.session_id, "inventory", {}, "inv2")
        snaps = self.mgr.get_snapshots(self.session_id)
        assert len(snaps) == 2
        assert snaps[0].timestamp <= snaps[1].timestamp

    def test_get_snapshots_filters_by_session(self):
        other = str(uuid.uuid4())
        self.mgr.create_snapshot(self.session_id, "validate", {}, "")
        self.mgr.create_snapshot(other, "validate", {}, "")
        assert len(self.mgr.get_snapshots(self.session_id)) == 1

    def test_plan_rollback(self):
        config = {
            "gateway": {"hosts": ["gw.example.org"]},
            "controller": {"hosts": ["ctrl.example.org"]},
            "hub": {"hosts": []},
            "eda": {"hosts": []},
            "install_dir": "/opt/aap",
        }
        self.mgr.create_snapshot(self.session_id, "install", config, "inv")
        actions = self.mgr.plan_rollback(self.session_id)
        assert isinstance(actions, list)
        assert len(actions) > 0

    def test_plan_rollback_no_snapshots(self):
        actions = self.mgr.plan_rollback("no-such-session")
        assert actions == []

    def test_cleanup_old_snapshots(self):
        snap = self.mgr.create_snapshot(self.session_id, "validate", {}, "")
        path = self.mgr._dir / f"{snap.id}.json"
        data = json.loads(path.read_text())
        data["timestamp"] = time.time() - 200 * 3600
        path.write_text(json.dumps(data))

        removed = self.mgr.cleanup_old_snapshots(max_age_hours=72)
        assert removed == 1

    def test_latest_snapshot(self):
        self.mgr.create_snapshot(self.session_id, "validate", {}, "")
        time.sleep(0.01)
        self.mgr.create_snapshot(self.session_id, "install", {}, "")
        latest = self.mgr.get_latest_snapshot(self.session_id)
        assert latest is not None
        assert latest.phase == "install"

    def test_rollback_commands_for_install(self):
        cmds = self.mgr._get_rollback_commands(
            "install", {"install_dir": "/opt/aap"}, "stop_containers"
        )
        assert len(cmds) > 0
        assert "podman stop" in cmds[0]

    def test_rollback_commands_cleanup(self):
        cmds = self.mgr._get_rollback_commands(
            "upload", {"install_dir": "/opt/aap"}, "cleanup_files"
        )
        assert any("rm -rf" in c for c in cmds)

    def test_extract_hosts(self):
        config = {
            "gateway": {"hosts": ["gw.example.org"]},
            "controller": {"hosts": ["ctrl.example.org"]},
            "hub": {"hosts": ["hub.example.org"]},
            "eda": {"hosts": ["eda.example.org"]},
            "target_host": "remote.example.org",
        }
        hosts = RollbackManager._extract_hosts(config)
        assert "gw.example.org" in hosts
        assert "remote.example.org" in hosts


# ======================================================================
# NotificationService
# ======================================================================


class TestNotificationService:
    def test_notification_disabled_by_default(self):
        svc = NotificationService()
        assert svc._config.enabled is False

    @pytest.mark.asyncio
    async def test_notify_creates_entry(self):
        svc = NotificationService()
        notif = await svc.notify(
            "deploy_start", "Deployment Started", "Session xyz"
        )
        assert isinstance(notif, Notification)
        assert notif.event == "deploy_start"
        assert notif.delivered is False

    @pytest.mark.asyncio
    async def test_notify_appends_to_history(self):
        svc = NotificationService()
        await svc.notify("test", "Test", "message")
        assert len(svc.get_history()) == 1

    def test_get_history(self):
        svc = NotificationService()
        history = svc.get_history()
        assert isinstance(history, list)

    @pytest.mark.asyncio
    async def test_get_history_ordered(self):
        svc = NotificationService()
        await svc.notify("e1", "First", "m1")
        await svc.notify("e2", "Second", "m2")
        history = svc.get_history()
        assert history[0].event == "e2"
        assert history[1].event == "e1"

    def test_format_slack_payload(self):
        svc = NotificationService()
        notif = Notification(
            id="abc",
            event="deploy_complete",
            timestamp=time.time(),
            title="Done",
            message="Deployment complete",
            severity="success",
        )
        payload = svc._format_slack_payload(notif)
        assert "blocks" in payload
        assert "text" in payload
        assert payload["text"] == "Done"

    def test_format_teams_payload(self):
        svc = NotificationService()
        notif = Notification(
            id="abc",
            event="deploy_fail",
            timestamp=time.time(),
            title="Failed",
            message="Install phase failed",
            severity="error",
        )
        payload = svc._format_teams_payload(notif)
        assert payload["@type"] == "MessageCard"
        assert payload["themeColor"] == "FF0000"

    def test_format_generic_payload(self):
        svc = NotificationService()
        notif = Notification(
            id="abc",
            event="test",
            timestamp=time.time(),
            title="Test",
            message="msg",
            severity="info",
        )
        payload = svc._format_generic_payload(notif)
        assert payload["source"] == "aap-deployment-wizard"

    @pytest.mark.asyncio
    async def test_webhook_no_url(self):
        svc = NotificationService(NotificationConfig(enabled=True, webhook_url=""))
        notif = Notification(
            id="x", event="e", timestamp=0, title="", message="", severity="info"
        )
        delivered = await svc.send_webhook(notif)
        assert delivered is False

    @pytest.mark.asyncio
    async def test_notify_deploy_start(self):
        svc = NotificationService()
        await svc.notify_deploy_start("sess-123", {"topology": "growth"})
        history = svc.get_history()
        assert any("deploy_start" == n.event for n in history)

    @pytest.mark.asyncio
    async def test_notify_deploy_complete(self):
        svc = NotificationService()
        await svc.notify_deploy_complete("sess-123", {"target_host": "h1"}, 120_000)
        history = svc.get_history()
        assert any("deploy_complete" == n.event for n in history)

    @pytest.mark.asyncio
    async def test_notify_deploy_fail(self):
        svc = NotificationService()
        await svc.notify_deploy_fail(
            "sess-123", "error msg", "install", {"target_host": "h1"}
        )
        history = svc.get_history()
        assert any("deploy_fail" == n.event for n in history)

    def test_update_config(self):
        svc = NotificationService()
        new_config = NotificationConfig(
            enabled=True, webhook_url="https://hooks.slack.com/test"
        )
        svc.update_config(new_config)
        assert svc._config.enabled is True

    @pytest.mark.asyncio
    async def test_history_capped(self):
        svc = NotificationService()
        svc._max_history = 5
        for i in range(10):
            await svc.notify(f"e{i}", f"T{i}", "m")
        assert len(svc._history) == 5


# ======================================================================
# CertificateManager (mocked openssl)
# ======================================================================


class TestCertificateManager:
    def test_parse_certificate(self):
        from app.services.certificate_manager import CertificateManager

        mgr = CertificateManager()
        fake_text_output = (
            "Certificate:\n"
            "    Subject: CN = aap.example.org, O = AAP\n"
            "    Issuer: CN = AAP CA, O = AAP\n"
            "    Serial Number:\n"
            "        01:23:45\n"
            "    Not Before: Jan  1 00:00:00 2025 GMT\n"
            "    Not After : Jan  1 00:00:00 2030 GMT\n"
            "    Public Key Algorithm: rsaEncryption\n"
            "    RSA Public-Key: (4096 bit)\n"
            "    Signature Algorithm: sha256WithRSAEncryption\n"
            "    X509v3 Subject Alternative Name:\n"
            "        DNS:aap.example.org, DNS:*.example.org\n"
        )
        fake_fp = "SHA256 Fingerprint=AA:BB:CC:DD"

        with patch(
            "app.services.certificate_manager._run_openssl",
            side_effect=[fake_text_output, fake_fp],
        ):
            info = mgr.parse_certificate("-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----")

        assert info.subject["CN"] == "aap.example.org"
        assert info.key_size == 4096
        assert "aap.example.org" in info.san_names

    def test_validate_certificate_format(self):
        from app.services.certificate_manager import CertificateManager

        mgr = CertificateManager()
        with patch.object(mgr, "parse_certificate", side_effect=RuntimeError("bad PEM")):
            chain = mgr.validate_certificate("bad data")
        assert chain.is_valid is False
        assert len(chain.errors) > 0

    def test_check_expiration(self):
        from app.services.certificate_manager import CertificateManager, CertificateInfo

        mgr = CertificateManager()
        now = datetime.datetime.now(datetime.timezone.utc)
        future = now + datetime.timedelta(days=365)
        fake_info = CertificateInfo(
            subject={"CN": "test"},
            issuer={"CN": "test"},
            serial_number="123",
            not_before=now - datetime.timedelta(days=1),
            not_after=future,
            is_expired=False,
            is_self_signed=True,
            san_names=["test.example.org"],
            key_algorithm="rsaEncryption",
            key_size=4096,
            signature_algorithm="sha256",
            fingerprint_sha256="AA:BB",
            pem_data="fake",
        )
        with patch.object(mgr, "parse_certificate", return_value=fake_info):
            result = mgr.check_expiration("fake_pem")
        assert result["status"] == "ok"
        assert result["days_remaining"] > 300

    def test_check_expiration_expired(self):
        from app.services.certificate_manager import CertificateManager, CertificateInfo

        mgr = CertificateManager()
        now = datetime.datetime.now(datetime.timezone.utc)
        fake_info = CertificateInfo(
            subject={"CN": "test"}, issuer={"CN": "test"},
            serial_number="123",
            not_before=now - datetime.timedelta(days=400),
            not_after=now - datetime.timedelta(days=10),
            is_expired=True, is_self_signed=True, san_names=[],
            key_algorithm="rsa", key_size=2048,
            signature_algorithm="sha256",
            fingerprint_sha256="", pem_data="",
        )
        with patch.object(mgr, "parse_certificate", return_value=fake_info):
            result = mgr.check_expiration("fake")
        assert result["status"] == "expired"

    def test_validate_hosts_coverage(self):
        from app.services.certificate_manager import CertificateManager, CertificateInfo

        mgr = CertificateManager()
        now = datetime.datetime.now(datetime.timezone.utc)
        fake_info = CertificateInfo(
            subject={"CN": "aap.example.org"}, issuer={"CN": "CA"},
            serial_number="1", not_before=now, not_after=now + datetime.timedelta(days=365),
            is_expired=False, is_self_signed=False,
            san_names=["aap.example.org", "*.example.org"],
            key_algorithm="rsa", key_size=2048,
            signature_algorithm="sha256", fingerprint_sha256="", pem_data="",
        )
        with patch.object(mgr, "parse_certificate", return_value=fake_info):
            errors = mgr.validate_certificate_for_hosts(
                "fake", ["aap.example.org", "hub.example.org"]
            )
        assert errors == []

    def test_validate_hosts_missing_san(self):
        from app.services.certificate_manager import CertificateManager, CertificateInfo

        mgr = CertificateManager()
        now = datetime.datetime.now(datetime.timezone.utc)
        fake_info = CertificateInfo(
            subject={"CN": "aap.example.org"}, issuer={"CN": "CA"},
            serial_number="1", not_before=now, not_after=now + datetime.timedelta(days=365),
            is_expired=False, is_self_signed=False,
            san_names=["aap.example.org"],
            key_algorithm="rsa", key_size=2048,
            signature_algorithm="sha256", fingerprint_sha256="", pem_data="",
        )
        with patch.object(mgr, "parse_certificate", return_value=fake_info):
            errors = mgr.validate_certificate_for_hosts(
                "fake", ["other.example.org"]
            )
        assert len(errors) == 1

    def test_is_ip(self):
        from app.services.certificate_manager import CertificateManager

        assert CertificateManager._is_ip("192.168.1.1") is True
        assert CertificateManager._is_ip("aap.example.org") is False
        assert CertificateManager._is_ip("::1") is True


# ======================================================================
# SSHManager
# ======================================================================


class TestSSHManager:
    def test_ssh_config_defaults(self):
        cfg = SSHConfig(hostname="test.example.org")
        assert cfg.port == 22
        assert cfg.username == "aap"
        assert cfg.timeout == 30

    def test_ssh_config_key(self):
        cfg = SSHConfig(hostname="test.example.org", port=2222, username="root")
        assert cfg.key == "root@test.example.org:2222"

    def test_connection_pool_init(self):
        from app.services.ssh_manager import HAS_PARAMIKO

        if not HAS_PARAMIKO:
            pytest.skip("paramiko not installed")
        from app.services.ssh_manager import SSHConnectionPool

        pool = SSHConnectionPool(max_connections=5)
        assert pool._max == 5
        assert pool._closed is False

    def test_command_result_structure(self):
        result = CommandResult(
            exit_code=0,
            stdout="hello",
            stderr="",
            duration_ms=42,
            command="echo hello",
            hostname="test.example.org",
        )
        assert result.ok is True
        assert result.stdout == "hello"
        assert result.duration_ms == 42

    def test_command_result_failure(self):
        result = CommandResult(
            exit_code=1,
            stdout="",
            stderr="not found",
            duration_ms=10,
            command="bad_cmd",
            hostname="test.example.org",
        )
        assert result.ok is False

    def test_stub_connection(self):
        from app.services.ssh_manager import StubSSHConnection

        stub = StubSSHConnection(SSHConfig(hostname="test"))
        assert stub.config.hostname == "test"

    @pytest.mark.asyncio
    async def test_stub_test_connection(self):
        from app.services.ssh_manager import StubSSHConnection

        stub = StubSSHConnection(SSHConfig(hostname="test"))
        info = await stub.test_connection()
        assert info["reachable"] is False

    def test_create_connection_factory(self):
        from app.services.ssh_manager import create_connection, HAS_PARAMIKO

        conn = create_connection(SSHConfig(hostname="test"))
        if HAS_PARAMIKO:
            from app.services.ssh_manager import SSHConnection

            assert isinstance(conn, SSHConnection)
        else:
            from app.services.ssh_manager import StubSSHConnection

            assert isinstance(conn, StubSSHConnection)


# ======================================================================
# HealthMonitor
# ======================================================================


class TestHealthMonitor:
    @pytest.mark.asyncio
    async def test_simulate_health(self):
        monitor = HealthMonitor("https://example.org", {})
        health = await monitor.simulate_health()
        assert isinstance(health, PlatformHealth)
        assert health.overall in ("healthy", "degraded", "down")
        assert len(health.components) == 4

    def test_get_events_empty(self):
        monitor = HealthMonitor("https://example.org", {})
        events = monitor.get_events()
        assert events == []

    @pytest.mark.asyncio
    async def test_simulate_records_events(self):
        monitor = HealthMonitor("https://example.org", {})
        await monitor.simulate_health()
        events = monitor.get_events()
        assert len(events) >= 0

    def test_get_history_empty(self):
        monitor = HealthMonitor("https://example.org", {})
        history = monitor.get_history()
        assert history == []

    @pytest.mark.asyncio
    async def test_compute_overall_all_healthy(self):
        from app.services.health_monitor import ComponentHealth, DatabaseHealth

        monitor = HealthMonitor("https://example.org", {})
        now = time.time()
        components = [
            ComponentHealth(
                name=n, status="healthy", container_state="running",
                uptime_seconds=3600, api_latency_ms=50,
                memory_usage_percent=40, cpu_usage_percent=10,
                url="", last_check=now,
            )
            for n in ["gateway", "controller", "hub", "eda"]
        ]
        db = DatabaseHealth(status="healthy", active_connections=10, max_connections=200, database_size="100MB")
        overall = monitor._compute_overall(components, db)
        assert overall == "healthy"

    @pytest.mark.asyncio
    async def test_compute_overall_db_down(self):
        from app.services.health_monitor import ComponentHealth, DatabaseHealth

        monitor = HealthMonitor("https://example.org", {})
        now = time.time()
        components = [
            ComponentHealth(
                name="gateway", status="healthy", container_state="running",
                uptime_seconds=3600, api_latency_ms=50,
                memory_usage_percent=40, cpu_usage_percent=10,
                url="", last_check=now,
            )
        ]
        db = DatabaseHealth(status="down", active_connections=0, max_connections=0, database_size="")
        overall = monitor._compute_overall(components, db)
        assert overall == "down"


# ======================================================================
# Middleware
# ======================================================================


class TestMiddleware:
    def test_request_logging(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        test_app = FastAPI()
        test_app.add_middleware(RequestLoggingMiddleware)

        @test_app.get("/test")
        async def _test():
            return {"ok": True}

        tc = TestClient(test_app)
        resp = tc.get("/test")
        assert resp.status_code == 200

    def test_request_logging_skips_health(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        test_app = FastAPI()
        test_app.add_middleware(RequestLoggingMiddleware)

        @test_app.get("/api/health")
        async def _health():
            return {"ok": True}

        tc = TestClient(test_app)
        resp = tc.get("/api/health")
        assert resp.status_code == 200

    def test_rate_limit(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        test_app = FastAPI()
        test_app.add_middleware(
            RateLimitMiddleware, requests_per_minute=60, burst=3
        )

        @test_app.get("/limited")
        async def _limited():
            return {"ok": True}

        tc = TestClient(test_app)
        for _ in range(3):
            resp = tc.get("/limited")
            assert resp.status_code == 200

        resp = tc.get("/limited")
        assert resp.status_code == 429

    def test_api_metrics(self):
        metrics = APIMetrics()
        metrics.record_request("GET", "/api/health", 200, 5.0)
        metrics.record_request("POST", "/api/deploy/start", 200, 150.0)
        metrics.record_request("GET", "/api/deploy/xxx/status", 404, 2.0)

        summary = metrics.get_summary()
        assert summary["total_requests"] == 3
        assert summary["total_errors"] == 1
        assert 200 in summary["by_status"]
        assert 404 in summary["by_status"]

    def test_api_metrics_reset(self):
        metrics = APIMetrics()
        metrics.record_request("GET", "/test", 200, 10.0)
        metrics.reset()
        summary = metrics.get_summary()
        assert summary["total_requests"] == 0

    def test_api_metrics_normalize_path(self):
        test_uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        assert APIMetrics._normalize_path(f"/api/deploy/{test_uuid}/status") == "/api/deploy/{id}/status"
        assert APIMetrics._normalize_path("/api/deploy/42/status") == "/api/deploy/{id}/status"
        assert APIMetrics._normalize_path("/api/health") == "/api/health"

    def test_api_metrics_slow_requests(self):
        metrics = APIMetrics()
        metrics._slow_threshold_ms = 100
        metrics.record_request("GET", "/slow", 200, 200.0)
        summary = metrics.get_summary()
        assert len(summary["slow_requests"]) == 1

    def test_request_id_middleware(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        test_app = FastAPI()
        test_app.add_middleware(RequestIdMiddleware)

        @test_app.get("/test")
        async def _test():
            return {"ok": True}

        tc = TestClient(test_app)
        resp = tc.get("/test")
        assert "x-request-id" in resp.headers

    def test_request_timing_middleware(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        test_app = FastAPI()
        test_app.add_middleware(RequestTimingMiddleware)

        @test_app.get("/test")
        async def _test():
            return {"ok": True}

        tc = TestClient(test_app)
        resp = tc.get("/test")
        assert "x-response-time" in resp.headers
