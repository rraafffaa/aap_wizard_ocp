"""AI-powered deployment error debugger using Azure OpenAI."""

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
You are an expert Red Hat Ansible Automation Platform (AAP) 2.6 deployment troubleshooter.
You specialize in the containerized installer (ansible.containerized_installer).

Key context:
- AAP 2.6 uses rootless Podman containers on RHEL 9
- The installer runs as a non-root user with ansible-playbook
- Components: Gateway, Controller, Hub (galaxy), EDA, PostgreSQL, Redis, Receptor
- Container images come from registry.redhat.io (requires authenticated podman login)
- The installer collection is ansible.containerized_installer
- Common issues: disk space, SELinux, firewall ports, podman storage, registry auth, DNS/FQDN, sudo permissions

When analyzing errors:
1. Identify the root cause from the Ansible task name and error message
2. Explain WHY it failed in plain language
3. Provide the exact commands to fix it (copy-pasteable)
4. Note any prerequisites or dependencies for the fix
5. If multiple possible causes exist, list them in order of likelihood

Keep responses concise and actionable. Use markdown formatting.
"""


class AIDebugger:
    """Diagnoses AAP deployment errors using Azure OpenAI."""

    def __init__(self):
        self.endpoint = AZURE_OPENAI_ENDPOINT.rstrip("/")
        self.api_key = AZURE_OPENAI_KEY
        self.model = AZURE_OPENAI_MODEL

    @property
    def available(self) -> bool:
        return bool(self.api_key and self.endpoint)

    async def diagnose(
        self,
        error_logs: str,
        config_summary: Optional[str] = None,
        max_tokens: int = 1500,
    ) -> dict:
        """Analyze deployment error logs and return diagnosis with fix suggestions."""
        if not self.available:
            return {
                "diagnosis": "AI debugger not configured — set AZURE_OPENAI_KEY.",
                "commands": [],
                "available": False,
            }

        # Build the user message with context
        user_msg = "Analyze this AAP 2.6 containerized deployment error and provide a fix:\n\n"
        if config_summary:
            user_msg += f"**Deployment config:**\n{config_summary}\n\n"
        user_msg += f"**Error logs (last lines):**\n```\n{error_logs[-3000:]}\n```"

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
            "max_tokens": max_tokens,
            "temperature": 0.3,
        }

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code != 200:
                    logger.error("AI API error %s: %s", resp.status_code, resp.text[:200])
                    return {
                        "diagnosis": f"AI service returned {resp.status_code}. Try again later.",
                        "commands": [],
                        "available": True,
                    }
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                commands = self._extract_commands(content)
                return {
                    "diagnosis": content,
                    "commands": commands,
                    "available": True,
                }
        except httpx.TimeoutException:
            return {
                "diagnosis": "AI service timed out. Check your network connection.",
                "commands": [],
                "available": True,
            }
        except Exception as exc:
            logger.exception("AI debugger error")
            return {
                "diagnosis": f"AI debugger error: {str(exc)[:200]}",
                "commands": [],
                "available": True,
            }

    def _extract_commands(self, text: str) -> list[str]:
        """Extract shell commands from markdown code blocks."""
        commands = []
        in_block = False
        current = []
        for line in text.split("\n"):
            if line.strip().startswith("```") and not in_block:
                in_block = True
                continue
            elif line.strip().startswith("```") and in_block:
                in_block = False
                if current:
                    commands.append("\n".join(current))
                    current = []
                continue
            if in_block:
                current.append(line)
        return commands

    def summarize_config(self, config: dict) -> str:
        """Create a brief config summary for AI context."""
        lines = [
            f"Topology: {config.get('topology', 'unknown')}",
            f"Installation: {config.get('installation_type', 'unknown')}",
            f"Target: {config.get('target_user', '')}@{config.get('target_host', '')}",
            f"HTTPS port: {config.get('network', {}).get('https_port', 443)}",
        ]
        return "\n".join(lines)
