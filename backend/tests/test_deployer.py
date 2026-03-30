import asyncio
import re

import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from app.models import DeploymentConfig
from app.deployer import Deployer, DEPLOY_PHASES, DeployEvent


def _deployer(cfg_dict: dict) -> Deployer:
    return Deployer(DeploymentConfig(**cfg_dict))


# ---------------------------------------------------------------------------
# Synchronous / state tests
# ---------------------------------------------------------------------------


class TestDeployer:
    """Tests for deployer initialisation and synchronous helpers."""

    def test_session_id_generated(self, default_config):
        d = _deployer(default_config)
        uuid_re = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        assert uuid_re.match(d.session_id)

    def test_initial_status_pending(self, default_config):
        d = _deployer(default_config)
        assert d._status == "pending"

    def test_cancel_sets_cancelled(self, default_config):
        d = _deployer(default_config)
        d.cancel()
        assert d._cancelled is True
        assert d._status == "cancelled"

    def test_get_status_returns_dict(self, default_config):
        d = _deployer(default_config)
        status = d.get_status()
        assert isinstance(status, dict)

    def test_status_has_required_fields(self, default_config):
        d = _deployer(default_config)
        status = d.get_status()
        for key in ("session_id", "status", "current_phase", "progress", "error", "log_lines"):
            assert key in status, f"Missing key: {key}"

    def test_status_session_id_matches(self, default_config):
        d = _deployer(default_config)
        assert d.get_status()["session_id"] == d.session_id

    def test_status_progress_starts_at_zero(self, default_config):
        d = _deployer(default_config)
        assert d.get_status()["progress"] == 0

    def test_dry_run_mode(self, default_config):
        cfg = {**default_config, "dry_run": True}
        d = _deployer(cfg)
        assert d.config.dry_run is True

    def test_cancel_with_no_process(self, default_config):
        d = _deployer(default_config)
        d._process = None
        d.cancel()
        assert d._status == "cancelled"

    def test_deploy_phases_constant(self):
        ids = [p["id"] for p in DEPLOY_PHASES]
        assert "validate" in ids
        assert "inventory" in ids
        assert "install" in ids
        assert "complete" in ids

    def test_deploy_event_to_dict(self):
        evt = DeployEvent("test_event", foo="bar")
        d = evt.to_dict()
        assert d["type"] == "test_event"
        assert d["foo"] == "bar"
        assert "timestamp" in d


# ---------------------------------------------------------------------------
# Async phase tests
# ---------------------------------------------------------------------------


