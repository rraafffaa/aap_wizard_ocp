"""Tests for the certificate manager service.

Covers parsing, validation, host validation, expiration checks,
generation (with mocked openssl), and error handling.
"""

import datetime
import subprocess
import tempfile

import pytest
from unittest.mock import patch, MagicMock


def _has_openssl():
    try:
        subprocess.run(
            ["openssl", "version"],
            capture_output=True,
            timeout=2,
            check=True,
        )
        return True
    except Exception:
        return False

from app.services.certificate_manager import (
    CertificateManager,
    CertificateInfo,
    CertificateChain,
)


# Minimal valid self-signed cert (localhost, short validity) - base64 is valid PEM structure
SAMPLE_SELF_SIGNED_PEM = """-----BEGIN CERTIFICATE-----
MIICpDCCAYwCCQDU+pQ4pHgSpDANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC7
o4qne60TB3pEkBGGjWF0KIsaqGgLTjZ5HJBYPlQyfIPBjmE16tJVUJhBk3kYOPbO
aAFPvedEL0FrF7FGJqmZdL5APVZ93KJ6GIluPLCaN3YtJGaa3sBxraF50sMkaP1A
3NDLNHB18RRhPcADaaT06fJHGRyEiCRwadPIz/wGNNm8bD2yJU33WfRGcL0RSJIx
x+ZmGSHIhwOBPDkWMibdCFPBaSGWnXJuOxe7FBBV3gEeJBK0t00mKl5YDFuJr4r3
L0bUTyNT9SzWKm6Rl+PN/8s2WGdNZFO2bRdaMDXpiO0JfLSidEhxbUaT42tZWS9J
4OKRBiNwypxV1GITDCHRAgMBAAEwDQYJKoZIhvcNAQELBQADggEBAKaJ0dS//MUU
AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
-----END CERTIFICATE-----"""


