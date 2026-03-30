"""Tests for AnsibleAutomationPlatform Custom Resource generator."""

import pytest
import yaml

from app.cr_generator import (
    generate_cr,
    generate_cr_yaml,
    generate_admin_secret,
    generate_postgres_secret,
    merge_cr_overrides,
    generate_all_resources,
    generate_all_resources_yaml,
)


@pytest.fixture
def sample_config():
    """Return a complete OCP deployment configuration."""
    return {
        "ocp": {
            "namespace": "aap",
            "storage_class": "gp3",
            "gateway_replicas": 1,
            "controller_replicas": 1,
            "controller_resource_preset": "medium",
            "hub_replicas": 1,
            "hub_storage_backend": "file",
            "hub_storage_size": "100Gi",
            "eda_replicas": 1,
            "postgres_storage_size": "50Gi",
            "custom_route_host": "",
            "tls_termination": "edge",
            "cr_overrides": "",
        },
        "database": {
            "type": "managed",
            "host": "",
            "port": 5432,
            "admin_username": "postgres",
            "admin_password": "",
        },
        "gateway": {
            "admin_password": "admin123",
        },
        "controller": {},
        "hub": {},
        "eda": {},
    }


@pytest.fixture
def external_db_config(sample_config):
    """Return config with external database."""
    config = sample_config.copy()
    config["database"] = {
        "type": "external",
        "host": "postgres.example.com",
        "port": 5432,
        "admin_username": "pgadmin",
        "admin_password": "pgpass123",
    }
    return config


