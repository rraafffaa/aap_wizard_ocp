import os
import json
import time
import asyncio
from dataclasses import asdict
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Body, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.models import (
    DeploymentConfig,
    PreflightRequest,
    PreflightResult,
    PrepareRequest,
    PrepareResult,
    InventoryGenerationRequest,
)
from app.inventory import InventoryGenerator
from app.preflight import PreflightChecker, HostPreparer
from app.deployer import Deployer

from app.services.health_monitor import HealthMonitor, HealthCheckScheduler
from app.services.audit_service import AuditService
from app.services.profile_service import ProfileService
from app.services.backup_service import BackupService
from app.services.rollback_manager import RollbackManager
from app.services.notification_service import NotificationService, NotificationConfig
from app.services.certificate_manager import CertificateManager
from app.services.report_generator import ReportGenerator
from app.services.config_validator import ConfigValidator
from app.middleware import setup_middleware
from app.auth import (
    LoginRequest, LoginResponse, UserInfo,
    validate_registry_credentials, create_token, decode_token,
    get_token_from_request, is_public_path,
)

from app.services.ai_debugger import AIDebugger

DEPLOY_SESSIONS: dict[str, Deployer] = {}

ai_debugger = AIDebugger()
audit_service = AuditService()
profile_service = ProfileService()
backup_service = BackupService()
rollback_manager = RollbackManager()
notification_service = NotificationService()
certificate_manager = CertificateManager()
report_generator = ReportGenerator()
config_validator = ConfigValidator()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    for deployer in DEPLOY_SESSIONS.values():
        deployer.cancel()


app = FastAPI(
    title="AAP Deployment Wizard API",
    version="1.0.0",
    lifespan=lifespan,
)

setup_middleware(app)


# ============================================================
# JWT Auth Middleware
# ============================================================

@app.middleware("http")
async def auth_middleware(request, call_next):
    if request.method == "OPTIONS" or is_public_path(request.url.path):
        return await call_next(request)
    token = get_token_from_request(request)
    if not token:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=401, content={"detail": "Authentication required"})
    try:
        decode_token(token)
    except HTTPException as exc:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    return await call_next(request)


# CORS: In production, set CORS_ORIGINS env var. No default localhost origins.
_cors_env = os.environ.get("CORS_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in _cors_env.split(",") if o.strip()] if _cors_env else []

if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    )


# ============================================================
# Auth
# ============================================================

_login_attempts: dict[str, list[float]] = {}
_LOGIN_RATE_LIMIT = 10  # max attempts per window
_LOGIN_RATE_WINDOW = 300  # 5 minutes

