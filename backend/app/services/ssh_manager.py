"""SSH connection manager for remote AAP deployments.

Handles SSH connections, command execution, file transfers,
and connection pooling for multi-node deployments.
"""
from __future__ import annotations

import asyncio
import logging
import os
import socket
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncGenerator, Optional

try:
    import paramiko
    HAS_PARAMIKO = True
except ImportError:
    HAS_PARAMIKO = False

logger = logging.getLogger(__name__)


def _require_paramiko():
    if not HAS_PARAMIKO:
        raise ImportError(
            "paramiko is required for SSH operations. "
            "Install it with: pip install paramiko"
        )


@dataclass
class SSHConfig:
    hostname: str
    port: int = 22
    username: str = "aap"
    password: Optional[str] = None
    key_path: Optional[str] = None
    timeout: int = 30
    keepalive_interval: int = 60

    @property
    def key(self) -> str:
        return f"{self.username}@{self.hostname}:{self.port}"


@dataclass
class CommandResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    command: str
    hostname: str

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


class SSHConnectionPool:
    """Thread-safe connection pool for SSH connections."""

    def __init__(self, max_connections: int = 10):
        _require_paramiko()
        self._max = max_connections
        self._pool: dict[str, list[SSHConnection]] = {}
        self._in_use: dict[str, int] = {}
        self._lock = asyncio.Lock()
        self._closed = False

    async def get_connection(self, config: SSHConfig) -> SSHConnection:
        async with self._lock:
            if self._closed:
                raise RuntimeError("Connection pool is closed")

            key = config.key
            if key not in self._pool:
                self._pool[key] = []
                self._in_use[key] = 0

            for conn in self._pool[key]:
                if not conn._in_use and conn.is_connected:
                    conn._in_use = True
                    self._in_use[key] += 1
                    return conn

            total = sum(self._in_use.values())
            if total >= self._max:
                raise RuntimeError(
                    f"Connection pool exhausted ({self._max} max). "
                    "Release connections or increase pool size."
                )

            conn = SSHConnection(config)
            await conn.connect()
            conn._in_use = True
            self._pool[key].append(conn)
            self._in_use[key] += 1
            return conn

    async def release_connection(self, conn: SSHConnection):
        async with self._lock:
            key = conn.config.key
            conn._in_use = False
            if key in self._in_use:
                self._in_use[key] = max(0, self._in_use[key] - 1)

    async def close_all(self):
        async with self._lock:
            self._closed = True
            for key, conns in self._pool.items():
                for conn in conns:
                    try:
                        await conn.disconnect()
                    except Exception:
                        logger.debug("Error closing connection %s", conn.config.key)
            self._pool.clear()
            self._in_use.clear()

    @asynccontextmanager
    async def connection(self, config: SSHConfig) -> AsyncGenerator[SSHConnection, None]:
        conn = await self.get_connection(config)
        try:
            yield conn
        finally:
            await self.release_connection(conn)

    @property
    def stats(self) -> dict:
        return {
            "pools": {
                k: {"available": sum(1 for c in v if not c._in_use),
                     "in_use": self._in_use.get(k, 0),
                     "total": len(v)}
                for k, v in self._pool.items()
            },
            "total_connections": sum(len(v) for v in self._pool.values()),
            "closed": self._closed,
        }