class TestGenerateCR:
    """Test Custom Resource generation from config."""

    def test_generate_cr_basic_structure(self, sample_config):
        """Test CR has correct apiVersion, kind, metadata."""
        cr = generate_cr(sample_config)

        assert cr["apiVersion"] == "aap.ansible.com/v1alpha1"
        assert cr["kind"] == "AnsibleAutomationPlatform"
        assert cr["metadata"]["name"] == "aap"
        assert cr["metadata"]["namespace"] == "aap"

    def test_generate_cr_admin_credentials(self, sample_config):
        """Test admin user and password secret are set."""
        cr = generate_cr(sample_config)

        assert cr["spec"]["admin_user"] == "admin"
        assert cr["spec"]["admin_password_secret"] == "aap-admin-password"

    def test_generate_cr_custom_namespace(self, sample_config):
        """Test custom namespace is used."""
        sample_config["ocp"]["namespace"] = "my-aap"
        cr = generate_cr(sample_config)

        assert cr["metadata"]["namespace"] == "my-aap"

    def test_generate_cr_gateway_replicas_default(self, sample_config):
        """Test gateway replicas not in spec when default (1)."""
        sample_config["ocp"]["gateway_replicas"] = 1
        cr = generate_cr(sample_config)

        assert "gateway" not in cr["spec"]

    def test_generate_cr_gateway_replicas_custom(self, sample_config):
        """Test gateway replicas in spec when > 1."""
        sample_config["ocp"]["gateway_replicas"] = 3
        cr = generate_cr(sample_config)

        assert cr["spec"]["gateway"]["replicas"] == 3

    def test_generate_cr_controller_replicas(self, sample_config):
        """Test controller replicas."""
        sample_config["ocp"]["controller_replicas"] = 2
        cr = generate_cr(sample_config)

        assert cr["spec"]["controller"]["replicas"] == 2

    def test_generate_cr_controller_resource_preset(self, sample_config):
        """Test controller resource preset."""
        sample_config["ocp"]["controller_resource_preset"] = "large"
        cr = generate_cr(sample_config)

        assert cr["spec"]["controller"]["resource_preset"] == "large"

    def test_generate_cr_controller_resource_preset_default(self, sample_config):
        """Test controller resource preset not in spec when medium (default)."""
        sample_config["ocp"]["controller_resource_preset"] = "medium"
        sample_config["ocp"]["controller_replicas"] = 1
        cr = generate_cr(sample_config)

        assert "controller" not in cr["spec"]

    def test_generate_cr_hub_replicas(self, sample_config):
        """Test hub replicas."""
        sample_config["ocp"]["hub_replicas"] = 2
        cr = generate_cr(sample_config)

        assert cr["spec"]["hub"]["replicas"] == 2

    def test_generate_cr_hub_storage_backend(self, sample_config):
        """Test hub storage backend (s3)."""
        sample_config["ocp"]["hub_storage_backend"] = "s3"
        cr = generate_cr(sample_config)

        assert cr["spec"]["hub"]["storage_type"] == "s3"

    def test_generate_cr_hub_storage_backend_default(self, sample_config):
        """Test hub storage backend not in spec when file (default)."""
        sample_config["ocp"]["hub_storage_backend"] = "file"
        sample_config["ocp"]["hub_replicas"] = 1
        cr = generate_cr(sample_config)

        assert "hub" not in cr["spec"]

    def test_generate_cr_hub_storage_size(self, sample_config):
        """Test hub storage size."""
        sample_config["ocp"]["hub_storage_size"] = "200Gi"
        cr = generate_cr(sample_config)

        assert cr["spec"]["hub"]["storage_size"] == "200Gi"

    def test_generate_cr_eda_replicas(self, sample_config):
        """Test EDA replicas."""
        sample_config["ocp"]["eda_replicas"] = 2
        cr = generate_cr(sample_config)

        assert cr["spec"]["eda"]["replicas"] == 2

    def test_generate_cr_managed_postgres(self, sample_config):
        """Test managed PostgreSQL configuration."""
        sample_config["ocp"]["storage_class"] = "gp3"
        sample_config["ocp"]["postgres_storage_size"] = "100Gi"
        cr = generate_cr(sample_config)

        assert cr["spec"]["postgres"]["storage_class"] == "gp3"
        assert cr["spec"]["postgres"]["storage_size"] == "100Gi"
        assert "postgres_configuration_secret" not in cr["spec"]

    def test_generate_cr_external_postgres(self, external_db_config):
        """Test external PostgreSQL uses secret reference."""
        cr = generate_cr(external_db_config)

        assert cr["spec"]["postgres_configuration_secret"] == "aap-postgres-config"
        assert "postgres" not in cr["spec"]

    def test_generate_cr_custom_route_host(self, sample_config):
        """Test custom route hostname."""
        sample_config["ocp"]["custom_route_host"] = "aap.apps.example.com"
        cr = generate_cr(sample_config)

        assert cr["spec"]["route_host"] == "aap.apps.example.com"

    def test_generate_cr_tls_termination(self, sample_config):
        """Test TLS termination setting."""
        sample_config["ocp"]["tls_termination"] = "passthrough"
        cr = generate_cr(sample_config)

        assert cr["spec"]["tls_termination"] == "passthrough"

    def test_generate_cr_tls_termination_default(self, sample_config):
        """Test TLS termination not in spec when edge (default)."""
        sample_config["ocp"]["tls_termination"] = "edge"
        cr = generate_cr(sample_config)

        assert "tls_termination" not in cr["spec"]


class TestGenerateCRYAML:
    """Test YAML string generation."""

    def test_generate_cr_yaml_returns_string(self, sample_config):
        """Test YAML output is a string."""
        yaml_str = generate_cr_yaml(sample_config)
        assert isinstance(yaml_str, str)

    def test_generate_cr_yaml_valid_yaml(self, sample_config):
        """Test YAML output is valid and parseable."""
        yaml_str = generate_cr_yaml(sample_config)
        parsed = yaml.safe_load(yaml_str)

        assert parsed["apiVersion"] == "aap.ansible.com/v1alpha1"
        assert parsed["kind"] == "AnsibleAutomationPlatform"

    def test_generate_cr_yaml_contains_spec(self, sample_config):
        """Test YAML contains spec section."""
        yaml_str = generate_cr_yaml(sample_config)
        parsed = yaml.safe_load(yaml_str)

        assert "spec" in parsed
        assert "admin_user" in parsed["spec"]


