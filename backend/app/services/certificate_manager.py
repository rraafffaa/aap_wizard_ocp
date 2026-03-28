"""TLS certificate manager for AAP deployments.

Generates self-signed certificates, validates existing certificates,
and manages certificate chains using OpenSSL subprocess calls.
"""
from __future__ import annotations

import datetime
import logging
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_HAS_OPENSSL: Optional[bool] = None


def _check_openssl() -> bool:
    global _HAS_OPENSSL
    if _HAS_OPENSSL is None:
        try:
            subprocess.run(
                ["openssl", "version"],
                capture_output=True, timeout=5, check=True,
            )
            _HAS_OPENSSL = True
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            _HAS_OPENSSL = False
    return _HAS_OPENSSL


def _require_openssl():
    if not _check_openssl():
        raise RuntimeError(
            "openssl CLI is required for certificate operations but was not found. "
            "Install it with: dnf install openssl (RHEL) or apt install openssl (Debian)"
        )


def _run_openssl(*args: str, stdin: Optional[str] = None, timeout: int = 30) -> str:
    _require_openssl()
    cmd = ["openssl", *args]
    result = subprocess.run(
        cmd,
        input=stdin,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"openssl command failed: {result.stderr.strip()}")
    return result.stdout


@dataclass
class CertificateInfo:
    subject: dict[str, str]
    issuer: dict[str, str]
    serial_number: str
    not_before: datetime.datetime
    not_after: datetime.datetime
    is_expired: bool
    is_self_signed: bool
    san_names: list[str]
    key_algorithm: str
    key_size: int
    signature_algorithm: str
    fingerprint_sha256: str
    pem_data: str


@dataclass
class CertificateChain:
    certificates: list[CertificateInfo]
    is_valid: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


