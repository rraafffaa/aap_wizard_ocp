"""Notification service for deployment events.

Sends notifications via webhooks when deployments start,
complete, fail, or require attention.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class NotificationConfig:
    webhook_url: str = ""
    enabled: bool = False
    events: list[str] = field(default_factory=lambda: ["deploy_complete", "deploy_fail"])
    include_config: bool = False
    include_logs: bool = False
    headers: dict = field(default_factory=dict)


@dataclass
class Notification:
    id: str
    event: str
    timestamp: float
    title: str
    message: str
    severity: str  # info, success, warning, error
    metadata: dict = field(default_factory=dict)
    delivered: bool = False
    delivery_error: str = ""


class NotificationService:
    def __init__(self, config: Optional[NotificationConfig] = None):
        self._config = config or NotificationConfig()
        self._history: list[Notification] = []
        self._max_history = 200

    async def notify(self, event: str, title: str, message: str,
                      severity: str = "info",
                      metadata: Optional[dict] = None) -> Notification:
        notification = Notification(
            id=str(uuid.uuid4()),
            event=event,
            timestamp=time.time(),
            title=title,
            message=message,
            severity=severity,
            metadata=metadata or {},
        )

        if self._config.enabled and event in self._config.events:
            delivered = await self.send_webhook(notification)
            notification.delivered = delivered

        self._history.append(notification)
        if len(self._history) > self._max_history:
            self._history = self._history[-self._max_history:]

        logger.info(
            "Notification [%s] %s: %s (delivered=%s)",
            severity, event, title, notification.delivered,
        )
        return notification

    async def send_webhook(self, notification: Notification) -> bool:
        if not self._config.webhook_url:
            notification.delivery_error = "No webhook URL configured"
            return False

        url = self._config.webhook_url.lower()

        if "hooks.slack.com" in url:
            payload = self._format_slack_payload(notification)
        elif "webhook.office.com" in url or "microsoft.com" in url:
            payload = self._format_teams_payload(notification)
        else:
            payload = self._format_generic_payload(notification)

        headers = {"Content-Type": "application/json"}
        headers.update(self._config.headers)

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    self._config.webhook_url,
                    json=payload,
                    headers=headers,
                )
                if resp.status_code < 300:
                    return True
                notification.delivery_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                logger.warning("Webhook delivery failed: %s", notification.delivery_error)
                return False
        except Exception as exc:
            notification.delivery_error = str(exc)
            logger.error("Webhook delivery error: %s", exc)
            return False

    async def notify_deploy_start(self, session_id: str, config: dict) -> None:
        meta = {"session_id": session_id}
        if self._config.include_config:
            safe = {k: v for k, v in config.items()
                    if not any(s in k.lower() for s in ("password", "secret", "token"))}
            meta["config"] = safe

        await self.notify(
            event="deploy_start",
            title="Deployment Started",
            message=(
                f"AAP deployment {session_id[:8]} has started. "
                f"Topology: {config.get('topology', 'N/A')}"
            ),
            severity="info",
            metadata=meta,
        )

    async def notify_deploy_complete(self, session_id: str, config: dict,
                                       duration_ms: int) -> None:
        mins = duration_ms // 60000
        secs = (duration_ms % 60000) // 1000
        host = config.get("target_host", "localhost")

        await self.notify(
            event="deploy_complete",
            title="Deployment Complete",
            message=(
                f"AAP deployment {session_id[:8]} completed successfully "
                f"in {mins}m {secs}s. Host: {host}"
            ),
            severity="success",
            metadata={
                "session_id": session_id,
                "duration_ms": duration_ms,
                "host": host,
            },
        )

    async def notify_deploy_fail(self, session_id: str, error: str,
                                   phase: str, config: dict) -> None:
        host = config.get("target_host", "localhost")
        await self.notify(
            event="deploy_fail",
            title="Deployment Failed",
            message=(
                f"AAP deployment {session_id[:8]} failed during '{phase}' phase. "
                f"Host: {host}. Error: {error[:300]}"
            ),
            severity="error",
            metadata={
                "session_id": session_id,
                "phase": phase,
                "error": error,
                "host": host,
            },
        )

    async def notify_health_alert(self, component: str, status: str,
                                    message: str) -> None:
        severity = "warning" if status == "degraded" else "error"
        await self.notify(
            event="health_alert",
            title=f"Health Alert: {component}",
            message=message,
            severity=severity,
            metadata={"component": component, "status": status},
        )

    def get_history(self, limit: int = 50) -> list[Notification]:
        return list(reversed(self._history[-limit:]))

    def update_config(self, config: NotificationConfig) -> None:
        self._config = config
        logger.info(
            "Notification config updated (enabled=%s, url=%s, events=%s)",
            config.enabled,
            config.webhook_url[:30] + "..." if len(config.webhook_url) > 30 else config.webhook_url,
            config.events,
        )

    def _format_slack_payload(self, notification: Notification) -> dict:
        severity_emoji = {
            "info": ":information_source:",
            "success": ":white_check_mark:",
            "warning": ":warning:",
            "error": ":x:",
        }
        emoji = severity_emoji.get(notification.severity, ":bell:")

        blocks = [
            {
                "type": "header",
                "text": {
                    "type": "plain_text",
                    "text": f"{emoji} {notification.title}",
                },
            },
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": notification.message,
                },
            },
        ]

        if notification.metadata:
            fields = []
            for k, v in list(notification.metadata.items())[:6]:
                if not isinstance(v, (dict, list)):
                    fields.append({"type": "mrkdwn", "text": f"*{k}:* {v}"})
            if fields:
                blocks.append({"type": "section", "fields": fields})

        return {"blocks": blocks, "text": notification.title}

    def _format_teams_payload(self, notification: Notification) -> dict:
        severity_color = {
            "info": "0078D4",
            "success": "00A36C",
            "warning": "FFA500",
            "error": "FF0000",
        }
        color = severity_color.get(notification.severity, "808080")

        facts = []
        for k, v in list(notification.metadata.items())[:8]:
            if not isinstance(v, (dict, list)):
                facts.append({"name": k, "value": str(v)})

        return {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "themeColor": color,
            "summary": notification.title,
            "sections": [
                {
                    "activityTitle": notification.title,
                    "activitySubtitle": f"AAP Deployment Wizard | {notification.event}",
                    "facts": facts,
                    "text": notification.message,
                    "markdown": True,
                },
            ],
        }

    def _format_generic_payload(self, notification: Notification) -> dict:
        return {
            "id": notification.id,
            "event": notification.event,
            "timestamp": notification.timestamp,
            "title": notification.title,
            "message": notification.message,
            "severity": notification.severity,
            "metadata": notification.metadata,
            "source": "aap-deployment-wizard",
        }
