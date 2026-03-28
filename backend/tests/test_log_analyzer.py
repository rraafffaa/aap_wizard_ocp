"""Tests for the Ansible log analyzer service."""
import json

import pytest

from app.services.log_analyzer import (
    LogAnalyzer,
    TaskResult,
    AnsibleTask,
    PlayRecap,
)

SAMPLE_ANSIBLE_OUTPUT = """
PLAY [Install AAP Containerized] ************

TASK [Gathering Facts] ************
ok: [aap.example.org]

TASK [ansible.containerized_installer.preflight : Check OS version] ************
ok: [aap.example.org]

TASK [ansible.containerized_installer.preflight : Check Python version] ************
ok: [aap.example.org]

TASK [ansible.containerized_installer.common : Install podman] ************
changed: [aap.example.org]

TASK [ansible.containerized_installer.common : Pull images] ************
fatal: [aap.example.org]: FAILED! => {"msg": "Error pulling image: unauthorized"}

TASK [ansible.containerized_installer.common : Retry pull] ************
skipping: [aap.example.org]

PLAY RECAP ************
aap.example.org : ok=3 changed=1 unreachable=0 failed=1 skipped=1 rescued=0 ignored=0
"""


class TestLogAnalyzer:
    @pytest.fixture
    def analyzer(self):
        return LogAnalyzer()

    @pytest.fixture
    def parsed(self, analyzer):
        return analyzer.parse_log(SAMPLE_ANSIBLE_OUTPUT)

    def test_parse_play(self, analyzer):
        event = analyzer.parse_line("PLAY [Install AAP] ********")
        assert event is not None
        assert event["event"] == "play_start"
        assert "Install AAP" in event["play"]

    def test_parse_task(self, analyzer):
        analyzer.parse_line("PLAY [Test] ********")
        event = analyzer.parse_line("TASK [Gathering Facts] ********")
        assert event is not None
        assert event["event"] == "task_start"
        assert "Gathering Facts" in event["task"]

    def test_parse_ok(self, analyzer):
        analyzer.parse_line("PLAY [Test] ********")
        analyzer.parse_line("TASK [Gathering Facts] ********")
        event = analyzer.parse_line("ok: [host1]")
        assert event is not None
        assert event["event"] == "ok"
        assert event["host"] == "host1"

    def test_parse_changed(self, analyzer):
        analyzer.parse_line("PLAY [Test] ********")
        analyzer.parse_line("TASK [Install package] ********")
        event = analyzer.parse_line("changed: [host1]")
        assert event is not None
        assert event["event"] == "changed"
        assert event["host"] == "host1"

    def test_parse_failed(self, analyzer):
        analyzer.parse_line("PLAY [Test] ********")
        analyzer.parse_line("TASK [Pull image] ********")
        event = analyzer.parse_line('fatal: [host1]: FAILED! => {"msg": "Error pulling image: unauthorized"}')
        assert event is not None
        assert event["event"] == "failed"
        assert event["host"] == "host1"
        assert "unauthorized" in event.get("msg", "")

    def test_parse_skipped(self, analyzer):
        analyzer.parse_line("PLAY [Test] ********")
        analyzer.parse_line("TASK [Retry] ********")
        event = analyzer.parse_line("skipping: [host1]")
        assert event is not None
        assert event["event"] == "skipped"
        assert event["host"] == "host1"

    def test_parse_recap(self, analyzer):
        analyzer.parse_line("PLAY [Test] ********")
        event = analyzer.parse_line("host1 : ok=5 changed=2 unreachable=0 failed=0 skipped=1 rescued=0 ignored=0")
        assert event is not None
        assert event["event"] == "recap"
        assert event["host"] == "host1"
        assert event["ok"] == 5
        assert event["failed"] == 0

    def test_parse_full_log(self, parsed):
        assert len(parsed) >= 1
        assert parsed[0].play_name == "Install AAP Containerized"
        assert len(parsed[0].tasks) >= 4
        assert len(parsed[0].recaps) >= 1

    def test_summary_total_tasks(self, analyzer, parsed):
        summary = analyzer.get_summary()
        assert summary["total_tasks"] >= 4
        assert summary["plays"] >= 1

    def test_summary_failed_count(self, analyzer, parsed):
        summary = analyzer.get_summary()
        assert summary["failed"] >= 1
        assert summary["has_failures"] is True

    def test_summary_changed_count(self, analyzer, parsed):
        summary = analyzer.get_summary()
        assert summary["changed"] >= 1

    def test_get_failures(self, analyzer, parsed):
        failures = analyzer.get_failures()
        assert len(failures) >= 1
        assert failures[0].result == TaskResult.FAILED

    def test_failure_has_host(self, analyzer, parsed):
        failures = analyzer.get_failures()
        assert len(failures) >= 1
        assert failures[0].host == "aap.example.org"

    def test_failure_has_message(self, analyzer, parsed):
        failures = analyzer.get_failures()
        assert len(failures) >= 1
        assert "unauthorized" in failures[0].msg or "Error" in failures[0].msg

    def test_get_changes(self, analyzer, parsed):
        changes = analyzer.get_changes()
        assert len(changes) >= 1
        assert changes[0].result == TaskResult.CHANGED

    def test_host_summary(self, analyzer, parsed):
        host_summary = analyzer.get_host_summary()
        assert "aap.example.org" in host_summary
        counts = host_summary["aap.example.org"]
        assert "ok" in counts or "failed" in counts

    def test_suggest_fixes_unauthorized(self, analyzer):
        task = AnsibleTask(
            name="Pull image",
            host="host1",
            result=TaskResult.FAILED,
            msg="Error pulling image: unauthorized",
        )
        suggestions = analyzer.suggest_fixes(task)
        assert len(suggestions) >= 1
        assert any("permission" in s.lower() or "sudo" in s.lower() or "privilege" in s.lower() for s in suggestions)

    def test_suggest_fixes_disk_space(self, analyzer):
        task = AnsibleTask(
            name="Write file",
            host="host1",
            result=TaskResult.FAILED,
            msg="no space left on device",
        )
        suggestions = analyzer.suggest_fixes(task)
        assert len(suggestions) >= 1
        assert any("disk" in s.lower() or "space" in s.lower() for s in suggestions)

    def test_suggest_fixes_permission(self, analyzer):
        task = AnsibleTask(
            name="Create dir",
            host="host1",
            result=TaskResult.FAILED,
            msg="permission denied",
        )
        suggestions = analyzer.suggest_fixes(task)
        assert len(suggestions) >= 1
        assert any("permission" in s.lower() or "sudo" in s.lower() for s in suggestions)

    def test_export_text(self, analyzer, parsed):
        report = analyzer.export_report("text")
        assert "Ansible Playbook" in report
        assert "FAILURES" in report or "Summary" in report or "Plays" in report

    def test_export_json(self, analyzer, parsed):
        report = analyzer.export_report("json")
        data = json.loads(report)
        assert "summary" in data
        assert "failures" in data
        assert data["summary"]["has_failures"] is True

    def test_export_html(self, analyzer, parsed):
        report = analyzer.export_report("html")
        assert "<html" in report
        assert "Ansible Playbook" in report
        assert "</body>" in report

    def test_empty_log(self, analyzer):
        parsed = analyzer.parse_log("")
        assert len(parsed) == 0
        summary = analyzer.get_summary()
        assert summary["total_tasks"] == 0
        assert summary["has_failures"] is False

    def test_partial_log(self, analyzer):
        partial = "PLAY [Test] ***\nTASK [Facts] ***\nok: [host1]"
        parsed = analyzer.parse_log(partial)
        assert len(parsed) >= 1
        assert len(parsed[0].tasks) >= 1

    def test_unicode_in_output(self, analyzer):
        log = "PLAY [Test] ***\nTASK [Facts] ***\nok: [host1]\n"
        log += "fatal: [host1]: FAILED! => {\"msg\": \"Error: café résumé\"}"
        parsed = analyzer.parse_log(log)
        assert len(parsed) >= 1
        failures = analyzer.get_failures()
        assert len(failures) >= 1