class CertificateManager:
    def __init__(self, cert_dir: Optional[str] = None):
        self.cert_dir = Path(cert_dir) if cert_dir else Path(tempfile.mkdtemp(prefix="aap-certs-"))
        self.cert_dir.mkdir(parents=True, exist_ok=True)

    def generate_ca(self, common_name: str = "AAP Wizard CA",
                    days: int = 3650) -> tuple[str, str]:
        """Generate CA certificate and key. Returns (cert_pem, key_pem)."""
        key_path = self.cert_dir / "ca.key"
        cert_path = self.cert_dir / "ca.crt"

        _run_openssl(
            "req", "-x509", "-new", "-newkey", "rsa:4096",
            "-nodes", "-sha256",
            "-days", str(days),
            "-subj", f"/CN={common_name}/O=AAP Wizard/OU=Deployment",
            "-keyout", str(key_path),
            "-out", str(cert_path),
        )

        cert_pem = cert_path.read_text()
        key_pem = key_path.read_text()
        logger.info("Generated CA certificate: CN=%s", common_name)
        return cert_pem, key_pem

    def generate_server_cert(self, hostnames: list[str],
                             ca_cert_path: str, ca_key_path: str,
                             days: int = 365) -> tuple[str, str]:
        """Generate server certificate signed by CA. Returns (cert_pem, key_pem)."""
        if not hostnames:
            raise ValueError("At least one hostname is required")

        key_path = self.cert_dir / "server.key"
        csr_path = self.cert_dir / "server.csr"
        cert_path = self.cert_dir / "server.crt"
        ext_path = self.cert_dir / "server_ext.cnf"

        san_entries = []
        for i, name in enumerate(hostnames):
            if self._is_ip(name):
                san_entries.append(f"IP.{i + 1} = {name}")
            else:
                san_entries.append(f"DNS.{i + 1} = {name}")

        ext_content = (
            "[req]\n"
            "distinguished_name = req_dn\n"
            "req_extensions = v3_req\n"
            "[req_dn]\n"
            "[v3_req]\n"
            "subjectAltName = @alt_names\n"
            "basicConstraints = CA:FALSE\n"
            "keyUsage = digitalSignature, keyEncipherment\n"
            "extendedKeyUsage = serverAuth\n"
            "[alt_names]\n"
            + "\n".join(san_entries)
            + "\n"
        )
        ext_path.write_text(ext_content)

        _run_openssl(
            "req", "-new", "-newkey", "rsa:2048",
            "-nodes", "-sha256",
            "-subj", f"/CN={hostnames[0]}/O=AAP Deployment",
            "-keyout", str(key_path),
            "-out", str(csr_path),
            "-config", str(ext_path),
        )

        v3_ext_path = self.cert_dir / "v3_ext.cnf"
        v3_content = (
            "subjectAltName = @alt_names\n"
            "basicConstraints = CA:FALSE\n"
            "keyUsage = digitalSignature, keyEncipherment\n"
            "extendedKeyUsage = serverAuth\n"
            "[alt_names]\n"
            + "\n".join(san_entries)
            + "\n"
        )
        v3_ext_path.write_text(v3_content)

        _run_openssl(
            "x509", "-req",
            "-in", str(csr_path),
            "-CA", ca_cert_path,
            "-CAkey", ca_key_path,
            "-CAcreateserial",
            "-days", str(days),
            "-sha256",
            "-extfile", str(v3_ext_path),
            "-out", str(cert_path),
        )

        cert_pem = cert_path.read_text()
        key_pem = key_path.read_text()
        logger.info("Generated server certificate for: %s", ", ".join(hostnames))
        return cert_pem, key_pem

    def generate_self_signed(self, hostnames: list[str],
                             days: int = 365) -> tuple[str, str, str]:
        """Generate self-signed cert with CA. Returns (ca_pem, cert_pem, key_pem)."""
        ca_cert_pem, ca_key_pem = self.generate_ca()

        ca_cert_path = self.cert_dir / "ca.crt"
        ca_key_path = self.cert_dir / "ca.key"
        ca_cert_path.write_text(ca_cert_pem)
        ca_key_path.write_text(ca_key_pem)

        cert_pem, key_pem = self.generate_server_cert(
            hostnames, str(ca_cert_path), str(ca_key_path), days=days,
        )

        logger.info("Generated self-signed certificate bundle for: %s", ", ".join(hostnames))
        return ca_cert_pem, cert_pem, key_pem

    def parse_certificate(self, pem_data: str) -> CertificateInfo:
        """Parse PEM certificate and extract info."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".pem", delete=False) as f:
            f.write(pem_data)
            f.flush()
            cert_file = f.name

        try:
            text_out = _run_openssl("x509", "-in", cert_file, "-text", "-noout")
            fingerprint_out = _run_openssl(
                "x509", "-in", cert_file, "-fingerprint", "-sha256", "-noout",
            )

            subject = self._parse_dn(self._extract_field(text_out, r"Subject:\s*(.+)"))
            issuer = self._parse_dn(self._extract_field(text_out, r"Issuer:\s*(.+)"))
            serial = self._extract_field(text_out, r"Serial Number:\s*\n?\s*(.+)")
            not_before = self._parse_date(self._extract_field(text_out, r"Not Before:\s*(.+)"))
            not_after = self._parse_date(self._extract_field(text_out, r"Not After\s*:\s*(.+)"))
            san_names = self._extract_sans(text_out)
            key_algo = self._extract_field(text_out, r"Public Key Algorithm:\s*(.+)")
            key_size = self._extract_key_size(text_out)
            sig_algo = self._extract_field(text_out, r"Signature Algorithm:\s*(.+)")
            fp = fingerprint_out.strip().split("=", 1)[-1].strip() if "=" in fingerprint_out else ""

            now = datetime.datetime.now(datetime.timezone.utc)
            is_expired = not_after < now if not_after else True
            is_self_signed = subject == issuer

            return CertificateInfo(
                subject=subject,
                issuer=issuer,
                serial_number=serial.strip(),
                not_before=not_before,
                not_after=not_after,
                is_expired=is_expired,
                is_self_signed=is_self_signed,
                san_names=san_names,
                key_algorithm=key_algo,
                key_size=key_size,
                signature_algorithm=sig_algo,
                fingerprint_sha256=fp,
                pem_data=pem_data,
            )
        finally:
            os.unlink(cert_file)

    def validate_certificate(self, cert_pem: str, key_pem: Optional[str] = None,
                             ca_pem: Optional[str] = None) -> CertificateChain:
        """Validate certificate, optionally check key match and CA chain."""
        errors: list[str] = []
        warnings: list[str] = []
        certs: list[CertificateInfo] = []

        try:
            info = self.parse_certificate(cert_pem)
            certs.append(info)
        except Exception as exc:
            return CertificateChain(
                certificates=[], is_valid=False,
                errors=[f"Failed to parse certificate: {exc}"],
            )

        if info.is_expired:
            errors.append(f"Certificate expired on {info.not_after.isoformat()}")
        else:
            days_left = (info.not_after - datetime.datetime.now(datetime.timezone.utc)).days
            if days_left < 30:
                warnings.append(f"Certificate expires in {days_left} days")

        if not info.san_names:
            warnings.append("Certificate has no Subject Alternative Names")

        if key_pem:
            match = self._check_key_match(cert_pem, key_pem)
            if not match:
                errors.append("Private key does not match the certificate")

        if ca_pem:
            chain_valid = self._verify_chain(cert_pem, ca_pem)
            if not chain_valid:
                errors.append("Certificate chain verification failed")
            try:
                ca_info = self.parse_certificate(ca_pem)
                certs.append(ca_info)
            except Exception:
                warnings.append("Could not parse CA certificate")

        return CertificateChain(
            certificates=certs,
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
        )

    def validate_certificate_for_hosts(self, cert_pem: str,
                                        hostnames: list[str]) -> list[str]:
        """Check if certificate SANs cover the required hostnames."""
        try:
            info = self.parse_certificate(cert_pem)
        except Exception as exc:
            return [f"Could not parse certificate: {exc}"]

        errors = []
        san_lower = [s.lower() for s in info.san_names]

        for host in hostnames:
            host_lower = host.lower()
            matched = False
            for san in san_lower:
                if san == host_lower:
                    matched = True
                    break
                if san.startswith("*."):
                    wildcard_domain = san[2:]
                    if host_lower.endswith(wildcard_domain) and host_lower.count(".") == san.count("."):
                        matched = True
                        break
            if not matched:
                errors.append(f"Hostname '{host}' is not covered by certificate SANs: {info.san_names}")

        return errors

    def check_expiration(self, cert_pem: str,
                          warn_days: int = 30) -> dict:
        """Check certificate expiration status."""
        try:
            info = self.parse_certificate(cert_pem)
        except Exception as exc:
            return {"status": "error", "error": str(exc)}

        now = datetime.datetime.now(datetime.timezone.utc)
        days_remaining = (info.not_after - now).days

        if info.is_expired:
            status = "expired"
        elif days_remaining <= warn_days:
            status = "warning"
        else:
            status = "ok"

        return {
            "status": status,
            "not_before": info.not_before.isoformat(),
            "not_after": info.not_after.isoformat(),
            "days_remaining": days_remaining,
            "is_expired": info.is_expired,
            "subject": info.subject,
        }

    def generate_csr(self, hostnames: list[str],
                      key_pem: str) -> str:
        """Generate Certificate Signing Request."""
        if not hostnames:
            raise ValueError("At least one hostname is required")

        key_path = self.cert_dir / "csr_key.pem"
        key_path.write_text(key_pem)
        csr_path = self.cert_dir / "request.csr"

        san_entries = []
        for i, name in enumerate(hostnames):
            if self._is_ip(name):
                san_entries.append(f"IP.{i + 1} = {name}")
            else:
                san_entries.append(f"DNS.{i + 1} = {name}")

        ext_path = self.cert_dir / "csr_ext.cnf"
        ext_content = (
            "[req]\n"
            "distinguished_name = req_dn\n"
            "req_extensions = v3_req\n"
            "prompt = no\n"
            f"[req_dn]\n"
            f"CN = {hostnames[0]}\n"
            "O = AAP Deployment\n"
            "[v3_req]\n"
            "subjectAltName = @alt_names\n"
            "[alt_names]\n"
            + "\n".join(san_entries)
            + "\n"
        )
        ext_path.write_text(ext_content)

        _run_openssl(
            "req", "-new", "-sha256",
            "-key", str(key_path),
            "-out", str(csr_path),
            "-config", str(ext_path),
        )

        csr_pem = csr_path.read_text()
        logger.info("Generated CSR for: %s", ", ".join(hostnames))
        return csr_pem

    # -- Internal helpers --

    @staticmethod
    def _is_ip(value: str) -> bool:
        parts = value.split(".")
        if len(parts) == 4:
            try:
                return all(0 <= int(p) <= 255 for p in parts)
            except ValueError:
                pass
        return ":" in value  # IPv6

    @staticmethod
    def _extract_field(text: str, pattern: str) -> str:
        m = re.search(pattern, text)
        return m.group(1).strip() if m else ""

    @staticmethod
    def _parse_dn(dn_str: str) -> dict[str, str]:
        result = {}
        for part in re.split(r",\s*", dn_str):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                result[k.strip()] = v.strip()
        return result

    @staticmethod
    def _parse_date(date_str: str) -> datetime.datetime:
        for fmt in (
            "%b %d %H:%M:%S %Y %Z",
            "%b  %d %H:%M:%S %Y %Z",
            "%Y-%m-%dT%H:%M:%S%z",
        ):
            try:
                dt = datetime.datetime.strptime(date_str.strip(), fmt)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=datetime.timezone.utc)
                return dt
            except ValueError:
                continue
        return datetime.datetime.now(datetime.timezone.utc)

    @staticmethod
    def _extract_sans(text: str) -> list[str]:
        m = re.search(r"X509v3 Subject Alternative Name:\s*\n\s*(.+)", text)
        if not m:
            return []
        sans_line = m.group(1).strip()
        names = []
        for entry in sans_line.split(","):
            entry = entry.strip()
            if entry.startswith("DNS:"):
                names.append(entry[4:])
            elif entry.startswith("IP Address:"):
                names.append(entry[11:])
        return names

    @staticmethod
    def _extract_key_size(text: str) -> int:
        m = re.search(r"(?:RSA Public-Key|Public-Key):\s*\((\d+)\s*bit\)", text)
        if m:
            return int(m.group(1))
        m = re.search(r"(\d+)\s*bit", text)
        return int(m.group(1)) if m else 0

    def _check_key_match(self, cert_pem: str, key_pem: str) -> bool:
        cert_file = self.cert_dir / "_check_cert.pem"
        key_file = self.cert_dir / "_check_key.pem"
        cert_file.write_text(cert_pem)
        key_file.write_text(key_pem)

        try:
            cert_mod = _run_openssl("x509", "-noout", "-modulus", "-in", str(cert_file))
            key_mod = _run_openssl("rsa", "-noout", "-modulus", "-in", str(key_file))
            return cert_mod.strip() == key_mod.strip()
        except RuntimeError:
            return False
        finally:
            cert_file.unlink(missing_ok=True)
            key_file.unlink(missing_ok=True)

    def _verify_chain(self, cert_pem: str, ca_pem: str) -> bool:
        cert_file = self.cert_dir / "_verify_cert.pem"
        ca_file = self.cert_dir / "_verify_ca.pem"
        cert_file.write_text(cert_pem)
        ca_file.write_text(ca_pem)

        try:
            _run_openssl("verify", "-CAfile", str(ca_file), str(cert_file))
            return True
        except RuntimeError:
            return False
        finally:
            cert_file.unlink(missing_ok=True)
            ca_file.unlink(missing_ok=True)
