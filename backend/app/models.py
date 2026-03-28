from __future__ import annotations

from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class Topology(str, Enum):
    GROWTH = "growth"
    ENTERPRISE = "enterprise"


class InstallationType(str, Enum):
    ONLINE = "online"
    DISCONNECTED = "disconnected"


class DatabaseType(str, Enum):
    MANAGED = "managed"
    EXTERNAL = "external"


class RedisMode(str, Enum):
    STANDALONE = "standalone"
    CLUSTER = "cluster"


class TLSConfig(BaseModel):
    custom_ca_cert: Optional[str] = None
    custom_server_cert: Optional[str] = None
    custom_server_key: Optional[str] = None
    disable_https: bool = False


class RegistryCredentials(BaseModel):
    username: str = ""
    password: str = ""


class DatabaseConfig(BaseModel):
    type: DatabaseType = DatabaseType.MANAGED
    host: str = ""
    port: int = 5432
    admin_username: str = "postgres"
    admin_password: str = ""


class GatewayConfig(BaseModel):
    hosts: list[str] = Field(default_factory=lambda: ["aap.example.org"])
    admin_password: str = ""
    pg_host: str = ""
    pg_database: str = "gateway"
    pg_username: str = "gateway"
    pg_password: str = ""


class ControllerConfig(BaseModel):
    hosts: list[str] = Field(default_factory=lambda: ["aap.example.org"])
    admin_password: str = ""
    pg_host: str = ""
    pg_database: str = "controller"
    pg_username: str = "controller"
    pg_password: str = ""
    percent_memory_capacity: float = 0.5


class HubConfig(BaseModel):
    hosts: list[str] = Field(default_factory=lambda: ["aap.example.org"])
    admin_password: str = ""
    pg_host: str = ""
    pg_database: str = "hub"
    pg_username: str = "hub"
    pg_password: str = ""
    seed_collections: bool = False


class EDAConfig(BaseModel):
    hosts: list[str] = Field(default_factory=lambda: ["aap.example.org"])
    admin_password: str = ""
    pg_host: str = ""
    pg_database: str = "eda"
    pg_username: str = "eda"
    pg_password: str = ""
    safe_plugins: list[str] = Field(
        default_factory=lambda: [
            "ansible.eda.webhook",
            "ansible.eda.alertmanager",
        ]
    )


class AdvancedCommonConfig(BaseModel):
    ca_tls_cert: str = ""
    ca_tls_key: str = ""
    ca_tls_key_passphrase: str = ""
    ca_tls_remote: bool = False
    client_request_timeout: int = 30
    container_compress: str = "gzip"
    container_keep_images: bool = False
    container_pull_images: bool = True
    feature_flags: str = ""
    images_tmp_dir: str = ""
    registry_auth: bool = True
    registry_ns_aap: str = "ansible-automation-platform-26"
    registry_ns_rhel: str = "rhel9"
    registry_tls_verify: bool = True
    registry_url: str = "registry.redhat.io"


class HostTuningConfig(BaseModel):
    tune_host_limits: bool = True
    host_tuning_sysctl_fs_inotify_max_user_instances: int = 8192
    host_tuning_sysctl_fs_inotify_max_user_watches: int = 524288
    host_tuning_nofile_limit_soft: int = 524288
    host_tuning_nofile_limit_hard: int = 524288


class AdvancedControllerConfig(BaseModel):
    admin_user: str = "admin"
    create_preload_data: bool = True
    event_workers: int = 4
    extra_settings: str = ""
    license_file: str = ""
    nginx_client_max_body_size: str = "5m"
    nginx_disable_hsts: bool = False
    nginx_disable_https: bool = False
    nginx_hsts_max_age: int = 63072000
    nginx_http_port: int = 8080
    nginx_https_port: int = 8443
    nginx_https_protocols: str = "TLSv1.2,TLSv1.3"
    pg_cert_auth: bool = False
    pg_port: int = 5432
    pg_sslmode: str = "prefer"
    pg_tls_cert: str = ""
    pg_tls_key: str = ""
    postinstall: bool = False
    postinstall_dir: str = ""
    postinstall_repo_url: str = ""
    postinstall_repo_ref: str = "main"
    secret_key: str = ""
    tls_cert: str = ""
    tls_key: str = ""
    tls_remote: bool = False
    uwsgi_listen_queue_size: int = 2048
    uwsgi_processes: str = ""


