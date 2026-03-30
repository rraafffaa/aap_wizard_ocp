"""OpenShift-specific preflight validation checks before AAP deployment.

Runs checks on the target OpenShift cluster via the Kubernetes API to verify
cluster requirements for AAP 2.6 operator deployment.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from app.ocp_client import OCPClient

logger = logging.getLogger(__name__)


async def run_ocp_preflight(config: dict) -> dict:
    """
    Run OpenShift preflight checks for AAP deployment.

    Args:
        config: Deployment configuration containing:
            - api_url: OpenShift cluster API URL
            - token: Authentication token
            - namespace: Target namespace for AAP
            - storage_class: Selected storage class name

    Returns:
        dict with structure:
        {
            "overall": "passed" | "failed" | "warning",
            "checks": [
                {
                    "name": str,
                    "status": "passed" | "failed" | "warning",
                    "message": str,
                    "details": str (optional)
                },
                ...
            ]
        }
    """
    api_url = config.get("api_url", "")
    token = config.get("token", "")
    namespace = config.get("namespace", "aap")
    storage_class = config.get("storage_class", "")

    if not api_url or not token:
        return {
            "overall": "failed",
            "checks": [
                {
                    "name": "Configuration",
                    "status": "failed",
                    "message": "Missing required configuration",
                    "details": "api_url and token are required",
                }
            ],
        }

    client = OCPClient(api_url=api_url, token=token)

    try:
        # Run all checks concurrently
        checks = await asyncio.gather(
            check_cluster_connection(client),
            check_cluster_version(client),
            check_cluster_admin(client),
            check_node_count(client),
            check_node_resources(client),
            check_storage_class(client, storage_class),
            check_namespace_conflict(client, namespace),
            check_operator_catalog(client),
            check_existing_aap(client, namespace),
            check_pull_secret(client),
        )

        # Flatten the list of checks
        all_checks = [check for check in checks]

        # Determine overall status
        failed = any(c["status"] == "failed" for c in all_checks)
        warning = any(c["status"] == "warning" for c in all_checks)
        overall = "failed" if failed else ("warning" if warning else "passed")

        return {
            "overall": overall,
            "checks": all_checks,
        }

    finally:
        await client.close()


async def check_cluster_connection(client: OCPClient) -> dict:
    """Verify cluster API connection and authentication."""
    try:
        result = await client.verify_connection()
        if result.get("connected"):
            versions = result.get("versions", [])
            version_str = ", ".join(versions[:3]) if versions else "available"
            return {
                "name": "Cluster Connection",
                "status": "passed",
                "message": f"Connected to cluster API ({version_str})",
            }
        else:
            error = result.get("error", "Unknown error")
            return {
                "name": "Cluster Connection",
                "status": "failed",
                "message": "Cannot connect to cluster API",
                "details": error,
            }
    except Exception as exc:
        logger.error(f"Connection check failed: {exc}")
        return {
            "name": "Cluster Connection",
            "status": "failed",
            "message": "Connection check failed",
            "details": str(exc),
        }


async def check_cluster_version(client: OCPClient) -> dict:
    """Verify OpenShift cluster version is 4.12+."""
    try:
        info = await client.get_cluster_info()
        version_str = info.get("version", {}).get("kubernetes", "unknown")

        # Extract version number (e.g., "v1.25.0+abcd123" -> 1.25)
        match = re.search(r"v?(\d+)\.(\d+)", version_str)
        if not match:
            return {
                "name": "Cluster Version",
                "status": "warning",
                "message": f"Could not parse version: {version_str}",
                "details": "AAP 2.6 requires OpenShift 4.12+ (Kubernetes 1.25+)",
            }

        major = int(match.group(1))
        minor = int(match.group(2))

        # OpenShift 4.12 corresponds to Kubernetes 1.25
        # OpenShift 4.13 = K8s 1.26, etc.
        version_ok = (major == 1 and minor >= 25) or major > 1

        if version_ok:
            return {
                "name": "Cluster Version",
                "status": "passed",
                "message": f"Cluster version: {version_str}",
            }
        else:
            return {
                "name": "Cluster Version",
                "status": "failed",
                "message": f"Cluster version too old: {version_str}",
                "details": "AAP 2.6 requires OpenShift 4.12+ (Kubernetes 1.25+)",
            }

    except Exception as exc:
        logger.error(f"Version check failed: {exc}")
        return {
            "name": "Cluster Version",
            "status": "warning",
            "message": "Could not verify cluster version",
            "details": str(exc),
        }


async def check_cluster_admin(client: OCPClient) -> dict:
    """Verify token has cluster-admin RBAC permissions."""
    try:
        # Try to list namespaces (cluster-level operation)
        await client._request("GET", "/api/v1/namespaces", params={"limit": "1"})

        # Try to list nodes (requires cluster-admin or cluster reader)
        await client.get_nodes()

        # Try to access operator APIs (OpenShift-specific)
        try:
            await client._request(
                "GET",
                "/apis/operators.coreos.com/v1alpha1/subscriptions",
                params={"limit": "1"}
            )
            return {
                "name": "Cluster Admin Access",
                "status": "passed",
                "message": "Token has cluster-admin or sufficient RBAC permissions",
            }
        except Exception:
            # Can list nodes but not operators - probably cluster-reader
            return {
                "name": "Cluster Admin Access",
                "status": "warning",
                "message": "Token may lack operator management permissions",
                "details": "Ensure token has cluster-admin role for AAP operator installation",
            }

    except Exception as exc:
        error_msg = str(exc)
        if "401" in error_msg or "Unauthorized" in error_msg:
            return {
                "name": "Cluster Admin Access",
                "status": "failed",
                "message": "Authentication failed - invalid or expired token",
                "details": error_msg,
            }
        elif "403" in error_msg or "Forbidden" in error_msg:
            return {
                "name": "Cluster Admin Access",
                "status": "failed",
                "message": "Token lacks required permissions",
                "details": "cluster-admin role required for AAP deployment",
            }
        else:
            logger.error(f"RBAC check failed: {exc}")
            return {
                "name": "Cluster Admin Access",
                "status": "warning",
                "message": "Could not verify RBAC permissions",
                "details": str(exc),
            }


async def check_node_count(client: OCPClient) -> dict:
    """Verify cluster has at least 3 nodes and sufficient worker nodes."""
    try:
        nodes = await client.get_nodes()
        total_nodes = len(nodes)
        worker_nodes = [n for n in nodes if n.get("role") == "worker"]
        worker_count = len(worker_nodes)

        # Detect Single Node OpenShift (SNO)
        if total_nodes == 1:
            return {
                "name": "Node Count",
                "status": "warning",
                "message": "Single Node OpenShift (SNO) detected",
                "details": "SNO is supported for development/testing. Production deployments recommend 3+ nodes.",
            }
        elif total_nodes < 3:
            return {
                "name": "Node Count",
                "status": "warning",
                "message": f"{total_nodes} nodes found",
                "details": "Production AAP deployments recommend 3+ nodes for HA",
            }
        elif worker_count < 3:
            return {
                "name": "Node Count",
                "status": "warning",
                "message": f"{total_nodes} nodes ({worker_count} workers)",
                "details": "Fewer than 3 worker nodes may impact workload distribution",
            }
        else:
            return {
                "name": "Node Count",
                "status": "passed",
                "message": f"{total_nodes} nodes ({worker_count} workers)",
            }

    except Exception as exc:
        logger.error(f"Node count check failed: {exc}")
        return {
            "name": "Node Count",
            "status": "warning",
            "message": "Could not retrieve node information",
            "details": str(exc),
        }


async def check_node_resources(client: OCPClient) -> dict:
    """Verify worker nodes have sufficient CPU and memory."""
    try:
        nodes = await client.get_nodes()
        worker_nodes = [n for n in nodes if n.get("role") == "worker"]

        # On SNO clusters, the single node serves all roles — use all nodes
        target_nodes = worker_nodes if worker_nodes else nodes
        node_label = "workers" if worker_nodes else "all nodes (SNO)"

        if not target_nodes:
            return {
                "name": "Node Resources",
                "status": "warning",
                "message": "No nodes found",
                "details": "Cannot verify resource capacity",
            }

        # Calculate total CPU and memory
        total_cpu = 0
        total_memory_mi = 0

        for node in target_nodes:
            # Parse CPU (format: "4" or "4000m")
            cpu_str = str(node.get("cpu", "0"))
            if cpu_str.endswith("m"):
                cpu_cores = int(cpu_str[:-1]) / 1000
            else:
                cpu_cores = int(cpu_str) if cpu_str.isdigit() else 0
            total_cpu += cpu_cores

            # Parse memory (format: "16384Mi" or "16Gi")
            memory_str = str(node.get("memory", "0"))
            if memory_str.endswith("Mi"):
                memory_mi = int(memory_str[:-2])
            elif memory_str.endswith("Gi"):
                memory_mi = int(memory_str[:-2]) * 1024
            elif memory_str.endswith("Ki"):
                memory_mi = int(memory_str[:-2]) / 1024
            else:
                memory_mi = 0
            total_memory_mi += memory_mi

        total_memory_gi = total_memory_mi / 1024

        # AAP 2.6 minimum: 16 GB RAM, 4 CPU cores (across cluster)
        # Recommended: 32 GB+ RAM, 8+ CPU cores
        cpu_ok = total_cpu >= 4
        memory_ok = total_memory_gi >= 16

        if cpu_ok and memory_ok:
            if total_cpu >= 8 and total_memory_gi >= 32:
                return {
                    "name": "Node Resources",
                    "status": "passed",
                    "message": f"{int(total_cpu)} CPU cores, {int(total_memory_gi)} GB RAM ({node_label})",
                }
            else:
                return {
                    "name": "Node Resources",
                    "status": "warning",
                    "message": f"{int(total_cpu)} CPU cores, {int(total_memory_gi)} GB RAM ({node_label})",
                    "details": "Meets minimum requirements; 8+ cores and 32+ GB recommended",
                }
        else:
            missing = []
            if not cpu_ok:
                missing.append(f"{int(total_cpu)} CPU cores (4+ required)")
            if not memory_ok:
                missing.append(f"{int(total_memory_gi)} GB RAM (16+ required)")

            return {
                "name": "Node Resources",
                "status": "failed",
                "message": "Insufficient cluster resources",
                "details": "; ".join(missing),
            }

    except Exception as exc:
        logger.error(f"Node resources check failed: {exc}")
        return {
            "name": "Node Resources",
            "status": "warning",
            "message": "Could not verify node resources",
            "details": str(exc),
        }


async def check_storage_class(client: OCPClient, storage_class: str) -> dict:
    """Verify the selected storage class exists."""
    try:
        storage_classes = await client.get_storage_classes()

        if not storage_class:
            if storage_classes:
                return {
                    "name": "Storage Class",
                    "status": "warning",
                    "message": "No storage class selected",
                    "details": f"Available: {', '.join(storage_classes)}",
                }
            else:
                return {
                    "name": "Storage Class",
                    "status": "failed",
                    "message": "No storage classes found in cluster",
                    "details": "AAP requires persistent storage (RWX for shared volumes)",
                }

        if storage_class in storage_classes:
            return {
                "name": "Storage Class",
                "status": "passed",
                "message": f"Storage class '{storage_class}' exists",
            }
        else:
            return {
                "name": "Storage Class",
                "status": "failed",
                "message": f"Storage class '{storage_class}' not found",
                "details": f"Available: {', '.join(storage_classes) if storage_classes else 'none'}",
            }

    except Exception as exc:
        logger.error(f"Storage class check failed: {exc}")
        return {
            "name": "Storage Class",
            "status": "warning",
            "message": "Could not verify storage classes",
            "details": str(exc),
        }


async def check_namespace_conflict(client: OCPClient, namespace: str) -> dict:
    """Check if namespace exists and warn if it contains AAP resources."""
    try:
        # Try to get the namespace
        try:
            await client._request("GET", f"/api/v1/namespaces/{namespace}")
            namespace_exists = True
        except Exception:
            namespace_exists = False

        if not namespace_exists:
            return {
                "name": "Namespace Conflict",
                "status": "passed",
                "message": f"Namespace '{namespace}' does not exist (will be created)",
            }

        # Namespace exists - check for AAP resources
        try:
            pods = await client.list_pods(namespace)
            if pods:
                return {
                    "name": "Namespace Conflict",
                    "status": "warning",
                    "message": f"Namespace '{namespace}' already exists with {len(pods)} pod(s)",
                    "details": "Existing resources may conflict with AAP deployment",
                }
        except Exception:
            pass

        return {
            "name": "Namespace Conflict",
            "status": "warning",
            "message": f"Namespace '{namespace}' already exists",
            "details": "Ensure no conflicting resources exist before deploying AAP",
        }

    except Exception as exc:
        logger.error(f"Namespace check failed: {exc}")
        return {
            "name": "Namespace Conflict",
            "status": "passed",
            "message": f"Will use namespace '{namespace}'",
            "details": "Could not verify existing resources",
        }


async def check_operator_catalog(client: OCPClient) -> dict:
    """Verify OperatorHub and catalog sources are available."""
    try:
        # Check if OperatorHub CatalogSource API is available
        result = await client._request(
            "GET",
            "/apis/operators.coreos.com/v1alpha1/catalogsources",
            params={"limit": "10"}
        )

        catalog_sources = result.get("items", [])
        redhat_catalogs = [
            cs for cs in catalog_sources
            if "redhat" in cs.get("metadata", {}).get("name", "").lower()
        ]

        if redhat_catalogs:
            catalog_names = [cs.get("metadata", {}).get("name") for cs in redhat_catalogs]
            return {
                "name": "Operator Catalog",
                "status": "passed",
                "message": f"Red Hat catalog sources available: {', '.join(catalog_names[:3])}",
            }
        elif catalog_sources:
            return {
                "name": "Operator Catalog",
                "status": "warning",
                "message": f"{len(catalog_sources)} catalog source(s) found",
                "details": "Red Hat OperatorHub catalog not found - AAP operator may not be available",
            }
        else:
            return {
                "name": "Operator Catalog",
                "status": "failed",
                "message": "No catalog sources found",
                "details": "OperatorHub catalog required for AAP operator installation",
            }

    except Exception as exc:
        error_msg = str(exc)
        if "404" in error_msg:
            return {
                "name": "Operator Catalog",
                "status": "failed",
                "message": "OperatorHub API not available",
                "details": "This cluster may not support OpenShift operators",
            }
        else:
            logger.error(f"Operator catalog check failed: {exc}")
            return {
                "name": "Operator Catalog",
                "status": "warning",
                "message": "Could not verify operator catalogs",
                "details": str(exc),
            }


async def check_existing_aap(client: OCPClient, namespace: str) -> dict:
    """Check if AAP custom resources already exist in the namespace."""
    try:
        # Check for AutomationController CR (AAP 2.x)
        try:
            result = await client._request(
                "GET",
                f"/apis/automationcontroller.ansible.com/v1beta1/namespaces/{namespace}/automationcontrollers",
            )
            controllers = result.get("items", [])
            if controllers:
                controller_names = [c.get("metadata", {}).get("name") for c in controllers]
                return {
                    "name": "Existing AAP Installation",
                    "status": "warning",
                    "message": f"AAP already installed in '{namespace}'",
                    "details": f"Found AutomationController(s): {', '.join(controller_names)}",
                }
        except Exception as exc:
            # API not available or namespace doesn't exist yet
            if "404" not in str(exc):
                logger.debug(f"Could not check for AutomationController: {exc}")

        # Check for AAP operator subscription
        try:
            result = await client._request(
                "GET",
                f"/apis/operators.coreos.com/v1alpha1/namespaces/{namespace}/subscriptions",
            )
            subs = result.get("items", [])
            aap_subs = [
                s for s in subs
                if "ansible" in s.get("spec", {}).get("name", "").lower()
                or "aap" in s.get("spec", {}).get("name", "").lower()
            ]
            if aap_subs:
                return {
                    "name": "Existing AAP Installation",
                    "status": "warning",
                    "message": f"AAP operator subscription found in '{namespace}'",
                    "details": "Existing operator installation detected",
                }
        except Exception as exc:
            if "404" not in str(exc):
                logger.debug(f"Could not check for subscriptions: {exc}")

        return {
            "name": "Existing AAP Installation",
            "status": "passed",
            "message": f"No AAP installation found in '{namespace}'",
        }

    except Exception as exc:
        logger.error(f"AAP check failed: {exc}")
        return {
            "name": "Existing AAP Installation",
            "status": "passed",
            "message": "Could not verify existing AAP resources",
            "details": "Proceeding with deployment",
        }


async def check_pull_secret(client: OCPClient) -> dict:
    """Verify cluster has pull secret for registry.redhat.io."""
    try:
        # Check the global pull secret in openshift-config namespace
        result = await client._request(
            "GET",
            "/api/v1/namespaces/openshift-config/secrets/pull-secret"
        )

        # Decode and check if it contains registry.redhat.io
        data = result.get("data", {})
        dockerconfigjson = data.get(".dockerconfigjson", "")

        if dockerconfigjson:
            # Check if registry.redhat.io is in the secret (base64 encoded)
            import base64
            try:
                decoded = base64.b64decode(dockerconfigjson).decode("utf-8")
                if "registry.redhat.io" in decoded:
                    return {
                        "name": "Pull Secret",
                        "status": "passed",
                        "message": "Cluster has pull secret for registry.redhat.io",
                    }
                else:
                    return {
                        "name": "Pull Secret",
                        "status": "warning",
                        "message": "Pull secret found but may not include registry.redhat.io",
                        "details": "AAP operator images are hosted on registry.redhat.io",
                    }
            except Exception:
                return {
                    "name": "Pull Secret",
                    "status": "warning",
                    "message": "Pull secret exists but could not be validated",
                }
        else:
            return {
                "name": "Pull Secret",
                "status": "warning",
                "message": "Pull secret data not found",
                "details": "Ensure cluster is configured to pull from registry.redhat.io",
            }

    except Exception as exc:
        error_msg = str(exc)
        if "404" in error_msg or "not found" in error_msg.lower():
            return {
                "name": "Pull Secret",
                "status": "warning",
                "message": "Global pull secret not found in openshift-config",
                "details": "Cluster may not be configured to pull from registry.redhat.io",
            }
        elif "403" in error_msg or "Forbidden" in error_msg:
            return {
                "name": "Pull Secret",
                "status": "warning",
                "message": "Cannot access pull secret (permission denied)",
                "details": "Token may lack permissions to read secrets in openshift-config",
            }
        else:
            logger.error(f"Pull secret check failed: {exc}")
            return {
                "name": "Pull Secret",
                "status": "warning",
                "message": "Could not verify pull secret",
                "details": "Ensure cluster can pull from registry.redhat.io",
            }
