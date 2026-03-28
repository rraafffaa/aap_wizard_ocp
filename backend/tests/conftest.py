import copy
import os
from unittest.mock import patch

import pytest

from app.models import DeploymentConfig, PreflightRequest


@pytest.fixture(autouse=True)
def _bypass_auth():
    """Bypass JWT auth middleware for all tests by treating every path as public."""
    with patch("app.main.is_public_path", return_value=True):
        yield


@pytest.fixture
def auth_headers():
    """Provide valid JWT auth headers for tests that explicitly need them."""
    os.environ.setdefault("JWT_SECRET", "test-secret-for-testing-only")
    from app.auth import create_token
    token, _ = create_token("testuser")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def default_config() -> dict:
    """Return a default growth-topology deployment configuration dict."""
    return {
        "topology": "growth",
        "installation_type": "online",
        "registry": {"username": "testuser", "password": "testpass"},
        "database": {
            "type": "managed",
            "host": "",
            "port": 5432,
            "admin_username": "postgres",
            "admin_password": "dbpass123",
        },
        "gateway": {
            "hosts": ["aap.example.org"],
            "admin_password": "gwpass123",
            "pg_host": "",
            "pg_database": "gateway",
            "pg_username": "gateway",
            "pg_password": "gwdbpass",
        },
        "controller": {
            "hosts": ["aap.example.org"],
            "admin_password": "ctrlpass123",
            "pg_host": "",
            "pg_database": "controller",
            "pg_username": "controller",
            "pg_password": "ctrldbpass",
            "percent_memory_capacity": 0.5,
        },
        "hub": {
            "hosts": ["aap.example.org"],
            "admin_password": "hubpass123",
            "pg_host": "",
            "pg_database": "hub",
            "pg_username": "hub",
            "pg_password": "hubdbpass",
            "seed_collections": False,
        },
        "eda": {
            "hosts": ["aap.example.org"],
            "admin_password": "edapass123",
            "pg_host": "",
            "pg_database": "eda",
            "pg_username": "eda",
            "pg_password": "edadbpass",
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
        "target_host": "",
        "target_user": "aap",
        "target_password": "",
        "target_ssh_port": 22,
    }


@pytest.fixture
def enterprise_config(default_config) -> dict:
    """Return an enterprise topology configuration with multiple hosts."""
    config = copy.deepcopy(default_config)
    config["topology"] = "enterprise"
    config["database"]["type"] = "external"
    config["database"]["host"] = "db.example.org"
    config["gateway"]["hosts"] = ["gw1.example.org", "gw2.example.org"]
    config["controller"]["hosts"] = ["ctrl1.example.org", "ctrl2.example.org"]
    config["hub"]["hosts"] = ["hub1.example.org", "hub2.example.org"]
    config["eda"]["hosts"] = ["eda1.example.org", "eda2.example.org"]
    config["execution_nodes"] = [
        {"host": "exec1.example.org", "receptor_type": "execution"}
    ]
    config["redis_mode"] = "cluster"
    return config


@pytest.fixture
def disconnected_config(default_config) -> dict:
    """Return a disconnected (bundled) installation config."""
    config = copy.deepcopy(default_config)
    config["installation_type"] = "disconnected"
    config["bundle_dir"] = "/opt/aap-bundle"
    return config


@pytest.fixture
def deployment_config(default_config) -> DeploymentConfig:
    """Build a DeploymentConfig model from the default dict."""
    return DeploymentConfig(**default_config)


@pytest.fixture
def enterprise_deployment_config(enterprise_config) -> DeploymentConfig:
    """Build a DeploymentConfig model from the enterprise dict."""
    return DeploymentConfig(**enterprise_config)


@pytest.fixture
def disconnected_deployment_config(disconnected_config) -> DeploymentConfig:
    """Build a DeploymentConfig model from the disconnected dict."""
    return DeploymentConfig(**disconnected_config)


@pytest.fixture
def preflight_request() -> PreflightRequest:
    """A basic growth-topology preflight request with no remote hosts."""
    return PreflightRequest(topology="growth", installation_type="online")


@pytest.fixture
def enterprise_preflight_request() -> PreflightRequest:
    """An enterprise preflight request with remote hosts."""
    from app.models import HostInfo

    return PreflightRequest(
        topology="enterprise",
        installation_type="online",
        hosts=[
            HostInfo(hostname="gw1.example.org", ssh_user="aap"),
            HostInfo(hostname="ctrl1.example.org", ssh_user="aap"),
        ],
    )