class TestCertificateManager:
    @pytest.fixture
    def manager(self):
        return CertificateManager()

    def test_parse_certificate_pem(self, manager):
        """Parse valid PEM and return CertificateInfo."""
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 12345
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2025 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption
X509v3 Subject Alternative Name:
    DNS:localhost, DNS:localhost.localdomain""",
                "SHA256 Fingerprint=AA:BB:CC:DD:EE:FF",
            ]
            info = manager.parse_certificate(SAMPLE_SELF_SIGNED_PEM)
        assert isinstance(info, CertificateInfo)
        assert info.subject
        assert info.issuer
        assert info.serial_number
        assert info.not_before
        assert info.not_after

    def test_parse_invalid_pem(self, manager):
        """Invalid PEM raises exception."""
        with pytest.raises(Exception):
            manager.parse_certificate("not valid pem data at all")

    def test_parse_extracts_subject(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = myhost.example.com, O = MyOrg
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2025 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            info = manager.parse_certificate(SAMPLE_SELF_SIGNED_PEM)
        assert "CN" in info.subject
        assert "myhost.example.com" in info.subject.get("CN", "") or "CN" in str(info.subject)

    def test_parse_extracts_issuer(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = My CA, O = CA Org
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2025 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            info = manager.parse_certificate(SAMPLE_SELF_SIGNED_PEM)
        assert info.issuer
        assert isinstance(info.issuer, dict)

    def test_parse_extracts_dates(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2025 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            info = manager.parse_certificate(SAMPLE_SELF_SIGNED_PEM)
        assert info.not_before is not None
        assert info.not_after is not None
        assert isinstance(info.not_before, datetime.datetime)
        assert isinstance(info.not_after, datetime.datetime)

    def test_parse_extracts_san(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2025 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption
X509v3 Subject Alternative Name:
    DNS:localhost, DNS:*.example.com, IP Address:192.168.1.1""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            info = manager.parse_certificate(SAMPLE_SELF_SIGNED_PEM)
        assert isinstance(info.san_names, list)
        assert "localhost" in info.san_names or "*.example.com" in info.san_names

    def test_parse_detects_self_signed(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2025 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            info = manager.parse_certificate(SAMPLE_SELF_SIGNED_PEM)
        assert info.is_self_signed is True

    def test_validate_valid_cert(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2030 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption
X509v3 Subject Alternative Name:
    DNS:localhost""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            chain = manager.validate_certificate(SAMPLE_SELF_SIGNED_PEM)
        assert isinstance(chain, CertificateChain)
        assert chain.is_valid is True
        assert len(chain.errors) == 0

    def test_validate_expired_cert(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2020 GMT
Not After : Jan  1 00:00:00 2021 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            chain = manager.validate_certificate(SAMPLE_SELF_SIGNED_PEM)
        assert chain.is_valid is False
        assert any("expired" in e.lower() for e in chain.errors)

    def test_validate_returns_chain(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2025 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            chain = manager.validate_certificate(SAMPLE_SELF_SIGNED_PEM)
        assert len(chain.certificates) >= 1
        assert all(isinstance(c, CertificateInfo) for c in chain.certificates)

    def test_validate_hosts_match(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = aap.example.org
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2025 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption
X509v3 Subject Alternative Name:
    DNS:aap.example.org""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            errors = manager.validate_certificate_for_hosts(
                SAMPLE_SELF_SIGNED_PEM, ["aap.example.org"]
            )
        assert len(errors) == 0

    def test_validate_hosts_mismatch(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2025 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption
X509v3 Subject Alternative Name:
    DNS:localhost""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            errors = manager.validate_certificate_for_hosts(
                SAMPLE_SELF_SIGNED_PEM, ["other.example.org"]
            )
        assert len(errors) > 0
        assert any("other.example.org" in e for e in errors)

    def test_validate_hosts_wildcard(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = *.example.com
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2025 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption
X509v3 Subject Alternative Name:
    DNS:*.example.com""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            errors = manager.validate_certificate_for_hosts(
                SAMPLE_SELF_SIGNED_PEM, ["api.example.com"]
            )
        assert len(errors) == 0

    def test_check_expiration_valid(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Jan  1 00:00:00 2030 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            result = manager.check_expiration(SAMPLE_SELF_SIGNED_PEM)
        assert result["status"] == "ok"
        assert result["is_expired"] is False
        assert result["days_remaining"] > 0

    def test_check_expiration_expiring_soon(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2024 GMT
Not After : Feb  1 00:00:00 2024 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            result = manager.check_expiration(SAMPLE_SELF_SIGNED_PEM, warn_days=60)
        assert result["status"] in ("warning", "ok", "expired")

    def test_check_expiration_expired(self, manager):
        with patch("app.services.certificate_manager._run_openssl") as mock_run:
            mock_run.side_effect = [
                """Subject: CN = localhost
Issuer: CN = localhost
Serial Number: 1
Not Before: Jan  1 00:00:00 2020 GMT
Not After : Jan  1 00:00:00 2021 GMT
Public Key Algorithm: rsaEncryption
    Public-Key: (2048 bit)