class AdvancedGatewayConfig(BaseModel):
    admin_user: str = "admin"
    extra_settings: str = ""
    main_url: str = ""
    nginx_client_max_body_size: str = "5m"
    nginx_disable_hsts: bool = False
    nginx_disable_https: bool = False
    nginx_hsts_max_age: int = 63072000
    nginx_http_port: int = 8083
    nginx_https_port: int = 8446
    nginx_https_protocols: str = "TLSv1.2,TLSv1.3"
    pg_cert_auth: bool = False
    pg_port: int = 5432
    pg_sslmode: str = "prefer"
    pg_tls_cert: str = ""
    pg_tls_key: str = ""
    redis_disable_tls: bool = False
    redis_host: str = ""
    redis_password: str = ""
    redis_port: int = 6379
    redis_tls_cert: str = ""
    redis_tls_key: str = ""
    redis_username: str = "gateway"
    secret_key: str = ""
    tls_cert: str = ""
    tls_key: str = ""
    tls_remote: bool = False
    uwsgi_listen_queue_size: int = 4096
    uwsgi_processes: str = ""
    grpc_server_processes: int = 5
    grpc_server_max_threads_per_process: int = 10


class AdvancedHubConfig(BaseModel):
    extra_settings: str = ""
    galaxy_importer: str = ""
    nginx_client_max_body_size: str = "20m"
    nginx_disable_hsts: bool = False
    nginx_disable_https: bool = False
    nginx_hsts_max_age: int = 63072000
    nginx_http_port: int = 8081
    nginx_https_port: int = 8444
    nginx_https_protocols: str = "TLSv1.2,TLSv1.3"
    pg_cert_auth: bool = False
    pg_port: int = 5432
    pg_sslmode: str = "prefer"
    pg_tls_cert: str = ""
    pg_tls_key: str = ""
    secret_key: str = ""
    storage_backend: str = "file"
    tls_cert: str = ""
    tls_key: str = ""
    tls_remote: bool = False
    workers: int = 2
    api_workers: str = ""
    shared_data_path: str = ""
    shared_data_mount_opts: str = "rw,sync,hard"
    collection_signing: bool = False
    collection_signing_key: str = ""
    container_signing: bool = False
    container_signing_key: str = ""
    postinstall: bool = False
    postinstall_dir: str = ""
    postinstall_repo_url: str = ""
    postinstall_repo_ref: str = "main"


class AdvancedEDAConfig(BaseModel):
    activation_workers: int = 2
    debug: bool = False
    extra_settings: str = ""
    nginx_client_max_body_size: str = "1m"
    nginx_disable_hsts: bool = False
    nginx_disable_https: bool = False
    nginx_hsts_max_age: int = 63072000
    nginx_http_port: int = 8082
    nginx_https_port: int = 8445
    nginx_https_protocols: str = "TLSv1.2,TLSv1.3"
    pg_cert_auth: bool = False
    pg_port: int = 5432
    pg_sslmode: str = "prefer"
    pg_tls_cert: str = ""
    pg_tls_key: str = ""
    redis_disable_tls: bool = False
    redis_host: str = ""
    redis_password: str = ""
    redis_port: int = 6379
    redis_tls_cert: str = ""
    redis_tls_key: str = ""
    redis_username: str = "eda"
    secret_key: str = ""
    tls_cert: str = ""
    tls_key: str = ""
    tls_remote: bool = False
    type: str = "hybrid"
    workers: int = 2
    gunicorn_workers: str = ""


class AdvancedDatabaseConfig(BaseModel):
    postgresql_admin_database: str = "postgres"
    postgresql_disable_tls: bool = False
    postgresql_effective_cache_size: str = ""
    postgresql_extra_settings: str = ""
    postgresql_keep_databases: bool = False
    postgresql_max_connections: int = 1024
    postgresql_log_destination: str = "/dev/stderr"
    postgresql_password_encryption: str = "scram-sha-256"
    postgresql_port: int = 5432
    postgresql_shared_buffers: str = ""
    postgresql_tls_cert: str = ""
    postgresql_tls_key: str = ""


class AdvancedReceptorConfig(BaseModel):
    disable_signing: bool = False
    disable_tls: bool = False
    log_level: str = "info"
    mintls13: bool = False
    port: int = 27199
    protocol: str = "tcp"
    signing_private_key: str = ""
    signing_public_key: str = ""
    tls_cert: str = ""
    tls_key: str = ""


class AdvancedRedisConfig(BaseModel):
    cluster_ip: str = ""
    disable_tls: bool = False
    port: int = 6379
    prefer_ipv6: bool = False
    tls_cert: str = ""
    tls_key: str = ""


