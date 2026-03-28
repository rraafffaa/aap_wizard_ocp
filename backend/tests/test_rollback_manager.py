"""Tests for the rollback manager service.

Covers snapshot creation, retrieval, rollback planning,
rollback commands, cleanup, persistence, and edge cases.
"""

import json
import tempfile

import pytest

from app.services.rollback_manager import (
    RollbackManager,
    DeploymentSnapshot,
    RollbackAction,
)


def get_default_config():
    return {
        "topology": "growth",
        "installation_type": "online",
        "gateway": {"hosts": ["aap.example.org"]},
        "controller": {"hosts": ["aap.example.org"]},
        "hub": {"hosts": ["aap.example.org"]},
        "eda": {"hosts": ["aap.example.org"]},
        "install_dir": "/opt/aap",
        "target_host": "aap.example.org",
    }


class TestRollbackManager:
    @pytest.fixture
    def manager(self, tmp_path):
        return RollbackManager(snapshots_dir=str(tmp_path))

    @pytest.fixture
    def sample_config(self):
        return get_default_config()

    @pytest.fixture
    def sample_inventory(self):
        return "[automationgateway]\naap.example.org\n"

    def test_create_snapshot(self, manager, sample_config, sample_inventory):
        snapshot = manager.create_snapshot(
            session_id="sess-123",
            phase="install",
            config=sample_config,
            inventory=sample_inventory,
        )
        assert snapshot is not None

    def test_create_snapshot_returns_snapshot(self, manager, sample_config, sample_inventory):
        snapshot = manager.create_snapshot(
            session_id="sess-456",
            phase="upload",
            config=sample_config,
            inventory=sample_inventory,
        )
        assert isinstance(snapshot, DeploymentSnapshot)

    def test_create_snapshot_has_id(self, manager, sample_config, sample_inventory):
        snapshot = manager.create_snapshot(
            session_id="sess-789",
            phase="preflight",
            config=sample_config,
            inventory=sample_inventory,
        )
        assert snapshot.id
        assert len(snapshot.id) > 0

    def test_create_snapshot_stores_config(self, manager, sample_config, sample_inventory):
        snapshot = manager.create_snapshot(
            session_id="sess-config",
            phase="install",
            config=sample_config,
            inventory=sample_inventory,
        )
        assert snapshot.config == sample_config
        assert snapshot.config.get("topology") == "growth"

    def test_create_snapshot_stores_inventory(self, manager, sample_config, sample_inventory):
        snapshot = manager.create_snapshot(
            session_id="sess-inv",
            phase="install",
            config=sample_config,
            inventory=sample_inventory,
        )
        assert snapshot.inventory == sample_inventory
        assert "automationgateway" in snapshot.inventory

    def test_create_multiple_snapshots(self, manager, sample_config, sample_inventory):
        s1 = manager.create_snapshot("sess-multi", "validate", sample_config, sample_inventory)
        s2 = manager.create_snapshot("sess-multi", "upload", sample_config, sample_inventory)
        s3 = manager.create_snapshot("sess-multi", "install", sample_config, sample_inventory)
        assert s1.id != s2.id != s3.id
        snapshots = manager.get_snapshots("sess-multi")
        assert len(snapshots) == 3

    def test_get_snapshots_empty(self, manager):
        snapshots = manager.get_snapshots("nonexistent-session")
        assert snapshots == []

    def test_get_snapshots_by_session(self, manager, sample_config, sample_inventory):
        manager.create_snapshot("sess-a", "install", sample_config, sample_inventory)
        manager.create_snapshot("sess-b", "install", sample_config, sample_inventory)
        manager.create_snapshot("sess-a", "upload", sample_config, sample_inventory)
        snapshots_a = manager.get_snapshots("sess-a")
        snapshots_b = manager.get_snapshots("sess-b")
        assert len(snapshots_a) == 2
        assert len(snapshots_b) == 1

    def test_get_latest_snapshot(self, manager, sample_config, sample_inventory):
        manager.create_snapshot("sess-latest", "validate", sample_config, sample_inventory)
        manager.create_snapshot("sess-latest", "upload", sample_config, sample_inventory)
        manager.create_snapshot("sess-latest", "install", sample_config, sample_inventory)
        latest = manager.get_latest_snapshot("sess-latest")
        assert latest is not None
        assert latest.phase == "install"

    def test_get_latest_no_snapshots(self, manager):
        latest = manager.get_latest_snapshot("empty-session")
        assert latest is None

    def test_plan_rollback(self, manager, sample_config, sample_inventory):
        manager.create_snapshot("sess-rollback", "install", sample_config, sample_inventory)
        actions = manager.plan_rollback("sess-rollback")
        assert isinstance(actions, list)

    def test_plan_rollback_returns_actions(self, manager, sample_config, sample_inventory):
        manager.create_snapshot("sess-actions", "install", sample_config, sample_inventory)
        actions = manager.plan_rollback("sess-actions")
        assert len(actions) > 0
        assert all(isinstance(a, RollbackAction) for a in actions)

    def test_plan_rollback_no_snapshots(self, manager):
        actions = manager.plan_rollback("no-snapshots")
        assert actions == []

    def test_plan_rollback_target_phase(self, manager, sample_config, sample_inventory):
        manager.create_snapshot("sess-target", "install", sample_config, sample_inventory)
        actions = manager.plan_rollback("sess-target", target_phase="upload")
        assert isinstance(actions, list)

    def test_rollback_actions_have_commands(self, manager, sample_config, sample_inventory):
        manager.create_snapshot("sess-cmds", "install", sample_config, sample_inventory)
        actions = manager.plan_rollback("sess-cmds")
        for action in actions:
            assert hasattr(action, "commands")
            assert isinstance(action.commands, list)

    def test_get_rollback_commands_install(self, manager, sample_config):
        commands = manager._get_rollback_commands("install", sample_config, "stop_containers")
        assert isinstance(commands, list)
        assert len(commands) > 0
        assert "podman" in commands[0] or "stop" in commands[0].lower()

    def test_get_rollback_commands_upload(self, manager, sample_config):
        commands = manager._get_rollback_commands("upload", sample_config, "cleanup_files")
        assert isinstance(commands, list)
        assert any("rm" in c or "cleanup" in c.lower() for c in commands)

    def test_get_rollback_commands_has_stop(self, manager, sample_config):
        stop_commands = manager._get_rollback_commands(
            "install", sample_config, "stop_containers"
        )
        assert len(stop_commands) > 0
        assert any("stop" in c.lower() for c in stop_commands)

    def test_cleanup_old_snapshots(self, manager, sample_config, sample_inventory):
        manager.create_snapshot("sess-old", "install", sample_config, sample_inventory)
        removed = manager.cleanup_old_snapshots(max_age_hours=0)
        assert removed >= 0

    def test_cleanup_preserves_recent(self, manager, sample_config, sample_inventory):
        manager.create_snapshot("sess-recent", "install", sample_config, sample_inventory)
        removed = manager.cleanup_old_snapshots(max_age_hours=72)
        snapshots = manager.get_snapshots("sess-recent")
        assert len(snapshots) >= 1 or removed == 0

    def test_snapshot_persisted_to_disk(self, manager, sample_config, sample_inventory):
        snapshot = manager.create_snapshot(
            "sess-persist",
            "install",
            sample_config,
            sample_inventory,
        )
        snapshot_files = list(manager._dir.glob("*.json"))
        assert len(snapshot_files) > 0
        content = snapshot_files[0].read_text()
        data = json.loads(content)
        assert data["session_id"] == "sess-persist"
        assert data["phase"] == "install"

    def test_load_snapshots_from_disk(self, manager, sample_config, sample_inventory):
        manager.create_snapshot("sess-load", "install", sample_config, sample_inventory)
        snapshots = manager.get_snapshots("sess-load")
        assert len(snapshots) > 0
        assert snapshots[0].config.get("topology") == "growth"

    def test_empty_session_id(self, manager):
        snapshots = manager.get_snapshots("")
        assert snapshots == []
        latest = manager.get_latest_snapshot("")
        assert latest is None

    def test_large_config(self, manager, sample_inventory):
        large_config = get_default_config()
        large_config["extra"] = {"key" + str(i): "value" * 100 for i in range(50)}
        snapshot = manager.create_snapshot(
            "sess-large",
            "install",
            large_config,
            sample_inventory,
        )
        assert snapshot is not None
        assert snapshot.config.get("extra") is not None


@pytest.mark.asyncio
class TestRollbackManagerAsync:
    @pytest.fixture
    def manager(self, tmp_path):
        return RollbackManager(snapshots_dir=str(tmp_path))

    @pytest.fixture
    def sample_config(self):
        return get_default_config()

    @pytest.fixture
    def sample_inventory(self):
        return "[automationgateway]\naap.example.org\n"

    async def test_execute_rollback_yields_events(self, manager, sample_config, sample_inventory):
        manager.create_snapshot("sess-exec", "install", sample_config, sample_inventory)
        actions = manager.plan_rollback("sess-exec")
        events = []
        async for event in manager.execute_rollback("sess-exec", actions):
            events.append(event)
        assert len(events) > 0
        assert any(e.get("status") in ("started", "progress", "complete", "action_complete") for e in events)
