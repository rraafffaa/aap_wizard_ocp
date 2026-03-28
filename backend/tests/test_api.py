"""Integration tests for the FastAPI REST endpoints.

Tests use the synchronous TestClient from FastAPI/Starlette which wraps
the ASGI app without needing a running server.
"""

import asyncio
import copy
import json
import time
import uuid

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from fastapi.testclient import TestClient

from app.main import app, DEPLOY_SESSIONS
from app.deployer import Deployer


client = TestClient(app)


# ---------------------------------------------------------------------------
# /api/health
# ---------------------------------------------------------------------------


class TestHealthEndpoint:
    def test_health_returns_200(self):
        resp = client.get("/api/health")
        assert resp.status_code == 200

    def test_health_returns_ok_status(self):
        resp = client.get("/api/health")
        assert resp.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# /api/preflight
# ---------------------------------------------------------------------------


class TestPreflightEndpoint:
    def test_preflight_returns_200(self, default_config):
        body = {
            "hosts": [],
            "topology": default_config["topology"],
            "installation_type": default_config["installation_type"],
        }
        with patch(
            "app.main.PreflightChecker"
        ) as MockChecker:
            mock_instance = MockChecker.return_value
            mock_instance.run = AsyncMock(
                return_value=MagicMock(
                    overall="passed",
                    checks=[],
                    model_dump=lambda: {"overall": "passed", "checks": []},
                )
            )
            resp = client.post("/api/preflight", json=body)
        assert resp.status_code == 200

    def test_preflight_returns_checks(self, default_config):
        body = {
            "hosts": [],
            "topology": "growth",
            "installation_type": "online",
        }
        fake_checks = [
            {"name": "Python 3", "status": "passed", "message": "3.12", "details": ""}
        ]
        with patch("app.main.PreflightChecker") as MockChecker:
            mock_instance = MockChecker.return_value
            mock_instance.run = AsyncMock(
                return_value=MagicMock(
                    overall="passed",
                    checks=fake_checks,
                    model_dump=lambda: {"overall": "passed", "checks": fake_checks},
                )
            )
            resp = client.post("/api/preflight", json=body)
        data = resp.json()
        assert "checks" in data

    def test_preflight_returns_overall(self, default_config):
        body = {
            "hosts": [],
            "topology": "growth",
            "installation_type": "online",
        }
        with patch("app.main.PreflightChecker") as MockChecker:
            mock_instance = MockChecker.return_value
            mock_instance.run = AsyncMock(
                return_value=MagicMock(
                    overall="passed",
                    checks=[],
                    model_dump=lambda: {"overall": "passed", "checks": []},
                )
            )
            resp = client.post("/api/preflight", json=body)
        assert "overall" in resp.json()

    def test_preflight_missing_content_type(self):
        resp = client.post("/api/preflight", content=b"not json")
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# /api/inventory
# ---------------------------------------------------------------------------


