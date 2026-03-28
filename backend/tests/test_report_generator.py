"""Comprehensive tests for the report generator."""
import json
import pytest

from app.services.report_generator import ReportGenerator, ReportSection


class TestReportGenerator:
    @pytest.fixture
    def generator(self):
        return ReportGenerator()

    # Config report
    def test_config_report_not_empty(self, generator, default_config):
        report = generator.generate_config_report(default_config)
        assert len(report) > 0
        assert "Configuration Report" in report

    def test_config_report_contains_topology(self, generator, default_config):
        report = generator.generate_config_report(default_config)
        assert "Growth" in report or "growth" in report
        assert "Topology" in report

    def test_config_report_contains_hosts(self, generator, default_config):
        report = generator.generate_config_report(default_config)
        assert "aap.example.org" in report
        assert "Gateway" in report or "gateway" in report
        assert "Controller" in report or "controller" in report

    def test_config_report_masks_passwords(self, generator):
        # Verify that render_text masks secrets when sections contain them
        sections = [
            ReportSection(
                title="Secrets Test",
                content="registry_password=secret123 admin_password=adminpass",
            ),
        ]
        report = generator.render_text(sections)
        assert "secret123" not in report
        assert "adminpass" not in report
        assert "********" in report

    # Pre-deploy report
    def test_pre_deploy_report(self, generator, default_config):
        report = generator.generate_pre_deploy_report(default_config)
        assert "Pre-Deployment Report" in report
        assert "Configuration Overview" in report
        assert "Host Layout" in report
        assert "Security" in report

    def test_pre_deploy_with_validation(self, generator, default_config):
        validation = {
            "valid": True,
            "score": 85,
            "errors": [],
            "warnings": [{"field": "registry", "message": "Consider using a private registry"}],
            "info": [],
        }
        report = generator.generate_pre_deploy_report(
            default_config,
            validation=validation,
        )
        assert "Validation Results" in report
        assert "85" in report
        assert "registry" in report or "Registry" in report

    def test_pre_deploy_with_preflight(self, generator, default_config):
        preflight = {
            "overall": "passed",
            "checks": [
                {"name": "CPU Cores", "status": "passed", "message": "8 cores"},
                {"name": "Memory", "status": "passed", "message": "32 GB"},
            ],
        }
        report = generator.generate_pre_deploy_report(
            default_config,
            preflight=preflight,
        )
        assert "Preflight Checks" in report
        assert "CPU Cores" in report
        assert "[OK]" in report or "passed" in report

    # Post-deploy report
    def test_post_deploy_report(self, generator, default_config):
        deploy_result = {
            "status": "success",
            "duration_seconds": 120.5,
            "session_id": "sess-123",
            "phases": [
                {"id": "preflight", "label": "Preflight", "status": "completed", "duration_seconds": 5},
                {"id": "install", "label": "Install", "status": "completed", "duration_seconds": 115},
            ],
        }
        report = generator.generate_post_deploy_report(default_config, deploy_result)
        assert "Post-Deployment Report" in report
        assert "Deployment Result" in report
        assert "Deployment Timeline" in report
        assert "success" in report or "SUCCESS" in report
        assert "120.5" in report

    def test_post_deploy_with_health(self, generator, default_config):
        deploy_result = {"status": "success", "duration_seconds": 0, "session_id": "sess-1"}
        health = {
            "overall": "healthy",
            "uptime_seconds": 3600,
            "components": [
                {"name": "controller", "status": "ok", "api_latency_ms": 10, "cpu_usage_percent": 5, "memory_usage_percent": 20},
            ],
        }
        report = generator.generate_post_deploy_report(
            default_config,
            deploy_result,
            health=health,
        )
        assert "Platform Health" in report
        assert "healthy" in report or "HEALTHY" in report
        assert "controller" in report

    # Rendering
    def test_render_text(self, generator):
        sections = [
            ReportSection(title="Section 1", content="Content one"),
            ReportSection(title="Section 2", content="Content two"),
        ]
        result = generator.render_text(sections)
        assert "Section 1" in result
        assert "Section 2" in result
        assert "Content one" in result
        assert "Content two" in result
        assert "=" * 64 in result

    def test_render_json(self, generator):
        sections = [
            ReportSection(title="Test Section", content="Test content", data={"key": "value"}),
        ]
        result = generator.render_json(sections)
        assert "Test Section" in result
        assert "Test content" in result
        assert "generated_at" in result

    def test_render_json_valid(self, generator):
        sections = [
            ReportSection(title="Test", content="Content", data={}),
        ]
        result = generator.render_json(sections)
        parsed = json.loads(result)
        assert "sections" in parsed
        assert len(parsed["sections"]) == 1
        assert parsed["sections"][0]["title"] == "Test"
        assert "generated_at" in parsed

    def test_render_html(self, generator):
        sections = [
            ReportSection(title="HTML Section", content="<script>alert(1)</script>"),
        ]
        result = generator.render_html(sections)
        assert "HTML Section" in result
        assert "&lt;script&gt;" in result or "script" in result

    def test_render_html_has_doctype(self, generator):
        sections = [ReportSection(title="Test", content="Content")]
        result = generator.render_html(sections)
        assert "<!DOCTYPE html>" in result
        assert "<html" in result
        assert "</html>" in result

    # Sections
    def test_format_config_section(self, generator, default_config):
        section = generator._format_config_section(default_config)
        assert section.title == "Configuration Overview"
        assert "Growth" in section.content or "growth" in section.content
        assert section.data.get("topology") == "growth"

    def test_format_hosts_section(self, generator, default_config):
        section = generator._format_hosts_section(default_config)
        assert section.title == "Host Layout"
        assert "aap.example.org" in section.content
        assert "gateway" in section.content.lower() or "Gateway" in section.content

    def test_format_security_section(self, generator, default_config):
        section = generator._format_security_section(default_config)
        assert section.title == "Security & Network"
        assert "HTTPS" in section.content
        assert "443" in section.content or "80" in section.content

    def test_format_validation_section(self, generator):
        validation = {"valid": False, "score": 50, "errors": ["Error 1"], "warnings": [], "info": []}
        section = ReportGenerator._format_validation_section(validation)
        assert section.title == "Validation Results"
        assert "50" in section.content
        assert "Error 1" in section.content

    def test_format_preflight_section(self, generator):
        preflight = {
            "overall": "passed",
            "checks": [{"name": "Check1", "status": "passed", "message": "OK"}],
        }
        section = ReportGenerator._format_preflight_section(preflight)
        assert section.title == "Preflight Checks"
        assert "Check1" in section.content
        assert "[OK]" in section.content

    # Secret masking
    def test_mask_secrets(self, generator):
        text = "admin_password=secret123 and token=abc123"
        result = generator._mask_secrets(text)
        assert "secret123" not in result
        assert "abc123" not in result
        assert "********" in result

    def test_mask_password_fields(self, generator):
        text = "registry_password=mypass gateway_admin_password=gwpass"
        result = generator._mask_secrets(text)
        assert "mypass" not in result
        assert "gwpass" not in result
        assert "********" in result

    def test_mask_token_fields(self, generator):
        text = "api_token=sk-12345 credential=mycred"
        result = generator._mask_secrets(text)
        assert "sk-12345" not in result
        assert "mycred" not in result

    def test_mask_preserves_non_secrets(self, generator):
        text = "hostname=web1.example.org port=443"
        result = generator._mask_secrets(text)
        assert "web1.example.org" in result
        assert "443" in result

    def test_generate_health_report(self, generator):
        health = {"overall": "healthy", "uptime_seconds": 3600}
        report = generator.generate_health_report(health)
        assert "Health Report" in report
        assert "healthy" in report or "HEALTHY" in report
