"""Authentication via Red Hat Registry (registry.redhat.io) credentials."""

import logging
import os
import time
from typing import Optional

import httpx
import jwt
from fastapi import Request, HTTPException
from pydantic import BaseModel

JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    import secrets
    JWT_SECRET = secrets.token_urlsafe(32)
    logging.getLogger(__name__).warning(
        "JWT_SECRET not set — generated ephemeral secret. "
        "Set JWT_SECRET env var for persistent sessions across restarts."
    )
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 8

PUBLIC_PATHS = {"/api/auth/login", "/api/auth/sso", "/api/health", "/docs", "/openapi.json"}


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    expires_at: int


class UserInfo(BaseModel):
    username: str
    expires_at: int


def create_token(username: str) -> tuple[str, int]:
    expires_at = int(time.time()) + JWT_EXPIRY_HOURS * 3600
    payload = {"sub": username, "exp": expires_at, "iat": int(time.time())}
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, expires_at


def decode_token(token: str) -> UserInfo:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return UserInfo(username=payload["sub"], expires_at=payload["exp"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


async def validate_registry_credentials(username: str, password: str) -> bool:
    """Validate credentials against registry.redhat.io token endpoint.

    Docker Registry v2 uses token-based auth:
    1. GET /v2/ returns 401 + WWW-Authenticate with a realm URL
    2. GET the realm URL with Basic auth to obtain a bearer token
    If step 2 returns 200, the credentials are valid.
    """
    token_url = (
        "https://registry.redhat.io/auth/realms/rhcc/protocol/"
        "redhat-docker-v2/auth?service=docker-registry"
    )
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(token_url, auth=(username, password))
            return resp.status_code == 200
    except httpx.RequestError:
        raise HTTPException(502, "Cannot reach registry.redhat.io — check network connectivity")


def get_token_from_request(request: Request) -> Optional[str]:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


def is_public_path(path: str) -> bool:
    if path in PUBLIC_PATHS:
        return True
    if path.startswith("/api/auth/login") or path.startswith("/api/auth/sso"):
        return True
    if not path.startswith("/api/") and not path.startswith("/ws/"):
        return True
    return False
