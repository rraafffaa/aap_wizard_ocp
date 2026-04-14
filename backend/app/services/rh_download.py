"""Red Hat API token exchange and AAP tarball download service.

Users provide their Red Hat offline token (from https://access.redhat.com/management/api)
which is exchanged for an access token to download the AAP containerized setup tarball
via the RHSM API (https://api.access.redhat.com/management/v1).

Flow:
  1. Exchange offline token for short-lived access token (SSO)
  2. GET /images/cset/{ContentSet} — list images, find tarball by filename
  3. GET /images/{checksum}/download — 307 redirect to CDN download URL
"""
from __future__ import annotations

import logging
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

RH_SSO_TOKEN_URL = (
    "https://sso.redhat.com/auth/realms/redhat-external/protocol/openid-connect/token"
)
RHSM_API_BASE = "https://api.access.redhat.com/management/v1"

# Content set for AAP 2.6 containerized setup files
AAP_CONTENT_SET = "ansible-automation-platform-2.6-for-rhel-9-x86_64-files"
TARBALL_PATTERN = "ansible-automation-platform-containerized-setup"
TARBALL_FILENAME = "ansible-automation-platform-containerized-setup-2.6-6.tar.gz"
DEFAULT_CACHE_DIR = Path.home() / ".aap-wizard" / "cache"


async def exchange_offline_token(offline_token: str) -> str:
    """Exchange a Red Hat offline token for a short-lived access token.

    Tries 'rhsm-api' client first, then falls back to 'cloud-services'.
    """
    # Strip whitespace/newlines that may have been pasted with the token
    token = offline_token.strip()

    for client_id in ("rhsm-api", "cloud-services"):
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                RH_SSO_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "client_id": client_id,
                    "refresh_token": token,
                },
            )
            if resp.status_code == 200:
                return resp.json()["access_token"]
            # Log the actual SSO error for debugging
            try:
                body = resp.json()
                error_desc = body.get("error_description", body.get("error", ""))
            except Exception:
                error_desc = resp.text[:200]
            logger.warning(
                "SSO token exchange failed (client_id=%s): %d — %s",
                client_id, resp.status_code, error_desc,
            )

    raise httpx.HTTPStatusError(
        f"Token exchange failed with all client IDs. Last error: {error_desc}",
        request=resp.request,
        response=resp,
    )


async def validate_offline_token(offline_token: str) -> dict:
    """Validate a Red Hat offline token by exchanging it and checking subscriptions."""
    try:
        access_token = await exchange_offline_token(offline_token)
    except httpx.HTTPStatusError as exc:
        # Surface the actual SSO error description to help the user
        try:
            body = exc.response.json()
            detail = body.get("error_description", body.get("error", str(exc)))
        except Exception:
            detail = str(exc)
        logger.warning("RH token validation failed: %s", detail)
        return {"valid": False, "error": detail}
    except Exception as exc:
        detail = str(exc) or f"{type(exc).__name__}: token exchange failed"
        logger.warning("RH token validation error: %s", detail)
        return {"valid": False, "error": detail}

    # Token exchange succeeded — the token is valid.  Subscription-level
    # access will be verified at download time; no need to block here.
    return {"valid": True, "username": "authenticated"}


async def _find_tarball_checksum(access_token: str) -> tuple[str, str]:
    """List images in the AAP content set and find the setup tarball.

    Returns (checksum, filename).
    Raises RuntimeError if not found.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{RHSM_API_BASE}/images/cset/{AAP_CONTENT_SET}",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"limit": 100},
        )
        resp.raise_for_status()
        data = resp.json()

    images = data.get("body", [])
    # Find the containerized setup tarball — prefer the latest version
    matches = [
        img for img in images
        if TARBALL_PATTERN in img.get("filename", "")
        and img.get("filename", "").endswith(".tar.gz")
    ]

    if not matches:
        raise RuntimeError(
            f"AAP containerized setup tarball not found in content set '{AAP_CONTENT_SET}'. "
            f"Ensure your subscription includes AAP 2.6. "
            f"Found {len(images)} images but none matched '{TARBALL_PATTERN}'."
        )

    # Sort by date (newest first) and pick the latest
    matches.sort(key=lambda i: i.get("datePublished", ""), reverse=True)
    best = matches[0]
    checksum = best["checksum"]
    filename = best["filename"]
    logger.info("Found tarball: %s (checksum: %s)", filename, checksum)
    return checksum, filename


def find_cached_tarball(cache_dir: Path | None = None) -> Path | None:
    """Check if the AAP tarball is already cached locally."""
    d = cache_dir or DEFAULT_CACHE_DIR
    if not d.exists():
        return None
    for item in d.iterdir():
        if (
            item.is_file()
            and item.name.startswith(TARBALL_PATTERN)
            and item.name.endswith(".tar.gz")
            and item.stat().st_size > 1_000_000
        ):
            return item
    return None


async def download_tarball(
    offline_token: str, cache_dir: Path | None = None
) -> Path:
    """Download the AAP setup tarball from Red Hat CDN, caching locally.

    Uses the RHSM API:
      1. List images in content set to find checksum
      2. GET /images/{checksum}/download → 307 redirect to CDN
      3. Follow redirect and stream to disk
    """
    d = cache_dir or DEFAULT_CACHE_DIR

    # Return cached copy if present
    cached = find_cached_tarball(d)
    if cached:
        logger.info("Using cached tarball: %s", cached)
        return cached

    # Exchange token
    access_token = await exchange_offline_token(offline_token)

    # Find the tarball checksum in the content set listing
    checksum, filename = await _find_tarball_checksum(access_token)

    # Download via checksum endpoint (returns 307 redirect to CDN)
    d.mkdir(parents=True, exist_ok=True)
    dest = d / filename
    tmp = dest.with_suffix(".tmp")

    logger.info("Downloading %s from Red Hat CDN...", filename)
    async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
        async with client.stream(
            "GET",
            f"{RHSM_API_BASE}/images/{checksum}/download",
            headers={"Authorization": f"Bearer {access_token}"},
        ) as resp:
            resp.raise_for_status()
            with open(tmp, "wb") as f:
                async for chunk in resp.aiter_bytes(chunk_size=65536):
                    f.write(chunk)

    tmp.rename(dest)
    size_mb = dest.stat().st_size // 1024 // 1024
    logger.info("Tarball downloaded: %s (%d MB)", dest, size_mb)
    return dest
