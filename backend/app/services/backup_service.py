"""Backup and restore service for the AAP Deployment Wizard.

Creates timestamped backups of configurations, inventories,
audit logs, and deployment state.
"""
from __future__ import annotations

import gzip
import json
import logging
import os
import shutil
import tarfile
import time
import uuid
from dataclasses import dataclass, field, asdict
from io import BytesIO
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

BACKUP_VERSION = "1.0"
BACKUP_CONTENTS_ALLOWED = {"config", "inventory", "audit_log", "metadata"}


@dataclass
class BackupManifest:
    id: str
    name: str
    timestamp: float
    version: str
    contents: list[str]
    size_bytes: int
    compressed: bool
    metadata: dict = field(default_factory=dict)


class BackupService:
    """File-backed backup and restore with optional gzip compression."""

    def __init__(self, backup_dir: Optional[str] = None):
        self._dir = Path(backup_dir) if backup_dir else Path.home() / ".aap-wizard" / "backups"
        self._dir.mkdir(parents=True, exist_ok=True)

    def create_backup(self, name: str, config: dict,
                      inventory: str = "",
                      audit_log: Optional[list] = None,
                      metadata: Optional[dict] = None) -> BackupManifest:
        backup_id = f"bak-{uuid.uuid4().hex[:12]}"
        backup_path = self._dir / backup_id
        backup_path.mkdir(parents=True, exist_ok=True)

        contents: list[str] = []

        config_safe = self._redact_secrets(config)
        (backup_path / "config.json").write_text(
            json.dumps(config_safe, indent=2, default=str)
        )
        contents.append("config")

        if inventory:
            (backup_path / "inventory.ini").write_text(inventory)
            contents.append("inventory")

        if audit_log:
            (backup_path / "audit_log.json").write_text(
                json.dumps(audit_log, indent=2, default=str)
            )
            contents.append("audit_log")

        meta = {
            "created_by": "aap-deployment-wizard",
            "wizard_version": BACKUP_VERSION,
            "topology": config.get("topology", "unknown"),
            "timestamp_human": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
            **(metadata or {}),
        }
        (backup_path / "metadata.json").write_text(
            json.dumps(meta, indent=2, default=str)
        )
        contents.append("metadata")

        compressed_path = self._compress_dir(backup_path, backup_id)
        size_bytes = compressed_path.stat().st_size if compressed_path.exists() else 0

        shutil.rmtree(backup_path, ignore_errors=True)

        manifest = BackupManifest(
            id=backup_id,
            name=name,
            timestamp=time.time(),
            version=BACKUP_VERSION,
            contents=contents,
            size_bytes=size_bytes,
            compressed=True,
            metadata=meta,
        )
        self._save_manifest(manifest)

        logger.info(
            "Created backup '%s' (%s, %d bytes, %d items)",
            name, backup_id, size_bytes, len(contents),
        )
        return manifest

    def list_backups(self) -> list[BackupManifest]:
        manifests = []
        for path in sorted(self._dir.glob("bak-*.manifest.json")):
            try:
                data = json.loads(path.read_text())
                manifests.append(BackupManifest(**data))
            except Exception as exc:
                logger.debug("Skipping invalid manifest %s: %s", path.name, exc)
        manifests.sort(key=lambda m: m.timestamp, reverse=True)
        return manifests

    def get_backup(self, backup_id: str) -> Optional[dict]:
        manifest = self._load_manifest(backup_id)
        if not manifest:
            return None

        archive_path = self._dir / f"{backup_id}.tar.gz"
        if not archive_path.exists():
            logger.warning("Backup archive missing for %s", backup_id)
            return None

        data = self._decompress_archive(archive_path)
        return {
            "manifest": asdict(manifest),
            **data,
        }

    def restore_backup(self, backup_id: str) -> dict:
        backup = self.get_backup(backup_id)
        if not backup:
            raise ValueError(f"Backup not found: {backup_id}")

        result = {
            "backup_id": backup_id,
            "restored_at": time.time(),
            "contents": [],
        }

        if "config" in backup:
            result["config"] = backup["config"]
            result["contents"].append("config")

        if "inventory" in backup:
            result["inventory"] = backup["inventory"]
            result["contents"].append("inventory")

        if "audit_log" in backup:
            result["audit_log"] = backup["audit_log"]
            result["contents"].append("audit_log")

        if "metadata" in backup:
            result["metadata"] = backup["metadata"]
            result["contents"].append("metadata")

        logger.info("Restored backup %s (%d items)", backup_id, len(result["contents"]))
        return result

    def delete_backup(self, backup_id: str) -> bool:
        manifest_path = self._dir / f"{backup_id}.manifest.json"
        archive_path = self._dir / f"{backup_id}.tar.gz"

        deleted = False
        if manifest_path.exists():
            manifest_path.unlink()
            deleted = True
        if archive_path.exists():
            archive_path.unlink()
            deleted = True

        if deleted:
            logger.info("Deleted backup %s", backup_id)
        return deleted

    def export_backup(self, backup_id: str) -> bytes:
        archive_path = self._dir / f"{backup_id}.tar.gz"
        if not archive_path.exists():
            raise ValueError(f"Backup archive not found: {backup_id}")
        return archive_path.read_bytes()

    def import_backup(self, data: bytes) -> BackupManifest:
        backup_id = f"bak-{uuid.uuid4().hex[:12]}"
        archive_path = self._dir / f"{backup_id}.tar.gz"
        archive_path.write_bytes(data)

        try:
            contents = self._decompress_archive(archive_path)
        except Exception as exc:
            archive_path.unlink(missing_ok=True)
            raise ValueError(f"Invalid backup archive: {exc}") from exc

        meta = contents.get("metadata", {})
        config = contents.get("config", {})
        content_keys = [k for k in contents if k != "manifest"]

        manifest = BackupManifest(
            id=backup_id,
            name=meta.get("name", f"Imported {time.strftime('%Y-%m-%d %H:%M')}"),
            timestamp=time.time(),
            version=meta.get("wizard_version", BACKUP_VERSION),
            contents=content_keys,
            size_bytes=len(data),
            compressed=True,
            metadata={
                **meta,
                "imported": True,
                "imported_at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
                "topology": config.get("topology", meta.get("topology", "unknown")),
            },
        )
        self._save_manifest(manifest)
        logger.info("Imported backup as %s (%d bytes)", backup_id, len(data))
        return manifest

    def auto_backup(self, config: dict,
                    trigger: str = "manual") -> BackupManifest:
        name = f"Auto-backup ({trigger}) — {time.strftime('%Y-%m-%d %H:%M')}"
        return self.create_backup(
            name=name,
            config=config,
            metadata={"trigger": trigger, "auto": True},
        )

    def cleanup_old_backups(self, max_count: int = 20,
                            max_age_days: int = 30) -> int:
        manifests = self.list_backups()
        cutoff_time = time.time() - (max_age_days * 86400)
        removed = 0

        for i, manifest in enumerate(manifests):
            should_remove = (
                i >= max_count
                or manifest.timestamp < cutoff_time
            )
            if should_remove:
                if self.delete_backup(manifest.id):
                    removed += 1

        if removed:
            logger.info(
                "Cleaned up %d old backups (max_count=%d, max_age=%dd)",
                removed, max_count, max_age_days,
            )
        return removed

    def get_backup_stats(self) -> dict:
        manifests = self.list_backups()
        total_size = sum(m.size_bytes for m in manifests)
        return {
            "total_backups": len(manifests),
            "total_size_bytes": total_size,
            "total_size_human": self._human_size(total_size),
            "oldest": manifests[-1].timestamp if manifests else None,
            "newest": manifests[0].timestamp if manifests else None,
            "backup_dir": str(self._dir),
        }

    def _compress_dir(self, dir_path: Path, backup_id: str) -> Path:
        archive_path = self._dir / f"{backup_id}.tar.gz"
        with tarfile.open(str(archive_path), "w:gz") as tar:
            for item in dir_path.iterdir():
                tar.add(str(item), arcname=item.name)
        return archive_path

    def _decompress_archive(self, archive_path: Path) -> dict:
        result: dict = {}
        with tarfile.open(str(archive_path), "r:gz") as tar:
            for member in tar.getmembers():
                if not member.isfile():
                    continue
                f = tar.extractfile(member)
                if f is None:
                    continue
                raw = f.read().decode("utf-8", errors="replace")

                if member.name == "config.json":
                    result["config"] = json.loads(raw)
                elif member.name == "inventory.ini":
                    result["inventory"] = raw
                elif member.name == "audit_log.json":
                    result["audit_log"] = json.loads(raw)
                elif member.name == "metadata.json":
                    result["metadata"] = json.loads(raw)
        return result

    def _save_manifest(self, manifest: BackupManifest) -> None:
        path = self._dir / f"{manifest.id}.manifest.json"
        path.write_text(json.dumps(asdict(manifest), indent=2, default=str))

    def _load_manifest(self, backup_id: str) -> Optional[BackupManifest]:
        path = self._dir / f"{backup_id}.manifest.json"
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text())
            return BackupManifest(**data)
        except Exception as exc:
            logger.error("Failed to load manifest %s: %s", backup_id, exc)
            return None

    @staticmethod
    def _redact_secrets(config: dict) -> dict:
        """Deep-copy config with password/secret values masked."""
        redacted = {}
        for key, value in config.items():
            if isinstance(value, dict):
                redacted[key] = BackupService._redact_secrets(value)
            elif any(s in key.lower() for s in ("password", "secret", "token", "key")):
                redacted[key] = "***REDACTED***" if value else value
            else:
                redacted[key] = value
        return redacted

    @staticmethod
    def _human_size(size_bytes: int) -> str:
        for unit in ("B", "KB", "MB", "GB"):
            if abs(size_bytes) < 1024:
                return f"{size_bytes:.1f} {unit}"
            size_bytes /= 1024  # type: ignore[assignment]
        return f"{size_bytes:.1f} TB"
