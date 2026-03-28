"""Audit logging service for tracking all wizard operations.

Records configuration changes, deployment actions, and system events
with full diff support for configuration changes.
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

VALID_CATEGORIES = {"navigation", "config", "deploy", "system", "health"}


@dataclass
class AuditEntry:
    id: str
    timestamp: float
    action: str
    category: str  # navigation, config, deploy, system, health
    user: str = "admin"
    session_id: str = ""
    details: str = ""
    metadata: dict = field(default_factory=dict)
    diff: list = field(default_factory=list)


class AuditService:
    """File-based audit log with querying capabilities."""

    def __init__(self, log_dir: Optional[str] = None):
        self._log_dir = Path(log_dir) if log_dir else Path.home() / ".aap-wizard" / "audit"
        self._log_dir.mkdir(parents=True, exist_ok=True)
        self._log_file = self._log_dir / "audit.jsonl"
        self._cache: list[AuditEntry] = []
        self._cache_loaded = False

    def log(self, action: str, category: str, details: str,
            metadata: Optional[dict] = None, diff: Optional[list] = None,
            session_id: str = "") -> AuditEntry:
        if category not in VALID_CATEGORIES:
            logger.warning("Unknown audit category '%s', using 'system'", category)
            category = "system"

        entry = AuditEntry(
            id=str(uuid.uuid4()),
            timestamp=time.time(),
            action=action,
            category=category,
            details=details,
            metadata=metadata or {},
            diff=diff or [],
            session_id=session_id,
        )

        self._persist(entry)
        self._cache.append(entry)
        logger.debug("Audit: [%s] %s — %s", category, action, details[:100])
        return entry

    def log_config_change(self, old_config: dict, new_config: dict,
                          session_id: str = "") -> AuditEntry:
        diff = self._compute_diff(old_config, new_config)
        if not diff:
            return self.log(
                action="config_no_change",
                category="config",
                details="Configuration reviewed with no changes",
                session_id=session_id,
            )

        changed_fields = [d["path"] for d in diff]
        return self.log(
            action="config_change",
            category="config",
            details=f"Changed {len(diff)} field(s): {', '.join(changed_fields[:5])}",
            metadata={"change_count": len(diff)},
            diff=diff,
            session_id=session_id,
        )

    def log_deploy_event(self, session_id: str, event: str,
                          details: str = "", metadata: Optional[dict] = None) -> AuditEntry:
        return self.log(
            action=f"deploy_{event}",
            category="deploy",
            details=details or f"Deployment event: {event}",
            metadata=metadata or {},
            session_id=session_id,
        )

    def get_entries(self, limit: int = 100, offset: int = 0,
                     category: Optional[str] = None,
                     since: Optional[float] = None,
                     until: Optional[float] = None,
                     session_id: Optional[str] = None) -> list[AuditEntry]:
        entries = self._load_entries()

        if category:
            entries = [e for e in entries if e.category == category]
        if since is not None:
            entries = [e for e in entries if e.timestamp >= since]
        if until is not None:
            entries = [e for e in entries if e.timestamp <= until]
        if session_id:
            entries = [e for e in entries if e.session_id == session_id]

        entries.sort(key=lambda e: e.timestamp, reverse=True)
        return entries[offset:offset + limit]

    def get_stats(self) -> dict:
        entries = self._load_entries()
        by_category: dict[str, int] = {}
        by_action: dict[str, int] = {}
        sessions: set[str] = set()

        for entry in entries:
            by_category[entry.category] = by_category.get(entry.category, 0) + 1
            by_action[entry.action] = by_action.get(entry.action, 0) + 1
            if entry.session_id:
                sessions.add(entry.session_id)

        first_ts = entries[0].timestamp if entries else 0
        last_ts = entries[-1].timestamp if entries else 0

        return {
            "total_entries": len(entries),
            "by_category": by_category,
            "by_action": by_action,
            "unique_sessions": len(sessions),
            "first_entry": first_ts,
            "last_entry": last_ts,
            "log_file": str(self._log_file),
            "log_size_bytes": self._log_file.stat().st_size if self._log_file.exists() else 0,
        }

    def export_log(self, format: str = "json") -> str:
        entries = self._load_entries()

        if format == "json":
            return json.dumps([asdict(e) for e in entries], indent=2)

        if format == "csv":
            lines = ["id,timestamp,action,category,user,session_id,details"]
            for e in entries:
                details_escaped = e.details.replace('"', '""')
                lines.append(
                    f'{e.id},{e.timestamp},{e.action},{e.category},'
                    f'{e.user},{e.session_id},"{details_escaped}"'
                )
            return "\n".join(lines)

        if format == "text":
            lines = []
            for e in entries:
                ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(e.timestamp))
                lines.append(f"[{ts}] [{e.category}] {e.action}: {e.details}")
            return "\n".join(lines)

        raise ValueError(f"Unsupported export format: {format}. Use json, csv, or text.")

    def _compute_diff(self, old: dict, new: dict, path: str = "") -> list[dict]:
        diffs = []
        all_keys = set(list(old.keys()) + list(new.keys()))

        for key in sorted(all_keys):
            current_path = f"{path}.{key}" if path else key
            old_val = old.get(key)
            new_val = new.get(key)

            if key not in old:
                diffs.append({
                    "path": current_path,
                    "type": "added",
                    "old": None,
                    "new": new_val,
                })
            elif key not in new:
                diffs.append({
                    "path": current_path,
                    "type": "removed",
                    "old": old_val,
                    "new": None,
                })
            elif isinstance(old_val, dict) and isinstance(new_val, dict):
                diffs.extend(self._compute_diff(old_val, new_val, current_path))
            elif old_val != new_val:
                # Mask password/secret fields in diff output
                if any(s in key.lower() for s in ("password", "secret", "token", "key")):
                    diffs.append({
                        "path": current_path,
                        "type": "changed",
                        "old": "***" if old_val else None,
                        "new": "***" if new_val else None,
                    })
                else:
                    diffs.append({
                        "path": current_path,
                        "type": "changed",
                        "old": old_val,
                        "new": new_val,
                    })

        return diffs

    def _persist(self, entry: AuditEntry) -> None:
        try:
            with open(self._log_file, "a") as f:
                f.write(json.dumps(asdict(entry), default=str) + "\n")
        except Exception as exc:
            logger.error("Failed to persist audit entry: %s", exc)

    def _load_entries(self) -> list[AuditEntry]:
        if not self._log_file.exists():
            return []

        entries = []
        try:
            with open(self._log_file) as f:
                for line_num, line in enumerate(f, 1):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        entries.append(AuditEntry(**data))
                    except (json.JSONDecodeError, TypeError) as exc:
                        logger.debug("Skipping malformed audit line %d: %s", line_num, exc)
        except Exception as exc:
            logger.error("Failed to load audit log: %s", exc)

        return entries
