"""Tests for OpenShift/Kubernetes API client."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
import httpx

from app.ocp_client import OCPClient


@pytest.fixture
def ocp_client():
    """Create an OCP client instance for testing."""
    return OCPClient(
        api_url="https://api.cluster.example.com:6443",
        token="test-token-12345"
    )


@pytest.fixture
def mock_httpx_client():
    """Create a mocked httpx.AsyncClient."""
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    return mock_client


class TestOCPClientInitialization:
    """Test client initialization and basic setup."""

    def test_init_stores_credentials(self):
        client = OCPClient(
            api_url="https://api.test.com:6443",
            token="my-token"
        )
        assert client.api_url == "https://api.test.com:6443"
        assert client.token == "my-token"

    def test_init_strips_trailing_slash(self):
        client = OCPClient(
            api_url="https://api.test.com:6443/",
            token="token"
        )
        assert client.api_url == "https://api.test.com:6443"

    def test_client_not_created_on_init(self):
        client = OCPClient(
            api_url="https://api.test.com:6443",
            token="token"
        )
        assert client._client is None


class TestOCPClientConnection:
    """Test connection verification and authentication."""

    @pytest.mark.asyncio
    async def test_verify_connection_success(self, ocp_client):
        """Test successful cluster connection."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"versions": ["v1"]}
        mock_response.raise_for_status = MagicMock()

        with patch.object(ocp_client, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await ocp_client.verify_connection()

        assert result["connected"] is True
        assert "versions" in result
        assert result["versions"] == ["v1"]

    @pytest.mark.asyncio
    async def test_verify_connection_401_unauthorized(self, ocp_client):
        """Test connection with invalid token."""
        mock_response = AsyncMock()
        mock_response.status_code = 401
        mock_response.text = "Unauthorized"

        with patch.object(ocp_client, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(
                side_effect=httpx.HTTPStatusError(
                    "Unauthorized",
                    request=AsyncMock(),
                    response=mock_response
                )
            )
            mock_get_client.return_value = mock_client

            result = await ocp_client.verify_connection()

        assert result["connected"] is False
        assert "HTTP 401" in result["error"]

    @pytest.mark.asyncio
    async def test_verify_connection_timeout(self, ocp_client):
        """Test connection timeout."""
        with patch.object(ocp_client, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(
                side_effect=httpx.TimeoutException("Connection timeout")
            )
            mock_get_client.return_value = mock_client

            result = await ocp_client.verify_connection()

        assert result["connected"] is False
        assert "timeout" in result["error"].lower()

    @pytest.mark.asyncio
    async def test_verify_connection_refused(self, ocp_client):
        """Test connection refused."""
        with patch.object(ocp_client, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            mock_get_client.return_value = mock_client

            result = await ocp_client.verify_connection()

        assert result["connected"] is False
        assert "refused" in result["error"].lower()


class TestOCPClientNodes:
    """Test node listing and parsing."""

    @pytest.mark.asyncio
    async def test_get_nodes_success(self, ocp_client):
        """Test parsing node list response."""
        mock_response = {
            "items": [
                {
                    "metadata": {
                        "name": "master-0",
                        "labels": {
                            "node-role.kubernetes.io/master": ""
                        }
                    },
                    "status": {
                        "conditions": [
                            {"type": "Ready", "status": "True"}
                        ],
                        "capacity": {
                            "cpu": "8",
                            "memory": "32Gi"
                        },
                        "nodeInfo": {
                            "osImage": "Red Hat Enterprise Linux CoreOS"
                        }
                    }
                },
                {
                    "metadata": {
                        "name": "worker-0",
                        "labels": {}
                    },
                    "status": {
                        "conditions": [
                            {"type": "Ready", "status": "False"}
                        ],
                        "capacity": {
                            "cpu": "4",
                            "memory": "16Gi"
                        },
                        "nodeInfo": {
                            "osImage": "RHEL CoreOS"
                        }
                    }
                }
            ]
        }

        with patch.object(ocp_client, '_request', return_value=mock_response):
            nodes = await ocp_client.get_nodes()

        assert len(nodes) == 2
        assert nodes[0]["name"] == "master-0"
        assert nodes[0]["role"] == "master"
        assert nodes[0]["ready"] is True
        assert nodes[0]["cpu"] == "8"
        assert nodes[0]["memory"] == "32Gi"

        assert nodes[1]["name"] == "worker-0"
        assert nodes[1]["role"] == "worker"
        assert nodes[1]["ready"] is False

    @pytest.mark.asyncio
    async def test_get_nodes_control_plane_role(self, ocp_client):
        """Test parsing control-plane role (K8s 1.20+)."""
        mock_response = {
            "items": [
                {
                    "metadata": {
                        "name": "control-plane-0",
                        "labels": {
                            "node-role.kubernetes.io/control-plane": ""
                        }
                    },
                    "status": {
                        "conditions": [{"type": "Ready", "status": "True"}],
                        "capacity": {"cpu": "4", "memory": "16Gi"},
                        "nodeInfo": {"osImage": "Ubuntu 22.04"}
                    }
                }
            ]
        }

        with patch.object(ocp_client, '_request', return_value=mock_response):
            nodes = await ocp_client.get_nodes()

        assert nodes[0]["role"] == "control-plane"

    @pytest.mark.asyncio
    async def test_get_nodes_empty_list(self, ocp_client):
        """Test empty node list response."""
        mock_response = {"items": []}

        with patch.object(ocp_client, '_request', return_value=mock_response):
            nodes = await ocp_client.get_nodes()

        assert nodes == []


class TestOCPClientStorageClasses:
    """Test storage class listing."""

    @pytest.mark.asyncio
    async def test_get_storage_classes_success(self, ocp_client):
        """Test parsing storage class list."""
        mock_response = {
            "items": [
                {"metadata": {"name": "gp2"}},
                {"metadata": {"name": "gp3"}},
                {"metadata": {"name": "ocs-storagecluster-cephfs"}}
            ]
        }

        with patch.object(ocp_client, '_request', return_value=mock_response):
            storage_classes = await ocp_client.get_storage_classes()

        assert len(storage_classes) == 3
        assert "gp2" in storage_classes
        assert "gp3" in storage_classes
        assert "ocs-storagecluster-cephfs" in storage_classes

    @pytest.mark.asyncio
    async def test_get_storage_classes_empty(self, ocp_client):
        """Test empty storage class list."""
        mock_response = {"items": []}

        with patch.object(ocp_client, '_request', return_value=mock_response):
            storage_classes = await ocp_client.get_storage_classes()

        assert storage_classes == []

    @pytest.mark.asyncio
    async def test_get_storage_classes_filters_empty_names(self, ocp_client):
        """Test filtering out items without names."""
        mock_response = {
            "items": [
                {"metadata": {"name": "gp2"}},
                {"metadata": {}},
                {"metadata": {"name": ""}}
            ]
        }

        with patch.object(ocp_client, '_request', return_value=mock_response):
            storage_classes = await ocp_client.get_storage_classes()

        assert storage_classes == ["gp2"]


class TestOCPClientNamespace:
    """Test namespace creation."""

    @pytest.mark.asyncio
    async def test_create_namespace_new(self, ocp_client):
        """Test creating a new namespace."""
        # First GET returns 404 (not found)
        mock_404_response = AsyncMock()
        mock_404_response.status_code = 404

        # POST creates the namespace
        mock_create_response = {
            "metadata": {"name": "aap"},
            "status": {"phase": "Active"}
        }

        async def mock_request(method, path, json=None, params=None):
            if method == "GET":
                raise httpx.HTTPStatusError(
                    "Not found",
                    request=AsyncMock(),
                    response=mock_404_response
                )
            return mock_create_response

        with patch.object(ocp_client, '_request', side_effect=mock_request):
            result = await ocp_client.create_namespace("aap")

        assert result["metadata"]["name"] == "aap"

    @pytest.mark.asyncio
    async def test_create_namespace_already_exists(self, ocp_client):
        """Test creating namespace that already exists."""
        mock_existing = {
            "metadata": {"name": "aap"},
            "status": {"phase": "Active"}
        }

        with patch.object(ocp_client, '_request', return_value=mock_existing):
            result = await ocp_client.create_namespace("aap")

        assert result["metadata"]["name"] == "aap"
        assert result["status"]["phase"] == "Active"

    @pytest.mark.asyncio
    async def test_create_namespace_error_not_404(self, ocp_client):
        """Test namespace creation when GET fails with non-404 error."""
        mock_500_response = AsyncMock()
        mock_500_response.status_code = 500

        with patch.object(ocp_client, '_request') as mock_request:
            mock_request.side_effect = httpx.HTTPStatusError(
                "Server error",
                request=AsyncMock(),
                response=mock_500_response
            )

            with pytest.raises(httpx.HTTPStatusError):
                await ocp_client.create_namespace("aap")


class TestOCPClientPods:
    """Test pod listing."""

    @pytest.mark.asyncio
    async def test_list_pods_success(self, ocp_client):
        """Test listing pods in a namespace."""
        mock_response = {
            "items": [
                {
                    "metadata": {"name": "gateway-1"},
                    "status": {
                        "phase": "Running",
                        "nodeName": "worker-0",
                        "containerStatuses": [
                            {"ready": True, "restartCount": 0},
                            {"ready": True, "restartCount": 2}
                        ]
                    }
                },
                {
                    "metadata": {"name": "controller-1"},
                    "status": {
                        "phase": "Pending",
                        "nodeName": "worker-1",
                        "containerStatuses": [
                            {"ready": False, "restartCount": 0}
                        ]
                    }
                }
            ]
        }

        with patch.object(ocp_client, '_request', return_value=mock_response):
            pods = await ocp_client.list_pods("aap")

        assert len(pods) == 2
        assert pods[0]["name"] == "gateway-1"
        assert pods[0]["phase"] == "Running"
        assert pods[0]["ready"] == "2/2"
        assert pods[0]["restarts"] == 2
        assert pods[0]["node"] == "worker-0"

        assert pods[1]["name"] == "controller-1"
        assert pods[1]["phase"] == "Pending"
        assert pods[1]["ready"] == "0/1"

    @pytest.mark.asyncio
    async def test_list_pods_with_label_selector(self, ocp_client):
        """Test listing pods with label selector."""
        mock_response = {"items": []}

        with patch.object(ocp_client, '_request', return_value=mock_response) as mock_req:
            await ocp_client.list_pods("aap", label_selector="app=controller")

        # Verify label selector was passed as parameter
        call_args = mock_req.call_args
        assert call_args[1]["params"]["labelSelector"] == "app=controller"


class TestOCPClientRoutes:
    """Test OpenShift route listing."""

    @pytest.mark.asyncio
    async def test_get_routes_success(self, ocp_client):
        """Test listing routes in a namespace."""
        mock_response = {
            "items": [
                {
                    "metadata": {"name": "gateway"},
                    "spec": {
                        "host": "aap.apps.cluster.example.com",
                        "path": "/",
                        "to": {"name": "gateway-service"},
                        "tls": {"termination": "edge"}
                    }
                },
                {
                    "metadata": {"name": "hub"},
                    "spec": {
                        "host": "hub.apps.cluster.example.com",
                        "to": {"name": "hub-service"}
                    }
                }
            ]
        }

        with patch.object(ocp_client, '_request', return_value=mock_response):
            routes = await ocp_client.get_routes("aap")

        assert len(routes) == 2
        assert routes[0]["name"] == "gateway"
        assert routes[0]["host"] == "aap.apps.cluster.example.com"
        assert routes[0]["tls"] is True

        assert routes[1]["name"] == "hub"
        assert routes[1]["tls"] is False

    @pytest.mark.asyncio
    async def test_get_routes_not_available_vanilla_k8s(self, ocp_client):
        """Test routes API not available on vanilla Kubernetes."""
        mock_404_response = AsyncMock()
        mock_404_response.status_code = 404

        with patch.object(ocp_client, '_request') as mock_req:
            mock_req.side_effect = httpx.HTTPStatusError(
                "Not found",
                request=AsyncMock(),
                response=mock_404_response
            )

            routes = await ocp_client.get_routes("aap")

        assert routes == []


class TestOCPClientCleanup:
    """Test client cleanup."""

    @pytest.mark.asyncio
    async def test_close_client(self, ocp_client):
        """Test closing the HTTP client."""
        mock_client = AsyncMock()
        ocp_client._client = mock_client

        await ocp_client.close()

        mock_client.aclose.assert_called_once()
        assert ocp_client._client is None

    @pytest.mark.asyncio
    async def test_close_no_client(self, ocp_client):
        """Test closing when no client exists."""
        ocp_client._client = None
        await ocp_client.close()  # Should not raise
        assert ocp_client._client is None