class TestDeployerPhases:
    """Tests for the async deployment phases."""

    @pytest.mark.asyncio
    async def test_validate_phase(self, default_config):
        d = _deployer(default_config)
        with patch.object(d, '_ssh_cmd', new_callable=AsyncMock, return_value=0):
            await d._phase_validate()
        assert any("validated" in line.lower() for line in d._log_lines)

    @pytest.mark.asyncio
    async def test_validate_phase_rejects_bad_config(self, default_config):
        cfg = {**default_config}
        cfg["gateway"] = {**cfg["gateway"], "admin_password": ""}
        d = _deployer(cfg)
        with pytest.raises(ValueError, match="Validation failed"):
            await d._phase_validate()

    @pytest.mark.asyncio
    async def test_inventory_phase(self, default_config):
        d = _deployer(default_config)
        await d._phase_generate_inventory()
        assert d._inv_path is not None
        assert d._inv_path.exists()
        content = d._inv_path.read_text()
        assert "[automationgateway]" in content

    @pytest.mark.asyncio
    async def test_inventory_phase_logs_size(self, default_config):
        d = _deployer(default_config)
        await d._phase_generate_inventory()
        assert any("bytes" in line.lower() for line in d._log_lines)

    @pytest.mark.asyncio
    async def test_all_phases_complete(self, default_config):
        d = _deployer(default_config)

        async def _noop():
            pass

        with (
            patch.object(d, "_phase_validate", new=_noop),
            patch.object(d, "_phase_prepare_host", new=_noop),
            patch.object(d, "_phase_generate_inventory", new=_noop),
            patch.object(d, "_phase_upload", new=_noop),
            patch.object(d, "_phase_preflight", new=_noop),
            patch.object(d, "_phase_install", new=_noop),
            patch.object(d, "_phase_post_install", new=_noop),
            patch.object(d, "_phase_complete", new=_noop),
        ):
            await d.run()

        assert d._status == "completed"
        assert d._progress == 100

    @pytest.mark.asyncio
    async def test_run_sets_status_to_running(self, default_config):
        d = _deployer(default_config)
        observed_status = None
        gate = asyncio.Event()

        async def _capture():
            nonlocal observed_status
            observed_status = d._status
            gate.set()
            await asyncio.sleep(0.05)

        async def _noop():
            pass

        with (
            patch.object(d, "_phase_validate", new=_capture),
            patch.object(d, "_phase_prepare_host", new=_noop),
            patch.object(d, "_phase_generate_inventory", new=_noop),
            patch.object(d, "_phase_upload", new=_noop),
            patch.object(d, "_phase_preflight", new=_noop),
            patch.object(d, "_phase_install", new=_noop),
            patch.object(d, "_phase_post_install", new=_noop),
            patch.object(d, "_phase_complete", new=_noop),
        ):
            task = asyncio.create_task(d.run())
            await gate.wait()
            assert observed_status == "running"
            await task

    @pytest.mark.asyncio
    async def test_run_failure_sets_failed(self, default_config):
        d = _deployer(default_config)

        async def _boom():
            raise RuntimeError("simulated failure")

        with patch.object(d, "_phase_validate", new=_boom):
            await d.run()

        assert d._status == "failed"
        assert "simulated failure" in d._error_message

    @pytest.mark.asyncio
    async def test_stream_events(self, default_config):
        d = _deployer(default_config)

        async def _noop():
            pass

        with (
            patch.object(d, "_phase_validate", new=_noop),
            patch.object(d, "_phase_prepare_host", new=_noop),
            patch.object(d, "_phase_generate_inventory", new=_noop),
            patch.object(d, "_phase_upload", new=_noop),
            patch.object(d, "_phase_preflight", new=_noop),
            patch.object(d, "_phase_install", new=_noop),
            patch.object(d, "_phase_post_install", new=_noop),
            patch.object(d, "_phase_complete", new=_noop),
        ):
            task = asyncio.create_task(d.run())

            events = []
            async for event in d.stream_events():
                events.append(event)
                if event.get("type") in ("complete", "error", "cancelled"):
                    break

            await task

        assert len(events) > 0
        types = {e["type"] for e in events}
        assert "started" in types
        assert "complete" in types

    @pytest.mark.asyncio
    async def test_cancel_during_run(self, default_config):
        d = _deployer(default_config)
        running = asyncio.Event()

        async def _slow_phase():
            running.set()
            await asyncio.sleep(10)

        async def _noop():
            pass

        with (
            patch.object(d, "_phase_validate", new=_noop),
            patch.object(d, "_phase_prepare_host", new=_noop),
            patch.object(d, "_phase_generate_inventory", new=_noop),
            patch.object(d, "_phase_upload", new=_slow_phase),
            patch.object(d, "_phase_preflight", new=_noop),
            patch.object(d, "_phase_install", new=_noop),
            patch.object(d, "_phase_post_install", new=_noop),
            patch.object(d, "_phase_complete", new=_noop),
        ):
            task = asyncio.create_task(d.run())
            await running.wait()
            d.cancel()
            await asyncio.sleep(0.05)

        assert d._status == "cancelled"
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    @pytest.mark.asyncio
    async def test_emit_puts_event_on_queue(self, default_config):
        d = _deployer(default_config)
        await d._emit("test_type", detail="hello")
        event = d._events.get_nowait()
        assert event["type"] == "test_type"
        assert event["detail"] == "hello"

    @pytest.mark.asyncio
    async def test_log_appends_to_log_lines(self, default_config):
        d = _deployer(default_config)
        await d._log("hello world")
        assert "hello world" in d._log_lines

    @pytest.mark.asyncio
    async def test_progress_advances_through_phases(self, default_config):
        d = _deployer(default_config)

        async def _noop():
            pass

        with (
            patch.object(d, "_phase_validate", new=_noop),
            patch.object(d, "_phase_prepare_host", new=_noop),
            patch.object(d, "_phase_generate_inventory", new=_noop),
            patch.object(d, "_phase_upload", new=_noop),
            patch.object(d, "_phase_preflight", new=_noop),
            patch.object(d, "_phase_install", new=_noop),
            patch.object(d, "_phase_post_install", new=_noop),
            patch.object(d, "_phase_complete", new=_noop),
        ):
            await d.run()

        assert d._progress == 100

    @pytest.mark.asyncio
    async def test_local_install_simulation(self, default_config):
        d = _deployer(default_config)
        d._setup_dir = None
        d._is_remote = False

        with (
            patch.object(d, "_find_setup_dir", return_value=None),
            patch.object(d, "_run_command", new_callable=AsyncMock, return_value=1),
        ):
            await d._phase_install()

        assert any("simulation" in line.lower() for line in d._log_lines)

    @pytest.mark.asyncio
    async def test_post_install_logs_services(self, default_config):
        d = _deployer(default_config)
        d._is_remote = False
        await d._phase_post_install()
        assert any("gateway" in line.lower() for line in d._log_lines)

    @pytest.mark.asyncio
    async def test_complete_phase_logs_url(self, default_config):
        d = _deployer(default_config)
        await d._phase_complete()
        assert any("https://" in line for line in d._log_lines)
        assert any("aap.example.org" in line for line in d._log_lines)
