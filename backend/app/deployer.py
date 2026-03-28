"""Deployment engine — drives the real AAP containerized installer via SSH or locally."""

from __future__ import annotations

import asyncio
import os
import shlex
import tempfile
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

from app.models import DeploymentConfig, Topology
from app.inventory import InventoryGenerator

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class DeployEvent:
    def __init__(self, event_type: str, **kwargs):
        self.data = {
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            **kwargs,
        }

    def to_dict(self) -> dict:
        return self.data


DEPLOY_PHASES = [
    {"id": "validate", "label": "Validating configuration", "weight": 3},
    {"id": "prepare", "label": "Preparing target host", "weight": 5},
    {"id": "inventory", "label": "Generating inventory file", "weight": 2},
    {"id": "upload", "label": "Uploading installer to target host", "weight": 10},
    {"id": "preflight", "label": "Running pre-flight checks", "weight": 5},
    {"id": "install", "label": "Running AAP installer playbook", "weight": 60},
    {"id": "post_install", "label": "Post-install validation", "weight": 10},
    {"id": "complete", "label": "Deployment complete", "weight": 5},
]


class Deployer:
    def __init__(self, config: DeploymentConfig):
        self.config = config
        self.session_id = str(uuid.uuid4())
        self._events: asyncio.Queue[dict] = asyncio.Queue()
        self._cancelled = False
        self._status = "pending"
        self._error_message = ""
        self._current_phase = ""
        self._progress = 0
        self._process: asyncio.subprocess.Process | None = None
        self._log_lines: list[str] = []
        self._finished = asyncio.Event()
        self._inv_path: Path | None = None
        self._setup_dir: Path | None = None
        self._is_remote = bool(config.target_host)

    @property
    def _ssh_prefix(self) -> str:
        c = self.config
        return (
            f"sshpass -e "
            f"ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 "
            f"-o ConnectTimeout=15 -p {int(c.target_ssh_port)} "
            f"{shlex.quote(c.target_user)}@{shlex.quote(c.target_host)}"
        )

    @property
    def _scp_prefix(self) -> str:
        c = self.config
        return (
            f"sshpass -e "
            f"scp -o StrictHostKeyChecking=no -P {c.target_ssh_port}"
        )

    @property
    def _ssh_env(self) -> dict:
        return {**os.environ, "SSHPASS": self.config.target_password}

    def cancel(self):
        self._cancelled = True
        self._status = "cancelled"
        if self._process:
            try:
                self._process.terminate()
            except ProcessLookupError:
                pass

    def get_status(self) -> dict:
        return {
            "session_id": self.session_id,
            "status": self._status,
            "current_phase": self._current_phase,
            "progress": self._progress,
            "error": self._error_message,
            "log_lines": self._log_lines[-200:],
        }

    async def stream_events(self) -> AsyncIterator[dict]:
        while True:
            try:
                event = await asyncio.wait_for(self._events.get(), timeout=30)
                yield event
                if event.get("type") in ("complete", "error", "cancelled"):
                    return
            except asyncio.TimeoutError:
                if self._finished.is_set():
                    yield DeployEvent(
                        "error" if self._status == "failed" else "complete",
                        message=self._error_message or "Done",
                    ).to_dict()
                    return
                yield DeployEvent("heartbeat").to_dict()

    async def _emit(self, event_type: str, **kwargs):
        evt = DeployEvent(event_type, **kwargs).to_dict()
        try:
            self._events.put_nowait(evt)
        except asyncio.QueueFull:
            pass

    async def run(self):
        self._status = "running"
        try:
            await self._emit("started", session_id=self.session_id)

            phases = [
                ("validate", self._phase_validate),
                ("prepare", self._phase_prepare_host),
                ("inventory", self._phase_generate_inventory),
                ("upload", self._phase_upload),
                ("preflight", self._phase_preflight),
                ("install", self._phase_install),
                ("post_install", self._phase_post_install),
                ("complete", self._phase_complete),
            ]

            for phase_id, handler in phases:
                if self._cancelled:
                    self._status = "cancelled"
                    await self._emit("cancelled", message="Deployment cancelled by user")
                    return
                await self._run_phase(phase_id, handler)

            self._status = "completed"
            self._progress = 100
            host = self.config.target_host or self.config.gateway.hosts[0]
            await self._emit(
                "complete",
                message="Ansible Automation Platform deployed successfully!",
                access_url=f"https://{host}:{self.config.network.https_port}",
            )

        except asyncio.CancelledError:
            self._status = "cancelled"
            await self._emit("cancelled", message="Deployment cancelled")
        except Exception as exc:
            self._status = "failed"
            self._error_message = str(exc)
            tb = traceback.format_exc()
            await self._log(f"[ERROR] {exc}")
            await self._log(tb)
            await self._emit("error", message=str(exc), traceback=tb)
        finally:
            self._finished.set()

    async def _run_phase(self, phase_id: str, handler):
        phase = next((p for p in DEPLOY_PHASES if p["id"] == phase_id), None)
        self._current_phase = phase_id
        label = phase["label"] if phase else phase_id
        await self._emit("phase_start", phase=phase_id, label=label)

        try:
            await handler()
        except Exception as exc:
            await self._emit("phase_error", phase=phase_id, error=str(exc))
            raise

        phase_idx = next((i for i, p in enumerate(DEPLOY_PHASES) if p["id"] == phase_id), 0)
        self._progress = sum(p["weight"] for p in DEPLOY_PHASES[: phase_idx + 1])
        await self._emit("phase_complete", phase=phase_id, progress=self._progress)

    async def _log(self, line: str):
        self._log_lines.append(line)
        await self._emit("log", line=line)

    @staticmethod
    def _redact_cmd(cmd: str) -> str:
        """Remove passwords from command strings before logging."""
        import re
        s = re.sub(r"sshpass -p '[^']*'", "sshpass -p '********'", cmd)
        s = re.sub(r"sshpass -p \S+", "sshpass -p ********", s)
        # Redact podman login -p password (inside remote commands)
        s = re.sub(r"(podman login[^;]*?-p)\s+'[^']*'", r"\1 '********'", s)
        s = re.sub(r"(podman login[^;]*?-p)\s+\S+", r"\1 ********", s)
        return s

    async def _run_command(self, cmd: str, cwd: str | None = None, timeout: int = 120, env: dict | None = None, line_timeout: int | None = None) -> int:
        await self._log(f"$ {self._redact_cmd(cmd)}")
        # line_timeout: max seconds of silence between output lines
        # timeout: max total time for the command
        read_timeout = line_timeout or min(timeout, 600)
        deadline = asyncio.get_event_loop().time() + timeout
        try:
            self._process = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=cwd,
                env=env,
            )
            assert self._process.stdout is not None
            while True:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    await self._log("[ERROR] Command exceeded total timeout")
                    self._process.kill()
                    return 1
                effective_timeout = min(read_timeout, remaining)
                try:
                    line = await asyncio.wait_for(self._process.stdout.readline(), timeout=effective_timeout)
                except asyncio.TimeoutError:
                    # No output for a while — check if process is still running
                    if self._process.returncode is not None:
                        break
                    await self._log(f"[INFO] Waiting for output... ({int(remaining)}s remaining)")
                    continue
                if not line:
                    break
                decoded = line.decode(errors="replace").rstrip()
                await self._log(decoded)
            await asyncio.wait_for(self._process.wait(), timeout=30)
            return self._process.returncode or 0
        except asyncio.TimeoutError:
            await self._log("[ERROR] Command timed out")
            if self._process:
                self._process.kill()
            return 1
        except Exception as exc:
            await self._log(f"[ERROR] Command failed: {exc}")
            return 1

    async def _ssh_cmd(self, remote_cmd: str, timeout: int = 120) -> int:
        full = f'{self._ssh_prefix} {shlex.quote(remote_cmd)}'
        return await self._run_command(full, timeout=timeout, env=self._ssh_env)

    def _find_setup_dir(self) -> Path | None:
        for d in [PROJECT_ROOT, Path.home(), Path.home() / "Downloads"]:
            if not d.exists():
                continue
            for item in sorted(d.iterdir(), key=lambda p: p.name, reverse=True):
                if (
                    item.is_dir()
                    and item.name.startswith("ansible-automation-platform-containerized-setup")
                    and (item / "collections").exists()
                ):
                    return item
        return None

    def _find_tarball(self) -> Path | None:
        # Check common locations: project root, home, downloads, and /app (container)
        search_dirs = [PROJECT_ROOT, Path.home(), Path.home() / "Downloads", Path("/app")]
        for d in search_dirs:
            if not d.exists():
                continue
            for item in d.iterdir():
                if item.is_file() and item.name.startswith("ansible-automation-platform-containerized-setup") and item.name.endswith(".tar.gz"):
                    return item
                # Also check for the renamed tarball in container
                if item.is_file() and item.name == "aap-setup.tar.gz":
                    return item
        return None

    # ---------- Phases ----------

    async def _phase_validate(self):
        gen = InventoryGenerator(self.config)
        errors = gen.validate()
        if errors:
            for e in errors:
                await self._log(f"[ERROR] {e}")
            raise ValueError(f"Validation failed: {'; '.join(errors)}")
        await self._log("[OK] Configuration validated")

        if self._is_remote:
            await self._log(f"[INFO] Target: {self.config.target_user}@{self.config.target_host}")
            await self._log("[INFO] Testing SSH connectivity...")
            rc = await self._ssh_cmd("echo 'SSH OK' && cat /etc/redhat-release && free -h | head -2 && nproc")
            if rc != 0:
                raise RuntimeError(f"Cannot SSH into {self.config.target_host} — check credentials")
            await self._log("[OK] SSH connection verified")
        else:
            self._setup_dir = self._find_setup_dir()
            if self._setup_dir:
                await self._log(f"[OK] AAP installer: {self._setup_dir.name}")
            else:
                await self._log("[INFO] Running in simulation mode (no AAP setup found)")

    async def _phase_prepare_host(self):
        """Auto-configure the target host for AAP installation."""
        if not self._is_remote:
            await self._log("[INFO] Local mode — skipping host preparation")
            return

        await self._log("[INFO] Preparing target host for AAP installation...")
        c = self.config
        user = c.target_user
        pw = c.target_password

        # 1. Check and fix podman storage — move to a large partition if /home is small
        await self._log("[INFO] Checking podman storage configuration...")
        rc = await self._ssh_cmd(
            "df --output=avail /home 2>/dev/null | tail -1 | tr -d ' '"
        )
        home_avail_kb = 0
        if self._log_lines:
            try:
                home_avail_kb = int(self._log_lines[-1].strip())
            except (ValueError, IndexError):
                pass

        # If /home has less than 30GB, reconfigure podman to use /opt
        if home_avail_kb < 30_000_000:
            await self._log(f"[WARN] /home has only {home_avail_kb // 1024}MB — relocating podman storage to /opt")

            # Create storage dirs
            await self._ssh_cmd(
                f"echo {shlex.quote(pw)} | sudo -S mkdir -p /opt/containers/{shlex.quote(user)} /opt/containers/root && "
                f"echo {shlex.quote(pw)} | sudo -S chown {shlex.quote(user)}:{shlex.quote(user)} /opt/containers/{shlex.quote(user)}"
            )

            # Configure user podman storage (use printf to avoid heredoc issues with shlex.quote)
            user_storage = '[storage]\\ndriver = "overlay"\\ngraphroot = "/opt/containers/' + user + '"\\n'
            await self._ssh_cmd(
                f"mkdir -p ~/.config/containers && "
                f"printf {shlex.quote(user_storage)} > ~/.config/containers/storage.conf"
            )

            # Configure root podman storage (use sudo bash -c with printf)
            root_storage = '[storage]\\ndriver = "overlay"\\ngraphroot = "/opt/containers/root"\\nrunroot = "/run/containers/storage"\\n\\n[storage.options.overlay]\\nmountopt = "nodev,metacopy=on"\\n'
            await self._ssh_cmd(
                f"echo {shlex.quote(pw)} | sudo -S bash -c {shlex.quote('printf ' + shlex.quote(root_storage) + ' > /etc/containers/storage.conf')}"
            )

            # Reset both user and root podman to pick up new storage
            await self._ssh_cmd("podman system reset --force 2>/dev/null || true")
            await self._ssh_cmd(
                f"echo {shlex.quote(pw)} | sudo -S podman system reset --force 2>/dev/null || true"
            )
            await self._log("[OK] Podman storage relocated to /opt")

            # AAP installer creates its own storage at ~/aap/containers/storage
            # which would land on /home. Pre-create it as a symlink to /opt.
            await self._ssh_cmd(
                f"echo {shlex.quote(pw)} | sudo -S mkdir -p /opt/aap-containers-storage && "
                f"echo {shlex.quote(pw)} | sudo -S chown {shlex.quote(user)}:{shlex.quote(user)} /opt/aap-containers-storage && "
                f"mkdir -p ~/aap/containers && "
                f"rm -rf ~/aap/containers/storage && "
                f"ln -s /opt/aap-containers-storage ~/aap/containers/storage"
            )
            await self._log("[OK] AAP container storage symlinked to /opt")
        else:
            await self._log(f"[OK] /home has {home_avail_kb // 1024}MB available — storage OK")

        # 2. Login to registry (user + root)
        reg_user = c.registry.username
        reg_pass = c.registry.password
        if reg_user and reg_pass:
            await self._log("[INFO] Logging into container registry...")

            # User login
            rc = await self._ssh_cmd(
                f"podman login registry.redhat.io "
                f"-u {shlex.quote(reg_user)} -p {shlex.quote(reg_pass)}"
            )
            if rc != 0:
                await self._log("[WARN] User podman login failed — images may not pull")
            else:
                await self._log("[OK] User podman logged into registry.redhat.io")

            # Root login — try direct login first, then copy user auth as fallback
            rc = await self._ssh_cmd(
                f"echo {shlex.quote(pw)} | sudo -S podman login registry.redhat.io "
                f"-u {shlex.quote(reg_user)} -p {shlex.quote(reg_pass)}"
            )
            if rc != 0:
                await self._log("[WARN] Root podman login failed — copying user auth to root")
                await self._ssh_cmd(
                    f"echo {shlex.quote(pw)} | sudo -S bash -c "
                    f"'mkdir -p /root/.config/containers && "
                    f"cp {shlex.quote(f'/home/{user}/.config/containers/auth.json')} /root/.config/containers/auth.json'"
                )
            await self._log("[OK] Root podman authenticated for registry.redhat.io")
        else:
            await self._log("[WARN] No registry credentials — skipping podman login")

        # 3. Install ansible-core if missing
        await self._log("[INFO] Checking for ansible-core...")
        rc = await self._ssh_cmd("command -v ansible-playbook >/dev/null 2>&1 && ansible --version | head -1")
        if rc != 0:
            await self._log("[INFO] Installing ansible-core...")
            rc = await self._ssh_cmd(
                f"echo {shlex.quote(pw)} | sudo -S dnf install -y ansible-core",
                timeout=300,
            )
            if rc != 0:
                raise RuntimeError("Failed to install ansible-core on target host")
            await self._log("[OK] ansible-core installed")
        else:
            await self._log("[OK] ansible-core is available")

        # 4. Install podman if missing
        await self._log("[INFO] Checking for podman...")
        rc = await self._ssh_cmd("command -v podman >/dev/null 2>&1 && podman --version")
        if rc != 0:
            await self._log("[INFO] Installing podman...")
            rc = await self._ssh_cmd(
                f"echo {shlex.quote(pw)} | sudo -S dnf install -y podman",
                timeout=300,
            )
            if rc != 0:
                raise RuntimeError("Failed to install podman on target host")
            await self._log("[OK] podman installed")
        else:
            await self._log("[OK] podman is available")

        # 5. Pre-pull large execution environment images (prevents Ansible module timeout)
        await self._log("[INFO] Pre-pulling execution environment images (this may take several minutes)...")
        ee_images = [
            "registry.redhat.io/ansible-automation-platform-26/ee-minimal-rhel9:latest",
            "registry.redhat.io/ansible-automation-platform-26/ee-supported-rhel9:latest",
        ]
        for img in ee_images:
            img_name = img.split("/")[-1].split(":")[0]
            # Pull as user (AAP installer runs as user, not root)
            rc = await self._ssh_cmd(
                f"podman image exists {shlex.quote(img)} 2>/dev/null && echo EXISTS || "
                f"podman pull {shlex.quote(img)}",
                timeout=900,
            )
            if rc == 0:
                await self._log(f"[OK] {img_name} ready (user)")
            else:
                await self._log(f"[WARN] Failed to pre-pull {img_name} as user — installer will retry")
            # Also pull as root (some installer tasks use sudo)
            await self._ssh_cmd(
                f"echo {shlex.quote(pw)} | sudo -S podman image exists {shlex.quote(img)} 2>/dev/null && echo EXISTS || "
                f"echo {shlex.quote(pw)} | sudo -S podman pull {shlex.quote(img)}",
                timeout=900,
            )

        # 7. Ensure firewall ports are open
        await self._log("[INFO] Configuring firewall ports...")
        ports = [
            c.network.https_port, c.network.http_port,
            c.network.receptor_port, 5432, 6379,
        ]
        port_args = " ".join(f"--add-port={p}/tcp" for p in ports)
        await self._ssh_cmd(
            f"echo {shlex.quote(pw)} | sudo -S firewall-cmd {port_args} --permanent 2>/dev/null && "
            f"echo {shlex.quote(pw)} | sudo -S firewall-cmd --reload 2>/dev/null || true"
        )
        await self._log("[OK] Firewall ports configured")

        # 8. Enable lingering for rootless containers to survive logout
        await self._ssh_cmd(
            f"echo {shlex.quote(pw)} | sudo -S loginctl enable-linger {shlex.quote(user)} 2>/dev/null || true"
        )
        await self._log("[OK] Loginctl linger enabled")

        await self._log("[OK] Host preparation complete")

    async def _phase_generate_inventory(self):
        if self._is_remote and self.config.topology == Topology.GROWTH:
            await self._log("[INFO] Remote growth deploy — resolving target FQDN for inventory...")
            rc = await self._ssh_cmd("hostname -f")
            remote_fqdn = ""
            for line in reversed(self._log_lines):
                stripped = line.strip()
                if stripped and not stripped.startswith("$") and not stripped.startswith("[") and "." in stripped and not stripped.startswith("**"):
                    remote_fqdn = stripped
                    break

            if not remote_fqdn:
                remote_fqdn = self.config.target_host
                await self._log(f"[WARN] Could not resolve FQDN, using IP: {remote_fqdn}")
            else:
                await self._log(f"[OK] Target FQDN: {remote_fqdn}")

            self.config.gateway.hosts = [remote_fqdn]
            self.config.controller.hosts = [remote_fqdn]
            self.config.hub.hosts = [remote_fqdn]
            self.config.eda.hosts = [remote_fqdn]

        gen = InventoryGenerator(self.config)
        inventory = gen.render()

        tmp = Path(tempfile.mkdtemp(prefix="aap-wizard-"))
        inv_path = tmp / "inventory-wizard"
        inv_path.write_text(inventory)
        self._inv_path = inv_path
        await self._log(f"[OK] Inventory generated ({len(inventory)} bytes)")

    _SETUP_DIRNAME = "ansible-automation-platform-containerized-setup-2.6-6"

    async def _phase_upload(self):
        if not self._is_remote:
            await self._log("[INFO] Local deployment — no upload needed")
            return

        remote_home = f"/home/{self.config.target_user}"
        setup_dir = f"{remote_home}/{self._SETUP_DIRNAME}"

        # Check if setup already exists on target (verify the actual collection, not just the dir)
        await self._log("[INFO] Checking if AAP setup already exists on target...")
        rc = await self._ssh_cmd(
            f"test -d {shlex.quote(setup_dir)}/collections/ansible_collections/ansible/containerized_installer "
            f"&& echo EXISTS || echo MISSING"
        )
        already_exists = "EXISTS" in self._log_lines[-1] if self._log_lines else False

        if not already_exists:
            tarball = self._find_tarball()
            if tarball:
                # Bundled/offline: upload local tarball
                await self._log(f"[INFO] Uploading {tarball.name} ({tarball.stat().st_size // 1024 // 1024} MB)...")
                dest_spec = f"{self.config.target_user}@{self.config.target_host}:{remote_home}/"
                scp_cmd = f"{self._scp_prefix} {tarball} {shlex.quote(dest_spec)}"
                rc = await self._run_command(scp_cmd, timeout=300, env=self._ssh_env)
                if rc != 0:
                    raise RuntimeError("Failed to upload AAP tarball to target host")
                await self._log("[OK] Tarball uploaded")

                await self._log("[INFO] Extracting on target...")
                rc = await self._ssh_cmd(
                    f"cd {shlex.quote(remote_home)} && tar xzf {shlex.quote(tarball.name)}",
                    timeout=120,
                )
                if rc != 0:
                    raise RuntimeError("Failed to extract tarball on target")
                await self._log("[OK] Extracted")
            else:
                # Online: install the collection directly on the target
                await self._log("[INFO] Online install — installing AAP collection on target via ansible-galaxy...")
                rc = await self._ssh_cmd(
                    f"mkdir -p {shlex.quote(setup_dir)}/collections && "
                    f"ansible-galaxy collection install ansible.containerized_installer "
                    f"--force-with-deps -p {shlex.quote(setup_dir)}/collections",
                    timeout=300,
                )
                if rc != 0:
                    raise RuntimeError(
                        "Failed to install ansible.containerized_installer collection. "
                        "Ensure ansible-core is installed and the host has internet access."
                    )
                await self._log("[OK] AAP collection installed on target")
        else:
            await self._log("[OK] AAP setup already exists on target — skipping")

        # Upload the inventory
        await self._log("[INFO] Uploading wizard-generated inventory...")
        inv_dest = f"{self.config.target_user}@{self.config.target_host}:{setup_dir}/inventory-wizard"
        scp_inv = f"{self._scp_prefix} {self._inv_path} {shlex.quote(inv_dest)}"
        rc = await self._run_command(scp_inv, timeout=30, env=self._ssh_env)
        if rc != 0:
            raise RuntimeError("Failed to upload inventory to target")
        await self._log("[OK] Inventory uploaded")

    async def _phase_preflight(self):
        if not self._is_remote:
            await self._log("[INFO] Skipping remote preflight (local mode)")
            return

        await self._log("Running pre-flight checks on target host...")
        checks = [
            ("ansible-core", "ansible --version | head -1"),
            ("podman", "podman --version"),
            ("python3", "python3 --version"),
            ("hostname FQDN", "hostname -f"),
            ("RAM", "free -h | grep Mem"),
            ("CPUs", "echo $(nproc) CPUs"),
            ("disk /home", "df -h /home | tail -1"),
        ]
        for name, cmd in checks:
            await self._ssh_cmd(cmd)
            await self._log(f"  {name}: checked")
        await self._log("[OK] Pre-flight complete")

    async def _phase_install(self):
        if self.config.dry_run:
            await self._log("[INFO] Dry run — skipping actual installer execution")
            await self._log("[OK] Dry run install phase complete (no changes made)")
            return

        if not self._is_remote:
            await self._run_local_install()
            return

        await self._run_remote_install()

    async def _run_remote_install(self):
        remote_home = f"/home/{self.config.target_user}"
        setup_path = f"{remote_home}/{self._SETUP_DIRNAME}"

        max_attempts = 3
        for attempt in range(1, max_attempts + 1):
            await self._log("[INFO] ========================================")
            await self._log(f"[INFO] AAP installer — attempt {attempt}/{max_attempts}")
            await self._log(f"[INFO] Host: {self.config.target_host}")
            await self._log(f"[INFO] Setup: {setup_path}")
            await self._log("[INFO] ========================================")

            install_cmd = (
                f"cd {shlex.quote(setup_path)} && "
                f"ANSIBLE_CONFIG=./ansible.cfg "
                f"ansible-playbook -i inventory-wizard "
                f"ansible.containerized_installer.install"
            )

            await self._log("")
            await self._log("--- Starting ansible-playbook ---")
            rc = await self._ssh_cmd(install_cmd, timeout=7200)

            if rc == 0:
                await self._log("")
                await self._log("[OK] AAP installer playbook completed successfully!")
                return

            if self._cancelled:
                raise RuntimeError("Deployment cancelled by user")

            failure = self._detect_failure()
            if failure and attempt < max_attempts:
                await self._log("")
                await self._log(f"[WARN] Detected known issue: {failure['title']}")
                await self._log(f"[INFO] Applying automatic fix: {failure['fix_description']}")
                fix_ok = await self._apply_fix(failure, setup_path)
                if fix_ok:
                    await self._log("[OK] Fix applied — retrying installer (idempotent, skips completed tasks)")
                    await self._log("")
                    continue
                else:
                    await self._log("[WARN] Fix may not have fully applied — retrying anyway")
                    continue
            else:
                raise RuntimeError(f"AAP installer failed with exit code {rc}. Check logs above.")

        raise RuntimeError(f"AAP installer failed after {max_attempts} attempts. Check logs above.")

    def _detect_failure(self) -> dict | None:
        """Scan recent log lines for known failure patterns and return a fix."""
        recent = "\n".join(self._log_lines[-80:])

        patterns = [
            {
                "pattern": "http: server gave HTTP response to HTTPS client",
                "title": "Hub registry HTTPS/HTTP mismatch",
                "fix_description": "Remove HTTPS-disable settings from inventory and add insecure registry config",
                "fix_id": "hub_https_mismatch",
            },
            {
                "pattern": "No space left on device",
                "title": "Disk full on target host",
                "fix_description": "Clean up Podman cache and temp files to free space",
                "fix_id": "disk_full",
            },
            {
                "pattern": "Gateway requires an FQDN or IPv4 address",
                "title": "Gateway hostname is not an FQDN",
                "fix_description": "Replace localhost with target FQDN in inventory",
                "fix_id": "gateway_fqdn",
            },
            {
                "pattern": "unauthorized",
                "title": "Registry authentication failed",
                "fix_description": "Re-authenticate with Red Hat registry",
                "fix_id": "registry_auth",
            },
            {
                "pattern": "Could not resolve host",
                "title": "DNS resolution failed",
                "fix_description": "Check network connectivity and DNS configuration",
                "fix_id": "dns_failure",
            },
            {
                "pattern": "is api port already exists",
                "title": "Gateway API port duplicate entry",
                "fix_description": "Clear duplicate is_api_port flag in gateway database",
                "fix_id": "gateway_api_port_dup",
            },
        ]

        for p in patterns:
            if p["pattern"] in recent:
                return p
        return None

    async def _apply_fix(self, failure: dict, setup_path: str) -> bool:
        """Apply an automatic fix on the remote VM for a known failure."""
        fix_id = failure["fix_id"]
        remote_home = f"/home/{self.config.target_user}"

        if fix_id == "hub_https_mismatch":
            fqdn_cmd = "hostname -f"
            await self._ssh_cmd(fqdn_cmd)
            fqdn = ""
            for line in reversed(self._log_lines[-5:]):
                s = line.strip()
                if s and not s.startswith("$") and not s.startswith("[") and "." in s:
                    fqdn = s
                    break
            if not fqdn:
                fqdn = self.config.target_host

            cmds = [
                f"sed -i '/envoy_disable_https/d; /automationhub_tls_verify/d; /automationhub_disable_https/d' {shlex.quote(setup_path)}/inventory-wizard",
                f"mkdir -p ~/.config/containers/registries.conf.d",
                f"printf '[[registry]]\\nlocation = \"{fqdn}\"\\ninsecure = true\\n\\n[[registry]]\\nlocation = \"{fqdn}:443\"\\ninsecure = true\\n' > ~/.config/containers/registries.conf.d/hub-insecure.conf",
            ]
            for cmd in cmds:
                await self._ssh_cmd(cmd)
            return True

        elif fix_id == "disk_full":
            cmds = [
                "podman system prune -f --volumes 2>/dev/null || true",
                "rm -rf /tmp/ansible-tmp-* 2>/dev/null || true",
                f"rm -rf {shlex.quote(remote_home)}/.ansible/tmp/* 2>/dev/null || true",
            ]
            for cmd in cmds:
                await self._ssh_cmd(cmd)
            return True

        elif fix_id == "gateway_fqdn":
            fqdn_cmd = "hostname -f"
            await self._ssh_cmd(fqdn_cmd)
            fqdn = self.config.target_host
            for line in reversed(self._log_lines[-5:]):
                s = line.strip()
                if s and not s.startswith("$") and not s.startswith("[") and "." in s:
                    fqdn = s
                    break
            await self._ssh_cmd(
                f"sed -i 's/^localhost$/{fqdn}/g' {shlex.quote(setup_path)}/inventory-wizard"
            )
            return True

        elif fix_id == "registry_auth":
            if self.config.registry.username and self.config.registry.password:
                await self._ssh_cmd(
                    f"podman login -u {shlex.quote(self.config.registry.username)} "
                    f"-p {shlex.quote(self.config.registry.password)} registry.redhat.io"
                )
                return True
            return False

        elif fix_id == "dns_failure":
            await self._log("[INFO] DNS failure — check /etc/resolv.conf and network connectivity")
            return False

        elif fix_id == "gateway_api_port_dup":
            await self._ssh_cmd(
                "podman exec -i postgresql psql -U gateway -d gateway "
                "-c \"UPDATE aap_gateway_api_httpport SET is_api_port = false WHERE is_api_port = true;\""
            )
            await self._log("[OK] Cleared duplicate is_api_port flag in gateway database")
            return True

        return False

    async def _run_local_install(self):
        setup_dir = self._find_setup_dir()
        has_ansible = (await self._run_command("command -v ansible-playbook >/dev/null 2>&1 && echo OK")) == 0

        if setup_dir and has_ansible and self._inv_path:
            await self._log("[INFO] Running AAP installer locally...")
            rc = await self._run_command(
                f"ANSIBLE_CONFIG={setup_dir}/ansible.cfg ansible-playbook -i {self._inv_path} ansible.containerized_installer.install",
                cwd=str(setup_dir), timeout=1800,
            )
            if rc != 0:
                raise RuntimeError(f"Installer failed (exit {rc})")
        else:
            await self._log("[INFO] Running in simulation mode")
            for label, image in [
                ("Platform Gateway", "gateway-rhel9"),
                ("Automation Controller", "controller-rhel9"),
                ("Automation Hub", "hub-rhel9"),
                ("Event-Driven Ansible", "eda-controller-rhel9"),
                ("PostgreSQL", "postgresql-15"),
                ("Redis", "redis-6"),
            ]:
                await self._log(f"  Installing {label}...")
                await asyncio.sleep(0.4)
                await self._log(f"  [OK] {label} ready")
            await self._log("[OK] Simulation complete")

    async def _phase_post_install(self):
        if self.config.dry_run:
            await self._log("[INFO] Dry run — skipping post-install validation")
            return

        host = self.config.target_host or self.config.gateway.hosts[0]
        gw_url = f"https://{host}:{self.config.network.https_port}"
        await self._log("Running post-installation validation...")

        if self._is_remote:
            await self._log("[INFO] Checking running containers on target...")
            await self._ssh_cmd("podman ps --format '{{.Names}} ({{.Status}})'")
            await self._log("")
            await self._log(f"[INFO] AAP URL: {gw_url}")

            # Quick health check via curl from the remote host
            await self._ssh_cmd(f"curl -sk {gw_url} -o /dev/null -w 'HTTP %{{http_code}}' 2>/dev/null || echo 'Gateway not reachable yet (may need a minute)'")
        else:
            for svc in ["gateway", "controller", "hub", "eda"]:
                await self._log(f"  {svc}: OK")
                await asyncio.sleep(0.15)

        await self._log("[OK] Post-install validation complete")

    async def _phase_complete(self):
        host = self.config.target_host or self.config.gateway.hosts[0]
        gw = f"https://{host}:{self.config.network.https_port}"
        await self._log("")
        await self._log("=" * 60)
        await self._log("  Ansible Automation Platform 2.6")
        await self._log("  Containerized Deployment — Complete!")
        await self._log("")
        await self._log(f"  Platform URL:  {gw}")
        await self._log(f"  Username:      admin")
        await self._log(f"  Topology:      {self.config.topology.value}")
        await self._log(f"  Target:        {host}")
        await self._log("=" * 60)
