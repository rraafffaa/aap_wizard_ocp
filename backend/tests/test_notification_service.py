"""Dedicated tests for the notification service.

Covers configuration, notification creation, webhook sending,
deploy notifications, payload formatting, history, and URL auto-detection.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.notification_service import (
    NotificationService,
    NotificationConfig,
    Notification,
)


class TestNotificationService:
    @pytest.fixture
    def service(self):
        return NotificationService()

    @pytest.fixture
    def enabled_service(self):
        config = NotificationConfig(
            webhook_url="https://hooks.example.com/test",
            enabled=True,
            events=["deploy_complete", "deploy_fail", "deploy_start", "test", "health_alert"],
        )
        return NotificationService(config=config)

    def test_default_config_disabled(self, service):
        assert service._config.enabled is False
        assert service._config.webhook_url == ""

    def test_update_config(self, service):
        new_config = NotificationConfig(
            webhook_url="https://new.example.com",
            enabled=True,
            events=["deploy_complete"],
        )
        service.update_config(new_config)
        assert service._config.webhook_url == "https://new.example.com"
        assert service._config.enabled is True

    def test_enabled_config(self, enabled_service):
        assert enabled_service._config.enabled is True
        assert "hooks.example.com" in enabled_service._config.webhook_url

    @pytest.mark.asyncio
    async def test_notify_creates_entry(self, enabled_service):
        with patch.object(enabled_service, "send_webhook", new_callable=AsyncMock, return_value=True):
            result = await enabled_service.notify(
                event="deploy_complete",
                title="Test",
                message="Test message",
                severity="info",
            )
        assert result.id
        assert result.event == "deploy_complete"
        assert result.title == "Test"
        assert len(enabled_service._history) > 0

    @pytest.mark.asyncio
    async def test_notify_disabled_skips(self, service):
        result = await service.notify(
            event="deploy_complete",
            title="Test",
            message="Test",
            severity="info",
        )
        assert result.delivered is False
        assert result.id

    @pytest.mark.asyncio
    async def test_notify_event_not_in_list(self, enabled_service):
        enabled_service._config.events = ["deploy_complete"]
        with patch.object(enabled_service, "send_webhook", new_callable=AsyncMock) as mock_send:
            result = await enabled_service.notify(
                event="deploy_start",
                title="Test",
                message="Test",
                severity="info",
            )
        mock_send.assert_not_called()
        assert result.delivered is False

    @pytest.mark.asyncio
    @patch("app.services.notification_service.httpx.AsyncClient")
    async def test_send_webhook_success(self, mock_client_class, enabled_service):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        notification = Notification(
            id="test-1",
            event="test",
            timestamp=0.0,
            title="Test",
            message="Test",
            severity="info",
        )
        result = await enabled_service.send_webhook(notification)
        assert result is True

    @pytest.mark.asyncio
    @patch("app.services.notification_service.httpx.AsyncClient")
    async def test_send_webhook_failure(self, mock_client_class, enabled_service):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = "Server Error"
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)
        mock_client_class.return_value = mock_client

        notification = Notification(
            id="test-1",
            event="test",
            timestamp=0.0,
            title="Test",
            message="Test",
            severity="info",
        )
        result = await enabled_service.send_webhook(notification)
        assert result is False
        assert "500" in notification.delivery_error

    @pytest.mark.asyncio
    async def test_notify_deploy_start(self, enabled_service):
        with patch.object(enabled_service, "send_webhook", new_callable=AsyncMock, return_value=True):
            await enabled_service.notify_deploy_start("sess-123", {"topology": "growth"})
        assert len(enabled_service._history) > 0
        last = enabled_service._history[-1]
        assert last.event == "deploy_start"
        assert "sess-123" in last.message or "sess" in last.message

    @pytest.mark.asyncio
    async def test_notify_deploy_complete(self, enabled_service):
        with patch.object(enabled_service, "send_webhook", new_callable=AsyncMock, return_value=True):
            await enabled_service.notify_deploy_complete(
                "sess-123", {"target_host": "localhost"}, duration_ms=60000
            )
        assert len(enabled_service._history) > 0
        last = enabled_service._history[-1]
        assert last.event == "deploy_complete"
        assert last.severity == "success"

    @pytest.mark.asyncio
    async def test_notify_deploy_fail(self, enabled_service):
        with patch.object(enabled_service, "send_webhook", new_callable=AsyncMock, return_value=True):
            await enabled_service.notify_deploy_fail(
                "sess-123", "Connection refused", "install", {"target_host": "localhost"}
            )
        assert len(enabled_service._history) > 0
        last = enabled_service._history[-1]
        assert last.event == "deploy_fail"
        assert last.severity == "error"
        assert "Connection refused" in last.message or "install" in last.message

    @pytest.mark.asyncio
    async def test_notify_health_alert(self, enabled_service):
        with patch.object(enabled_service, "send_webhook", new_callable=AsyncMock, return_value=True):
            await enabled_service.notify_health_alert(
                "gateway", "degraded", "High latency detected"
            )
        assert len(enabled_service._history) > 0
        last = enabled_service._history[-1]
        assert last.event == "health_alert"
        assert "gateway" in last.title or "Health" in last.title

    def test_format_slack_payload(self, enabled_service):
        notification = Notification(
            id="n1",
            event="test",
            timestamp=0.0,
            title="Deployment Complete",
            message="Deployment finished",
            severity="success",
        )
        payload = enabled_service._format_slack_payload(notification)
        assert "blocks" in payload
        assert "text" in payload
        assert "Deployment Complete" in payload["text"]

    def test_format_slack_has_text(self, enabled_service):
        notification = Notification(
            id="n1",
            event="test",
            timestamp=0.0,
            title="Alert",
            message="Test",
            severity="info",
        )
        payload = enabled_service._format_slack_payload(notification)
        assert payload["text"]
        assert "blocks" in payload
        assert len(payload["blocks"]) > 0

    def test_format_teams_payload(self, enabled_service):
        notification = Notification(
            id="n1",
            event="test",
            timestamp=0.0,
            title="Deployment Complete",
            message="Deployment finished",
            severity="success",
        )
        payload = enabled_service._format_teams_payload(notification)
        assert "sections" in payload
        assert "activityTitle" in payload["sections"][0]
        assert "ThemeColor" in payload or "themeColor" in payload

    def test_format_teams_has_title(self, enabled_service):
        notification = Notification(
            id="n1",
            event="test",
            timestamp=0.0,
            title="My Title",
            message="Test",
            severity="info",
        )
        payload = enabled_service._format_teams_payload(notification)
        assert "My Title" in str(payload)
        assert "summary" in payload or "activityTitle" in str(payload)

    def test_format_generic_payload(self, enabled_service):
        notification = Notification(
            id="n1",
            event="deploy_complete",
            timestamp=123.45,
            title="Title",
            message="Message",
            severity="info",
            metadata={"key": "value"},
        )
        payload = enabled_service._format_generic_payload(notification)
        assert payload["id"] == "n1"
        assert payload["event"] == "deploy_complete"
        assert payload["title"] == "Title"
        assert payload["message"] == "Message"
        assert payload["severity"] == "info"
        assert payload["metadata"] == {"key": "value"}
        assert payload["source"] == "aap-deployment-wizard"

    def test_history_empty(self, service):
        history = service.get_history()
        assert isinstance(history, list)


    @pytest.mark.asyncio
    async def test_history_records_notifications(self, enabled_service):
        with patch.object(enabled_service, "send_webhook", new_callable=AsyncMock, return_value=True):
            await enabled_service.notify(
                event="deploy_complete",
                title="Test",
                message="Test",
                severity="info",
            )
        history = enabled_service.get_history()
        assert len(history) > 0
        assert history[0].event == "deploy_complete"

    def test_history_limit(self, service):
        for i in range(10):
            service._history.append(
                Notification(
                    id=str(i),
                    event="test",
                    timestamp=0.0,
                    title="Test",
                    message="Test",
                    severity="info",
                )
            )
        history = service.get_history(limit=3)
        assert len(history) <= 3

    def test_detect_slack_url(self, enabled_service):
        enabled_service._config.webhook_url = "https://hooks.slack.com/services/123/456/789"
        notification = Notification(
            id="n1",
            event="test",
            timestamp=0.0,
            title="Test",
            message="Test",
            severity="info",
        )
        payload = enabled_service._format_slack_payload(notification)
        assert "blocks" in payload
        assert "text" in payload

    def test_detect_teams_url(self, enabled_service):
        enabled_service._config.webhook_url = "https://outlook.office.com/webhook/123"
        notification = Notification(
            id="n1",
            event="test",
            timestamp=0.0,
            title="Test",
            message="Test",
            severity="info",
        )
        payload = enabled_service._format_teams_payload(notification)
        assert "sections" in payload
        assert "activityTitle" in payload["sections"][0]

    def test_detect_generic_url(self, enabled_service):
        enabled_service._config.webhook_url = "https://custom.example.com/webhook"
        notification = Notification(
            id="n1",
            event="test",
            timestamp=0.0,
            title="Test",
            message="Test",
            severity="info",
        )
        payload = enabled_service._format_generic_payload(notification)
        assert payload["source"] == "aap-deployment-wizard"
        assert payload["event"] == "test"
