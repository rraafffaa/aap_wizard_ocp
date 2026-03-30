"""Tests for OpenShift-specific preflight validation checks."""

import pytest
from unittest.mock import AsyncMock, patch

from app.ocp_preflight import (
    run_ocp_preflight,
    check_cluster_connection,
    check_cluster_version,
    check_cluster_admin,
    check_node_count,
    check_node_resources,
    check_storage_class,
    check_namespace_conflict,
    check_operator_catalog,
    check_existing_aap,
    check_pull_secret,
)


@pytest.fixture
def sample_config():
    """Return a basic OCP preflight config."""
    return {
        "api_url": "https://api.cluster.example.com:6443",
        "token": "test-token-12345",
        "namespace": "aap",
        "storage_class": "gp3",
    }


@pytest.fixture
def mock_ocp_client():
    """Create a mocked OCPClient."""
    mock_client = AsyncMock()
    mock_client.close = AsyncMock()
    return mock_client


class TestRunOCPPreflight:
    """Test the main preflight runner."""

    @pytest.mark.asyncio
    async def test_run_returns_correct_structure(self, sample_config):
        """Test preflight result has overall and checks."""
        with patch("app.ocp_preflight.OCPClient") as MockClient:
            mock_instance = AsyncMock()
            mock_instance.close = AsyncMock()
            mock_instance.verify_connection = AsyncMock(
                return_value={"connected": True, "versions": ["v1"]}
            )
            mock_instance.get_cluster_info = AsyncMock(
                return_value={
                    "version": {"kubernetes": "v1.26.0"},
                    "nodes": [],
                    "storage_classes": [],
                    "installed_operators": [],
                }
            )
            mock_instance.get_nodes = AsyncMock(return_value=[])
            mock_instance.get_storage_classes = AsyncMock(return_value=[])
            mock_instance._request = AsyncMock(return_value={"items": []})
            MockClient.return_value = mock_instance

            result = await run_ocp_preflight(sample_config)

        assert "overall" in result
        assert "checks" in result
        assert isinstance(result["checks"], list)

    @pytest.mark.asyncio
    async def test_run_overall_passed_all_pass(self, sample_config):
        """Test overall status is 'passed' when all checks pass."""
        with patch("app.ocp_preflight.asyncio.gather", new_callable=AsyncMock) as mock_gather:
            mock_gather.return_value = [
                {"name": "Check 1", "status": "passed", "message": "OK"},
                {"name": "Check 2", "status": "passed", "message": "OK"},
            ]

            with patch("app.ocp_preflight.OCPClient") as MockClient:
                mock_instance = AsyncMock()
                mock_instance.close = AsyncMock()
                MockClient.return_value = mock_instance

                result = await run_ocp_preflight(sample_config)

        assert result["overall"] == "passed"

    @pytest.mark.asyncio
    async def test_run_overall_failed_any_fail(self, sample_config):
        """Test overall status is 'failed' when any check fails."""
        with patch("app.ocp_preflight.asyncio.gather", new_callable=AsyncMock) as mock_gather:
            mock_gather.return_value = [
                {"name": "Check 1", "status": "passed", "message": "OK"},
                {"name": "Check 2", "status": "failed", "message": "Error"},
                {"name": "Check 3", "status": "warning", "message": "Warn"},
            ]

            with patch("app.ocp_preflight.OCPClient") as MockClient:
                mock_instance = AsyncMock()
                mock_instance.close = AsyncMock()
                MockClient.return_value = mock_instance

                result = await run_ocp_preflight(sample_config)

        assert result["overall"] == "failed"

    @pytest.mark.asyncio
    async def test_run_overall_warning_no_failures(self, sample_config):
        """Test overall status is 'warning' when warnings but no failures."""
        with patch("app.ocp_preflight.asyncio.gather", new_callable=AsyncMock) as mock_gather:
            mock_gather.return_value = [
                {"name": "Check 1", "status": "passed", "message": "OK"},
                {"name": "Check 2", "status": "warning", "message": "Warn"},
            ]

            with patch("app.ocp_preflight.OCPClient") as MockClient:
                mock_instance = AsyncMock()
                mock_instance.close = AsyncMock()
                MockClient.return_value = mock_instance

                result = await run_ocp_preflight(sample_config)

        assert result["overall"] == "warning"

    @pytest.mark.asyncio
    async def test_run_missing_config(self):
        """Test preflight with missing required config."""
        result = await run_ocp_preflight({"api_url": "", "token": ""})

        assert result["overall"] == "failed"
        assert len(result["checks"]) == 1
        assert result["checks"][0]["status"] == "failed"
        assert "Missing required configuration" in result["checks"][0]["message"]