class TestGenerateAdminSecret:
    """Test admin password Secret generation."""

    def test_admin_secret_structure(self, sample_config):
        """Test Secret has correct structure."""
        secret = generate_admin_secret(sample_config)

        assert secret["apiVersion"] == "v1"
        assert secret["kind"] == "Secret"
        assert secret["type"] == "Opaque"

    def test_admin_secret_name(self, sample_config):
        """Test Secret name matches CR reference."""
        secret = generate_admin_secret(sample_config)

        assert secret["metadata"]["name"] == "aap-admin-password"

    def test_admin_secret_namespace(self, sample_config):
        """Test Secret is in same namespace as CR."""
        sample_config["ocp"]["namespace"] = "my-aap"
        secret = generate_admin_secret(sample_config)

        assert secret["metadata"]["namespace"] == "my-aap"

    def test_admin_secret_password(self, sample_config):
        """Test Secret contains password from config."""
        sample_config["gateway"]["admin_password"] = "mysecurepass"
        secret = generate_admin_secret(sample_config)

        assert secret["stringData"]["password"] == "mysecurepass"


class TestGeneratePostgresSecret:
    """Test PostgreSQL configuration Secret generation."""

    def test_postgres_secret_not_created_for_managed(self, sample_config):
        """Test no Secret created when using managed database."""
        secret = generate_postgres_secret(sample_config)
        assert secret is None

    def test_postgres_secret_created_for_external(self, external_db_config):
        """Test Secret created for external database."""
        secret = generate_postgres_secret(external_db_config)

        assert secret is not None
        assert secret["kind"] == "Secret"

    def test_postgres_secret_structure(self, external_db_config):
        """Test PostgreSQL Secret structure."""
        secret = generate_postgres_secret(external_db_config)

        assert secret["apiVersion"] == "v1"
        assert secret["kind"] == "Secret"
        assert secret["type"] == "Opaque"
        assert secret["metadata"]["name"] == "aap-postgres-config"

    def test_postgres_secret_connection_details(self, external_db_config):
        """Test PostgreSQL Secret contains connection details."""
        secret = generate_postgres_secret(external_db_config)

        assert secret["stringData"]["host"] == "postgres.example.com"
        assert secret["stringData"]["port"] == "5432"
        assert secret["stringData"]["username"] == "pgadmin"
        assert secret["stringData"]["password"] == "pgpass123"
        assert secret["stringData"]["database"] == "postgres"
        assert secret["stringData"]["type"] == "unmanaged"
        assert secret["stringData"]["sslmode"] == "prefer"

    def test_postgres_secret_namespace(self, external_db_config):
        """Test PostgreSQL Secret in correct namespace."""
        external_db_config["ocp"]["namespace"] = "my-aap"
        secret = generate_postgres_secret(external_db_config)

        assert secret["metadata"]["namespace"] == "my-aap"


class TestMergeCROverrides:
    """Test CR override merging."""

    def test_merge_simple_override(self):
        """Test merging simple top-level override."""
        base = {
            "apiVersion": "aap.ansible.com/v1alpha1",
            "kind": "AnsibleAutomationPlatform",
            "spec": {
                "admin_user": "admin"
            }
        }
        overrides = {
            "spec": {
                "admin_user": "myuser"
            }
        }

        result = merge_cr_overrides(base, overrides)
        assert result["spec"]["admin_user"] == "myuser"

    def test_merge_nested_override(self):
        """Test merging nested spec overrides."""
        base = {
            "spec": {
                "controller": {
                    "replicas": 1
                }
            }
        }
        overrides = {
            "spec": {
                "controller": {
                    "replicas": 3,
                    "web_replicas": 2
                }
            }
        }

        result = merge_cr_overrides(base, overrides)
        assert result["spec"]["controller"]["replicas"] == 3
        assert result["spec"]["controller"]["web_replicas"] == 2

    def test_merge_partial_spec_overrides(self):
        """Test merging when overrides only contain spec fields."""
        base = {
            "apiVersion": "aap.ansible.com/v1alpha1",
            "kind": "AnsibleAutomationPlatform",
            "spec": {
                "admin_user": "admin",
                "controller": {"replicas": 1}
            }
        }
        overrides = {
            "gateway": {"replicas": 2}
        }

        result = merge_cr_overrides(base, overrides)
        assert result["spec"]["gateway"]["replicas"] == 2
        assert result["spec"]["admin_user"] == "admin"
        assert result["spec"]["controller"]["replicas"] == 1

    def test_merge_preserves_base_fields(self):
        """Test merging preserves fields not in overrides."""
        base = {
            "spec": {
                "admin_user": "admin",
                "gateway": {"replicas": 1},
                "controller": {"replicas": 1}
            }
        }
        overrides = {
            "spec": {
                "gateway": {"replicas": 2}
            }
        }

        result = merge_cr_overrides(base, overrides)
        assert result["spec"]["controller"]["replicas"] == 1
        assert result["spec"]["admin_user"] == "admin"

    def test_merge_empty_overrides(self):
        """Test merging with empty overrides."""
        base = {"spec": {"admin_user": "admin"}}
        overrides = {}

        result = merge_cr_overrides(base, overrides)
        assert result == base