class SSHConnection:
    """Wrapper around paramiko SSH client with async support."""

    def __init__(self, config: SSHConfig):
        _require_paramiko()
        self.config = config
        self._client: Optional[paramiko.SSHClient] = None
        self._sftp: Optional[paramiko.SFTPClient] = None
        self._connected = False
        self._in_use = False
        self._connect_time: float = 0

    @property
    def is_connected(self) -> bool:
        if not self._connected or not self._client:
            return False
        try:
            transport = self._client.get_transport()
            return transport is not None and transport.is_active()
        except Exception:
            return False

    async def connect(self) -> None:
        def _connect():
            client = paramiko.SSHClient()
            client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

            connect_kwargs = {
                "hostname": self.config.hostname,
                "port": self.config.port,
                "username": self.config.username,
                "timeout": self.config.timeout,
                "allow_agent": False,
                "look_for_keys": False,
            }

            if self.config.key_path:
                key_path = os.path.expanduser(self.config.key_path)
                if not os.path.isfile(key_path):
                    raise FileNotFoundError(f"SSH key not found: {key_path}")
                connect_kwargs["key_filename"] = key_path
                connect_kwargs["look_for_keys"] = True
            elif self.config.password:
                connect_kwargs["password"] = self.config.password
            else:
                connect_kwargs["allow_agent"] = True
                connect_kwargs["look_for_keys"] = True

            client.connect(**connect_kwargs)

            transport = client.get_transport()
            if transport and self.config.keepalive_interval:
                transport.set_keepalive(self.config.keepalive_interval)

            return client

        self._client = await asyncio.to_thread(_connect)
        self._connected = True
        self._connect_time = time.time()
        logger.info("SSH connected to %s", self.config.key)

    async def disconnect(self) -> None:
        def _disconnect():
            if self._sftp:
                try:
                    self._sftp.close()
                except Exception:
                    pass
                self._sftp = None
            if self._client:
                try:
                    self._client.close()
                except Exception:
                    pass
                self._client = None

        await asyncio.to_thread(_disconnect)
        self._connected = False
        logger.info("SSH disconnected from %s", self.config.key)

    def _get_sftp(self) -> paramiko.SFTPClient:
        if not self._client:
            raise RuntimeError("Not connected")
        if self._sftp is None:
            self._sftp = self._client.open_sftp()
        return self._sftp

    async def execute(self, command: str, timeout: int = 300,
                      stream_output: bool = False) -> CommandResult:
        if not self.is_connected:
            raise RuntimeError(f"Not connected to {self.config.hostname}")

        start = time.monotonic()

        def _exec():
            stdin, stdout, stderr = self._client.exec_command(
                command, timeout=timeout
            )
            out = stdout.read().decode(errors="replace")
            err = stderr.read().decode(errors="replace")
            rc = stdout.channel.recv_exit_status()
            return rc, out, err

        rc, out, err = await asyncio.to_thread(_exec)
        duration = int((time.monotonic() - start) * 1000)

        result = CommandResult(
            exit_code=rc,
            stdout=out.strip(),
            stderr=err.strip(),
            duration_ms=duration,
            command=command,
            hostname=self.config.hostname,
        )

        if result.ok:
            logger.debug("[%s] %s (exit 0, %dms)", self.config.hostname, command[:80], duration)
        else:
            logger.warning("[%s] %s (exit %d, %dms)", self.config.hostname, command[:80], rc, duration)

        return result

    async def stream_execute(self, command: str) -> AsyncGenerator[str, None]:
        """Execute command and yield output lines as they arrive."""
        if not self.is_connected:
            raise RuntimeError(f"Not connected to {self.config.hostname}")

        def _open_channel():
            transport = self._client.get_transport()
            channel = transport.open_session()
            channel.exec_command(command)
            return channel

        channel = await asyncio.to_thread(_open_channel)

        try:
            buf = ""
            while True:
                ready = await asyncio.to_thread(channel.recv_ready)
                if ready:
                    data = await asyncio.to_thread(channel.recv, 4096)
                    if not data:
                        break
                    buf += data.decode(errors="replace")
                    while "\n" in buf:
                        line, buf = buf.split("\n", 1)
                        yield line
                elif await asyncio.to_thread(channel.exit_status_ready):
                    break
                else:
                    await asyncio.sleep(0.05)

            if buf:
                yield buf
        finally:
            await asyncio.to_thread(channel.close)

    async def upload_file(self, local_path: str, remote_path: str,
                          callback: Optional[callable] = None) -> None:
        if not os.path.isfile(local_path):
            raise FileNotFoundError(f"Local file not found: {local_path}")

        def _upload():
            sftp = self._get_sftp()
            sftp.put(local_path, remote_path, callback=callback)

        await asyncio.to_thread(_upload)
        logger.info("[%s] Uploaded %s -> %s", self.config.hostname, local_path, remote_path)

    async def download_file(self, remote_path: str, local_path: str) -> None:
        os.makedirs(os.path.dirname(local_path) or ".", exist_ok=True)

        def _download():
            sftp = self._get_sftp()
            sftp.get(remote_path, local_path)

        await asyncio.to_thread(_download)
        logger.info("[%s] Downloaded %s -> %s", self.config.hostname, remote_path, local_path)

    async def upload_directory(self, local_dir: str, remote_dir: str) -> int:
        """Upload directory recursively, returns file count."""
        if not os.path.isdir(local_dir):
            raise FileNotFoundError(f"Local directory not found: {local_dir}")

        await self.mkdir(remote_dir, parents=True)
        count = 0

        for root, dirs, files in os.walk(local_dir):
            rel = os.path.relpath(root, local_dir)
            remote_root = os.path.join(remote_dir, rel).replace("\\", "/")
            if rel != ".":
                await self.mkdir(remote_root, parents=True)

            for fname in files:
                local_file = os.path.join(root, fname)
                remote_file = os.path.join(remote_root, fname).replace("\\", "/")
                await self.upload_file(local_file, remote_file)
                count += 1

        logger.info("[%s] Uploaded directory %s -> %s (%d files)",
                    self.config.hostname, local_dir, remote_dir, count)
        return count

    async def file_exists(self, path: str) -> bool:
        def _stat():
            try:
                sftp = self._get_sftp()
                sftp.stat(path)
                return True
            except FileNotFoundError:
                return False
            except IOError:
                return False

        return await asyncio.to_thread(_stat)

    async def mkdir(self, path: str, parents: bool = True) -> None:
        def _mkdir():
            sftp = self._get_sftp()
            if parents:
                parts = path.split("/")
                current = ""
                for part in parts:
                    if not part:
                        current = "/"
                        continue
                    current = current + "/" + part if current != "/" else "/" + part
                    try:
                        sftp.stat(current)
                    except (FileNotFoundError, IOError):
                        sftp.mkdir(current)
            else:
                sftp.mkdir(path)

        await asyncio.to_thread(_mkdir)

    async def read_file(self, path: str) -> str:
        def _read():
            sftp = self._get_sftp()
            with sftp.open(path, "r") as f:
                return f.read().decode(errors="replace") if isinstance(f.read(), bytes) else ""

        def _read_safe():
            sftp = self._get_sftp()
            with sftp.open(path, "rb") as f:
                data = f.read()
            if isinstance(data, bytes):
                return data.decode(errors="replace")
            return str(data)

        return await asyncio.to_thread(_read_safe)

    async def write_file(self, path: str, content: str) -> None:
        def _write():
            sftp = self._get_sftp()
            with sftp.open(path, "w") as f:
                f.write(content)

        await asyncio.to_thread(_write)

    async def test_connection(self) -> dict:
        """Test SSH connectivity and return system info."""
        try:
            result = await self.execute("echo OK", timeout=10)
            if not result.ok:
                return {
                    "hostname": self.config.hostname,
                    "reachable": False,
                    "error": result.stderr,
                }

            info = await self.get_system_info()
            return {
                "hostname": self.config.hostname,
                "reachable": True,
                "latency_ms": result.duration_ms,
                **info,
            }
        except Exception as exc:
            return {
                "hostname": self.config.hostname,
                "reachable": False,
                "error": str(exc),
            }

    async def get_system_info(self) -> dict:
        """Get OS, CPU, memory, disk info from remote host."""
        commands = {
            "os": "cat /etc/redhat-release 2>/dev/null || cat /etc/os-release 2>/dev/null | head -1",
            "hostname": "hostname -f 2>/dev/null || hostname",
            "kernel": "uname -r",
            "arch": "uname -m",
            "cpus": "nproc",
            "memory_total": "free -m | awk '/Mem:/{print $2}'",
            "memory_available": "free -m | awk '/Mem:/{print $7}'",
            "disk_root": "df -h / | awk 'NR==2{print $4}'",
            "disk_home": "df -h /home 2>/dev/null | awk 'NR==2{print $4}'",
            "uptime": "uptime -p 2>/dev/null || uptime",
            "python": "python3 --version 2>&1 | head -1",
            "podman": "podman --version 2>&1 | head -1",
            "ansible": "ansible --version 2>&1 | head -1",
            "selinux": "getenforce 2>/dev/null || echo N/A",
        }

        info = {}
        for key, cmd in commands.items():
            try:
                result = await self.execute(cmd, timeout=10)
                info[key] = result.stdout.strip() if result.ok else ""
            except Exception:
                info[key] = ""

        return info