class TestClusterConnection:
    """Test cluster connection check."""

    @pytest.mark.asyncio
    async def test_connection_success(self, mock_ocp_client):
        """Test successful connection."""
        mock_ocp_client.verify_connection = AsyncMock(
            return_value={"connected": True, "versions": ["v1", "v1beta1"]}
        )

        result = await check_cluster_connection(mock_ocp_client)

        assert result["status"] == "passed"
        assert "Connected to cluster API" in result["message"]

    @pytest.mark.asyncio
    async def test_connection_failure(self, mock_ocp_client):
        """Test connection failure."""
        mock_ocp_client.verify_connection = AsyncMock(
            return_value={"connected": False, "error": "Connection refused"}
        )

        result = await check_cluster_connection(mock_ocp_client)

        assert result["status"] == "failed"
        assert "Cannot connect" in result["message"]


class TestClusterVersion:
    """Test cluster version check."""

    @pytest.mark.asyncio
    async def test_version_ok_ocp_413(self, mock_ocp_client):
        """Test OpenShift 4.13 (K8s 1.26) passes."""
        mock_ocp_client.get_cluster_info = AsyncMock(
            return_value={"version": {"kubernetes": "v1.26.0+abcd123"}}
        )

        result = await check_cluster_version(mock_ocp_client)

        assert result["status"] == "passed"
        assert "1.26" in result["message"]

    @pytest.mark.asyncio
    async def test_version_ok_ocp_412(self, mock_ocp_client):
        """Test OpenShift 4.12 (K8s 1.25) passes."""
        mock_ocp_client.get_cluster_info = AsyncMock(
            return_value={"version": {"kubernetes": "v1.25.0"}}
        )

        result = await check_cluster_version(mock_ocp_client)

        assert result["status"] == "passed"

    @pytest.mark.asyncio
    async def test_version_too_old(self, mock_ocp_client):
        """Test old K8s version fails."""
        mock_ocp_client.get_cluster_info = AsyncMock(
            return_value={"version": {"kubernetes": "v1.23.0"}}
        )

        result = await check_cluster_version(mock_ocp_client)

        assert result["status"] == "failed"
        assert "too old" in result["message"]

    @pytest.mark.asyncio
    async def test_version_unparseable(self, mock_ocp_client):
        """Test unparseable version returns warning."""
        mock_ocp_client.get_cluster_info = AsyncMock(
            return_value={"version": {"kubernetes": "unknown"}}
        )

        result = await check_cluster_version(mock_ocp_client)

        assert result["status"] == "warning"
        assert "Could not parse version" in result["message"]