@app.post("/api/auth/login", response_model=LoginResponse)
async def login(req: LoginRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    # Clean old entries and check rate limit
    attempts = _login_attempts.get(client_ip, [])
    attempts = [t for t in attempts if now - t < _LOGIN_RATE_WINDOW]
    if len(attempts) >= _LOGIN_RATE_LIMIT:
        raise HTTPException(429, "Too many login attempts. Try again in a few minutes.")
    attempts.append(now)
    _login_attempts[client_ip] = attempts

    valid = await validate_registry_credentials(req.username, req.password)
    if not valid:
        raise HTTPException(401, "Invalid Red Hat Registry credentials")
    token, expires_at = create_token(req.username)
    return LoginResponse(token=token, username=req.username, expires_at=expires_at)


@app.get("/api/auth/me")
async def auth_me(request: Request):
    token = get_token_from_request(request)
    if not token:
        raise HTTPException(401, "Not authenticated")
    user = decode_token(token)
    return {"username": user.username, "expires_at": user.expires_at}


# ============================================================
# Health
# ============================================================

@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/health/platform")
async def platform_health(gateway_url: str = Query("", description="Gateway URL for live checks")):
    if not gateway_url:
        monitor = HealthMonitor("https://localhost", {})
        result = await monitor.simulate_health()
    else:
        monitor = HealthMonitor(gateway_url, {"verify_ssl": False, "timeout": 10})
        result = await monitor.check_all()

    return {
        "overall": result.overall,
        "components": [asdict(c) for c in result.components],
        "database": asdict(result.database),
        "last_updated": result.last_updated,
        "uptime_seconds": result.uptime_seconds,
    }


# ============================================================
# Profiles
# ============================================================

class ProfileCreateRequest(BaseModel):
    name: str
    description: str = ""
    config: dict = {}
    tags: list[str] = []
    topology: str = ""


class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    config: Optional[dict] = None
    tags: Optional[list[str]] = None
    topology: Optional[str] = None


@app.get("/api/profiles")
async def list_profiles(category: Optional[str] = None):
    if category == "preset":
        profiles = profile_service.get_presets()
    elif category == "custom":
        profiles = profile_service.get_custom()
    else:
        profiles = profile_service.get_all()
    return {"profiles": [asdict(p) for p in profiles]}


@app.get("/api/profiles/{profile_id}")
async def get_profile(profile_id: str):
    profile = profile_service.get_by_id(profile_id)
    if not profile:
        raise HTTPException(404, "Profile not found")
    return asdict(profile)


@app.post("/api/profiles")
async def create_profile(req: ProfileCreateRequest):
    profile = profile_service.create(
        name=req.name,
        description=req.description,
        config=req.config,
        tags=req.tags,
        topology=req.topology,
    )
    audit_service.log(
        action="profile_create",
        category="config",
        details=f"Created profile '{req.name}'",
        metadata={"profile_id": profile.id},
    )
    return asdict(profile)


@app.put("/api/profiles/{profile_id}")
async def update_profile(profile_id: str, req: ProfileUpdateRequest):
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    profile = profile_service.update(profile_id, updates)
    if not profile:
        raise HTTPException(404, "Profile not found or is a preset")
    audit_service.log(
        action="profile_update",
        category="config",
        details=f"Updated profile '{profile.name}'",
        metadata={"profile_id": profile_id},
    )
    return asdict(profile)


@app.delete("/api/profiles/{profile_id}")
async def delete_profile(profile_id: str):
    if not profile_service.delete(profile_id):
        raise HTTPException(404, "Profile not found or is a preset")
    audit_service.log(
        action="profile_delete",
        category="config",
        details=f"Deleted profile '{profile_id}'",
    )
    return {"deleted": True}


@app.get("/api/profiles/{profile_id}/yaml")
async def export_profile_yaml(profile_id: str):
    try:
        content = profile_service.export_yaml(profile_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return {"yaml": content}


@app.post("/api/profiles/import")
async def import_profile_yaml(body: dict = Body(...)):
    yaml_content = body.get("yaml", "")
    if not yaml_content:
        raise HTTPException(400, "No YAML content provided")
    try:
        profile = profile_service.import_yaml(yaml_content)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    audit_service.log(
        action="profile_import",
        category="config",
        details=f"Imported profile '{profile.name}'",
        metadata={"profile_id": profile.id},
    )
    return asdict(profile)


# ============================================================
# Audit
# ============================================================

@app.get("/api/audit")
async def list_audit_entries(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    category: Optional[str] = None,
    session_id: Optional[str] = None,
    since: Optional[float] = Query(None, description="Unix timestamp - entries after this time"),
):
    entries = audit_service.get_entries(
        limit=limit, offset=offset,
        category=category, session_id=session_id,
        since=since,
    )
    return {"entries": [asdict(e) for e in entries], "count": len(entries)}


@app.get("/api/audit/stats")
async def audit_stats():
    return audit_service.get_stats()


@app.get("/api/audit/export")
async def export_audit(format: str = Query("json", pattern="^(json|csv|text)$")):
    content = audit_service.export_log(format=format)
    return {"format": format, "content": content}


# ============================================================
# Backups
# ============================================================

class BackupCreateRequest(BaseModel):
    name: str
    config: dict
    inventory: str = ""
    audit_log: Optional[list] = None
    metadata: Optional[dict] = None


@app.get("/api/backups")
async def list_backups():
    manifests = backup_service.list_backups()
    return {
        "backups": [asdict(m) for m in manifests],
        "stats": backup_service.get_backup_stats(),
    }


@app.post("/api/backups")
async def create_backup(req: BackupCreateRequest):
    manifest = backup_service.create_backup(
        name=req.name,
        config=req.config,
        inventory=req.inventory,
        audit_log=req.audit_log,
        metadata=req.metadata,
    )
    audit_service.log(
        action="backup_create",
        category="system",
        details=f"Created backup '{req.name}'",
        metadata={"backup_id": manifest.id},
    )
    return asdict(manifest)


@app.get("/api/backups/{backup_id}")
async def get_backup(backup_id: str):
    backup = backup_service.get_backup(backup_id)
    if not backup:
        raise HTTPException(404, "Backup not found")
    return backup


@app.delete("/api/backups/{backup_id}")
async def delete_backup(backup_id: str):
    if not backup_service.delete_backup(backup_id):
        raise HTTPException(404, "Backup not found")
    audit_service.log(
        action="backup_delete",
        category="system",
        details=f"Deleted backup '{backup_id}'",
    )
    return {"deleted": True}


@app.post("/api/backups/{backup_id}/restore")
async def restore_backup(backup_id: str):
    try:
        result = backup_service.restore_backup(backup_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    audit_service.log(
        action="backup_restore",
        category="system",
        details=f"Restored backup '{backup_id}'",
        metadata={"contents": result.get("contents", [])},
    )
    return result


# ============================================================
# Certificates
# ============================================================

class CertGenerateRequest(BaseModel):
    hostnames: list[str]
    days: int = 365


class CertValidateRequest(BaseModel):
    cert_pem: str
    key_pem: Optional[str] = None
    ca_pem: Optional[str] = None


class CertInfoRequest(BaseModel):
    cert_pem: str


@app.post("/api/certificates/generate")
async def generate_certificates(req: CertGenerateRequest):
    if not req.hostnames:
        raise HTTPException(400, "At least one hostname is required")
    try:
        ca_pem, cert_pem, key_pem = certificate_manager.generate_self_signed(
            hostnames=req.hostnames, days=req.days,
        )
    except RuntimeError as exc:
        raise HTTPException(500, f"Certificate generation failed: {exc}")
    audit_service.log(
        action="cert_generate",
        category="config",
        details=f"Generated self-signed certificates for {', '.join(req.hostnames[:3])}",
        metadata={"hostnames": req.hostnames, "days": req.days},
    )
    return {"ca_cert": ca_pem, "server_cert": cert_pem, "server_key": key_pem}


@app.post("/api/certificates/validate")
async def validate_certificate(req: CertValidateRequest):
    try:
        chain = certificate_manager.validate_certificate(
            cert_pem=req.cert_pem,
            key_pem=req.key_pem,
            ca_pem=req.ca_pem,
        )
    except Exception as exc:
        raise HTTPException(400, f"Validation failed: {exc}")
    return {
        "is_valid": chain.is_valid,
        "errors": chain.errors,
        "warnings": chain.warnings,
        "certificates": [
            {
                "subject": c.subject,
                "issuer": c.issuer,
                "not_before": c.not_before.isoformat(),
                "not_after": c.not_after.isoformat(),
                "is_expired": c.is_expired,
                "is_self_signed": c.is_self_signed,
                "san_names": c.san_names,
                "key_algorithm": c.key_algorithm,
                "key_size": c.key_size,
                "fingerprint_sha256": c.fingerprint_sha256,
            }
            for c in chain.certificates
        ],
    }


@app.post("/api/certificates/info")
async def certificate_info(req: CertInfoRequest):
    try:
        info = certificate_manager.parse_certificate(req.cert_pem)
    except Exception as exc:
        raise HTTPException(400, f"Failed to parse certificate: {exc}")
    return {
        "subject": info.subject,
        "issuer": info.issuer,
        "serial_number": info.serial_number,
        "not_before": info.not_before.isoformat(),
        "not_after": info.not_after.isoformat(),
        "is_expired": info.is_expired,
        "is_self_signed": info.is_self_signed,
        "san_names": info.san_names,
        "key_algorithm": info.key_algorithm,
        "key_size": info.key_size,
        "signature_algorithm": info.signature_algorithm,
        "fingerprint_sha256": info.fingerprint_sha256,
    }


# ============================================================
# Rollback
# ============================================================

@app.get("/api/deploy/{session_id}/snapshots")
async def list_snapshots(session_id: str):
    snapshots = rollback_manager.get_snapshots(session_id)
    return {"snapshots": [asdict(s) for s in snapshots]}


@app.post("/api/deploy/{session_id}/rollback")
async def rollback_deployment(session_id: str, body: dict = Body(default={})):
    target_phase = body.get("target_phase")
    actions = rollback_manager.plan_rollback(session_id, target_phase=target_phase)
    if not actions:
        raise HTTPException(404, "No snapshots found or no rollback actions needed")

    results = []
    async for event in rollback_manager.execute_rollback(session_id, actions):
        results.append(event)

    audit_service.log(
        action="deploy_rollback",
        category="deploy",
        details=f"Rolled back session {session_id[:8]}",
        session_id=session_id,
        metadata={"target_phase": target_phase, "actions": len(actions)},
    )
    return {"session_id": session_id, "events": results}


class RetryRequest(BaseModel):
    config: dict


@app.post("/api/deploy/{session_id}/retry/{phase}")
async def retry_from_phase(session_id: str, phase: str, req: RetryRequest):
    new_session_id = await rollback_manager.retry_from_phase(
        session_id=session_id,
        phase=phase,
        config=req.config,
    )
    audit_service.log(
        action="deploy_retry",
        category="deploy",
        details=f"Retrying from phase '{phase}' (original: {session_id[:8]})",
        session_id=new_session_id,
        metadata={"original_session": session_id, "phase": phase},
    )
    return {"new_session_id": new_session_id, "phase": phase}


# ============================================================
# Notifications
# ============================================================

class NotificationConfigRequest(BaseModel):
    webhook_url: str = ""
    enabled: bool = False
    events: list[str] = []
    include_config: bool = False
    include_logs: bool = False
    headers: dict = {}


@app.get("/api/notifications/config")
async def get_notification_config():
    cfg = notification_service._config
    return {
        "webhook_url": cfg.webhook_url,
        "enabled": cfg.enabled,
        "events": cfg.events,
        "include_config": cfg.include_config,
        "include_logs": cfg.include_logs,
    }


@app.post("/api/notifications/config")
async def update_notification_config(req: NotificationConfigRequest):
    config = NotificationConfig(
        webhook_url=req.webhook_url,
        enabled=req.enabled,
        events=req.events or ["deploy_complete", "deploy_fail"],
        include_config=req.include_config,
        include_logs=req.include_logs,
        headers=req.headers,
    )
    notification_service.update_config(config)
    audit_service.log(
        action="notification_config_update",
        category="system",
        details=f"Updated notification config (enabled={config.enabled})",
    )
    return {"status": "updated"}


@app.post("/api/notifications/test")
async def test_notification():
    result = await notification_service.notify(
        event="test",
        title="Test Notification",
        message="This is a test notification from the AAP Deployment Wizard.",
        severity="info",
        metadata={"test": True},
    )
    return {
        "delivered": result.delivered,
        "error": result.delivery_error,
        "notification_id": result.id,
    }


@app.get("/api/notifications/history")
async def notification_history(limit: int = Query(50, ge=1, le=200)):
    history = notification_service.get_history(limit=limit)
    return {"notifications": [asdict(n) for n in history]}


# ============================================================
# Reports
# ============================================================

class ReportGenerateRequest(BaseModel):
    type: str  # pre-deploy, post-deploy, config, health
    config: dict


@app.post("/api/reports/generate")
async def generate_report(req: ReportGenerateRequest):
    config = req.config
    report_type = req.type

    if report_type == "pre-deploy":
        report = report_generator.generate_pre_deploy_report(config)
    elif report_type == "post-deploy":
        report = report_generator.generate_post_deploy_report(config, {})
    elif report_type == "config":
        report = report_generator.generate_config_report(config)
    elif report_type == "health":
        monitor = HealthMonitor("https://localhost", {})
        health_result = await monitor.simulate_health()
        health_dict = {
            "overall": health_result.overall,
            "components": [asdict(c) for c in health_result.components],
            "database": asdict(health_result.database),
            "uptime_seconds": health_result.uptime_seconds,
        }
        report = report_generator.generate_health_report(health_dict)
    else:
        raise HTTPException(400, f"Unknown report type: {report_type}")

    return {"report": report}


# ============================================================
# Config Validation
# ============================================================

class ConfigValidateRequest(BaseModel):
    config: dict


@app.post("/api/config/validate")
async def validate_config_endpoint(req: ConfigValidateRequest):
    report = config_validator.validate(req.config)
    return {
        "valid": report.valid,
        "errors": [
            {
                "field": r.field,
                "message": r.message,
                "severity": r.severity,
                "category": r.category,
                "fix_suggestion": r.fix_suggestion,
            }
            for r in report.errors
        ],
        "warnings": [
            {
                "field": r.field,
                "message": r.message,
                "severity": r.severity,
                "category": r.category,
                "fix_suggestion": r.fix_suggestion,
            }
            for r in report.warnings
        ],
        "score": report.score,
    }


# ============================================================
# Existing endpoints — Preflight, Inventory, Deploy
# ============================================================

class SSHVerifyRequest(BaseModel):
    target_host: str = Field(..., min_length=1, max_length=255)
    target_user: str = Field(default="aap", min_length=1, max_length=64)
    target_password: str = Field(default="", max_length=256)
    target_ssh_port: int = Field(default=22, ge=1, le=65535)


class SSHVerifyResult(BaseModel):
    connected: bool = False
    hostname: str = ""
    os: str = ""
    error: str = ""
    latency_ms: int = 0


@app.post("/api/ssh/verify", response_model=SSHVerifyResult)
async def verify_ssh(req: SSHVerifyRequest):
    """Quick SSH ping: connect, grab hostname + OS, return."""
    import shlex, time
    prefix = (
        f"sshpass -e "
        f"ssh -T -o StrictHostKeyChecking=no -o ConnectTimeout=8 "
        f"-p {int(req.target_ssh_port)} "
        f"{shlex.quote(req.target_user)}@{shlex.quote(req.target_host)}"
    )
    env = {**os.environ, "SSHPASS": req.target_password}
    cmd = f"{prefix} {shlex.quote('echo __OK__ && hostname -f && cat /etc/redhat-release 2>/dev/null || cat /etc/os-release 2>/dev/null | head -1')}"
    t0 = time.monotonic()
    try:
        proc = await asyncio.wait_for(
            asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=env),
            timeout=15,
        )
        raw, _ = await asyncio.wait_for(proc.communicate(), timeout=15)
        latency = int((time.monotonic() - t0) * 1000)
        text = raw.decode(errors="replace").strip()
        lines = [
            l for l in text.split("\n")
            if not l.startswith("** ") and not l.startswith("Warning:")
            and "post-quantum" not in l and "store now, decrypt later" not in l
            and "server may need to be upgraded" not in l
            and "We trust you" not in l and "Respect the privacy" not in l
            and "Think before you type" not in l
            and "With great power" not in l
            and "#1)" not in l and "#2)" not in l and "#3)" not in l
            and "password for" not in l.lower()
        ]
        if "__OK__" in lines[0] if lines else "":
            hostname = lines[1].strip() if len(lines) > 1 else ""
            os_info = lines[2].strip() if len(lines) > 2 else ""
            return SSHVerifyResult(connected=True, hostname=hostname, os=os_info, latency_ms=latency)
        return SSHVerifyResult(connected=False, error="\n".join(lines)[:300], latency_ms=latency)
    except asyncio.TimeoutError:
        return SSHVerifyResult(connected=False, error="Connection timed out after 15 seconds")
    except Exception as exc:
        return SSHVerifyResult(connected=False, error=str(exc)[:300])


class PortCheckRequest(BaseModel):
    target_host: str
    target_user: str = "aap"
    target_password: str = ""
    target_ssh_port: int = Field(default=22, ge=1, le=65535)
    ports: list[int] = Field(default=[80, 443, 27199], max_length=20)


class PortCheckResult(BaseModel):
    port: int
    open: bool
    service: str = ""


@app.post("/api/ports/check")
async def check_ports(req: PortCheckRequest):
    """Check if ports are accessible on the target host via SSH."""
    import shlex, time

    port_services = {80: "HTTP", 443: "HTTPS", 27199: "Receptor", 5432: "PostgreSQL", 6379: "Redis", 22: "SSH"}
    results: list[dict] = []

    # Validate port range
    for p in req.ports:
        if not (1 <= p <= 65535):
            raise HTTPException(400, f"Invalid port number: {p}")

    for port in req.ports:
        prefix = (
            f"sshpass -e ssh -T -o StrictHostKeyChecking=no -o ConnectTimeout=8 "
            f"-p {int(req.target_ssh_port)} "
            f"{shlex.quote(req.target_user)}@{shlex.quote(req.target_host)}"
        )
        # Check if port is listening OR if we can bind to it (meaning it's free/available)
        check_cmd = f"ss -tlnp 2>/dev/null | grep -q ':{port} ' && echo LISTENING || echo AVAILABLE"
        cmd = f"{prefix} {shlex.quote(check_cmd)}"
        env = {**os.environ, "SSHPASS": req.target_password}

        try:
            proc = await asyncio.wait_for(
                asyncio.create_subprocess_shell(cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, env=env),
                timeout=10,
            )
            raw, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            output = raw.decode(errors="replace").strip()
            # Filter SSH warnings
            lines = [l for l in output.split("\n") if not l.startswith("** ") and "post-quantum" not in l and "server may need" not in l]
            last_line = lines[-1].strip() if lines else ""
            is_available = last_line in ("LISTENING", "AVAILABLE")
            results.append({
                "port": port,
                "open": is_available,
                "status": "listening" if last_line == "LISTENING" else "available" if last_line == "AVAILABLE" else "error",
                "service": port_services.get(port, ""),
            })
        except Exception:
            results.append({"port": port, "open": False, "status": "error", "service": port_services.get(port, "")})

    return {"results": results}


class AIDiagnoseRequest(BaseModel):
    error_logs: str = Field(..., max_length=10000)
    config: Optional[dict] = None
    session_id: str = ""


@app.post("/api/ai/diagnose")
async def diagnose_error(req: AIDiagnoseRequest):
    """Use AI to diagnose a deployment error and suggest fixes."""
    config_summary = ai_debugger.summarize_config(req.config) if req.config else None

    # If session_id provided, append recent deploy logs for context
    logs = req.error_logs
    if req.session_id and req.session_id in DEPLOY_SESSIONS:
        deploy_logs = DEPLOY_SESSIONS[req.session_id].get_status().get("log_lines", [])
        if deploy_logs:
            logs = "\n".join(deploy_logs[-50:])

    result = await ai_debugger.diagnose(logs, config_summary)
    return result


@app.get("/api/ai/status")
async def ai_status():
    """Check if AI debugger is available."""
    return {"available": ai_debugger.available}


@app.post("/api/preflight", response_model=PreflightResult)
async def run_preflight(req: PreflightRequest):
    checker = PreflightChecker(req)
    result = await checker.run()
    audit_service.log(
        action="preflight_run",
        category="deploy",
        details=f"Preflight completed: {result.overall}",
    )
    return result


@app.post("/api/prepare", response_model=PrepareResult)
async def prepare_host(req: PrepareRequest):
    """SSH into the target VM and install missing AAP dependencies."""
    preparer = HostPreparer(req)
    result = await preparer.prepare()
    audit_service.log(
        action="host_prepare",
        category="deploy",
        details=f"Host preparation {'succeeded' if result.success else 'failed'}: {len(result.actions)} actions",
    )
    return result


@app.post("/api/inventory/generate")
async def generate_inventory(req: InventoryGenerationRequest):
    generator = InventoryGenerator(req.config)
    inventory_content = generator.render()
    return {"inventory": inventory_content}


@app.post("/api/inventory/validate")
async def validate_inventory(req: InventoryGenerationRequest):
    generator = InventoryGenerator(req.config)
    errors = generator.validate()
    return {"valid": len(errors) == 0, "errors": errors}


@app.post("/api/deploy/start")
async def start_deploy(config: DeploymentConfig):
    deployer = Deployer(config)
    session_id = deployer.session_id
    DEPLOY_SESSIONS[session_id] = deployer
    asyncio.create_task(deployer.run())
    audit_service.log_deploy_event(session_id, "start", f"Deployment started")
    asyncio.create_task(notification_service.notify_deploy_start(session_id, config.model_dump()))
    return {"session_id": session_id}


@app.post("/api/deploy/{session_id}/cancel")
async def cancel_deploy(session_id: str):
    deployer = DEPLOY_SESSIONS.get(session_id)
    if not deployer:
        raise HTTPException(404, "Session not found")
    deployer.cancel()
    audit_service.log_deploy_event(session_id, "cancel", "Deployment cancelled by user")
    return {"status": "cancelled"}


@app.get("/api/deploy/{session_id}/status")
async def deploy_status(session_id: str):
    deployer = DEPLOY_SESSIONS.get(session_id)
    if not deployer:
        raise HTTPException(404, "Session not found")
    return deployer.get_status()


# ---------- WebSocket for live deployment logs ----------

@app.websocket("/ws/deploy/{session_id}")
async def deploy_ws(websocket: WebSocket, session_id: str):
    # Authenticate WebSocket via query param token
    token = websocket.query_params.get("token", "")
    if not token:
        await websocket.close(code=4001, reason="Authentication required")
        return
    try:
        decode_token(token)
    except HTTPException:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    await websocket.accept()
    deployer = DEPLOY_SESSIONS.get(session_id)
    if not deployer:
        await websocket.send_json({"type": "error", "message": "Session not found"})
        await websocket.close()
        return
    try:
        async for event in deployer.stream_events():
            try:
                await websocket.send_json(event)
            except Exception:
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ---------- Serve frontend in production ----------

# Try local dev path (backend/app/main.py → project root) then container path
_app_dir = Path(__file__).resolve().parent.parent
frontend_dist = _app_dir.parent / "frontend" / "dist"
if not frontend_dist.exists():
    frontend_dist = _app_dir / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