class MultiHostExecutor:
    """Execute commands across multiple hosts in parallel."""

    def __init__(self, pool: SSHConnectionPool):
        self._pool = pool

    async def execute_on_all(self, configs: list[SSHConfig], command: str,
                             timeout: int = 300) -> dict[str, CommandResult]:
        """Execute a command on all hosts concurrently."""

        async def _exec_one(config: SSHConfig) -> tuple[str, CommandResult]:
            async with self._pool.connection(config) as conn:
                result = await conn.execute(command, timeout=timeout)
                return config.hostname, result

        tasks = [_exec_one(c) for c in configs]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        output = {}
        for item in results:
            if isinstance(item, Exception):
                logger.error("Multi-host execution error: %s", item)
                continue
            hostname, result = item
            output[hostname] = result

        return output

    async def execute_sequential(self, configs: list[SSHConfig], command: str,
                                  stop_on_failure: bool = True) -> list[CommandResult]:
        """Execute command on hosts one at a time."""
        results = []
        for config in configs:
            async with self._pool.connection(config) as conn:
                result = await conn.execute(command)
                results.append(result)
                if stop_on_failure and not result.ok:
                    logger.warning(
                        "Sequential execution stopped at %s (exit %d)",
                        config.hostname, result.exit_code,
                    )
                    break
        return results

    async def test_all_connections(self, configs: list[SSHConfig]) -> dict[str, dict]:
        """Test connectivity to all hosts concurrently."""

        async def _test_one(config: SSHConfig) -> tuple[str, dict]:
            try:
                conn = SSHConnection(config)
                await conn.connect()
                info = await conn.test_connection()
                await conn.disconnect()
                return config.hostname, info
            except Exception as exc:
                return config.hostname, {
                    "hostname": config.hostname,
                    "reachable": False,
                    "error": str(exc),
                }

        tasks = [_test_one(c) for c in configs]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        output = {}
        for item in results:
            if isinstance(item, Exception):
                continue
            hostname, info = item
            output[hostname] = info

        return output

    async def upload_to_all(self, configs: list[SSHConfig],
                            local_path: str, remote_path: str) -> dict[str, bool]:
        """Upload a file to all hosts concurrently."""

        async def _upload_one(config: SSHConfig) -> tuple[str, bool]:
            try:
                async with self._pool.connection(config) as conn:
                    await conn.upload_file(local_path, remote_path)
                    return config.hostname, True
            except Exception as exc:
                logger.error("Upload failed for %s: %s", config.hostname, exc)
                return config.hostname, False

        tasks = [_upload_one(c) for c in configs]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        output = {}
        for item in results:
            if isinstance(item, Exception):
                continue
            hostname, success = item
            output[hostname] = success

        return output


