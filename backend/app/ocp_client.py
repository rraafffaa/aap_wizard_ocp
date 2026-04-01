"""OpenShift/Kubernetes API client — lightweight REST wrapper for cluster operations."""

from __future__ import annotations

import logging
from typing import Any, Optional
from urllib.parse import urljoin

import httpx


logger = logging.getLogger(__name__)


class OCPClient:
    """
    Lightweight OpenShift/Kubernetes API client using httpx.

    Uses direct REST API calls instead of the kubernetes Python package
    to keep dependencies minimal and avoid installation complexity.
    """

    def __init__(self, api_url: str, token: str):
        """
        Initialize the OCP/K8s client.

        Args:
            api_url: Base cluster API URL (e.g., https://api.cluster.example.com:6443)
            token: Bearer token for authentication
        """
        self.api_url = api_url.rstrip("/")
        self.token = token
        self._client: Optional[httpx.AsyncClient] = None

    def _get_client(self) -> httpx.AsyncClient:
        """Get or create the HTTP client."""
        if self._client is None:
            self._client = httpx.AsyncClient(
                headers={"Authorization": f"Bearer {self.token}"},
                verify=False,  # NOTE: Disabling SSL verification for self-signed cluster certs
                timeout=60.0,
            )
        return self._client

    async def close(self):
        """Close the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def _request(
        self, method: str, path: str, json: Optional[dict] = None, params: Optional[dict] = None
    ) -> dict[str, Any]:
        """
        Make an authenticated request to the K8s API.

        Args:
            method: HTTP method (GET, POST, PUT, DELETE, etc.)
            path: API path (e.g., /api/v1/nodes)
            json: JSON body for POST/PUT requests
            params: Query parameters

        Returns:
            Parsed JSON response

        Raises:
            httpx.HTTPStatusError: On 4xx/5xx responses
            httpx.ConnectError: On connection failures
            httpx.TimeoutException: On timeout
        """
        client = self._get_client()
        url = urljoin(self.api_url, path)

        try:
            logger.debug(f"{method} {path}")
            response = await client.request(method, url, json=json, params=params)
            response.raise_for_status()
            return response.json()
        except httpx.ConnectError as exc:
            logger.error(f"Connection refused to {self.api_url}: {exc}")
            raise
        except httpx.TimeoutException as exc:
            logger.error(f"Request timeout for {method} {path}: {exc}")
            raise
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 401:
                logger.error("Unauthorized — invalid or expired token")
            elif status == 403:
                logger.error(f"Forbidden — token lacks permission for {method} {path}")
            else:
                logger.error(f"{method} {path} failed with status {status}: {exc.response.text[:200]}")
            raise

    async def verify_connection(self) -> dict[str, Any]:
        """
        Verify connectivity to the cluster.

        Returns:
            Cluster API version info or error details
        """
        try:
            result = await self._request("GET", "/api")
            logger.info("Cluster connection verified")
            return {"connected": True, "versions": result.get("versions", [])}
        except httpx.ConnectError:
            return {"connected": False, "error": "Connection refused — check API URL"}
        except httpx.TimeoutException:
            return {"connected": False, "error": "Connection timeout"}
        except httpx.HTTPStatusError as exc:
            return {
                "connected": False,
                "error": f"HTTP {exc.response.status_code}: {exc.response.text[:200]}",
            }
        except Exception as exc:
            return {"connected": False, "error": str(exc)}

    async def get_cluster_info(self) -> dict[str, Any]:
        """
        Get comprehensive cluster information.

        Returns:
            Dict with version, platform, nodes, storage_classes, installed_operators
        """
        info: dict[str, Any] = {}

        # Get version
        try:
            version_info = await self._request("GET", "/version")
            info["version"] = {
                "kubernetes": version_info.get("gitVersion", "unknown"),
                "platform": version_info.get("platform", "unknown"),
            }
        except Exception as exc:
            logger.warning(f"Failed to get cluster version: {exc}")
            info["version"] = {"kubernetes": "unknown", "platform": "unknown"}

        # Get nodes
        try:
            nodes = await self.get_nodes()
            info["nodes"] = nodes
            info["node_count"] = len(nodes)
        except Exception as exc:
            logger.warning(f"Failed to get nodes: {exc}")
            info["nodes"] = []
            info["node_count"] = 0

        # Get storage classes
        try:
            storage_classes = await self.get_storage_classes()
            info["storage_classes"] = storage_classes
        except Exception as exc:
            logger.warning(f"Failed to get storage classes: {exc}")
            info["storage_classes"] = []

        # Get installed operators (OpenShift-specific)
        try:
            operators = await self.get_installed_operators()
            info["installed_operators"] = operators
        except Exception as exc:
            logger.warning(f"Failed to get operators: {exc}")
            info["installed_operators"] = []

        return info

    async def get_nodes(self) -> list[dict[str, Any]]:
        """
        List cluster nodes with their details.

        Returns:
            List of nodes with name, role, ready status, cpu, memory
        """
        try:
            result = await self._request("GET", "/api/v1/nodes")
            nodes = []

            for item in result.get("items", []):
                metadata = item.get("metadata", {})
                status = item.get("status", {})

                # Determine role (master/control-plane or worker)
                labels = metadata.get("labels", {})
                role = "worker"
                if labels.get("node-role.kubernetes.io/master") == "":
                    role = "master"
                elif labels.get("node-role.kubernetes.io/control-plane") == "":
                    role = "control-plane"

                # Determine ready status
                conditions = status.get("conditions", [])
                ready = False
                for cond in conditions:
                    if cond.get("type") == "Ready":
                        ready = cond.get("status") == "True"
                        break

                # Get capacity
                capacity = status.get("capacity", {})

                nodes.append({
                    "name": metadata.get("name", "unknown"),
                    "role": role,
                    "ready": ready,
                    "cpu": capacity.get("cpu", "unknown"),
                    "memory": capacity.get("memory", "unknown"),
                    "os_image": status.get("nodeInfo", {}).get("osImage", "unknown"),
                })

            return nodes
        except Exception as exc:
            logger.error(f"Failed to get nodes: {exc}")
            raise

    async def get_storage_classes(self) -> list[str]:
        """
        List available StorageClass names.

        Returns:
            List of storage class names
        """
        try:
            result = await self._request("GET", "/apis/storage.k8s.io/v1/storageclasses")
            return [
                item.get("metadata", {}).get("name", "")
                for item in result.get("items", [])
                if item.get("metadata", {}).get("name")
            ]
        except Exception as exc:
            logger.error(f"Failed to get storage classes: {exc}")
            raise

    async def get_installed_operators(self) -> list[str]:
        """
        Check for AAP-related operators in all namespaces (OpenShift-specific).

        Returns:
            List of operator names (focuses on AAP-related operators)
        """
        try:
            # Try to get ClusterServiceVersions (OpenShift Operator framework)
            result = await self._request(
                "GET",
                "/apis/operators.coreos.com/v1alpha1/clusterserviceversions",
                params={"limit": "500"}
            )

            operators = []
            for item in result.get("items", []):
                name = item.get("metadata", {}).get("name", "")
                display_name = item.get("spec", {}).get("displayName", name)

                # Filter for AAP-related operators
                if any(keyword in name.lower() for keyword in ["ansible", "automation", "aap"]):
                    operators.append(display_name or name)

            return operators
        except httpx.HTTPStatusError as exc:
            # If ClusterServiceVersions API not available (vanilla K8s), return empty
            if exc.response.status_code == 404:
                logger.info("Operator API not available (vanilla Kubernetes cluster)")
                return []
            raise
        except Exception as exc:
            logger.error(f"Failed to get operators: {exc}")
            raise

    async def create_namespace(self, name: str) -> dict[str, Any]:
        """
        Create a namespace if it doesn't exist.

        Args:
            name: Namespace name

        Returns:
            Created or existing namespace metadata
        """
        # Check if namespace exists
        try:
            result = await self._request("GET", f"/api/v1/namespaces/{name}")
            logger.info(f"Namespace '{name}' already exists")
            return result
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                raise

        # Create namespace
        namespace_spec = {
            "apiVersion": "v1",
            "kind": "Namespace",
            "metadata": {"name": name},
        }

        result = await self._request("POST", "/api/v1/namespaces", json=namespace_spec)
        logger.info(f"Created namespace '{name}'")
        return result

    async def apply_resource(self, namespace: str, resource: dict[str, Any]) -> dict[str, Any]:
        """
        Apply a Kubernetes resource (create or update).

        Args:
            namespace: Target namespace
            resource: K8s resource manifest (must include apiVersion, kind, metadata)

        Returns:
            Created/updated resource
        """
        api_version = resource.get("apiVersion", "")
        kind = resource.get("kind", "")
        name = resource.get("metadata", {}).get("name", "")

        if not all([api_version, kind, name]):
            raise ValueError("Resource must have apiVersion, kind, and metadata.name")

        # Determine API path
        if "/" in api_version:
            group, version = api_version.split("/", 1)
            # Convert kind to plural (simple heuristic)
            plural = kind.lower() + "s"
            path = f"/apis/{group}/{version}/namespaces/{namespace}/{plural}"
        else:
            # Core API (v1)
            plural = kind.lower() + "s"
            path = f"/api/{api_version}/namespaces/{namespace}/{plural}"

        # Try to get existing resource
        try:
            existing = await self._request("GET", f"{path}/{name}")
            # Update existing
            resource["metadata"]["resourceVersion"] = existing.get("metadata", {}).get("resourceVersion")
            result = await self._request("PUT", f"{path}/{name}", json=resource)
            logger.info(f"Updated {kind} '{name}' in namespace '{namespace}'")
            return result
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                raise

        # Create new
        result = await self._request("POST", path, json=resource)
        logger.info(f"Created {kind} '{name}' in namespace '{namespace}'")
        return result

    async def get_resource_status(
        self, namespace: str, group: str, version: str, plural: str, name: str
    ) -> dict[str, Any]:
        """
        Get status of a specific resource.

        Args:
            namespace: Namespace name
            group: API group (empty string for core API)
            version: API version (e.g., v1)
            plural: Resource plural name (e.g., pods, deployments)
            name: Resource name

        Returns:
            Resource status and metadata
        """
        if group:
            path = f"/apis/{group}/{version}/namespaces/{namespace}/{plural}/{name}"
        else:
            path = f"/api/{version}/namespaces/{namespace}/{plural}/{name}"

        result = await self._request("GET", path)
        return {
            "name": result.get("metadata", {}).get("name"),
            "status": result.get("status", {}),
            "metadata": result.get("metadata", {}),
        }

    async def list_pods(self, namespace: str, label_selector: str = "") -> list[dict[str, Any]]:
        """
        List pods in a namespace.

        Args:
            namespace: Namespace name
            label_selector: Optional label selector (e.g., "app=controller")

        Returns:
            List of pods with name, phase, ready status
        """
        params = {}
        if label_selector:
            params["labelSelector"] = label_selector

        result = await self._request("GET", f"/api/v1/namespaces/{namespace}/pods", params=params)

        pods = []
        for item in result.get("items", []):
            metadata = item.get("metadata", {})
            status = item.get("status", {})

            # Count ready containers
            container_statuses = status.get("containerStatuses", [])
            ready_count = sum(1 for c in container_statuses if c.get("ready", False))
            total_count = len(container_statuses)

            pods.append({
                "name": metadata.get("name", "unknown"),
                "phase": status.get("phase", "unknown"),
                "ready": f"{ready_count}/{total_count}",
                "restarts": sum(c.get("restartCount", 0) for c in container_statuses),
                "node": status.get("nodeName", ""),
            })

        return pods

    async def get_routes(self, namespace: str) -> list[dict[str, Any]]:
        """
        List OpenShift routes in a namespace.

        Args:
            namespace: Namespace name

        Returns:
            List of routes with name, host, path, service
        """
        try:
            result = await self._request(
                "GET", f"/apis/route.openshift.io/v1/namespaces/{namespace}/routes"
            )

            routes = []
            for item in result.get("items", []):
                metadata = item.get("metadata", {})
                spec = item.get("spec", {})

                routes.append({
                    "name": metadata.get("name", "unknown"),
                    "host": spec.get("host", ""),
                    "path": spec.get("path", "/"),
                    "service": spec.get("to", {}).get("name", ""),
                    "tls": "tls" in spec,
                })

            return routes
        except httpx.HTTPStatusError as exc:
            # Routes API not available (vanilla K8s)
            if exc.response.status_code == 404:
                logger.info("Routes API not available (vanilla Kubernetes cluster)")
                return []
            raise