class LightspeedConfig(BaseModel):
    enabled: bool = False
    admin_password: str = ""
    admin_user: str = "admin"
    pg_host: str = ""
    pg_password: str = ""
    pg_database: str = "lightspeed"
    pg_username: str = "lightspeed"
    pg_port: int = 5432
    secret_key: str = ""
    tls_cert: str = ""
    tls_key: str = ""
    chatbot_enabled: bool = False
    chatbot_default_provider: str = "rhoai"
    chatbot_model_url: str = ""
    chatbot_model_api_key: str = ""
    chatbot_model_id: str = ""
    wca_model_api_key: str = ""
    wca_model_id: str = ""
    mcp_controller_enabled: bool = False
    mcp_lightspeed_enabled: bool = False


class MonitoringConfig(BaseModel):
    setup_monitoring: bool = False
    pcp_pmcd_port: int = 44321
    pcp_pmproxy_port: int = 44322
    pcp_firewall_zone: str = "public"
    metrics_utility_enabled: bool = False


class AdvancedVariablesConfig(BaseModel):
    common: AdvancedCommonConfig = Field(default_factory=AdvancedCommonConfig)
    host_tuning: HostTuningConfig = Field(default_factory=HostTuningConfig)
    controller: AdvancedControllerConfig = Field(default_factory=AdvancedControllerConfig)
    gateway: AdvancedGatewayConfig = Field(default_factory=AdvancedGatewayConfig)
    hub: AdvancedHubConfig = Field(default_factory=AdvancedHubConfig)
    eda: AdvancedEDAConfig = Field(default_factory=AdvancedEDAConfig)
    database: AdvancedDatabaseConfig = Field(default_factory=AdvancedDatabaseConfig)
    receptor: AdvancedReceptorConfig = Field(default_factory=AdvancedReceptorConfig)
    redis: AdvancedRedisConfig = Field(default_factory=AdvancedRedisConfig)
    lightspeed: LightspeedConfig = Field(default_factory=LightspeedConfig)
    monitoring: MonitoringConfig = Field(default_factory=MonitoringConfig)


class ExecutionNode(BaseModel):
    host: str
    receptor_type: str = "execution"  # 'execution' or 'hop'


class HostInfo(BaseModel):
    hostname: str
    ip_address: str = ""
    ssh_user: str = "aap"
    ssh_port: int = 22
    ssh_key_path: str = ""
    ssh_password: str = ""


class NetworkConfig(BaseModel):
    http_port: int = 80
    https_port: int = 443
    receptor_port: int = 27199
    tls: TLSConfig = Field(default_factory=TLSConfig)


class DeploymentConfig(BaseModel):
    topology: Topology = Topology.GROWTH
    installation_type: InstallationType = InstallationType.ONLINE
    registry: RegistryCredentials = Field(default_factory=RegistryCredentials)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    gateway: GatewayConfig = Field(default_factory=GatewayConfig)
    controller: ControllerConfig = Field(default_factory=ControllerConfig)
    hub: HubConfig = Field(default_factory=HubConfig)
    eda: EDAConfig = Field(default_factory=EDAConfig)
    execution_nodes: list[ExecutionNode] = Field(default_factory=list)
    hosts: list[HostInfo] = Field(default_factory=list)
    network: NetworkConfig = Field(default_factory=NetworkConfig)
    redis_mode: RedisMode = RedisMode.STANDALONE
    bundle_dir: str = ""
    install_dir: str = "/opt/aap"
    eula_accepted: bool = False
    dry_run: bool = False
    target_host: str = ""
    target_user: str = "aap"
    target_password: str = ""
    target_ssh_port: int = 22
    advanced: AdvancedVariablesConfig = Field(default_factory=AdvancedVariablesConfig)


# ---------- Request / Response helpers ----------


class PreflightCheck(BaseModel):
    name: str
    status: str = "pending"  # pending | running | passed | failed | warning
    message: str = ""
    details: str = ""


class PreflightRequest(BaseModel):
    hosts: list[HostInfo] = Field(default_factory=list)
    topology: Topology = Topology.GROWTH
    installation_type: InstallationType = InstallationType.ONLINE
    target_host: str = ""
    target_user: str = "aap"
    target_password: str = ""
    target_ssh_port: int = 22


class PrepareRequest(BaseModel):
    target_host: str
    target_user: str = "aap"
    target_password: str = ""
    target_ssh_port: int = 22
    fix_items: list[str] = Field(default_factory=list)


class PrepareResult(BaseModel):
    success: bool = True
    actions: list[dict] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


class PreflightResult(BaseModel):
    overall: str = "pending"  # passed | failed | warning
    checks: list[PreflightCheck] = Field(default_factory=list)


class InventoryGenerationRequest(BaseModel):
    config: DeploymentConfig
