"""Tests for AAP post-install onboarding automation."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch, mock_open
import httpx

from app.onboarding import AAPOnboarder


@pytest.fixture
def onboarder():
    """Create an AAPOnboarder instance for testing."""
    return AAPOnboarder(
        gateway_url="https://aap.example.com",
        admin_user="admin",
        admin_password="testpass123"
    )


@pytest.fixture
def mock_httpx_client():
    """Create a mocked httpx.AsyncClient."""
    mock_client = AsyncMock(spec=httpx.AsyncClient)
    return mock_client


class TestAAPOnboarderInitialization:
    """Test onboarder initialization."""

    def test_init_stores_credentials(self):
        """Test initialization stores gateway URL and credentials."""
        onboarder = AAPOnboarder(
            gateway_url="https://test.example.com/",
            admin_user="myuser",
            admin_password="mypass"
        )

        assert onboarder.gateway_url == "https://test.example.com"
        assert onboarder.admin_user == "myuser"
        assert onboarder.admin_password == "mypass"

    def test_init_strips_trailing_slash(self):
        """Test gateway URL trailing slash is removed."""
        onboarder = AAPOnboarder(
            gateway_url="https://test.example.com/",
            admin_user="admin",
            admin_password="pass"
        )

        assert onboarder.gateway_url == "https://test.example.com"

    def test_init_default_admin_user(self):
        """Test default admin user is 'admin'."""
        onboarder = AAPOnboarder(
            gateway_url="https://test.example.com",
            admin_password="pass"
        )

        assert onboarder.admin_user == "admin"

    def test_init_client_not_created(self):
        """Test HTTP client not created on init."""
        onboarder = AAPOnboarder(
            gateway_url="https://test.example.com",
            admin_password="pass"
        )

        assert onboarder._client is None


class TestAAPOnboarderAPIRequest:
    """Test API request handling."""

    @pytest.mark.asyncio
    async def test_api_request_401_unauthorized(self, onboarder):
        """Test 401 unauthorized raises RuntimeError."""
        mock_response = AsyncMock()
        mock_response.status_code = 401
        mock_response.text = "Unauthorized"

        with patch.object(onboarder, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            with pytest.raises(RuntimeError) as exc_info:
                await onboarder._api_request("GET", "/api/test")

            assert "Authentication failed (401)" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_api_request_403_forbidden(self, onboarder):
        """Test 403 forbidden raises RuntimeError."""
        mock_response = AsyncMock()
        mock_response.status_code = 403
        mock_response.text = "Forbidden"

        with patch.object(onboarder, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            with pytest.raises(RuntimeError) as exc_info:
                await onboarder._api_request("GET", "/api/test")

            assert "Permission denied (403)" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_api_request_connection_refused(self, onboarder):
        """Test connection refused raises RuntimeError."""
        with patch.object(onboarder, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(
                side_effect=httpx.ConnectError("Connection refused")
            )
            mock_get_client.return_value = mock_client

            with pytest.raises(RuntimeError) as exc_info:
                await onboarder._api_request("GET", "/api/test")

            assert "Cannot connect to AAP" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_api_request_timeout(self, onboarder):
        """Test timeout raises RuntimeError."""
        with patch.object(onboarder, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(
                side_effect=httpx.TimeoutException("Timeout")
            )
            mock_get_client.return_value = mock_client

            with pytest.raises(RuntimeError) as exc_info:
                await onboarder._api_request("GET", "/api/test")

            assert "timed out" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_api_request_success_json(self, onboarder):
        """Test successful request returns JSON."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "ok", "data": "test"}
        mock_response.content = b'{"status":"ok"}'

        with patch.object(onboarder, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await onboarder._api_request("GET", "/api/test")

        assert result["status"] == "ok"
        assert result["data"] == "test"

    @pytest.mark.asyncio
    async def test_api_request_204_no_content(self, onboarder):
        """Test 204 No Content returns success dict."""
        mock_response = AsyncMock()
        mock_response.status_code = 204
        mock_response.content = b''

        with patch.object(onboarder, '_get_client') as mock_get_client:
            mock_client = AsyncMock()
            mock_client.request = AsyncMock(return_value=mock_response)
            mock_get_client.return_value = mock_client

            result = await onboarder._api_request("DELETE", "/api/resource/1")

        assert result["status"] == "success"
        assert result["status_code"] == 204


class TestCreateProject:
    """Test project creation."""

    @pytest.mark.asyncio
    async def test_create_project_success(self, onboarder):
        """Test successful project creation."""
        mock_response = {
            "id": 123,
            "name": "Demo Project",
            "scm_type": "git",
            "scm_url": "https://github.com/ansible/ansible-tower-samples",
        }

        with patch.object(onboarder, '_api_request', return_value=mock_response):
            result = await onboarder.create_project()

        assert result["id"] == 123
        assert result["name"] == "Demo Project"

    @pytest.mark.asyncio
    async def test_create_project_custom_name(self, onboarder):
        """Test project creation with custom name."""
        mock_response = {"id": 456, "name": "My Project"}

        with patch.object(onboarder, '_api_request', return_value=mock_response) as mock_req:
            await onboarder.create_project(name="My Project")

        call_args = mock_req.call_args
        assert call_args[1]["json"]["name"] == "My Project"

    @pytest.mark.asyncio
    async def test_create_project_custom_repo(self, onboarder):
        """Test project creation with custom repository."""
        mock_response = {"id": 789}

        with patch.object(onboarder, '_api_request', return_value=mock_response) as mock_req:
            await onboarder.create_project(
                scm_url="https://github.com/myorg/myrepo",
                scm_branch="develop"
            )

        call_args = mock_req.call_args
        assert call_args[1]["json"]["scm_url"] == "https://github.com/myorg/myrepo"
        assert call_args[1]["json"]["scm_branch"] == "develop"

    @pytest.mark.asyncio
    async def test_create_project_failure(self, onboarder):
        """Test project creation failure raises RuntimeError."""
        with patch.object(onboarder, '_api_request') as mock_req:
            mock_req.side_effect = RuntimeError("API error")

            with pytest.raises(RuntimeError) as exc_info:
                await onboarder.create_project()

            assert "Failed to create project" in str(exc_info.value)


class TestCreateInventory:
    """Test inventory creation."""

    @pytest.mark.asyncio
    async def test_create_inventory_success(self, onboarder):
        """Test successful inventory creation."""
        mock_inventory = {"id": 10, "name": "Demo Inventory"}
        mock_host = {"id": 20, "name": "localhost"}

        call_count = 0

        async def mock_request(method, path, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:  # Create inventory
                return mock_inventory
            return mock_host  # Create host

        with patch.object(onboarder, '_api_request', side_effect=mock_request):
            result = await onboarder.create_inventory()

        assert result["id"] == 10
        assert result["name"] == "Demo Inventory"

    @pytest.mark.asyncio
    async def test_create_inventory_with_hosts(self, onboarder):
        """Test inventory creation with custom hosts."""
        mock_inventory = {"id": 10}

        requests = []

        async def mock_request(method, path, **kwargs):
            requests.append((method, path, kwargs))
            if "inventories" in path:
                return mock_inventory
            return {"id": 99}  # Host creation

        with patch.object(onboarder, '_api_request', side_effect=mock_request):
            await onboarder.create_inventory(hosts=["host1.example.com", "host2.example.com"])

        # Should create 1 inventory + 2 hosts
        assert len(requests) == 3

    @pytest.mark.asyncio
    async def test_create_inventory_localhost_connection_local(self, onboarder):
        """Test localhost gets ansible_connection=local."""
        requests = []

        async def mock_request(method, path, **kwargs):
            requests.append(kwargs)
            if "inventories" in path:
                return {"id": 10}
            return {"id": 99}

        with patch.object(onboarder, '_api_request', side_effect=mock_request):
            await onboarder.create_inventory(hosts=["localhost"])

        # Check the host creation payload
        host_payload = requests[1]["json"]
        assert "ansible_connection: local" in host_payload["variables"]

    @pytest.mark.asyncio
    async def test_create_inventory_failure(self, onboarder):
        """Test inventory creation failure raises RuntimeError."""
        with patch.object(onboarder, '_api_request') as mock_req:
            mock_req.side_effect = RuntimeError("API error")

            with pytest.raises(RuntimeError) as exc_info:
                await onboarder.create_inventory()

            assert "Failed to create inventory" in str(exc_info.value)


class TestCreateJobTemplate:
    """Test job template creation."""

    @pytest.mark.asyncio
    async def test_create_job_template_success(self, onboarder):
        """Test successful job template creation."""
        mock_response = {
            "id": 50,
            "name": "Demo Job Template",
            "project": 10,
            "inventory": 20,
        }

        with patch.object(onboarder, '_api_request', return_value=mock_response):
            result = await onboarder.create_job_template(project_id=10, inventory_id=20)

        assert result["id"] == 50
        assert result["name"] == "Demo Job Template"

    @pytest.mark.asyncio
    async def test_create_job_template_missing_project(self, onboarder):
        """Test job template creation without project_id raises error."""
        with pytest.raises(RuntimeError) as exc_info:
            await onboarder.create_job_template(project_id=None, inventory_id=20)

        assert "project_id and inventory_id are required" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_job_template_missing_inventory(self, onboarder):
        """Test job template creation without inventory_id raises error."""
        with pytest.raises(RuntimeError) as exc_info:
            await onboarder.create_job_template(project_id=10, inventory_id=None)

        assert "project_id and inventory_id are required" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_create_job_template_custom_playbook(self, onboarder):
        """Test job template with custom playbook."""
        mock_response = {"id": 60}

        with patch.object(onboarder, '_api_request', return_value=mock_response) as mock_req:
            await onboarder.create_job_template(
                project_id=10,
                inventory_id=20,
                playbook="site.yml"
            )

        call_args = mock_req.call_args
        assert call_args[1]["json"]["playbook"] == "site.yml"


class TestLaunchJob:
    """Test job launching."""

    @pytest.mark.asyncio
    async def test_launch_job_success(self, onboarder):
        """Test successful job launch."""
        mock_response = {
            "id": 100,
            "status": "pending",
            "url": "/api/controller/v2/jobs/100/"
        }

        with patch.object(onboarder, '_api_request', return_value=mock_response):
            result = await onboarder.launch_job(template_id=50)

        assert result["id"] == 100
        assert result["status"] == "pending"

    @pytest.mark.asyncio
    async def test_launch_job_failure(self, onboarder):
        """Test job launch failure raises RuntimeError."""
        with patch.object(onboarder, '_api_request') as mock_req:
            mock_req.side_effect = RuntimeError("API error")

            with pytest.raises(RuntimeError) as exc_info:
                await onboarder.launch_job(template_id=50)

            assert "Failed to launch job" in str(exc_info.value)


class TestGetJobStatus:
    """Test job status retrieval."""

    @pytest.mark.asyncio
    async def test_get_job_status_success(self, onboarder):
        """Test successful job status retrieval."""
        mock_response = {
            "id": 100,
            "status": "successful",
            "failed": False
        }

        with patch.object(onboarder, '_api_request', return_value=mock_response):
            result = await onboarder.get_job_status(job_id=100)

        assert result["id"] == 100
        assert result["status"] == "successful"
        assert result["failed"] is False

    @pytest.mark.asyncio
    async def test_get_job_status_failure(self, onboarder):
        """Test job status retrieval failure raises RuntimeError."""
        with patch.object(onboarder, '_api_request') as mock_req:
            mock_req.side_effect = RuntimeError("API error")

            with pytest.raises(RuntimeError) as exc_info:
                await onboarder.get_job_status(job_id=100)

            assert "Failed to get job status" in str(exc_info.value)


class TestGetProgress:
    """Test onboarding progress check."""

    @pytest.mark.asyncio
    async def test_get_progress_all_complete(self, onboarder):
        """Test progress when all steps are complete."""
        async def mock_request(method, path, **kwargs):
            return {"count": 5, "results": []}

        with patch.object(onboarder, '_api_request', side_effect=mock_request):
            progress = await onboarder.get_progress()

        assert progress["has_projects"] is True
        assert progress["has_inventories"] is True
        assert progress["has_job_templates"] is True
        assert progress["has_jobs"] is True

    @pytest.mark.asyncio
    async def test_get_progress_none_complete(self, onboarder):
        """Test progress when no steps are complete."""
        async def mock_request(method, path, **kwargs):
            return {"count": 0, "results": []}

        with patch.object(onboarder, '_api_request', side_effect=mock_request):
            progress = await onboarder.get_progress()

        assert progress["has_projects"] is False
        assert progress["has_inventories"] is False
        assert progress["has_job_templates"] is False
        assert progress["has_jobs"] is False

    @pytest.mark.asyncio
    async def test_get_progress_partial_complete(self, onboarder):
        """Test progress when some steps are complete."""
        call_count = 0

        async def mock_request(method, path, **kwargs):
            nonlocal call_count
            call_count += 1
            if "projects" in path:
                return {"count": 2}
            elif "inventories" in path:
                return {"count": 1}
            else:
                return {"count": 0}

        with patch.object(onboarder, '_api_request', side_effect=mock_request):
            progress = await onboarder.get_progress()

        assert progress["has_projects"] is True
        assert progress["has_inventories"] is True
        assert progress["has_job_templates"] is False
        assert progress["has_jobs"] is False

    @pytest.mark.asyncio
    async def test_get_progress_manifest_check_error(self, onboarder):
        """Test progress when manifest endpoint fails (continues gracefully)."""
        call_count = 0

        async def mock_request(method, path, **kwargs):
            nonlocal call_count
            call_count += 1
            if "subscriptions" in path:
                raise RuntimeError("Subscription API not available")
            return {"count": 0}

        with patch.object(onboarder, '_api_request', side_effect=mock_request):
            progress = await onboarder.get_progress()

        # Should not crash, manifest check should be False
        assert progress["has_manifest"] is False

    @pytest.mark.asyncio
    async def test_get_progress_failure(self, onboarder):
        """Test progress check failure raises RuntimeError."""
        with patch.object(onboarder, '_api_request') as mock_req:
            mock_req.side_effect = RuntimeError("API error")

            with pytest.raises(RuntimeError) as exc_info:
                await onboarder.get_progress()

            assert "Failed to check onboarding progress" in str(exc_info.value)


class TestUploadManifest:
    """Test manifest upload."""

    @pytest.mark.asyncio
    async def test_upload_manifest_success(self, onboarder, tmp_path):
        """Test successful manifest upload."""
        # Create a temporary manifest file
        manifest_file = tmp_path / "manifest.zip"
        manifest_file.write_bytes(b"fake zip content")

        mock_response = {"status": "uploaded"}

        with patch.object(onboarder, '_api_request', return_value=mock_response):
            result = await onboarder.upload_manifest(str(manifest_file))

        assert result["success"] is True
        assert "Manifest uploaded" in result["message"]

    @pytest.mark.asyncio
    async def test_upload_manifest_file_not_found(self, onboarder):
        """Test manifest upload with non-existent file."""
        with pytest.raises(RuntimeError) as exc_info:
            await onboarder.upload_manifest("/nonexistent/manifest.zip")

        assert "Manifest file not found" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_upload_manifest_api_failure(self, onboarder, tmp_path):
        """Test manifest upload API failure."""
        manifest_file = tmp_path / "manifest.zip"
        manifest_file.write_bytes(b"fake zip")

        with patch.object(onboarder, '_api_request') as mock_req:
            mock_req.side_effect = RuntimeError("Upload failed")

            result = await onboarder.upload_manifest(str(manifest_file))

        assert result["success"] is False
        assert "Manifest upload failed" in result["message"]


class TestCleanup:
    """Test client cleanup."""

    @pytest.mark.asyncio
    async def test_close_client(self, onboarder):
        """Test closing the HTTP client."""
        mock_client = AsyncMock()
        onboarder._client = mock_client

        await onboarder.close()

        mock_client.aclose.assert_called_once()
        assert onboarder._client is None

    @pytest.mark.asyncio
    async def test_close_no_client(self, onboarder):
        """Test closing when no client exists."""
        onboarder._client = None
        await onboarder.close()  # Should not raise
        assert onboarder._client is None
