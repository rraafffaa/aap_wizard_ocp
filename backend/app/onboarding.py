"""Post-install onboarding automation — sets up a user's first workflow via AAP REST API."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


class AAPOnboarder:
    """Automates AAP onboarding tasks via REST API: manifest upload, project creation, inventory, job template, and job launch."""

    def __init__(
        self,
        gateway_url: str,
        admin_user: str = "admin",
        admin_password: str = "",
    ):
        """
        Initialize the onboarding client.

        Args:
            gateway_url: AAP gateway URL (e.g., "https://192.168.1.10:443")
            admin_user: Admin username (default: "admin")
            admin_password: Admin password
        """
        self.gateway_url = gateway_url.rstrip("/")
        self.admin_user = admin_user
        self.admin_password = admin_password
        self._client: Optional[httpx.AsyncClient] = None
        self._token: Optional[str] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client with proper auth and SSL settings."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self.gateway_url,
                auth=(self.admin_user, self.admin_password),
                verify=False,  # Self-signed certs
                timeout=60.0,
                follow_redirects=True,
            )
        return self._client

    async def _api_request(
        self, method: str, path: str, **kwargs
    ) -> dict:
        """
        Make an authenticated API request to AAP.

        Args:
            method: HTTP method (GET, POST, PUT, DELETE)
            path: API path (e.g., "/api/controller/v2/projects/")
            **kwargs: Additional arguments for httpx request (json, data, files, etc.)

        Returns:
            Response JSON as dict

        Raises:
            RuntimeError: On connection errors or non-2xx responses
        """
        client = await self._get_client()
        url = path if path.startswith("http") else path

        try:
            logger.info(f"{method} {url}")
            response = await client.request(method, url, **kwargs)

            if response.status_code == 401:
                raise RuntimeError(
                    "Authentication failed (401). Check admin credentials."
                )
            if response.status_code == 403:
                raise RuntimeError(
                    "Permission denied (403). Admin user lacks required permissions."
                )
            if response.status_code >= 400:
                error_detail = response.text[:500]
                raise RuntimeError(
                    f"API request failed ({response.status_code}): {error_detail}"
                )

            # Handle empty responses (e.g., 204 No Content)
            if response.status_code == 204 or not response.content:
                return {"status": "success", "status_code": response.status_code}

            return response.json()

        except httpx.ConnectError as exc:
            raise RuntimeError(
                f"Cannot connect to AAP at {self.gateway_url}. "
                "Ensure AAP is running and reachable."
            ) from exc
        except httpx.TimeoutException as exc:
            raise RuntimeError(
                f"Request to {url} timed out. AAP may be starting up or overloaded."
            ) from exc
        except Exception as exc:
            if isinstance(exc, RuntimeError):
                raise
            raise RuntimeError(f"API request failed: {exc}") from exc

    async def upload_manifest(self, manifest_path: str) -> dict:
        """
        Upload a Red Hat subscription manifest to AAP.

        Args:
            manifest_path: Absolute path to the manifest ZIP file

        Returns:
            Result dict with "success" and "message" keys

        Raises:
            RuntimeError: On upload failure
        """
        manifest_file = Path(manifest_path)
        if not manifest_file.exists():
            raise RuntimeError(f"Manifest file not found: {manifest_path}")

        logger.info(f"Uploading manifest: {manifest_file.name}")

        try:
            with open(manifest_file, "rb") as f:
                files = {"file": (manifest_file.name, f, "application/zip")}
                result = await self._api_request(
                    "POST",
                    "/api/gateway/v1/subscriptions/",
                    files=files,
                )
            logger.info("Manifest uploaded successfully")
            return {
                "success": True,
                "message": "Manifest uploaded",
                "result": result,
            }
        except Exception as exc:
            logger.error(f"Manifest upload failed: {exc}")
            return {
                "success": False,
                "message": f"Manifest upload failed: {exc}",
            }

    async def create_project(
        self,
        name: str = "Demo Project",
        scm_url: str = "https://github.com/ansible/ansible-tower-samples",
        scm_branch: str = "master",
    ) -> dict:
        """
        Create an SCM project in Automation Controller.

        Args:
            name: Project name
            scm_url: Git repository URL
            scm_branch: Git branch

        Returns:
            Created project dict with id, name, scm_url, etc.

        Raises:
            RuntimeError: On creation failure
        """
        logger.info(f"Creating project: {name}")

        payload = {
            "name": name,
            "description": "Sample project created during onboarding",
            "scm_type": "git",
            "scm_url": scm_url,
            "scm_branch": scm_branch,
            "scm_update_on_launch": True,
            "organization": 1,  # Default organization
        }

        try:
            result = await self._api_request(
                "POST",
                "/api/controller/v2/projects/",
                json=payload,
            )
            logger.info(f"Project created: ID {result.get('id')}")
            return result
        except Exception as exc:
            logger.error(f"Project creation failed: {exc}")
            raise RuntimeError(f"Failed to create project: {exc}") from exc

    async def create_inventory(
        self,
        name: str = "Demo Inventory",
        hosts: Optional[list[str]] = None,
    ) -> dict:
        """
        Create an inventory and add hosts to it.

        Args:
            name: Inventory name
            hosts: List of hostnames (default: ["localhost"])

        Returns:
            Created inventory dict with id, name, etc.

        Raises:
            RuntimeError: On creation failure
        """
        if hosts is None:
            hosts = ["localhost"]

        logger.info(f"Creating inventory: {name}")

        inventory_payload = {
            "name": name,
            "description": "Sample inventory created during onboarding",
            "organization": 1,  # Default organization
        }

        try:
            inventory = await self._api_request(
                "POST",
                "/api/controller/v2/inventories/",
                json=inventory_payload,
            )
            inventory_id = inventory.get("id")
            logger.info(f"Inventory created: ID {inventory_id}")

            # Add hosts to the inventory
            for hostname in hosts:
                logger.info(f"Adding host: {hostname}")
                host_payload = {
                    "name": hostname,
                    "inventory": inventory_id,
                    "enabled": True,
                    "variables": "ansible_connection: local" if hostname == "localhost" else "",
                }
                await self._api_request(
                    "POST",
                    "/api/controller/v2/hosts/",
                    json=host_payload,
                )

            logger.info(f"Added {len(hosts)} host(s) to inventory")
            return inventory

        except Exception as exc:
            logger.error(f"Inventory creation failed: {exc}")
            raise RuntimeError(f"Failed to create inventory: {exc}") from exc

    async def create_job_template(
        self,
        name: str = "Demo Job Template",
        project_id: Optional[int] = None,
        inventory_id: Optional[int] = None,
        playbook: str = "hello_world.yml",
    ) -> dict:
        """
        Create a job template.

        Args:
            name: Template name
            project_id: Project ID (required)
            inventory_id: Inventory ID (required)
            playbook: Playbook filename

        Returns:
            Created job template dict with id, name, etc.

        Raises:
            RuntimeError: On creation failure or missing parameters
        """
        if project_id is None or inventory_id is None:
            raise RuntimeError(
                "Both project_id and inventory_id are required to create a job template"
            )

        logger.info(f"Creating job template: {name}")

        payload = {
            "name": name,
            "description": "Sample job template created during onboarding",
            "job_type": "run",
            "inventory": inventory_id,
            "project": project_id,
            "playbook": playbook,
            "verbosity": 0,
            "ask_variables_on_launch": False,
        }

        try:
            result = await self._api_request(
                "POST",
                "/api/controller/v2/job_templates/",
                json=payload,
            )
            logger.info(f"Job template created: ID {result.get('id')}")
            return result
        except Exception as exc:
            logger.error(f"Job template creation failed: {exc}")
            raise RuntimeError(f"Failed to create job template: {exc}") from exc

    async def launch_job(self, template_id: int) -> dict:
        """
        Launch a job from a job template.

        Args:
            template_id: Job template ID

        Returns:
            Job dict with id, status, url, etc.

        Raises:
            RuntimeError: On launch failure
        """
        logger.info(f"Launching job from template ID {template_id}")

        try:
            result = await self._api_request(
                "POST",
                f"/api/controller/v2/job_templates/{template_id}/launch/",
                json={},
            )
            job_id = result.get("id")
            job_status = result.get("status", "unknown")
            logger.info(f"Job launched: ID {job_id}, status: {job_status}")
            return result
        except Exception as exc:
            logger.error(f"Job launch failed: {exc}")
            raise RuntimeError(f"Failed to launch job: {exc}") from exc

    async def get_job_status(self, job_id: int) -> dict:
        """
        Get the current status of a job.

        Args:
            job_id: Job ID

        Returns:
            Job status dict with id, status, failed, etc.

        Raises:
            RuntimeError: On retrieval failure
        """
        logger.info(f"Fetching job status for ID {job_id}")

        try:
            result = await self._api_request(
                "GET",
                f"/api/controller/v2/jobs/{job_id}/",
            )
            return result
        except Exception as exc:
            logger.error(f"Failed to get job status: {exc}")
            raise RuntimeError(f"Failed to get job status: {exc}") from exc

    async def get_progress(self) -> dict:
        """
        Check what onboarding steps are already completed.

        Returns:
            Progress dict with boolean flags for each onboarding step:
            - has_manifest: Subscription manifest uploaded
            - has_projects: At least one project exists
            - has_inventories: At least one inventory exists
            - has_job_templates: At least one job template exists
            - has_jobs: At least one job has been run

        Raises:
            RuntimeError: On API failure
        """
        logger.info("Checking onboarding progress")

        progress = {
            "has_manifest": False,
            "has_projects": False,
            "has_inventories": False,
            "has_job_templates": False,
            "has_jobs": False,
        }

        try:
            # Check manifest (subscription status)
            try:
                subscriptions = await self._api_request(
                    "GET",
                    "/api/gateway/v1/subscriptions/",
                )
                # If we get a valid response with results, manifest is present
                if subscriptions and subscriptions.get("count", 0) > 0:
                    progress["has_manifest"] = True
            except Exception:
                # Manifest endpoint may not be available or may require different auth
                logger.warning("Unable to check subscription status")

            # Check projects
            projects = await self._api_request(
                "GET",
                "/api/controller/v2/projects/",
            )
            if projects.get("count", 0) > 0:
                progress["has_projects"] = True

            # Check inventories
            inventories = await self._api_request(
                "GET",
                "/api/controller/v2/inventories/",
            )
            if inventories.get("count", 0) > 0:
                progress["has_inventories"] = True

            # Check job templates
            templates = await self._api_request(
                "GET",
                "/api/controller/v2/job_templates/",
            )
            if templates.get("count", 0) > 0:
                progress["has_job_templates"] = True

            # Check jobs
            jobs = await self._api_request(
                "GET",
                "/api/controller/v2/jobs/",
            )
            if jobs.get("count", 0) > 0:
                progress["has_jobs"] = True

            logger.info(f"Onboarding progress: {progress}")
            return progress

        except Exception as exc:
            logger.error(f"Failed to check progress: {exc}")
            raise RuntimeError(f"Failed to check onboarding progress: {exc}") from exc

    async def close(self):
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None
