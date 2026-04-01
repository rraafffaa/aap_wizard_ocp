"""OpenShift deployment engine — drives AAP operator installation on OCP clusters."""

from __future__ import annotations

import asyncio
import logging
from typing import Callable, Optional

from app.ocp_client import OCPClient

logger = logging.getLogger(__name__)


OCP_DEPLOY_PHASES = [
    {"id": "connecting", "label": "Connecting to cluster", "weight": 5},
    {"id": "namespace", "label": "Creating namespace", "weight": 5},
    {"id": "operator_check", "label": "Checking for AAP operator", "weight": 5},
    {"id": "operator_install", "label": "Installing AAP operator", "weight": 20},
    {"id": "operator_wait", "label": "Waiting for operator readiness", "weight": 15},
    {"id": "cr_apply", "label": "Applying AnsibleAutomationPlatform CR", "weight": 10},
    {"id": "reconciliation", "label": "Waiting for AAP reconciliation", "weight": 30},
    {"id": "routes", "label": "Retrieving access routes", "weight": 5},
    {"id": "validation", "label": "Validating deployment", "weight": 5},
]


class OCPDeployer:
    """
    OpenShift deployment engine for Ansible Automation Platform.

    Deploys AAP on OpenShift by:
    1. Connecting to the cluster
    2. Creating the target namespace
    3. Installing the AAP operator (if needed)
    4. Applying the AnsibleAutomationPlatform custom resource
    5. Waiting for reconciliation and route creation
    """

    def __init__(self, config: dict, session_id: str):
        """
        Initialize the OCP deployer.

        Args:
            config: Deployment configuration with keys:
                - cluster_url: OCP API URL
                - token: Bearer token
                - namespace: Target namespace name
                - operator_namespace: Namespace for operator (default: openshift-operators)
                - catalog_source: Optional custom CatalogSource spec
                - cr: AnsibleAutomationPlatform CR manifest (dict)
            session_id: Unique deployment session ID
        """
        self.config = config
        self.session_id = session_id
        self.client: Optional[OCPClient] = None
        self._progress = 0
        self._current_phase = ""
        self._status = "pending"
        self._error = ""
        self._access_url = ""
        self._log_lines: list[str] = []
        self._cancelled = asyncio.Event()
        self._log_callback: Optional[Callable[[str], None]] = None

    @property
    def namespace(self) -> str:
        """Get the target namespace."""
        return self.config.get("namespace", "ansible-automation-platform")

    @property
    def operator_namespace(self) -> str:
        """Get the operator installation namespace."""
        return self.config.get("operator_namespace", "openshift-operators")

    async def cancel(self):
        """Cancel the deployment."""
        self._cancelled.set()
        logger.info(f"[{self.session_id}] Deployment cancelled by user")

    async def _log(self, line: str):
        """Log a message via the callback and store for status polling."""
        logger.info(line)
        self._log_lines.append(line)
        if self._log_callback:
            await self._log_callback(line)

    async def _update_progress(self, phase_id: str):
        """Update progress based on completed phase."""
        self._current_phase = phase_id
        phase_idx = next(
            (i for i, p in enumerate(OCP_DEPLOY_PHASES) if p["id"] == phase_id), 0
        )
        self._progress = sum(p["weight"] for p in OCP_DEPLOY_PHASES[: phase_idx + 1])
        await self._log(f"[PROGRESS] {self._progress}%")

    async def deploy(self, log_callback: Callable[[str], None]) -> dict:
        """
        Execute the full deployment workflow.

        Args:
            log_callback: Async function to receive log lines

        Returns:
            Deployment result with status, access_url, and error (if any)

        Raises:
            asyncio.CancelledError: If deployment is cancelled
            Exception: On deployment failure
        """
        self._log_callback = log_callback
        self._status = "running"

        try:
            await self._log("=" * 60)
            await self._log("  AAP Deployment Wizard — OpenShift Deployment")
            await self._log(f"  Session: {self.session_id}")
            await self._log("=" * 60)

            # Phase 1: Connect to cluster
            await self._connect()
            await self._update_progress("connecting")
            self._check_cancellation()

            # Phase 2: Create/verify namespace
            await self._setup_namespace()
            await self._update_progress("namespace")
            self._check_cancellation()

            # Phase 3: Check for existing operator
            operator_exists = await self._check_operator()
            await self._update_progress("operator_check")
            self._check_cancellation()

            # Phase 4: Install operator if needed
            if not operator_exists:
                await self._install_operator()
                await self._update_progress("operator_install")
                self._check_cancellation()

                # Phase 5: Wait for operator readiness
                await self._wait_for_operator()
                await self._update_progress("operator_wait")
                self._check_cancellation()
            else:
                await self._log("[OK] AAP operator already installed — skipping installation")
                await self._update_progress("operator_wait")

            # Phase 6a: Create required Secrets, then apply CR
            await self._create_secrets()
            await self._apply_cr()
            await self._update_progress("cr_apply")
            self._check_cancellation()

            # Phase 7: Wait for reconciliation
            await self._wait_for_reconciliation()
            await self._update_progress("reconciliation")
            self._check_cancellation()

            # Phase 8: Get routes
            routes = await self._get_routes()
            await self._update_progress("routes")
            self._check_cancellation()

            # Phase 9: Validate deployment
            await self._validate()
            await self._update_progress("validation")

            # Determine access URL
            access_url = ""
            if routes:
                # Look for controller or gateway route
                for route in routes:
                    if any(
                        keyword in route.get("name", "").lower()
                        for keyword in ["controller", "gateway", "ansible"]
                    ):
                        protocol = "https" if route.get("tls") else "http"
                        host = route.get("host", "")
                        access_url = f"{protocol}://{host}"
                        break
                # Fallback to first route
                if not access_url and routes:
                    protocol = "https" if routes[0].get("tls") else "http"
                    host = routes[0].get("host", "")
                    access_url = f"{protocol}://{host}"

            await self._log("")
            await self._log("=" * 60)
            await self._log("  Ansible Automation Platform")
            await self._log("  OpenShift Deployment — Complete!")
            await self._log("")
            await self._log(f"  Namespace:     {self.namespace}")
            if access_url:
                await self._log(f"  Access URL:    {access_url}")
            await self._log(f"  Session:       {self.session_id}")
            await self._log("=" * 60)

            self._status = "success"
            self._progress = 100
            self._access_url = access_url
            return {
                "status": "success",
                "namespace": self.namespace,
                "access_url": access_url,
                "routes": routes,
                "progress": 100,
            }

        except asyncio.CancelledError:
            self._status = "cancelled"
            await self._log("[CANCELLED] Deployment cancelled by user")
            raise
        except Exception as exc:
            self._status = "failed"
            self._error = str(exc)
            await self._log(f"[ERROR] Deployment failed: {exc}")
            logger.exception(f"[{self.session_id}] Deployment failed")
            raise
        finally:
            if self.client:
                await self.client.close()

    def _check_cancellation(self):
        """Check if deployment was cancelled."""
        if self._cancelled.is_set():
            raise asyncio.CancelledError("Deployment cancelled by user")

    async def _connect(self):
        """Verify cluster connection."""
        await self._log("[INFO] Connecting to OpenShift cluster...")
        await self._log(f"[INFO] Cluster URL: {self.config.get('cluster_url')}")

        self.client = OCPClient(
            api_url=self.config["cluster_url"], token=self.config["token"]
        )

        result = await self.client.verify_connection()
        if not result.get("connected"):
            error = result.get("error", "Unknown connection error")
            raise ConnectionError(f"Failed to connect to cluster: {error}")

        await self._log("[OK] Connected to cluster")

        # Get cluster info
        try:
            info = await self.client.get_cluster_info()
            version = info.get("version", {})
            await self._log(
                f"[INFO] Kubernetes version: {version.get('kubernetes', 'unknown')}"
            )
            await self._log(f"[INFO] Platform: {version.get('platform', 'unknown')}")
            await self._log(f"[INFO] Nodes: {info.get('node_count', 0)}")

            # Check for storage classes
            storage_classes = info.get("storage_classes", [])
            if storage_classes:
                await self._log(
                    f"[INFO] Available storage classes: {', '.join(storage_classes[:5])}"
                )
            else:
                await self._log("[WARN] No storage classes found")

        except Exception as exc:
            await self._log(f"[WARN] Could not retrieve full cluster info: {exc}")

    async def _setup_namespace(self):
        """Create or verify the target namespace."""
        await self._log(f"[INFO] Setting up namespace '{self.namespace}'...")

        try:
            await self.client.create_namespace(self.namespace)
            await self._log(f"[OK] Namespace '{self.namespace}' ready")
        except Exception as exc:
            raise RuntimeError(f"Failed to create namespace: {exc}")

    async def _check_operator(self) -> bool:
        """
        Check if the AAP operator is already installed.

        Returns:
            True if operator is installed, False otherwise
        """
        await self._log("[INFO] Checking for existing AAP operator...")

        try:
            operators = await self.client.get_installed_operators()
            aap_operators = [
                op
                for op in operators
                if any(
                    keyword in op.lower()
                    for keyword in ["ansible", "automation", "aap"]
                )
            ]

            if aap_operators:
                await self._log(f"[OK] Found AAP operator: {aap_operators[0]}")
                return True

            await self._log("[INFO] AAP operator not found")
            return False

        except Exception as exc:
            await self._log(f"[WARN] Could not check operator status: {exc}")
            return False

    async def _install_operator(self):
        """Install the AAP operator via Subscription CR."""
        await self._log("[INFO] Installing AAP operator...")

        # Check if custom CatalogSource is needed
        catalog_source = self.config.get("catalog_source")
        if catalog_source:
            await self._log("[INFO] Creating custom CatalogSource...")
            try:
                await self.client.apply_resource(
                    self.operator_namespace, catalog_source
                )
                await self._log("[OK] CatalogSource created")
                # Wait a bit for catalog to be ready
                await asyncio.sleep(5)
            except Exception as exc:
                raise RuntimeError(f"Failed to create CatalogSource: {exc}")

        # Create OperatorGroup if needed (for non-openshift-operators namespace)
        if self.operator_namespace != "openshift-operators":
            await self._log(
                f"[INFO] Creating OperatorGroup in '{self.operator_namespace}'..."
            )
            operator_group = {
                "apiVersion": "operators.coreos.com/v1",
                "kind": "OperatorGroup",
                "metadata": {
                    "name": "aap-operator-group",
                    "namespace": self.operator_namespace,
                },
                "spec": {"targetNamespaces": [self.namespace]},
            }
            try:
                await self.client.apply_resource(
                    self.operator_namespace, operator_group
                )
                await self._log("[OK] OperatorGroup created")
            except Exception as exc:
                raise RuntimeError(f"Failed to create OperatorGroup: {exc}")

        # Create Subscription
        await self._log("[INFO] Creating operator Subscription...")
        subscription = {
            "apiVersion": "operators.coreos.com/v1alpha1",
            "kind": "Subscription",
            "metadata": {
                "name": "ansible-automation-platform-operator",
                "namespace": self.operator_namespace,
            },
            "spec": {
                "channel": self.config.get("operator_channel", "stable-2.5"),
                "name": "ansible-automation-platform-operator",
                "source": self.config.get("catalog_name", "redhat-operators"),
                "sourceNamespace": "openshift-marketplace",
                "installPlanApproval": "Automatic",
            },
        }

        try:
            await self.client.apply_resource(self.operator_namespace, subscription)
            await self._log("[OK] Subscription created")
        except Exception as exc:
            raise RuntimeError(f"Failed to create Subscription: {exc}")

    async def _wait_for_operator(self, timeout: int = 600):
        """
        Wait for the operator CSV to be ready.

        Args:
            timeout: Maximum wait time in seconds
        """
        await self._log(
            "[INFO] Waiting for operator to be ready (this may take a few minutes)..."
        )

        start_time = asyncio.get_event_loop().time()
        check_interval = 10

        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > timeout:
                raise TimeoutError(
                    f"Operator did not become ready within {timeout} seconds"
                )

            self._check_cancellation()

            try:
                # Check for CSV in the operator namespace
                result = await self.client._request(
                    "GET",
                    f"/apis/operators.coreos.com/v1alpha1/namespaces/{self.operator_namespace}/clusterserviceversions",
                )

                for item in result.get("items", []):
                    name = item.get("metadata", {}).get("name", "")
                    if "ansible-automation-platform" in name.lower():
                        phase = item.get("status", {}).get("phase", "")
                        await self._log(f"[INFO] Operator CSV phase: {phase}")

                        if phase == "Succeeded":
                            await self._log("[OK] Operator is ready")
                            return

            except Exception as exc:
                await self._log(f"[WARN] Error checking operator status: {exc}")

            remaining = timeout - elapsed
            await self._log(
                f"[INFO] Operator not ready yet... ({int(remaining)}s remaining)"
            )
            await asyncio.sleep(check_interval)

    async def _create_secrets(self):
        """Create required Kubernetes Secrets before applying the CR."""
        from app.cr_generator import generate_admin_secret, generate_postgres_secret

        await self._log("[INFO] Creating required Secrets...")

        # Admin password secret
        admin_secret = generate_admin_secret(self.config.get("wizard_config", self.config))
        try:
            await self.client.apply_resource(self.namespace, admin_secret)
            await self._log("[OK] Admin password Secret created")
        except Exception as exc:
            raise RuntimeError(f"Failed to create admin password Secret: {exc}")

        # External DB secret (if applicable)
        postgres_secret = generate_postgres_secret(self.config.get("wizard_config", self.config))
        if postgres_secret:
            try:
                await self.client.apply_resource(self.namespace, postgres_secret)
                await self._log("[OK] PostgreSQL configuration Secret created")
            except Exception as exc:
                raise RuntimeError(f"Failed to create PostgreSQL Secret: {exc}")

    async def _apply_cr(self):
        """Apply the AnsibleAutomationPlatform custom resource."""
        await self._log("[INFO] Applying AnsibleAutomationPlatform CR...")

        cr = self.config.get("cr")
        if not cr:
            raise ValueError("No AnsibleAutomationPlatform CR provided in config")

        # Ensure CR has the correct namespace
        if "metadata" not in cr:
            cr["metadata"] = {}
        cr["metadata"]["namespace"] = self.namespace

        # If no name specified, use default
        if "name" not in cr["metadata"]:
            cr["metadata"]["name"] = "aap"

        try:
            await self.client.apply_resource(self.namespace, cr)
            cr_name = cr["metadata"]["name"]
            await self._log(f"[OK] AnsibleAutomationPlatform CR '{cr_name}' applied")
        except Exception as exc:
            raise RuntimeError(f"Failed to apply AnsibleAutomationPlatform CR: {exc}")

    async def _wait_for_reconciliation(self, timeout: int = 1800):
        """
        Wait for the AnsibleAutomationPlatform CR to be reconciled.

        Args:
            timeout: Maximum wait time in seconds (default 30 minutes)
        """
        await self._log(
            "[INFO] Waiting for AAP components to reconcile (this may take 15-30 minutes)..."
        )

        cr = self.config.get("cr", {})
        cr_name = cr.get("metadata", {}).get("name", "aap")

        start_time = asyncio.get_event_loop().time()
        check_interval = 15
        last_status = ""

        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > timeout:
                raise TimeoutError(
                    f"AAP did not become ready within {timeout // 60} minutes"
                )

            self._check_cancellation()

            try:
                # Get the CR status
                resource = await self.client.get_resource_status(
                    namespace=self.namespace,
                    group="aap.ansible.com",
                    version="v1alpha1",
                    plural="ansibleautomationplatforms",
                    name=cr_name,
                )

                status = resource.get("status", {})
                conditions = status.get("conditions", [])

                # Always extract conditions (not just on status change)
                ready_condition = next(
                    (c for c in conditions if c.get("type") == "Ready"), None
                )
                running_condition = next(
                    (c for c in conditions if c.get("type") == "Running"), None
                )

                # Log status changes
                current_status = str(status)
                if current_status != last_status:
                    if ready_condition:
                        ready_status = ready_condition.get("status", "Unknown")
                        reason = ready_condition.get("reason", "")
                        message = ready_condition.get("message", "")
                        await self._log(
                            f"[INFO] Ready status: {ready_status} ({reason})"
                        )
                        if message and message != reason:
                            await self._log(f"[INFO] {message}")

                    # Log other conditions
                    for condition in conditions:
                        cond_type = condition.get("type", "")
                        cond_status = condition.get("status", "")
                        if cond_type not in ("Ready",) and cond_status != "Unknown":
                            await self._log(
                                f"[INFO] {cond_type}: {cond_status}"
                            )

                    last_status = current_status

                # Check if ready via Ready condition
                if ready_condition and ready_condition.get("status") == "True":
                    await self._log("[OK] AAP components are ready")
                    return

                # Check pods as additional progress indicator
                pods_ready = False
                try:
                    pods = await self.client.list_pods(self.namespace)
                    running_pods = [p for p in pods if p.get("phase") == "Running"]
                    completed_pods = [p for p in pods if p.get("phase") == "Succeeded"]
                    active_pods = len(running_pods) + len(completed_pods)
                    if pods:
                        await self._log(
                            f"[INFO] Pods: {active_pods}/{len(pods)} active ({len(running_pods)} running, {len(completed_pods)} completed)"
                        )

                    # Filter out operator manager pods — they match component names
                    # but are NOT the actual AAP application pods
                    app_pods = [
                        p.get("name", "") for p in running_pods
                        if "operator-controller-manager" not in p.get("name", "")
                        and "operator-manager" not in p.get("name", "")
                    ]

                    # AAP app pods follow the pattern: aap-gateway-*, aap-controller-*,
                    # aap-hub-*, aap-eda-*. Must have all 4 components.
                    aap_component_patterns = [
                        "aap-gateway-",      # not aap-gateway-operator-
                        "aap-controller-",   # the actual controller workload
                        "aap-hub-",          # hub api/content/worker/web
                        "aap-eda-",          # eda api/worker/scheduler
                    ]
                    components_present = sum(
                        1 for pattern in aap_component_patterns
                        if any(name.startswith(pattern) for name in app_pods)
                    )

                    # Need all 4 AAP components AND a minimum of 15 total pods
                    # (9 operator/infra + at least 6 app pods)
                    min_total_pods = 15
                    if (pods and active_pods >= len(pods)
                            and components_present >= 4
                            and len(pods) >= min_total_pods):
                        pods_ready = True
                except Exception:
                    pass

                # AAP 2.6 operator may only have a "Running" condition (no "Ready")
                # If all key component pods are up and the CR has a Running condition, consider it done
                if pods_ready and running_condition and running_condition.get("status") == "True":
                    await self._log("[OK] All AAP component pods are running — deployment complete")
                    return

            except Exception as exc:
                await self._log(f"[WARN] Error checking reconciliation status: {exc}")

            remaining = timeout - elapsed
            await self._log(
                f"[INFO] Reconciliation in progress... ({int(remaining // 60)}m {int(remaining % 60)}s remaining)"
            )
            await asyncio.sleep(check_interval)

    async def _get_routes(self) -> list[dict]:
        """
        Retrieve OpenShift routes for the deployed AAP.
        Retries a few times since routes may take a moment to appear after pods are ready.

        Returns:
            List of route dictionaries with name, host, path, service, tls
        """
        await self._log("[INFO] Retrieving access routes...")

        # Routes may not appear immediately — retry up to 3 times
        routes = []
        for attempt in range(3):
            try:
                routes = await self.client.get_routes(self.namespace)
                if routes:
                    break
                if attempt < 2:
                    await self._log("[INFO] No routes yet — waiting 10s...")
                    await asyncio.sleep(10)
            except Exception as exc:
                await self._log(f"[WARN] Could not retrieve routes: {exc}")
                if attempt < 2:
                    await asyncio.sleep(10)

        if routes:
            await self._log(f"[OK] Found {len(routes)} route(s):")
            for route in routes:
                protocol = "https" if route.get("tls") else "http"
                host = route.get("host", "")
                name = route.get("name", "unknown")
                await self._log(f"  - {name}: {protocol}://{host}")
        else:
            await self._log("[WARN] No routes found after retries")

        return routes

    async def _validate(self):
        """Perform basic deployment validation."""
        await self._log("[INFO] Running deployment validation...")

        try:
            # Check pods — Running and Succeeded (completed Jobs like migrations) are both healthy
            pods = await self.client.list_pods(self.namespace)
            running_pods = [p for p in pods if p.get("phase") == "Running"]
            completed_pods = [p for p in pods if p.get("phase") == "Succeeded"]
            healthy_count = len(running_pods) + len(completed_pods)
            total_pods = len(pods)
            unhealthy = [p for p in pods if p.get("phase") not in ("Running", "Succeeded")]

            await self._log(f"[INFO] Pods: {len(running_pods)} running, {len(completed_pods)} completed, {total_pods} total")

            if total_pods == 0:
                await self._log("[WARN] No pods found in namespace")
            elif unhealthy:
                await self._log(
                    f"[WARN] {len(unhealthy)} pod(s) not healthy"
                )
                for pod in unhealthy:
                    await self._log(
                        f"  - {pod.get('name')}: {pod.get('phase')}"
                    )
            else:
                await self._log("[OK] All pods are healthy")

            # Check routes
            routes = await self.client.get_routes(self.namespace)
            if routes:
                await self._log(f"[OK] {len(routes)} route(s) configured")
            else:
                await self._log("[WARN] No routes found")

            await self._log("[OK] Validation complete")

        except Exception as exc:
            await self._log(f"[WARN] Validation encountered errors: {exc}")
