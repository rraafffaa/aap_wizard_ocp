"""Log analyzer for Ansible playbook output.

Parses raw ansible-playbook output into structured events,
extracts task results, timing information, and failure details.
"""
import json
import logging
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class TaskResult(Enum):
    OK = "ok"
    CHANGED = "changed"
    FAILED = "failed"
    SKIPPED = "skipped"
    UNREACHABLE = "unreachable"
    RESCUED = "rescued"
    IGNORED = "ignored"


@dataclass
class AnsibleTask:
    name: str
    host: str
    result: TaskResult
    role: str = ""
    collection: str = ""
    module: str = ""
    duration_ms: int = 0
    changed: bool = False
    stdout: str = ""
    stderr: str = ""
    msg: str = ""
    item: str = ""
    loop_count: int = 0
    line_number: int = 0


@dataclass
class PlayRecap:
    host: str
    ok: int = 0
    changed: int = 0
    unreachable: int = 0
    failed: int = 0
    skipped: int = 0
    rescued: int = 0
    ignored: int = 0


@dataclass
class PlaybookRun:
    play_name: str
    tasks: list[AnsibleTask] = field(default_factory=list)
    recaps: list[PlayRecap] = field(default_factory=list)
    start_time: float = 0
    end_time: float = 0
    total_tasks: int = 0
    failed_tasks: int = 0
    changed_tasks: int = 0
    duration_seconds: float = 0