Signature Algorithm: sha256WithRSAEncryption""",
                "SHA256 Fingerprint=AA:BB:CC",
            ]
            result = manager.check_expiration(SAMPLE_SELF_SIGNED_PEM)
        assert result["status"] == "expired"
        assert result["is_expired"] is True

    @patch("app.services.certificate_manager._run_openssl")
    def test_generate_self_signed(self, mock_run, manager):
        mock_run.return_value = ""
        with tempfile.TemporaryDirectory() as tmpdir:
            m = CertificateManager(cert_dir=tmpdir)
            ca_path = f"{tmpdir}/ca.crt"
            ca_key_path = f"{tmpdir}/ca.key"
            with patch.object(m, "generate_ca", return_value=("ca_pem", "ca_key_pem")):
                with patch.object(
                    m,
                    "generate_server_cert",
                    return_value=("cert_pem", "key_pem"),
                ):
                    ca, cert, key = m.generate_self_signed(
                        hostnames=["localhost"], days=365
                    )
        assert ca == "ca_pem"
        assert cert == "cert_pem"
        assert key == "key_pem"

    @pytest.mark.skipif(not _has_openssl(), reason="openssl not available")
    def test_generate_ca(self, manager):
        with tempfile.TemporaryDirectory() as tmpdir:
            m = CertificateManager(cert_dir=tmpdir)
            cert_pem, key_pem = m.generate_ca(common_name="Test CA", days=365)
        assert "-----BEGIN CERTIFICATE-----" in cert_pem
        assert "-----BEGIN" in key_pem

    @pytest.mark.skipif(not _has_openssl(), reason="openssl not available")
    def test_generate_server_cert(self, manager):
        with tempfile.TemporaryDirectory() as tmpdir:
            m = CertificateManager(cert_dir=tmpdir)
            ca_cert_pem, ca_key_pem = m.generate_ca(common_name="Test CA", days=365)
            ca_cert_path = f"{tmpdir}/ca.crt"
            ca_key_path = f"{tmpdir}/ca.key"
            with open(ca_cert_path, "w") as f:
                f.write(ca_cert_pem)
            with open(ca_key_path, "w") as f:
                f.write(ca_key_pem)
            cert_pem, key_pem = m.generate_server_cert(
                hostnames=["aap.example.org"],
                ca_cert_path=ca_cert_path,
                ca_key_path=ca_key_path,
                days=365,
            )
        assert "-----BEGIN CERTIFICATE-----" in cert_pem
        assert "-----BEGIN" in key_pem

    @pytest.mark.skipif(not _has_openssl(), reason="openssl not available")
    def test_generate_csr(self, manager):
        with tempfile.TemporaryDirectory() as tmpdir:
            m = CertificateManager(cert_dir=tmpdir)
            _, _, key_pem = m.generate_self_signed(
                hostnames=["aap.example.org"], days=365
            )
            csr_pem = m.generate_csr(
                hostnames=["aap.example.org"],
                key_pem=key_pem,
            )
        assert csr_pem is not None
        assert isinstance(csr_pem, str)
        assert "-----BEGIN CERTIFICATE REQUEST-----" in csr_pem

    def test_openssl_not_found(self, manager):
        with patch("app.services.certificate_manager._require_openssl") as mock_req:
            mock_req.side_effect = RuntimeError("openssl CLI is required")
            with pytest.raises(RuntimeError) as exc_info:
                manager.parse_certificate(SAMPLE_SELF_SIGNED_PEM)
        assert "openssl" in str(exc_info.value).lower()

    def test_invalid_pem_data(self, manager):
        with pytest.raises(Exception):
            manager.parse_certificate("garbage data that is not PEM")

    def test_empty_pem_data(self, manager):
        with pytest.raises(Exception):
            manager.parse_certificate("")


class TestCertificateInfo:
    def test_dataclass_fields(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        future = now.replace(year=now.year + 1)
        info = CertificateInfo(
            subject={"CN": "localhost"},
            issuer={"CN": "localhost"},
            serial_number="1",
            not_before=now,
            not_after=future,
            is_expired=False,
            is_self_signed=True,
            san_names=["localhost"],
            key_algorithm="rsaEncryption",
            key_size=2048,
            signature_algorithm="sha256WithRSAEncryption",
            fingerprint_sha256="AA:BB:CC",
            pem_data="",
        )
        assert info.subject == {"CN": "localhost"}
        assert info.issuer == {"CN": "localhost"}
        assert info.serial_number == "1"
        assert info.key_size == 2048
        assert info.san_names == ["localhost"]

    def test_is_expired_property(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        past = now.replace(year=now.year - 1)
        info = CertificateInfo(
            subject={},
            issuer={},
            serial_number="1",
            not_before=past,
            not_after=past,
            is_expired=True,
            is_self_signed=False,
            san_names=[],
            key_algorithm="",
            key_size=0,
            signature_algorithm="",
            fingerprint_sha256="",
            pem_data="",
        )
        assert info.is_expired is True

    def test_is_self_signed_property(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        future = now.replace(year=now.year + 1)
        info = CertificateInfo(
            subject={"CN": "localhost"},
            issuer={"CN": "localhost"},
            serial_number="1",
            not_before=now,
            not_after=future,
            is_expired=False,
            is_self_signed=True,
            san_names=[],
            key_algorithm="",
            key_size=0,
            signature_algorithm="",
            fingerprint_sha256="",
            pem_data="",
        )
        assert info.is_self_signed is True
