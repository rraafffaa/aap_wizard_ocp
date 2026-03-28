"""Rollback manager for AAP deployments.

Manages deployment snapshots, enables phase-level retry,
and provides rollback capabilities for failed deployments.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional, AsyncGenerator

logger = logging.getLogger(__name__)

PHASE_ORDER = [
    "validate", "inventory", "upload", "preflight",
    "install", "post_install", "complete",
]

ROLLBACK_ACTIONS_BY_PHASE = {
    "install": [
        "stop_containers",
        "remove_containers",
        "cleanup_files",
    ],
    "post_install": [
        "stop_containers",
        "remove_containers",
        "cleanup_files",
    ],
    "upload": [
        "cleanup_files",
    ],
    "preflight": [],
    "inventory": [],
    "validate": [],
}


@dataclass
class DeploymentSnapshot:
    id: str
    session_id: str
    phase: str
    timestamp: float
    config: dict
    inventory: str
    status: str  # created, applied, rolled_back
    metadata: dict = field(default_factory=dict)


@dataclass
class RollbackAction:
    phase: str
    action: str  # stop_containers, remove_containers, restore_config, cleanup_files
    target_hosts: list[str]
    commands: list[str]
    status: str = "pending"
    error: str = ""


class RollbackManager:
    """Manages deployment snapshots and rollback operations."""

    def __init__(self, snapshots_dir: Optional[str] = None):
        self._dir = Path(snapshots_dir) if snapshots_dir else Path.home() / ".aap-wizard" / "snapshots"
        self._dir.mkdir(parents=True, exist_ok=True)

    def create_snapshot(self, session_id: str, phase: str,
                        config: dict, inventory: str) -> DeploymentSnapshot:
        snapshot = DeploymentSnapshot(
            id=str(uuid.uuid4()),
            session_id=session_id,
            phase=phase,
            timestamp=time.time(),
            config=config,
            inventory=inventory,
            status="created",
            metadata={
                "phase_index": PHASE_ORDER.index(phase) if phase in PHASE_ORDER else -1,
            },
        )
        self._save_snapshot(snapshot)
        logger.info("Created snapshot %s for session %s phase '%s'",
                     snapshot.id[:8], session_id[:8], phase)
        return snapshot

    def get_snapshots(self, session_id: str) -> list[DeploymentSnapshot]:
        all_snapshots = self._load_snapshots()
        return sorted(
            [s for s in all_snapshots if s.session_id == session_id],
            key=lambda s: s.timestamp,
        )

    def get_latest_snapshot(self, session_id: str) -> Optional[DeploymentSnapshot]:
        snapshots = self.get_snapshots(session_id)
        return snapshots[-1] if snapshots else None

    def plan_rollback(self, session_id: str,
                       target_phase: Optional[str] = None) -> list[RollbackAction]:
        """Plan rollback actions from the latest snapshot back to a target phase."""
        snapshots = self.get_snapshots(session_id)
        if not snapshots:
            logger.warning("No snapshots found for session %s", session_id)
            return []

        latest = snapshots[-1]
        config = latest.config

        target_hosts = self._extract_hosts(config)

        if target_phase is None:
            target_phase = "validate"

        latest_idx = PHASE_ORDER.index(latest.phase) if latest.phase in PHASE_ORDER else 0
        target_idx = PHASE_ORDER.index(target_phase) if target_phase in PHASE_ORDER else 0

        actions = []
        for idx in range(latest_idx, target_idx - 1, -1):
            if idx < 0 or idx >= len(PHASE_ORDER):
                continue
            phase = PHASE_ORDER[idx]
            phase_actions = ROLLBACK_ACTIONS_BY_PHASE.get(phase, [])

            for action_name in phase_actions:
                commands = self._get_rollback_commands(phase, config, action_name)
                if commands:
                    actions.append(RollbackAction(
                        phase=phase,
                        action=action_name,
                        target_hosts=target_hosts,
                        commands=commands,
                    ))

        logger.info(
            "Planned %d rollback actions for session %s (%s -> %s)",
            len(actions), session_id[:8], latest.phase, target_phase,
        )
        return actions

    async def execute_rollback(self, session_id: str,
                                actions: list[RollbackAction],
                                ssh_config: Optional[dict] = None) -> AsyncGenerator[dict, None]:
        """Execute rollback actions, yielding progress updates."""
        total = len(actions)
        if total == 0:
            yield {"status": "complete", "message": "No rollback actions needed"}
            return

        yield {
            "status": "started",
            "message": f"Starting rollback with {total} actions",
            "total_actions": total,
        }

        for i, action in enumerate(actions):
            action.status = "running"
            yield {
                "status": "progress",
                "action": action.action,
                "phase": action.phase,
                "index": i + 1,
                "total": total,
                "message": f"Executing: {action.action} for phase '{action.phase}'",
            }

            try:
                if ssh_config:
                    await self._execute_remote_action(action, ssh_config)
                else:
                    await self._execute_local_action(action)
                action.status = "completed"
                yield {
                    "status": "action_complete",
                    "action": action.action,
                    "phase": action.phase,
                    "index": i + 1,
                    "total": total,
                }
            except Exception as exc:
                action.status = "failed"
                action.error = str(exc)
                yield {
                    "status": "action_failed",
                    "action": action.action,
                    "phase": action.phase,
                    "error": str(exc),
                    "index": i + 1,
                    "total": total,
                }
                logger.error("Rollback action %s failed: %s", action.action, exc)

        latest = self.get_latest_snapshot(session_id)
        if latest:
            latest.status = "rolled_back"
            self._save_snapshot(latest)

        failed = [a for a in actions if a.status == "failed"]
        if failed:
            yield {
                "status": "partial",
                "message": f"Rollback completed with {len(failed)} error(s)",
                "failed_actions": [{"action": a.action, "error": a.error} for a in failed],
            }
        else:
            yield {
                "status": "complete",
                "message": "Rollback completed successfully",
            }

    async def retry_from_phase(self, session_id: str, phase: str,
                                config: dict) -> str:
        """Create a new snapshot and return a new session ID for retry."""
        snapshots = self.get_snapshots(session_id)
        inventory = ""
        if snapshots:
            for s in reversed(snapshots):
                if s.inventory:
                    inventory = s.inventory
                    break

        new_session_id = str(uuid.uuid4())
        self.create_snapshot(
            session_id=new_session_id,
            phase=phase,
            config=config,
            inventory=inventory,
        )

        logger.info(
            "Created retry session %s from phase '%s' (original: %s)",
            new_session_id[:8], phase, session_id[:8],
        )
        return new_session_id

    def cleanup_old_snapshots(self, max_age_hours: int = 72) -> int:
        cutoff = time.time() - (max_age_hours * 3600)
        removed = 0

        for path in self._dir.glob("*.json"):
            try:
                data = json.loads(path.read_text())
                if data.get("timestamp", 0) < cutoff:
                    path.unlink()
                    removed += 1
            except Exception:
                continue

        if removed:
            logger.info("Cleaned up %d old snapshots (older than %dh)", removed, max_age_hours)
        return removed

    def _save_snapshot(self, snapshot: DeploymentSnapshot) -> None:
        path = self._dir / f"{snapshot.id}.json"
        try:
            path.write_text(json.dumps(asdict(snapshot), indent=2, default=str))
        except Exception as exc:
            logger.error("Failed to save snapshot %s: %s", snapshot.id, exc)

    def _load_snapshots(self) -> list[DeploymentSnapshot]:
        snapshots = []
        for path in self._dir.glob("*.json"):
            try:
                data = json.loads(path.read_text())
                snapshots.append(DeploymentSnapshot(**data))
            except Exception as exc:
                logger.debug("Skipping invalid snapshot %s: %s", path.name, exc)
        return snapshots

    def _get_rollback_commands(self, phase: str, config: dict,
                               action: str = "") -> list[str]:
        """Generate shell commands for a specific rollback action."""
        prefix = config.get("install_dir", "/opt/aap")
        container_prefix = "aap"

        if action == "stop_containers":
            return [
                f"podman stop $(podman ps -q --filter name={container_prefix}) 2>/dev/null || true",
            ]

        if action == "remove_containers":
            return [
                f"podman rm -f $(podman ps -aq --filter name={container_prefix}) 2>/dev/null || true",
                f"podman volume prune -f 2>/dev/null || true",
            ]

        if action == "restore_config":
            return [
                f"if [ -d {prefix}/backup ]; then cp -r {prefix}/backup/* {prefix}/ ; fi",
            ]

        if action == "cleanup_files":
            return [
                f"rm -rf /tmp/aap-wizard-* 2>/dev/null || true",
            ]

        return []

    @staticmethod
    def _extract_hosts(config: dict) -> list[str]:
        hosts = set()
        for section in ("gateway", "controller", "hub", "eda"):
            section_config = config.get(section, {})
            for h in section_config.get("hosts", []):
                hosts.add(h)
        if config.get("target_host"):
            hosts.add(config["target_host"])
        return sorted(hosts)

    async def _execute_remote_action(self, action: RollbackAction,
                                      ssh_config: dict) -> None:
        from app.services.ssh_manager import SSHConfig, SSHConnection

        config = SSHConfig(**ssh_config)
        conn = SSHConnection(config)
        try:
            await conn.connect()
            for cmd in action.commands:
                result = await conn.execute(cmd, timeout=60)
                if not result.ok:
                    logger.warning(
                        "Rollback command returned %d: %s",
                        result.exit_code, cmd[:80],
                    )
        finally:
            await conn.disconnect()

    async def _execute_local_action(self, action: RollbackAction) -> None:
        for cmd in action.commands:
            proc = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
            if proc.returncode and proc.returncode != 0:
                logger.warning(
                    "Local rollback command returned %d: %s — %s",
                    proc.returncode, cmd[:80], stderr.decode(errors="replace")[:200],
                )