class StubSSHConnection:
    """Stub used when paramiko is not installed. Raises on any operation."""

    def __init__(self, config: SSHConfig):
        self.config = config

    async def connect(self) -> None:
        _require_paramiko()

    async def disconnect(self) -> None:
        pass

    async def execute(self, command: str, **kwargs) -> CommandResult:
        _require_paramiko()
        raise RuntimeError("unreachable")

    async def stream_execute(self, command: str):
        _require_paramiko()
        yield ""  # noqa: unreachable

    async def upload_file(self, local_path: str, remote_path: str, **kwargs) -> None:
        _require_paramiko()

    async def download_file(self, remote_path: str, local_path: str) -> None:
        _require_paramiko()

    async def upload_directory(self, local_dir: str, remote_dir: str) -> int:
        _require_paramiko()
        return 0

    async def file_exists(self, path: str) -> bool:
        _require_paramiko()
        return False

    async def mkdir(self, path: str, parents: bool = True) -> None:
        _require_paramiko()

    async def read_file(self, path: str) -> str:
        _require_paramiko()
        return ""

    async def write_file(self, path: str, content: str) -> None:
        _require_paramiko()

    async def test_connection(self) -> dict:
        return {
            "hostname": self.config.hostname,
            "reachable": False,
            "error": "paramiko not installed",
        }

    async def get_system_info(self) -> dict:
        _require_paramiko()
        return {}


def create_connection(config: SSHConfig) -> SSHConnection | StubSSHConnection:
    """Factory: return a real or stub SSH connection based on paramiko availability."""
    if HAS_PARAMIKO:
        return SSHConnection(config)
    return StubSSHConnection(config)


def create_pool(max_connections: int = 10) -> SSHConnectionPool:
    """Factory: create connection pool (raises if paramiko missing)."""
    return SSHConnectionPool(max_connections=max_connections)