class TestCROverridesIntegration:
    """Test CR generation with YAML overrides."""

    def test_generate_cr_with_yaml_overrides(self, sample_config):
        """Test CR generation with YAML overrides applied."""
        sample_config["ocp"]["cr_overrides"] = """
controller:
  replicas: 5
  web_replicas: 3
"""
        cr = generate_cr(sample_config)

        assert cr["spec"]["controller"]["replicas"] == 5
        assert cr["spec"]["controller"]["web_replicas"] == 3

    def test_generate_cr_with_invalid_yaml_overrides(self, sample_config):
        """Test invalid YAML overrides are ignored (no crash)."""
        sample_config["ocp"]["cr_overrides"] = """
this is not: valid: yaml:
  - broken
"""
        cr = generate_cr(sample_config)

        # Should still generate CR without overrides
        assert cr["apiVersion"] == "aap.ansible.com/v1alpha1"

    def test_generate_cr_with_empty_overrides(self, sample_config):
        """Test empty override string is handled."""
        sample_config["ocp"]["cr_overrides"] = "   "
        cr = generate_cr(sample_config)

        assert cr["apiVersion"] == "aap.ansible.com/v1alpha1"

    def test_generate_cr_with_full_spec_override(self, sample_config):
        """Test overriding with full spec structure."""
        sample_config["ocp"]["cr_overrides"] = """
spec:
  gateway:
    replicas: 4
  controller:
    replicas: 6
"""
        cr = generate_cr(sample_config)

        assert cr["spec"]["gateway"]["replicas"] == 4
        assert cr["spec"]["controller"]["replicas"] == 6


class TestGenerateAllResources:
    """Test generation of all K8s resources."""

    def test_generate_all_resources_managed_db(self, sample_config):
        """Test resource list for managed database."""
        resources = generate_all_resources(sample_config)

        assert len(resources) == 2
        assert resources[0]["kind"] == "Secret"
        assert resources[0]["metadata"]["name"] == "aap-admin-password"
        assert resources[1]["kind"] == "AnsibleAutomationPlatform"

    def test_generate_all_resources_external_db(self, external_db_config):
        """Test resource list for external database includes postgres secret."""
        resources = generate_all_resources(external_db_config)

        assert len(resources) == 3
        kinds = [r["kind"] for r in resources]
        assert kinds.count("Secret") == 2
        assert kinds.count("AnsibleAutomationPlatform") == 1

        secret_names = [r["metadata"]["name"] for r in resources if r["kind"] == "Secret"]
        assert "aap-admin-password" in secret_names
        assert "aap-postgres-config" in secret_names

    def test_generate_all_resources_yaml_multi_doc(self, sample_config):
        """Test multi-document YAML generation."""
        yaml_str = generate_all_resources_yaml(sample_config)

        # Should have document separators
        assert "---" in yaml_str

        # Should be valid multi-doc YAML
        docs = list(yaml.safe_load_all(yaml_str))
        assert len(docs) == 2

    def test_generate_all_resources_yaml_external_db(self, external_db_config):
        """Test multi-document YAML with external database."""
        yaml_str = generate_all_resources_yaml(external_db_config)

        docs = list(yaml.safe_load_all(yaml_str))
        assert len(docs) == 3

        kinds = [d["kind"] for d in docs]
        assert kinds.count("Secret") == 2
        assert kinds.count("AnsibleAutomationPlatform") == 1
