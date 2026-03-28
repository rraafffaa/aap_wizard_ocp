"""API middleware for the AAP Deployment Wizard.

Includes request logging, rate limiting, request ID tracking,
and timing middleware.
"""
from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Optional

from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to every response."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Attach a unique request ID to every request/response."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
        request.state.request_id = request_id

        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class RequestTimingMiddleware(BaseHTTPMiddleware):
    """Measure request duration and add timing headers."""

    def __init__(self, app, metrics: Optional[APIMetrics] = None):
        super().__init__(app)
        self._metrics = metrics

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start = time.monotonic()
        response = await call_next(request)
        duration_ms = (time.monotonic() - start) * 1000

        response.headers["X-Response-Time"] = f"{duration_ms:.1f}ms"

        if self._metrics:
            self._metrics.record_request(
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                duration_ms=duration_ms,
            )

        return response


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log every API request with method, path, status, and duration."""

    SKIP_PATHS = {"/api/health", "/favicon.ico"}

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.url.path in self.SKIP_PATHS:
            return await call_next(request)

        start = time.monotonic()
        response = await call_next(request)
        duration_ms = (time.monotonic() - start) * 1000

        request_id = getattr(request.state, "request_id", "?")
        client = request.client.host if request.client else "unknown"

        log_fn = logger.info if response.status_code < 400 else logger.warning
        log_fn(
            "%s %s %d %.1fms [%s] from %s",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            request_id[:8],
            client,
        )

        return response


@dataclass
class _RateBucket:
    tokens: float
    last_refill: float


_rate_limit_buckets: dict[str, _RateBucket] = {}


def reset_rate_limits() -> None:
    """Clear all rate-limit buckets (useful in tests)."""
    _rate_limit_buckets.clear()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Token-bucket rate limiting per client IP."""

    def __init__(self, app, requests_per_minute: int = 120,
                 burst: int = 20, exclude_paths: Optional[set[str]] = None):
        super().__init__(app)
        self._rpm = requests_per_minute
        self._burst = burst
        self._exclude = exclude_paths or {"/api/health", "/ws/"}
        self._buckets = _rate_limit_buckets
        self._refill_rate = requests_per_minute / 60.0

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path
        if any(path.startswith(p) for p in self._exclude):
            return await call_next(request)

        client_ip = request.client.host if request.client else "0.0.0.0"
        bucket = self._get_bucket(client_ip)

        now = time.monotonic()
        elapsed = now - bucket.last_refill
        bucket.tokens = min(self._burst, bucket.tokens + elapsed * self._refill_rate)
        bucket.last_refill = now

        if bucket.tokens < 1:
            retry_after = int((1 - bucket.tokens) / self._refill_rate) + 1
            logger.warning("Rate limit exceeded for %s on %s", client_ip, path)
            return Response(
                content='{"detail":"Rate limit exceeded. Try again later."}',
                status_code=429,
                media_type="application/json",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(self._rpm),
                    "X-RateLimit-Remaining": "0",
                },
            )

        bucket.tokens -= 1

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self._rpm)
        response.headers["X-RateLimit-Remaining"] = str(int(bucket.tokens))
        return response

    def _get_bucket(self, client_ip: str) -> _RateBucket:
        if client_ip not in self._buckets:
            self._buckets[client_ip] = _RateBucket(
                tokens=float(self._burst),
                last_refill=time.monotonic(),
            )
        return self._buckets[client_ip]


class APIMetrics:
    """Track API metrics for monitoring."""

    def __init__(self):
        self._request_count: int = 0
        self._error_count: int = 0
        self._total_duration_ms: float = 0
        self._by_path: dict[str, dict] = defaultdict(
            lambda: {"count": 0, "errors": 0, "total_ms": 0, "max_ms": 0}
        )
        self._by_status: dict[int, int] = defaultdict(int)
        self._by_method: dict[str, int] = defaultdict(int)
        self._start_time = time.time()
        self._slow_requests: list[dict] = []
        self._slow_threshold_ms = 1000

    def record_request(self, method: str, path: str, status: int,
                        duration_ms: float) -> None:
        self._request_count += 1
        self._total_duration_ms += duration_ms
        self._by_status[status] += 1
        self._by_method[method] += 1

        normalized = self._normalize_path(path)
        entry = self._by_path[normalized]
        entry["count"] += 1
        entry["total_ms"] += duration_ms
        entry["max_ms"] = max(entry["max_ms"], duration_ms)

        if status >= 400:
            self._error_count += 1
            entry["errors"] += 1

        if duration_ms >= self._slow_threshold_ms:
            self._slow_requests.append({
                "method": method,
                "path": path,
                "status": status,
                "duration_ms": round(duration_ms, 1),
                "timestamp": time.time(),
            })
            if len(self._slow_requests) > 100:
                self._slow_requests = self._slow_requests[-100:]

    def get_summary(self) -> dict:
        uptime = time.time() - self._start_time
        avg_ms = (self._total_duration_ms / self._request_count
                  if self._request_count else 0)

        top_paths = sorted(
            self._by_path.items(),
            key=lambda x: x[1]["count"],
            reverse=True,
        )[:10]

        return {
            "uptime_seconds": int(uptime),
            "total_requests": self._request_count,
            "total_errors": self._error_count,
            "error_rate": round(self._error_count / max(self._request_count, 1) * 100, 2),
            "avg_response_ms": round(avg_ms, 1),
            "requests_per_second": round(self._request_count / max(uptime, 1), 2),
            "by_status": dict(self._by_status),
            "by_method": dict(self._by_method),
            "top_paths": [
                {
                    "path": p,
                    "count": d["count"],
                    "errors": d["errors"],
                    "avg_ms": round(d["total_ms"] / max(d["count"], 1), 1),
                    "max_ms": round(d["max_ms"], 1),
                }
                for p, d in top_paths
            ],
            "slow_requests": self._slow_requests[-10:],
        }

    def reset(self) -> None:
        self._request_count = 0
        self._error_count = 0
        self._total_duration_ms = 0
        self._by_path.clear()
        self._by_status.clear()
        self._by_method.clear()
        self._slow_requests.clear()
        self._start_time = time.time()

    @staticmethod
    def _normalize_path(path: str) -> str:
        """Collapse UUID/ID path segments for grouping."""
        parts = path.strip("/").split("/")
        normalized = []
        for part in parts:
            if len(part) == 36 and part.count("-") == 4:
                normalized.append("{id}")
            elif part.isdigit():
                normalized.append("{id}")
            else:
                normalized.append(part)
        return "/" + "/".join(normalized)


_metrics = APIMetrics()


def get_metrics() -> APIMetrics:
    return _metrics


def setup_middleware(app: FastAPI) -> None:
    """Configure all middleware for the application."""
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(RequestTimingMiddleware, metrics=_metrics)
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(RateLimitMiddleware, requests_per_minute=120, burst=20)

    logger.info("API middleware configured: security-headers, request-id, timing, logging, rate-limit")