class LogAnalyzer:
    """Parses and analyzes Ansible playbook log output."""

    PLAY_PATTERN = re.compile(r"^PLAY \[(.+?)\]")
    TASK_PATTERN = re.compile(r"^TASK \[(.+?)\]")
    OK_PATTERN = re.compile(r"^ok: \[(.+?)\](.*)")
    CHANGED_PATTERN = re.compile(r"^changed: \[(.+?)\](.*)")
    FAILED_PATTERN = re.compile(r"^fatal: \[(.+?)\]:.*?=>\s*(.+)", re.DOTALL)
    SKIPPED_PATTERN = re.compile(r"^skipping: \[(.+?)\]")
    UNREACHABLE_PATTERN = re.compile(r"^fatal: \[(.+?)\]: UNREACHABLE")
    RESCUED_PATTERN = re.compile(r"^rescued: \[(.+?)\]")
    IGNORED_PATTERN = re.compile(r"^(?:ok|changed|fatal).*IGNORED", re.IGNORECASE)
    RECAP_PATTERN = re.compile(
        r"^(\S+)\s+:\s+ok=(\d+)\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)"
        r"(?:\s+skipped=(\d+))?(?:\s+rescued=(\d+))?(?:\s+ignored=(\d+))?"
    )
    ROLE_PATTERN = re.compile(r"^(.+?)\s*:\s*(.+)$")
    TIMING_PATTERN = re.compile(r"(?:real|elapsed)\s+(\d+)m\s*(\d+(?:\.\d+)?)s")
    ITEM_PATTERN = re.compile(r"=>\s*\(item=(.+?)\)")
    HANDLER_PATTERN = re.compile(r"^RUNNING HANDLER \[(.+?)\]")

    _ERROR_CATEGORIES = {
        "permission": [
            "permission denied", "access denied", "unauthorized", "forbidden",
            "sudo", "not permitted",
        ],
        "connectivity": [
            "connection refused", "connection timed out", "unreachable",
            "no route to host", "name or service not known", "network is unreachable",
        ],
        "missing_package": [
            "no such file or directory", "command not found", "package not found",
            "no matching distribution", "module not found",
        ],
        "configuration": [
            "invalid value", "syntax error", "configuration error",
            "missing required", "invalid option",
        ],
        "disk_space": [
            "no space left on device", "disk quota exceeded",
        ],
        "timeout": [
            "timed out", "timeout", "deadline exceeded",
        ],
        "certificate": [
            "certificate verify failed", "ssl", "tls", "x509",
        ],
        "dns": [
            "could not resolve", "name resolution", "dns",
        ],
    }

    def __init__(self):
        self._lines: list[str] = []
        self._runs: list[PlaybookRun] = []
        self._current_play: Optional[PlaybookRun] = None
        self._current_task_name: str = ""

    def parse_line(self, line: str) -> Optional[dict]:
        """Parse a single log line and return structured event if applicable."""
        stripped = line.strip()
        if not stripped:
            return None

        line_num = len(self._lines) + 1
        self._lines.append(line)

        m = self.PLAY_PATTERN.match(stripped)
        if m:
            play_name = m.group(1)
            if self._current_play:
                self._finalize_play()
            self._current_play = PlaybookRun(
                play_name=play_name, start_time=time.time()
            )
            return {"event": "play_start", "play": play_name, "line": line_num}

        m = self.TASK_PATTERN.match(stripped)
        if m:
            self._current_task_name = m.group(1)
            return {
                "event": "task_start",
                "task": self._current_task_name,
                "line": line_num,
            }

        m = self.HANDLER_PATTERN.match(stripped)
        if m:
            self._current_task_name = m.group(1)
            return {
                "event": "handler_start",
                "task": self._current_task_name,
                "line": line_num,
            }

        m = self.UNREACHABLE_PATTERN.match(stripped)
        if m:
            task = self._make_task(m.group(1), TaskResult.UNREACHABLE, line_num)
            return {"event": "unreachable", "host": m.group(1), "line": line_num, "task": task.name}

        m = self.FAILED_PATTERN.match(stripped)
        if m:
            host = m.group(1)
            raw_json = m.group(2)
            task = self._make_task(host, TaskResult.FAILED, line_num)
            self._parse_json_payload(task, raw_json)
            return {
                "event": "failed",
                "host": host,
                "msg": task.msg,
                "line": line_num,
                "task": task.name,
            }

        m = self.CHANGED_PATTERN.match(stripped)
        if m:
            host = m.group(1)
            task = self._make_task(host, TaskResult.CHANGED, line_num)
            task.changed = True
            extra = m.group(2)
            im = self.ITEM_PATTERN.search(extra) if extra else None
            if im:
                task.item = im.group(1)
                task.loop_count += 1
            return {"event": "changed", "host": host, "line": line_num, "task": task.name}

        m = self.OK_PATTERN.match(stripped)
        if m:
            host = m.group(1)
            task = self._make_task(host, TaskResult.OK, line_num)
            extra = m.group(2)
            im = self.ITEM_PATTERN.search(extra) if extra else None
            if im:
                task.item = im.group(1)
                task.loop_count += 1
            return {"event": "ok", "host": host, "line": line_num, "task": task.name}

        m = self.SKIPPED_PATTERN.match(stripped)
        if m:
            task = self._make_task(m.group(1), TaskResult.SKIPPED, line_num)
            return {"event": "skipped", "host": m.group(1), "line": line_num, "task": task.name}

        m = self.RECAP_PATTERN.match(stripped)
        if m:
            recap = PlayRecap(
                host=m.group(1),
                ok=int(m.group(2)),
                changed=int(m.group(3)),
                unreachable=int(m.group(4)),
                failed=int(m.group(5)),
                skipped=int(m.group(6) or 0),
                rescued=int(m.group(7) or 0),
                ignored=int(m.group(8) or 0),
            )
            if self._current_play:
                self._current_play.recaps.append(recap)
            return {
                "event": "recap",
                "host": recap.host,
                "ok": recap.ok,
                "failed": recap.failed,
                "line": line_num,
            }

        return None

    def parse_log(self, log_content: str) -> list[PlaybookRun]:
        """Parse complete log content into structured runs."""
        self._lines = []
        self._runs = []
        self._current_play = None
        self._current_task_name = ""

        for line in log_content.splitlines():
            self.parse_line(line)

        if self._current_play:
            self._finalize_play()

        return list(self._runs)

    def get_summary(self) -> dict:
        """Get summary statistics across all parsed runs."""
        total_tasks = 0
        total_failed = 0
        total_changed = 0
        total_skipped = 0
        total_ok = 0
        hosts: set[str] = set()

        for run in self._runs:
            total_tasks += run.total_tasks
            total_failed += run.failed_tasks
            total_changed += run.changed_tasks
            for task in run.tasks:
                if task.result == TaskResult.OK:
                    total_ok += 1
                elif task.result == TaskResult.SKIPPED:
                    total_skipped += 1
                hosts.add(task.host)

        return {
            "plays": len(self._runs),
            "total_tasks": total_tasks,
            "ok": total_ok,
            "changed": total_changed,
            "failed": total_failed,
            "skipped": total_skipped,
            "hosts": sorted(hosts),
            "host_count": len(hosts),
            "has_failures": total_failed > 0,
        }

    def get_failures(self) -> list[AnsibleTask]:
        """Get all failed tasks."""
        failures: list[AnsibleTask] = []
        for run in self._runs:
            for task in run.tasks:
                if task.result in (TaskResult.FAILED, TaskResult.UNREACHABLE):
                    failures.append(task)
        return failures

    def get_changes(self) -> list[AnsibleTask]:
        """Get all changed tasks."""
        changes: list[AnsibleTask] = []
        for run in self._runs:
            for task in run.tasks:
                if task.result == TaskResult.CHANGED:
                    changes.append(task)
        return changes

    def get_timeline(self) -> list[dict]:
        """Get chronological timeline of events."""
        timeline: list[dict] = []
        for run in self._runs:
            timeline.append({
                "type": "play_start",
                "name": run.play_name,
                "time": run.start_time,
            })
            for task in run.tasks:
                timeline.append({
                    "type": "task",
                    "name": task.name,
                    "host": task.host,
                    "result": task.result.value,
                    "line": task.line_number,
                })
            timeline.append({
                "type": "play_end",
                "name": run.play_name,
                "time": run.end_time,
                "duration_seconds": run.duration_seconds,
            })
        return timeline

    def get_host_summary(self) -> dict[str, dict]:
        """Get per-host summary of task results."""
        summary: dict[str, dict] = {}
        for run in self._runs:
            for task in run.tasks:
                h = task.host
                if h not in summary:
                    summary[h] = {
                        "ok": 0, "changed": 0, "failed": 0,
                        "skipped": 0, "unreachable": 0,
                    }
                key = task.result.value
                if key in summary[h]:
                    summary[h][key] += 1

            for recap in run.recaps:
                if recap.host in summary:
                    continue
                summary[recap.host] = {
                    "ok": recap.ok,
                    "changed": recap.changed,
                    "failed": recap.failed,
                    "skipped": recap.skipped,
                    "unreachable": recap.unreachable,
                }
        return summary

    def suggest_fixes(self, failure: AnsibleTask) -> list[str]:
        """Suggest potential fixes for common failure patterns."""
        category = self._detect_error_category(failure)
        combined = f"{failure.msg} {failure.stderr} {failure.stdout}".lower()
        suggestions: list[str] = []

        if category == "permission":
            suggestions.append("Check that the SSH user has sudo/root privileges on the target host.")
            suggestions.append("Verify file ownership and permissions on remote paths.")
            if "sudo" in combined:
                suggestions.append("Ensure NOPASSWD sudo is configured or provide become_password.")

        elif category == "connectivity":
            suggestions.append("Verify the target host is reachable (ping / ssh test).")
            suggestions.append("Check firewall rules allow SSH (port 22) and AAP ports (443, 27199).")
            if "refused" in combined:
                suggestions.append("The service may not be running on the target port.")

        elif category == "missing_package":
            suggestions.append("Install the required package on the target host before rerunning.")
            suggestions.append("For containerised installs, ensure the container image is available.")

        elif category == "configuration":
            suggestions.append("Review the inventory variables for typos or invalid values.")
            suggestions.append("Cross-check the AAP 2.6 installer documentation for required parameters.")

        elif category == "disk_space":
            suggestions.append("Free disk space on the target host (need ~20 GB for AAP).")
            suggestions.append("Run: df -h /var /tmp /opt to identify full partitions.")

        elif category == "timeout":
            suggestions.append("Increase timeout values in ansible.cfg or task parameters.")
            suggestions.append("Check network latency between control node and target.")

        elif category == "certificate":
            suggestions.append("Verify TLS certificates are valid and not expired.")
            suggestions.append("If using custom CA, ensure custom_ca_cert is set correctly.")

        elif category == "dns":
            suggestions.append("Check /etc/resolv.conf on the target host.")
            suggestions.append("Verify all hostnames in the inventory resolve correctly.")

        else:
            suggestions.append("Review the full error output for additional context.")
            suggestions.append("Check the Ansible docs for the failing module.")
            suggestions.append("Try running the task in verbose mode (-vvv) for more detail.")

        return suggestions

    def export_report(self, format: str = "text") -> str:
        """Export analysis report in text, json, or html format."""
        if format == "json":
            return self._export_json()
        if format == "html":
            return self._export_html()
        return self._export_text()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _make_task(self, host: str, result: TaskResult, line_num: int) -> AnsibleTask:
        role, task_name = self._split_role_task(self._current_task_name)
        task = AnsibleTask(
            name=task_name,
            host=host,
            result=result,
            role=role,
            line_number=line_num,
            changed=result == TaskResult.CHANGED,
        )
        if self._current_play:
            self._current_play.tasks.append(task)
        return task

    def _split_role_task(self, full_name: str) -> tuple[str, str]:
        m = self.ROLE_PATTERN.match(full_name)
        if m:
            return m.group(1).strip(), m.group(2).strip()
        return "", full_name

    @staticmethod
    def _parse_json_payload(task: AnsibleTask, raw: str) -> None:
        raw = raw.strip()
        if not raw:
            return
        try:
            data = json.loads(raw)
            task.msg = data.get("msg", "")
            task.stderr = data.get("stderr", "")
            task.stdout = data.get("stdout", "")
            task.module = data.get("module_name", "")
        except (json.JSONDecodeError, TypeError):
            task.msg = raw[:500]

    def _finalize_play(self) -> None:
        if not self._current_play:
            return
        play = self._current_play
        play.end_time = time.time()
        play.total_tasks = len(play.tasks)
        play.failed_tasks = sum(
            1 for t in play.tasks if t.result in (TaskResult.FAILED, TaskResult.UNREACHABLE)
        )
        play.changed_tasks = sum(1 for t in play.tasks if t.result == TaskResult.CHANGED)
        if play.start_time:
            play.duration_seconds = round(play.end_time - play.start_time, 2)
        self._runs.append(play)
        self._current_play = None

    def _detect_error_category(self, task: AnsibleTask) -> str:
        combined = f"{task.msg} {task.stderr} {task.stdout}".lower()
        for category, keywords in self._ERROR_CATEGORIES.items():
            for kw in keywords:
                if kw in combined:
                    return category
        return "unknown"

    # ------------------------------------------------------------------
    # Export formats
    # ------------------------------------------------------------------

    def _export_text(self) -> str:
        summary = self.get_summary()
        lines: list[str] = []
        lines.append("=" * 60)
        lines.append("  Ansible Playbook Analysis Report")
        lines.append("=" * 60)
        lines.append("")
        lines.append(f"Plays:   {summary['plays']}")
        lines.append(f"Tasks:   {summary['total_tasks']}")
        lines.append(f"OK:      {summary['ok']}")
        lines.append(f"Changed: {summary['changed']}")
        lines.append(f"Failed:  {summary['failed']}")
        lines.append(f"Skipped: {summary['skipped']}")
        lines.append(f"Hosts:   {', '.join(summary['hosts'])}")
        lines.append("")

        failures = self.get_failures()
        if failures:
            lines.append("-" * 60)
            lines.append("  FAILURES")
            lines.append("-" * 60)
            for f in failures:
                lines.append(f"  [{f.result.value.upper()}] {f.name}")
                lines.append(f"    Host: {f.host}")
                if f.role:
                    lines.append(f"    Role: {f.role}")
                if f.msg:
                    lines.append(f"    Msg:  {f.msg[:200]}")
                lines.append(f"    Line: {f.line_number}")
                fixes = self.suggest_fixes(f)
                if fixes:
                    lines.append("    Suggestions:")
                    for fix in fixes:
                        lines.append(f"      - {fix}")
                lines.append("")

        host_summary = self.get_host_summary()
        if host_summary:
            lines.append("-" * 60)
            lines.append("  HOST SUMMARY")
            lines.append("-" * 60)
            for host, counts in sorted(host_summary.items()):
                parts = [f"{k}={v}" for k, v in counts.items() if v]
                lines.append(f"  {host:30s}  {' '.join(parts)}")
            lines.append("")

        return "\n".join(lines)

    def _export_json(self) -> str:
        return json.dumps(
            {
                "summary": self.get_summary(),
                "failures": [
                    {
                        "name": t.name,
                        "host": t.host,
                        "result": t.result.value,
                        "role": t.role,
                        "msg": t.msg,
                        "line": t.line_number,
                        "suggestions": self.suggest_fixes(t),
                    }
                    for t in self.get_failures()
                ],
                "host_summary": self.get_host_summary(),
                "timeline": self.get_timeline(),
            },
            indent=2,
        )

    def _export_html(self) -> str:
        summary = self.get_summary()
        failures = self.get_failures()
        host_summary = self.get_host_summary()

        html_parts: list[str] = [
            "<!DOCTYPE html>",
            "<html><head><meta charset='utf-8'>",
            "<title>Ansible Playbook Report</title>",
            "<style>",
            "body{font-family:sans-serif;margin:2em;color:#333}",
            "h1{color:#1a1a2e}h2{color:#16213e;border-bottom:1px solid #ddd;padding-bottom:.3em}",
            "table{border-collapse:collapse;width:100%;margin:1em 0}",
            "th,td{border:1px solid #ddd;padding:8px;text-align:left}",
            "th{background:#f4f4f4}.fail{color:#c0392b}.ok{color:#27ae60}",
            ".warn{color:#f39c12}",
            "</style></head><body>",
            "<h1>Ansible Playbook Analysis Report</h1>",
            "<h2>Summary</h2>",
            "<table>",
            f"<tr><th>Plays</th><td>{summary['plays']}</td></tr>",
            f"<tr><th>Tasks</th><td>{summary['total_tasks']}</td></tr>",
            f"<tr><th>OK</th><td class='ok'>{summary['ok']}</td></tr>",
            f"<tr><th>Changed</th><td class='warn'>{summary['changed']}</td></tr>",
            f"<tr><th>Failed</th><td class='fail'>{summary['failed']}</td></tr>",
            f"<tr><th>Skipped</th><td>{summary['skipped']}</td></tr>",
            "</table>",
        ]

        if failures:
            html_parts.append("<h2>Failures</h2>")
            for f in failures:
                html_parts.append(f"<h3 class='fail'>{_html_esc(f.name)} on {_html_esc(f.host)}</h3>")
                if f.msg:
                    html_parts.append(f"<p><strong>Message:</strong> {_html_esc(f.msg[:300])}</p>")
                fixes = self.suggest_fixes(f)
                if fixes:
                    html_parts.append("<ul>")
                    for fix in fixes:
                        html_parts.append(f"<li>{_html_esc(fix)}</li>")
                    html_parts.append("</ul>")

        if host_summary:
            html_parts.append("<h2>Host Summary</h2><table>")
            html_parts.append("<tr><th>Host</th><th>OK</th><th>Changed</th><th>Failed</th><th>Skipped</th><th>Unreachable</th></tr>")
            for host, counts in sorted(host_summary.items()):
                html_parts.append(
                    f"<tr><td>{_html_esc(host)}</td>"
                    f"<td class='ok'>{counts.get('ok',0)}</td>"
                    f"<td class='warn'>{counts.get('changed',0)}</td>"
                    f"<td class='fail'>{counts.get('failed',0)}</td>"
                    f"<td>{counts.get('skipped',0)}</td>"
                    f"<td class='fail'>{counts.get('unreachable',0)}</td></tr>"
                )
            html_parts.append("</table>")

        html_parts.append("</body></html>")
        return "\n".join(html_parts)


def _html_esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
