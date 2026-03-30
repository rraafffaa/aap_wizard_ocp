"""Encrypted configuration store for AI credentials.

Stores AI API keys encrypted at rest using Fernet symmetric encryption.
Key material stored separately from encrypted data.

Files:
  ~/.aap-wizard/.key        — Fernet key (auto-generated)
  ~/.aap-wizard/ai-config.enc — Encrypted JSON blob
"""

import json
import os
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from cryptography.fernet import Fernet, InvalidToken
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False
    logger.warning("cryptography package not installed — AI config store will use plaintext fallback")

CONFIG_DIR = Path.home() / ".aap-wizard"
KEY_FILE = CONFIG_DIR / ".key"
CONFIG_FILE = CONFIG_DIR / "ai-config.enc"


class AIConfigStore:
    """Manages encrypted storage of AI API credentials."""

    def __init__(self):
        self._fernet: Optional[object] = None
        self._ensure_dir()
        self._load_key()

    def _ensure_dir(self):
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        # Restrict directory permissions
        try:
            os.chmod(CONFIG_DIR, 0o700)
        except OSError:
            pass

    def _load_key(self):
        if not HAS_CRYPTO:
            return
        if KEY_FILE.exists():
            key = KEY_FILE.read_bytes().strip()
        else:
            key = Fernet.generate_key()
            KEY_FILE.write_bytes(key)
            try:
                os.chmod(KEY_FILE, 0o600)
            except OSError:
                pass
        self._fernet = Fernet(key)

    def _encrypt(self, data: str) -> bytes:
        if self._fernet:
            return self._fernet.encrypt(data.encode())
        return data.encode()

    def _decrypt(self, data: bytes) -> str:
        if self._fernet:
            return self._fernet.decrypt(data).decode()
        return data.decode()

    def save(self, endpoint: str, api_key: str, model: str = "gpt-4o") -> None:
        """Save AI credentials to encrypted store."""
        payload = json.dumps({
            "endpoint": endpoint,
            "api_key": api_key,
            "model": model,
        })
        encrypted = self._encrypt(payload)
        CONFIG_FILE.write_bytes(encrypted)
        try:
            os.chmod(CONFIG_FILE, 0o600)
        except OSError:
            pass
        logger.info("AI credentials saved to encrypted store")

    def load(self) -> Optional[dict]:
        """Load AI credentials from encrypted store.

        Returns dict with endpoint, api_key, model — or None if not configured.
        """
        if not CONFIG_FILE.exists():
            return None
        try:
            encrypted = CONFIG_FILE.read_bytes()
            decrypted = self._decrypt(encrypted)
            return json.loads(decrypted)
        except Exception as exc:
            logger.error("Failed to load AI config: %s", exc)
            return None

    def clear(self) -> None:
        """Remove stored AI credentials."""
        if CONFIG_FILE.exists():
            CONFIG_FILE.unlink()
            logger.info("AI credentials cleared")

    def is_configured(self) -> bool:
        """Check if credentials are stored."""
        return CONFIG_FILE.exists()

    def get_status(self) -> dict:
        """Return status without exposing the API key."""
        config = self.load()
        if not config:
            return {"configured": False, "endpoint": "", "model": "", "key_set": False}
        return {
            "configured": True,
            "endpoint": config.get("endpoint", ""),
            "model": config.get("model", "gpt-4o"),
            "key_set": bool(config.get("api_key")),
        }