class TestLinePatterns:
    def test_play_pattern(self):
        import re
        pattern = re.compile(r"^PLAY \[(.+?)\]")
        m = pattern.match("PLAY [Install AAP] ********")
        assert m is not None
        assert m.group(1) == "Install AAP"

    def test_task_pattern(self):
        import re
        pattern = re.compile(r"^TASK \[(.+?)\]")
        m = pattern.match("TASK [Gathering Facts] ********")
        assert m is not None
        assert m.group(1) == "Gathering Facts"

    def test_ok_pattern(self):
        import re
        pattern = re.compile(r"^ok: \[(.+?)\](.*)")
        m = pattern.match("ok: [aap.example.org]")
        assert m is not None
        assert m.group(1) == "aap.example.org"

    def test_changed_pattern(self):
        import re
        pattern = re.compile(r"^changed: \[(.+?)\](.*)")
        m = pattern.match("changed: [host1]")
        assert m is not None
        assert m.group(1) == "host1"

    def test_fatal_pattern(self):
        import re
        pattern = re.compile(r"^fatal: \[(.+?)\]:.*?=>\s*(.+)", re.DOTALL)
        m = pattern.match('fatal: [host1]: FAILED! => {"msg": "error"}')
        assert m is not None
        assert m.group(1) == "host1"

    def test_recap_pattern(self):
        import re
        pattern = re.compile(
            r"^(\S+)\s+:\s+ok=(\d+)\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)"
            r"(?:\s+skipped=(\d+))?(?:\s+rescued=(\d+))?(?:\s+ignored=(\d+))?"
        )
        m = pattern.match("host1 : ok=5 changed=2 unreachable=0 failed=0 skipped=1 rescued=0 ignored=0")
        assert m is not None
        assert m.group(1) == "host1"
        assert m.group(2) == "5"
        assert m.group(5) == "0"
