"""AI co-pilot service for AAP Deployment Wizard — supports both containerized and OCP deployments."""

import os
import logging
import httpx
from typing import Optional

logger = logging.getLogger(__name__)

AZURE_OPENAI_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT", "")
AZURE_OPENAI_KEY = os.environ.get("AZURE_OPENAI_KEY", "")
AZURE_OPENAI_MODEL = os.environ.get("AZURE_OPENAI_MODEL", "gpt-4o")
AZURE_OPENAI_API_VERSION = "2024-12-01-preview"

SYSTEM_PROMPT = """\
You are an expert Red Hat Ansible Automation Platform (AAP) 2.6 deployment advisor.
You support both containerized deployments (via ansible.containerized_installer) and OpenShift operator deployments.

Key context:
- Containerized: Rootless Podman on RHEL 9, components include Gateway, Controller, Hub, EDA, PostgreSQL, Redis
- OpenShift: AAP operator via OLM, deployed as CustomResources (AnsibleAutomationPlatform CR)
- Common topologies: growth (single node), enterprise (multi-node HA)
- Critical settings: replicas, storage, resource presets, database config, SSL/TLS

Provide clear, actionable guidance tailored to the deployment platform.
"""


class AIService:
    """AI-powered configuration advisor and validator for AAP deployments."""

    def __init__(self):
        self.endpoint = AZURE_OPENAI_ENDPOINT.rstrip("/")
        self.api_key = AZURE_OPENAI_KEY
        self.model = AZURE_OPENAI_MODEL

    @property
    def available(self) -> bool:
        """Check if external AI API is configured."""
        return bool(self.api_key and self.endpoint)

    async def review_config(self, config: dict) -> dict:
        """
        Pre-deployment AI config review (rule-based, always works offline).

        Returns:
            {
                "issues": list[str],        # Potential problems
                "suggestions": list[str],   # Improvement recommendations
                "score": int                # 1-10 rating
            }
        """
        platform = config.get("platform", "containerized")
        issues = []
        suggestions = []
        score = 10  # Start optimistic

        # Platform-agnostic checks
        if not config.get("admin_password"):
            issues.append("Admin password is not set")
            score -= 2

        # Platform-specific checks
        if platform == "ocp":
            issues_found, suggestions_found = self._review_ocp_config(config)
        else:
            issues_found, suggestions_found = self._review_containerized_config(config)

        issues.extend(issues_found)
        suggestions.extend(suggestions_found)

        # Adjust score based on issues
        score -= len(issues)
        score = max(1, min(10, score))

        return {
            "issues": issues,
            "suggestions": suggestions,
            "score": score,
        }

    def _review_containerized_config(self, config: dict) -> tuple[list[str], list[str]]:
        """Review containerized deployment configuration."""
        issues = []
        suggestions = []

        # SSH target checks
        if not config.get("target_host"):
            issues.append("Target host is not configured")
        if not config.get("target_user"):
            issues.append("Target user is not configured")
        if not config.get("target_password"):
            issues.append("Target SSH password is not set")

        # Topology checks
        topology = config.get("topology", "")
        hosts = config.get("hosts", [])

        if topology == "enterprise" and len(hosts) < 3:
            issues.append("Enterprise topology requires at least 3 hosts for HA")
            suggestions.append("Add more hosts or switch to 'growth' topology")

        if topology == "growth" and len(hosts) > 1:
            suggestions.append("Growth topology typically uses a single host — consider reducing hosts or using 'enterprise' topology")

        # Database configuration
        db_type = config.get("database", {}).get("type", "internal")
        if db_type == "external":
            db_config = config.get("database", {})
            if not db_config.get("host"):
                issues.append("External database host not configured")
            if not db_config.get("port"):
                suggestions.append("Database port not specified — will use defaults")
            if not db_config.get("password"):
                issues.append("External database password not set")

        # Network configuration
        network = config.get("network", {})
        https_port = network.get("https_port")
        if https_port and https_port == 80:
            suggestions.append("HTTPS port is set to 80 — consider using 443 for standard HTTPS")

        # Bundle/registry checks
        bundle_type = config.get("bundle_type", "online")
        if bundle_type == "offline" and not config.get("bundle_path"):
            issues.append("Offline bundle selected but bundle path not specified")

        # SSL/TLS
        if config.get("generate_certificates"):
            suggestions.append("Self-signed certificates will be generated — consider using trusted CA certificates for production")

        return issues, suggestions

    def _review_ocp_config(self, config: dict) -> tuple[list[str], list[str]]:
        """Review OpenShift deployment configuration."""
        issues = []
        suggestions = []

        # OCP connection checks
        if not config.get("ocp_api_url"):
            issues.append("OpenShift API URL is not configured")
        if not config.get("ocp_token"):
            issues.append("OpenShift authentication token is not set")

        # Namespace
        if not config.get("namespace"):
            suggestions.append("Namespace not specified — will use default")

        # Operator channel
        channel = config.get("operator_channel", "")
        if not channel:
            suggestions.append("Operator channel not specified — will use latest stable")
        elif "stable" not in channel.lower():
            suggestions.append("Consider using a stable channel for production deployments")

        # Replica counts (HA check)
        components = config.get("components", {})
        controller_replicas = components.get("controller", {}).get("replicas", 1)
        hub_replicas = components.get("hub", {}).get("replicas", 1)
        eda_replicas = components.get("eda", {}).get("replicas", 1)

        if controller_replicas == 1:
            issues.append("Only 1 controller replica configured — no high availability")
            suggestions.append("Increase controller replicas to 3+ for HA")

        if hub_replicas == 1:
            suggestions.append("Single Hub replica — consider 2+ for redundancy")

        if eda_replicas == 1:
            suggestions.append("Single EDA replica — consider 2+ for redundancy")

        # Storage class
        if not config.get("storage_class"):
            issues.append("Storage class not configured — pods may fail to provision persistent volumes")
            suggestions.append("Set storage_class to match your cluster's available storage classes")

        # Resource presets
        preset = config.get("resource_preset", "")
        if not preset:
            suggestions.append("No resource preset selected — consider 'small', 'medium', or 'large' based on workload")
        elif preset == "small" and controller_replicas >= 3:
            suggestions.append("Small resource preset with 3+ replicas may be under-provisioned — consider 'medium' or 'large'")

        # Ingress type
        ingress = config.get("ingress_type", "")
        if not ingress:
            suggestions.append("Ingress type not specified — will use default Route")

        return issues, suggestions

    async def suggest_from_natural_language(
        self,
        prompt: str,
        current_config: dict
    ) -> dict:
        """
        Natural language config assistant.

        Takes a user prompt like "I want HA with 3 controller nodes" and returns
        suggested config changes.

        Returns:
            {
                "changes": dict,        # Partial config to merge
                "explanation": str      # Plain language explanation
            }
        """
        # Use AI if available, otherwise fall back to rule-based
        if self.available:
            return await self._ai_suggest(prompt, current_config)
        else:
            return self._rule_based_suggest(prompt, current_config)

    def _rule_based_suggest(self, prompt: str, current_config: dict) -> dict:
        """Rule-based natural language processing for common requests."""
        prompt_lower = prompt.lower()
        platform = current_config.get("platform", "containerized")
        changes = {}
        explanation = ""

        # Detect intent
        if any(word in prompt_lower for word in ["ha", "high availability", "redundan"]):
            if platform == "ocp":
                changes = {
                    "components": {
                        "controller": {"replicas": 3},
                        "hub": {"replicas": 2},
                        "eda": {"replicas": 2},
                    },
                    "resource_preset": "large",
                }
                explanation = "Configured for high availability: 3 controller replicas, 2 hub replicas, 2 EDA replicas, large resource preset"
            else:
                changes = {
                    "topology": "enterprise",
                }
                explanation = "Switched to enterprise topology for high availability multi-node deployment"

        elif any(word in prompt_lower for word in ["minimal", "dev", "development", "test", "small"]):
            if platform == "ocp":
                changes = {
                    "components": {
                        "controller": {"replicas": 1},
                        "hub": {"replicas": 1},
                        "eda": {"replicas": 1},
                    },
                    "resource_preset": "small",
                }
                explanation = "Configured for minimal dev/test environment: single replicas, small resource preset"
            else:
                changes = {
                    "topology": "growth",
                }
                explanation = "Switched to growth topology for single-node development deployment"

        elif any(word in prompt_lower for word in ["production", "prod", "enterprise"]):
            if platform == "ocp":
                changes = {
                    "components": {
                        "controller": {"replicas": 3},
                        "hub": {"replicas": 2},
                        "eda": {"replicas": 2},
                    },
                    "resource_preset": "large",
                }
                explanation = "Configured for production: 3 controller replicas, 2 hub/EDA replicas, large resources"
            else:
                changes = {
                    "topology": "enterprise",
                    "bundle_type": "online",
                }
                explanation = "Configured for production enterprise deployment"

        elif "3 controller" in prompt_lower or "three controller" in prompt_lower:
            if platform == "ocp":
                changes = {
                    "components": {
                        "controller": {"replicas": 3},
                    }
                }
                explanation = "Set controller replicas to 3"
            else:
                explanation = "For containerized deployments, use enterprise topology with 3 hosts"
                changes = {"topology": "enterprise"}

        elif any(word in prompt_lower for word in ["storage", "persistent", "pv", "pvc"]):
            if platform == "ocp":
                changes = {
                    "storage_class": "gp3-csi",  # Common AWS storage class
                }
                explanation = "Set storage class to 'gp3-csi' (adjust based on your cluster's available storage classes)"
            else:
                explanation = "Storage is managed automatically for containerized deployments"

        elif any(word in prompt_lower for word in ["namespace", "project"]):
            if platform == "ocp":
                # Try to extract namespace from prompt
                words = prompt.split()
                ns = None
                for i, word in enumerate(words):
                    if word.lower() in ["namespace", "project"] and i + 1 < len(words):
                        ns = words[i + 1].strip("'\"")
                        break
                if ns:
                    changes = {"namespace": ns}
                    explanation = f"Set namespace to '{ns}'"
                else:
                    explanation = "Please specify the namespace name in your request"
            else:
                explanation = "Namespaces are only applicable to OpenShift deployments"

        else:
            explanation = "I didn't recognize that request. Try: 'high availability', 'minimal dev setup', 'production ready', or '3 controller nodes'"

        return {
            "changes": changes,
            "explanation": explanation,
        }

    async def _ai_suggest(self, prompt: str, current_config: dict) -> dict:
        """Use Azure OpenAI to interpret natural language config requests."""
        platform = current_config.get("platform", "containerized")

        user_msg = f"""\
The user is configuring an AAP {platform} deployment and said:

"{prompt}"

Current config summary:
- Platform: {platform}
- Topology: {current_config.get('topology', 'not set')}
- OCP replicas: {current_config.get('components', {}).get('controller', {}).get('replicas', 'N/A')}

Return ONLY a JSON object with this structure:
{{
  "changes": {{"key": "value"}},
  "explanation": "Brief explanation"
}}

The changes object should contain config keys to update. Keep it minimal.
"""

        url = (
            f"{self.endpoint}/openai/deployments/{self.model}"
            f"/chat/completions?api-version={AZURE_OPENAI_API_VERSION}"
        )
        headers = {"api-key": self.api_key, "Content-Type": "application/json"}
        payload = {
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            "max_tokens": 500,
            "temperature": 0.3,
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code != 200:
                    logger.error("AI API error %s: %s", resp.status_code, resp.text[:200])
                    return self._rule_based_suggest(prompt, current_config)

                data = resp.json()
                content = data["choices"][0]["message"]["content"]

                # Try to parse as JSON
                import json
                # Strip markdown code blocks if present
                content = content.strip()
                if content.startswith("```"):
                    lines = content.split("\n")
                    content = "\n".join(lines[1:-1])

                result = json.loads(content)
                return result
        except Exception as exc:
            logger.exception("AI suggest error")
            return self._rule_based_suggest(prompt, current_config)

    async def get_contextual_help(self, step: str, config: dict) -> str:
        """
        Returns context-aware guidance for the current wizard step.
        Platform-aware — different tips for OCP vs containerized.

        Args:
            step: Current wizard step (e.g., "topology", "network", "ocp_connection")
            config: Current config dict

        Returns:
            Helpful guidance string (markdown formatted)
        """
        platform = config.get("platform", "containerized")

        # Step-specific guidance
        if step == "topology":
            if platform == "containerized":
                return """\
**Topology Selection**
- **Growth**: Single-node deployment, ideal for development/testing
- **Enterprise**: Multi-node HA deployment, requires 3+ hosts for production

Choose growth for simple setups, enterprise for production HA.
"""
            else:
                return """\
**Topology (OCP)**
- Configure replica counts for each component
- 1 replica = no HA (dev/test)
- 3+ replicas = HA (production)

Set replicas based on your availability requirements.
"""

        elif step == "network":
            if platform == "containerized":
                return """\
**Network Configuration**
- HTTPS port: Default 443 (standard HTTPS)
- FQDN: Fully qualified domain name for access
- DNS must resolve FQDN to target host IP

Ensure firewall allows traffic on the configured port.
"""
            else:
                return """\
**Network Configuration (OCP)**
- Ingress type: Route (default) or LoadBalancer
- Routes are automatically created by OpenShift
- External FQDN configured via route host

DNS is managed by cluster ingress controller.
"""

        elif step == "database":
            if platform == "containerized":
                return """\
**Database Configuration**
- **Internal**: Managed PostgreSQL container (recommended)
- **External**: Use existing PostgreSQL 15+ instance

Use internal for simplicity, external for shared DB or compliance.
"""
            else:
                return """\
**Database Configuration (OCP)**
- Database is deployed as a container by default
- Configure persistent storage for PostgreSQL
- External DB supported via advanced settings

Ensure storage class provides persistent volumes.
"""

        elif step == "resources":
            if platform == "ocp":
                return """\
**Resource Presets (OCP)**
- **Small**: Dev/test (2 CPU, 4GB RAM per pod)
- **Medium**: Production light (4 CPU, 8GB RAM)
- **Large**: Production HA (8 CPU, 16GB RAM)

Match preset to expected workload and node capacity.
"""
            else:
                return """\
**Resource Requirements (Containerized)**
- Minimum: 4 CPU, 16GB RAM, 40GB disk
- Recommended: 8 CPU, 32GB RAM, 100GB disk
- Enterprise: 16+ CPU, 64GB+ RAM per node

Check target host meets requirements before deploying.
"""

        elif step == "storage":
            if platform == "ocp":
                return """\
**Storage Configuration (OCP)**
- Storage class must exist in cluster
- Check available classes: `oc get storageclass`
- Typical sizes: 20GB automation-hub, 10GB PostgreSQL, 5GB controller

Ensure sufficient cluster storage capacity.
"""
            else:
                return """\
**Storage (Containerized)**
- Storage managed automatically in /opt or /home
- Podman storage uses overlay2 by default
- Minimum 40GB free space required

Installer will check and relocate storage if needed.
"""

        elif step == "ocp_connection":
            return """\
**OpenShift Connection**
- API URL: Your cluster API endpoint (e.g., https://api.cluster.example.com:6443)
- Token: Service account token or user token with cluster-admin

Get token: `oc whoami -t` or create service account.
"""

        elif step == "ssl":
            if platform == "containerized":
                return """\
**SSL/TLS Certificates**
- **Self-signed**: Generated automatically (dev/test)
- **Custom**: Upload your CA-signed certificates (production)

Self-signed certs will trigger browser warnings.
"""
            else:
                return """\
**SSL/TLS Certificates (OCP)**
- OpenShift routes use cluster's default TLS
- Custom certs via route annotations or secrets
- Let's Encrypt supported via cert-manager

Default cluster certs are usually sufficient.
"""

        elif step == "review":
            return f"""\
**Deployment Review**
- Platform: {platform.upper()}
- Review all settings before deploying
- Use AI review for automated config validation
- Download config for backup

You can save this config as a profile for reuse.
"""

        else:
            return f"Configure settings for the {step} step."