class TestInventoryEndpoints:
    def test_generate_returns_inventory(self, default_config):
        resp = client.post(
            "/api/inventory/generate", json={"config": default_config}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "inventory" in data
        assert "[automationgateway]" in data["inventory"]

    def test_generate_growth_topology(self, default_config):
        resp = client.post(
            "/api/inventory/generate", json={"config": default_config}
        )
        inv = resp.json()["inventory"]
        assert "Growth" in inv
        assert "ansible_connection=local" in inv

    def test_generate_enterprise_topology(self, enterprise_config):
        resp = client.post(
            "/api/inventory/generate", json={"config": enterprise_config}
        )
        assert resp.status_code == 200
        inv = resp.json()["inventory"]
        assert "Enterprise" in inv
        assert "gw1.example.org" in inv
        assert "gw2.example.org" in inv

    def test_generate_disconnected(self, disconnected_config):
        resp = client.post(
            "/api/inventory/generate", json={"config": disconnected_config}
        )
        inv = resp.json()["inventory"]
        assert "bundle_install=true" in inv

    def test_validate_valid_config(self, default_config):
        resp = client.post(
            "/api/inventory/validate", json={"config": default_config}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is True
        assert data["errors"] == []

    def test_validate_invalid_config(self):
        bad_config = {
            "topology": "growth",
            "installation_type": "online",
            "registry": {"username": "", "password": ""},
            "database": {"admin_password": ""},
            "gateway": {"hosts": [], "admin_password": ""},
            "controller": {"hosts": []},
        }
        resp = client.post(
            "/api/inventory/validate", json={"config": bad_config}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is False
        assert len(data["errors"]) > 0

    def test_validate_enterprise_valid(self, enterprise_config):
        resp = client.post(
            "/api/inventory/validate", json={"config": enterprise_config}
        )
        assert resp.json()["valid"] is True

    def test_generate_returns_string(self, default_config):
        resp = client.post(
            "/api/inventory/generate", json={"config": default_config}
        )
        assert isinstance(resp.json()["inventory"], str)


# ---------------------------------------------------------------------------
# /api/deploy
# ---------------------------------------------------------------------------


class TestDeployEndpoints:
    def test_start_returns_session_id(self, default_config):
        with patch.object(Deployer, "run", new_callable=AsyncMock):
            resp = client.post("/api/deploy/start", json=default_config)
        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data
        sid = data["session_id"]
        DEPLOY_SESSIONS.pop(sid, None)

    def test_status_unknown_session_404(self):
        resp = client.get(f"/api/deploy/{uuid.uuid4()}/status")
        assert resp.status_code == 404

    def test_cancel_unknown_session_404(self):
        resp = client.post(f"/api/deploy/{uuid.uuid4()}/cancel")
        assert resp.status_code == 404

    def test_start_and_get_status(self, default_config):
        with patch.object(Deployer, "run", new_callable=AsyncMock):
            resp = client.post("/api/deploy/start", json=default_config)
        sid = resp.json()["session_id"]
        status_resp = client.get(f"/api/deploy/{sid}/status")
        assert status_resp.status_code == 200
        status = status_resp.json()
        assert status["session_id"] == sid
        assert "status" in status
        DEPLOY_SESSIONS.pop(sid, None)

    def test_cancel_active_session(self, default_config):
        with patch.object(Deployer, "run", new_callable=AsyncMock):
            resp = client.post("/api/deploy/start", json=default_config)
        sid = resp.json()["session_id"]
        cancel_resp = client.post(f"/api/deploy/{sid}/cancel")
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled"
        DEPLOY_SESSIONS.pop(sid, None)

    def test_start_creates_session_entry(self, default_config):
        with patch.object(Deployer, "run", new_callable=AsyncMock):
            resp = client.post("/api/deploy/start", json=default_config)
        sid = resp.json()["session_id"]
        assert sid in DEPLOY_SESSIONS
        DEPLOY_SESSIONS.pop(sid, None)


# ---------------------------------------------------------------------------
# Profile endpoints (not yet implemented — tested structurally)
# ---------------------------------------------------------------------------


class TestProfileEndpoints:
    @pytest.mark.skip(reason="Profile endpoints not yet implemented in main.py")
    def test_list_profiles(self):
        resp = client.get("/api/profiles")
        assert resp.status_code == 200

    @pytest.mark.skip(reason="Profile endpoints not yet implemented in main.py")
    def test_get_preset_profile(self):
        resp = client.get("/api/profiles/growth-default")
        assert resp.status_code == 200

    @pytest.mark.skip(reason="Profile endpoints not yet implemented in main.py")
    def test_create_custom_profile(self):
        resp = client.post(
            "/api/profiles",
            json={"name": "my-profile", "config": {"topology": "growth"}},
        )
        assert resp.status_code in (200, 201)

    @pytest.mark.skip(reason="Profile endpoints not yet implemented in main.py")
    def test_delete_custom_profile(self):
        resp = client.delete("/api/profiles/some-id")
        assert resp.status_code in (200, 204, 404)


# ---------------------------------------------------------------------------
# Audit endpoints (not yet implemented — tested structurally)
# ---------------------------------------------------------------------------


class TestAuditEndpoints:
    @pytest.mark.skip(reason="Audit endpoints not yet implemented in main.py")
    def test_get_audit_log(self):
        resp = client.get("/api/audit")
        assert resp.status_code == 200

    @pytest.mark.skip(reason="Audit endpoints not yet implemented in main.py")
    def test_audit_stats(self):
        resp = client.get("/api/audit/stats")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Backup endpoints (not yet implemented — tested structurally)
# ---------------------------------------------------------------------------


class TestBackupEndpoints:
    @pytest.mark.skip(reason="Backup endpoints not yet implemented in main.py")
    def test_list_backups(self):
        resp = client.get("/api/backups")
        assert resp.status_code == 200

    @pytest.mark.skip(reason="Backup endpoints not yet implemented in main.py")
    def test_create_backup(self, default_config):
        resp = client.post("/api/backups", json={"config": default_config})
        assert resp.status_code in (200, 201)