class TestClusterAdmin:
    """Test cluster admin permissions check."""

    @pytest.mark.asyncio
    async def test_cluster_admin_success(self, mock_ocp_client):
        """Test successful cluster admin check."""
        mock_ocp_client._request = AsyncMock(return_value={"items": []})
        mock_ocp_client.get_nodes = AsyncMock(return_value=[])

        result = await check_cluster_admin(mock_ocp_client)

        assert result["status"] == "passed"
        assert "cluster-admin" in result["message"]

    @pytest.mark.asyncio
    async def test_cluster_admin_no_operator_access(self, mock_ocp_client):
        """Test cluster reader (no operator API access) returns warning."""
        call_count = 0

        async def mock_request(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 1:  # First call succeeds (namespaces)
                return {"items": []}
            # Second call (operators) fails — get_nodes is separately mocked
            raise Exception("403 Forbidden")

        mock_ocp_client._request = mock_request
        mock_ocp_client.get_nodes = AsyncMock(return_value=[])

        result = await check_cluster_admin(mock_ocp_client)

        assert result["status"] == "warning"
        assert "may lack operator management" in result["message"]

    @pytest.mark.asyncio
    async def test_cluster_admin_unauthorized(self, mock_ocp_client):
        """Test 401 unauthorized."""
        mock_ocp_client._request = AsyncMock(side_effect=Exception("401 Unauthorized"))

        result = await check_cluster_admin(mock_ocp_client)

        assert result["status"] == "failed"
        assert "Authentication failed" in result["message"]


class TestNodeCount:
    """Test node count check."""

    @pytest.mark.asyncio
    async def test_node_count_sufficient(self, mock_ocp_client):
        """Test sufficient nodes pass."""
        mock_ocp_client.get_nodes = AsyncMock(
            return_value=[
                {"name": "master-0", "role": "master", "ready": True},
                {"name": "worker-0", "role": "worker", "ready": True},
                {"name": "worker-1", "role": "worker", "ready": True},
                {"name": "worker-2", "role": "worker", "ready": True},
            ]
        )

        result = await check_node_count(mock_ocp_client)

        assert result["status"] == "passed"
        assert "4 nodes" in result["message"]
        assert "3 workers" in result["message"]

    @pytest.mark.asyncio
    async def test_node_count_insufficient_total(self, mock_ocp_client):
        """Test less than 3 total nodes returns warning (not hard failure)."""
        mock_ocp_client.get_nodes = AsyncMock(
            return_value=[
                {"name": "master-0", "role": "master", "ready": True},
                {"name": "worker-0", "role": "worker", "ready": True},
            ]
        )

        result = await check_node_count(mock_ocp_client)

        assert result["status"] == "warning"
        assert "2 nodes" in result["message"]

    @pytest.mark.asyncio
    async def test_node_count_few_workers(self, mock_ocp_client):
        """Test less than 3 workers returns warning."""
        mock_ocp_client.get_nodes = AsyncMock(
            return_value=[
                {"name": "master-0", "role": "master", "ready": True},
                {"name": "master-1", "role": "master", "ready": True},
                {"name": "worker-0", "role": "worker", "ready": True},
            ]
        )

        result = await check_node_count(mock_ocp_client)

        assert result["status"] == "warning"
        assert "3 nodes" in result["message"]
        assert "1 workers" in result["message"]


class TestNodeResources:
    """Test node resource capacity check."""

    @pytest.mark.asyncio
    async def test_node_resources_sufficient(self, mock_ocp_client):
        """Test sufficient CPU and memory."""
        mock_ocp_client.get_nodes = AsyncMock(
            return_value=[
                {"name": "worker-0", "role": "worker", "cpu": "8", "memory": "32Gi"},
                {"name": "worker-1", "role": "worker", "cpu": "8", "memory": "32Gi"},
            ]
        )

        result = await check_node_resources(mock_ocp_client)

        assert result["status"] == "passed"
        assert "16 CPU cores" in result["message"]
        assert "64 GB RAM" in result["message"]

    @pytest.mark.asyncio
    async def test_node_resources_minimum(self, mock_ocp_client):
        """Test minimum resources return warning."""
        mock_ocp_client.get_nodes = AsyncMock(
            return_value=[
                {"name": "worker-0", "role": "worker", "cpu": "4", "memory": "16Gi"},
            ]
        )

        result = await check_node_resources(mock_ocp_client)

        assert result["status"] == "warning"
        assert "4 CPU cores" in result["message"]
        assert "16 GB RAM" in result["message"]

    @pytest.mark.asyncio
    async def test_node_resources_insufficient(self, mock_ocp_client):
        """Test insufficient resources fail."""
        mock_ocp_client.get_nodes = AsyncMock(
            return_value=[
                {"name": "worker-0", "role": "worker", "cpu": "2", "memory": "8Gi"},
            ]
        )

        result = await check_node_resources(mock_ocp_client)

        assert result["status"] == "failed"
        assert "Insufficient" in result["message"]


class TestStorageClass:
    """Test storage class check."""

    @pytest.mark.asyncio
    async def test_storage_class_exists(self, mock_ocp_client):
        """Test selected storage class exists."""
        mock_ocp_client.get_storage_classes = AsyncMock(
            return_value=["gp2", "gp3", "ocs-storagecluster-cephfs"]
        )

        result = await check_storage_class(mock_ocp_client, "gp3")

        assert result["status"] == "passed"
        assert "gp3" in result["message"]

    @pytest.mark.asyncio
    async def test_storage_class_not_found(self, mock_ocp_client):
        """Test selected storage class does not exist."""
        mock_ocp_client.get_storage_classes = AsyncMock(
            return_value=["gp2", "gp3"]
        )

        result = await check_storage_class(mock_ocp_client, "missing-sc")

        assert result["status"] == "failed"
        assert "not found" in result["message"]

    @pytest.mark.asyncio
    async def test_storage_class_none_selected(self, mock_ocp_client):
        """Test no storage class selected returns warning."""
        mock_ocp_client.get_storage_classes = AsyncMock(
            return_value=["gp2", "gp3"]
        )

        result = await check_storage_class(mock_ocp_client, "")

        assert result["status"] == "warning"
        assert "No storage class selected" in result["message"]

    @pytest.mark.asyncio
    async def test_storage_class_none_available(self, mock_ocp_client):
        """Test no storage classes in cluster."""
        mock_ocp_client.get_storage_classes = AsyncMock(return_value=[])

        result = await check_storage_class(mock_ocp_client, "")

        assert result["status"] == "failed"
        assert "No storage classes found" in result["message"]


class TestNamespaceConflict:
    """Test namespace conflict check."""

    @pytest.mark.asyncio
    async def test_namespace_does_not_exist(self, mock_ocp_client):
        """Test namespace does not exist (will be created)."""
        mock_ocp_client._request = AsyncMock(side_effect=Exception("404 Not Found"))

        result = await check_namespace_conflict(mock_ocp_client, "aap")

        assert result["status"] == "passed"
        assert "does not exist" in result["message"]

    @pytest.mark.asyncio
    async def test_namespace_exists_empty(self, mock_ocp_client):
        """Test namespace exists but is empty."""
        call_count = 0

        async def mock_request(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:  # First call checks namespace
                return {"metadata": {"name": "aap"}}
            # Second call lists pods - empty
            return {"items": []}

        mock_ocp_client._request = mock_request
        mock_ocp_client.list_pods = AsyncMock(return_value=[])

        result = await check_namespace_conflict(mock_ocp_client, "aap")

        assert result["status"] == "warning"
        assert "already exists" in result["message"]

    @pytest.mark.asyncio
    async def test_namespace_exists_with_pods(self, mock_ocp_client):
        """Test namespace exists with pods."""
        mock_ocp_client._request = AsyncMock(
            return_value={"metadata": {"name": "aap"}}
        )
        mock_ocp_client.list_pods = AsyncMock(
            return_value=[
                {"name": "pod-1", "phase": "Running"},
                {"name": "pod-2", "phase": "Running"},
            ]
        )

        result = await check_namespace_conflict(mock_ocp_client, "aap")

        assert result["status"] == "warning"
        assert "2 pod(s)" in result["message"]


class TestOperatorCatalog:
    """Test operator catalog check."""

    @pytest.mark.asyncio
    async def test_operator_catalog_redhat_available(self, mock_ocp_client):
        """Test Red Hat catalog sources available."""
        mock_ocp_client._request = AsyncMock(
            return_value={
                "items": [
                    {"metadata": {"name": "redhat-operators"}},
                    {"metadata": {"name": "redhat-marketplace"}},
                ]
            }
        )

        result = await check_operator_catalog(mock_ocp_client)

        assert result["status"] == "passed"
        assert "redhat-operators" in result["message"]

    @pytest.mark.asyncio
    async def test_operator_catalog_no_redhat(self, mock_ocp_client):
        """Test no Red Hat catalog sources."""
        mock_ocp_client._request = AsyncMock(
            return_value={
                "items": [
                    {"metadata": {"name": "community-operators"}},
                ]
            }
        )

        result = await check_operator_catalog(mock_ocp_client)

        assert result["status"] == "warning"
        assert "1 catalog source(s)" in result["message"]

    @pytest.mark.asyncio
    async def test_operator_catalog_api_not_available(self, mock_ocp_client):
        """Test operator catalog API not available (vanilla K8s)."""
        mock_ocp_client._request = AsyncMock(side_effect=Exception("404 Not Found"))

        result = await check_operator_catalog(mock_ocp_client)

        assert result["status"] == "failed"
        assert "OperatorHub API not available" in result["message"]


class TestExistingAAP:
    """Test existing AAP installation check."""

    @pytest.mark.asyncio
    async def test_no_existing_aap(self, mock_ocp_client):
        """Test no existing AAP installation."""
        mock_ocp_client._request = AsyncMock(side_effect=Exception("404 Not Found"))

        result = await check_existing_aap(mock_ocp_client, "aap")

        assert result["status"] == "passed"
        assert "No AAP installation" in result["message"]

    @pytest.mark.asyncio
    async def test_existing_aap_controller(self, mock_ocp_client):
        """Test existing AutomationController found."""
        mock_ocp_client._request = AsyncMock(
            return_value={
                "items": [
                    {"metadata": {"name": "my-controller"}},
                ]
            }
        )

        result = await check_existing_aap(mock_ocp_client, "aap")

        assert result["status"] == "warning"
        assert "already installed" in result["message"]
        assert "my-controller" in result["details"]


class TestPullSecret:
    """Test pull secret check."""

    @pytest.mark.asyncio
    async def test_pull_secret_exists_with_redhat(self, mock_ocp_client):
        """Test pull secret exists with registry.redhat.io."""
        import base64
        secret_data = base64.b64encode(b'{"auths":{"registry.redhat.io":{}}}').decode()

        mock_ocp_client._request = AsyncMock(
            return_value={
                "data": {
                    ".dockerconfigjson": secret_data
                }
            }
        )

        result = await check_pull_secret(mock_ocp_client)

        assert result["status"] == "passed"
        assert "registry.redhat.io" in result["message"]

    @pytest.mark.asyncio
    async def test_pull_secret_missing_redhat(self, mock_ocp_client):
        """Test pull secret exists but missing registry.redhat.io."""
        import base64
        secret_data = base64.b64encode(b'{"auths":{"docker.io":{}}}').decode()

        mock_ocp_client._request = AsyncMock(
            return_value={
                "data": {
                    ".dockerconfigjson": secret_data
                }
            }
        )

        result = await check_pull_secret(mock_ocp_client)

        assert result["status"] == "warning"
        assert "may not include registry.redhat.io" in result["message"]

    @pytest.mark.asyncio
    async def test_pull_secret_not_found(self, mock_ocp_client):
        """Test pull secret not found."""
        mock_ocp_client._request = AsyncMock(side_effect=Exception("404 Not Found"))

        result = await check_pull_secret(mock_ocp_client)

        assert result["status"] == "warning"
        assert "not found" in result["message"]
