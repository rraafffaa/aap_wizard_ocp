export type DeployPlatform = 'containerized' | 'openshift';
export type Topology = 'growth' | 'enterprise';
export type InstallationType = 'online' | 'disconnected';
export type DatabaseType = 'managed' | 'external';
export type RedisMode = 'standalone' | 'cluster';

// ── OpenShift Configuration ──────────────────────────────

export interface OCPClusterInfo {
  api_url: string;
  version: string;
  platform: string;
  nodes: OCPNode[];
  storage_classes: string[];
  operators: string[];
  connected: boolean;
  error?: string;
}

export interface OCPNode {
  name: string;
  role: 'master' | 'worker' | 'infra';
  ready: boolean;
  cpu: string;
  memory: string;
}

export interface OCPConfig {
  api_url: string;
  token: string;
  namespace: string;
  storage_class: string;
  postgres_storage_size: string;
  hub_storage_size: string;
  hub_storage_backend: 'file' | 's3' | 'azure';
  gateway_replicas: number;
  controller_replicas: number;
  hub_replicas: number;
  eda_replicas: number;
  controller_resource_preset: 'small' | 'medium' | 'large' | 'custom';
  custom_route_host: string;
  tls_termination: 'edge' | 'passthrough' | 'reencrypt';
  operator_channel: string;
  operator_installed: boolean;
  cr_overrides: string;
  access_url: string;
}

export function getDefaultOCPConfig(): OCPConfig {
  return {
    api_url: '',
    token: '',
    namespace: 'aap',
    storage_class: '',
    postgres_storage_size: '50Gi',
    hub_storage_size: '100Gi',
    hub_storage_backend: 'file',
    gateway_replicas: 1,
    controller_replicas: 1,
    hub_replicas: 1,
    eda_replicas: 1,
    controller_resource_preset: 'medium',
    custom_route_host: '',
    tls_termination: 'edge',
    operator_channel: 'stable-2.6',
    operator_installed: false,
    cr_overrides: '',
    access_url: '',
  };
}

// ── Onboarding Types ─────────────────────────────────────

export interface OnboardingProgress {
  manifest_uploaded: boolean;
  project_created: boolean;
  inventory_created: boolean;
  template_created: boolean;
  job_launched: boolean;
}

export function getDefaultOnboardingProgress(): OnboardingProgress {
  return {
    manifest_uploaded: false,
    project_created: false,
    inventory_created: false,
    template_created: false,
    job_launched: false,
  };
}

export interface TLSConfig {
  custom_ca_cert: string;
  custom_server_cert: string;
  custom_server_key: string;
  disable_https: boolean;
}

export interface RegistryCredentials {
  username: string;
  password: string;
}

export interface DatabaseConfig {
  type: DatabaseType;
  host: string;
  port: number;
  admin_username: string;
  admin_password: string;
}

export interface GatewayConfig {
  hosts: string[];
  admin_password: string;
  pg_host: string;
  pg_database: string;
  pg_username: string;
  pg_password: string;
}

export interface ControllerConfig {
  hosts: string[];
  admin_password: string;
  pg_host: string;
  pg_database: string;
  pg_username: string;
  pg_password: string;
  percent_memory_capacity: number;
}

export interface HubConfig {
  hosts: string[];
  admin_password: string;
  pg_host: string;
  pg_database: string;
  pg_username: string;
  pg_password: string;
  seed_collections: boolean;
}

export interface EDAConfig {
  hosts: string[];
  admin_password: string;
  pg_host: string;
  pg_database: string;
  pg_username: string;
  pg_password: string;
  safe_plugins: string[];
}

export interface AdvancedCommonConfig {
  ca_tls_cert: string;
  ca_tls_key: string;
  ca_tls_key_passphrase: string;
  ca_tls_remote: boolean;
  client_request_timeout: number;
  container_compress: string;
  container_keep_images: boolean;
  container_pull_images: boolean;
  feature_flags: string;
  images_tmp_dir: string;
  registry_auth: boolean;
  registry_ns_aap: string;
  registry_ns_rhel: string;
  registry_tls_verify: boolean;
  registry_url: string;
}

export interface HostTuningConfig {
  tune_host_limits: boolean;
  host_tuning_sysctl_fs_inotify_max_user_instances: number;
  host_tuning_sysctl_fs_inotify_max_user_watches: number;
  host_tuning_nofile_limit_soft: number;
  host_tuning_nofile_limit_hard: number;
}

export interface AdvancedControllerConfig {
  admin_user: string;
  create_preload_data: boolean;
  event_workers: number;
  extra_settings: string;
  license_file: string;
  nginx_client_max_body_size: string;
  nginx_disable_hsts: boolean;
  nginx_disable_https: boolean;
  nginx_hsts_max_age: number;
  nginx_http_port: number;
  nginx_https_port: number;
  nginx_https_protocols: string;
  pg_cert_auth: boolean;
  pg_port: number;
  pg_sslmode: string;
  pg_tls_cert: string;
  pg_tls_key: string;
  postinstall: boolean;
  postinstall_dir: string;
  postinstall_repo_url: string;
  postinstall_repo_ref: string;
  secret_key: string;
  tls_cert: string;
  tls_key: string;
  tls_remote: boolean;
  uwsgi_listen_queue_size: number;
  uwsgi_processes: string;
}

export interface AdvancedGatewayConfig {
  admin_user: string;
  extra_settings: string;
  main_url: string;
  nginx_client_max_body_size: string;
  nginx_disable_hsts: boolean;
  nginx_disable_https: boolean;
  nginx_hsts_max_age: number;
  nginx_http_port: number;
  nginx_https_port: number;
  nginx_https_protocols: string;
  pg_cert_auth: boolean;
  pg_port: number;
  pg_sslmode: string;
  pg_tls_cert: string;
  pg_tls_key: string;
  redis_disable_tls: boolean;
  redis_host: string;
  redis_password: string;
  redis_port: number;
  redis_tls_cert: string;
  redis_tls_key: string;
  redis_username: string;
  secret_key: string;
  tls_cert: string;
  tls_key: string;
  tls_remote: boolean;
  uwsgi_listen_queue_size: number;
  uwsgi_processes: string;
  grpc_server_processes: number;
  grpc_server_max_threads_per_process: number;
}

export interface AdvancedHubConfig {
  extra_settings: string;
  galaxy_importer: string;
  nginx_client_max_body_size: string;
  nginx_disable_hsts: boolean;
  nginx_disable_https: boolean;
  nginx_hsts_max_age: number;
  nginx_http_port: number;
  nginx_https_port: number;
  nginx_https_protocols: string;
  pg_cert_auth: boolean;
  pg_port: number;
  pg_sslmode: string;
  pg_tls_cert: string;
  pg_tls_key: string;
  secret_key: string;
  storage_backend: string;
  tls_cert: string;
  tls_key: string;
  tls_remote: boolean;
  workers: number;
  api_workers: string;
  shared_data_path: string;
  shared_data_mount_opts: string;
  collection_signing: boolean;
  collection_signing_key: string;
  container_signing: boolean;
  container_signing_key: string;
  postinstall: boolean;
  postinstall_dir: string;
  postinstall_repo_url: string;
  postinstall_repo_ref: string;
}

export interface AdvancedEDAConfig {
  activation_workers: number;
  debug: boolean;
  extra_settings: string;
  nginx_client_max_body_size: string;
  nginx_disable_hsts: boolean;
  nginx_disable_https: boolean;
  nginx_hsts_max_age: number;
  nginx_http_port: number;
  nginx_https_port: number;
  nginx_https_protocols: string;
  pg_cert_auth: boolean;
  pg_port: number;
  pg_sslmode: string;
  pg_tls_cert: string;
  pg_tls_key: string;
  redis_disable_tls: boolean;
  redis_host: string;
  redis_password: string;
  redis_port: number;
  redis_tls_cert: string;
  redis_tls_key: string;
  redis_username: string;
  secret_key: string;
  tls_cert: string;
  tls_key: string;
  tls_remote: boolean;
  type: string;
  workers: number;
  gunicorn_workers: string;
}

export interface AdvancedDatabaseConfig {
  postgresql_admin_database: string;
  postgresql_disable_tls: boolean;
  postgresql_effective_cache_size: string;
  postgresql_extra_settings: string;
  postgresql_keep_databases: boolean;
  postgresql_max_connections: number;
  postgresql_log_destination: string;
  postgresql_password_encryption: string;
  postgresql_port: number;
  postgresql_shared_buffers: string;
  postgresql_tls_cert: string;
  postgresql_tls_key: string;
}

export interface AdvancedReceptorConfig {
  disable_signing: boolean;
  disable_tls: boolean;
  log_level: string;
  mintls13: boolean;
  port: number;
  protocol: string;
  signing_private_key: string;
  signing_public_key: string;
  tls_cert: string;
  tls_key: string;
}

export interface AdvancedRedisConfig {
  cluster_ip: string;
  disable_tls: boolean;
  port: number;
  prefer_ipv6: boolean;
  tls_cert: string;
  tls_key: string;
}

export interface LightspeedConfig {
  enabled: boolean;
  admin_password: string;
  admin_user: string;
  pg_host: string;
  pg_password: string;
  pg_database: string;
  pg_username: string;
  pg_port: number;
  secret_key: string;
  tls_cert: string;
  tls_key: string;
  chatbot_enabled: boolean;
  chatbot_default_provider: string;
  chatbot_model_url: string;
  chatbot_model_api_key: string;
  chatbot_model_id: string;
  wca_model_api_key: string;
  wca_model_id: string;
  mcp_controller_enabled: boolean;
  mcp_lightspeed_enabled: boolean;
}

export interface MonitoringConfig {
  setup_monitoring: boolean;
  pcp_pmcd_port: number;
  pcp_pmproxy_port: number;
  pcp_firewall_zone: string;
  metrics_utility_enabled: boolean;
}

export interface AdvancedVariablesConfig {
  common: AdvancedCommonConfig;
  host_tuning: HostTuningConfig;
  controller: AdvancedControllerConfig;
  gateway: AdvancedGatewayConfig;
  hub: AdvancedHubConfig;
  eda: AdvancedEDAConfig;
  database: AdvancedDatabaseConfig;
  receptor: AdvancedReceptorConfig;
  redis: AdvancedRedisConfig;
  lightspeed: LightspeedConfig;
  monitoring: MonitoringConfig;
}

export interface ExecutionNode {
  host: string;
  receptor_type: 'execution' | 'hop';
}

export interface HostInfo {
  hostname: string;
  ip_address: string;
  ssh_user: string;
  ssh_port: number;
  ssh_key_path: string;
  ssh_password: string;
}

export interface NetworkConfig {
  http_port: number;
  https_port: number;
  receptor_port: number;
  tls: TLSConfig;
}

export interface DeploymentConfig {
  platform: DeployPlatform;
  topology: Topology;
  installation_type: InstallationType;
  registry: RegistryCredentials;
  database: DatabaseConfig;
  gateway: GatewayConfig;
  controller: ControllerConfig;
  hub: HubConfig;
  eda: EDAConfig;
  execution_nodes: ExecutionNode[];
  hosts: HostInfo[];
  network: NetworkConfig;
  redis_mode: RedisMode;
  bundle_dir: string;
  install_dir: string;
    eula_accepted: boolean;
    dry_run: boolean;
    target_host: string;
    target_user: string;
    target_password: string;
    target_ssh_port: number;
    advanced: AdvancedVariablesConfig;
    ocp: OCPConfig;
    onboarding: OnboardingProgress;
  }

export interface PreflightCheck {
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'warning';
  message: string;
  details: string;
}

export interface PreflightResult {
  overall: 'pending' | 'passed' | 'failed' | 'warning';
  checks: PreflightCheck[];
}

export interface DeployPhase {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'error';
}

export interface DeployStatus {
  session_id: string;
  status: string;
  current_phase: string;
  progress: number;
  error: string;
  access_url?: string;
  log_lines: string[];
}

export type WizardStep =
  | 'welcome'
  | 'eula'
  | 'platform'
  // Containerized branch
  | 'subscription'
  | 'topology'
  | 'target'
  | 'hosts'
  // OCP branch
  | 'cluster'
  | 'namespace'
  | 'operator'
  | 'replicas'
  // Shared steps
  | 'components'
  | 'database'
  | 'network'
  | 'credentials'
  | 'advanced'
  | 'preflight'
  | 'review'
  | 'deploy'
  | 'complete'
  | 'onboarding';

// Steps for containerized deployment
const CONTAINERIZED_SECTIONS: { label: string; steps: WizardStep[] }[] = [
  { label: 'Getting Started', steps: ['welcome', 'eula'] },
  { label: 'Installation', steps: ['subscription', 'topology', 'target', 'hosts'] },
  { label: 'Configuration', steps: ['database', 'network', 'credentials', 'advanced'] },
  { label: 'Deployment', steps: ['preflight', 'deploy', 'complete'] },
];

// Steps for OpenShift deployment
const OPENSHIFT_SECTIONS: { label: string; steps: WizardStep[] }[] = [
  { label: 'Getting Started', steps: ['welcome', 'eula'] },
  { label: 'OpenShift', steps: ['cluster', 'namespace', 'operator', 'replicas'] },
  { label: 'Configuration', steps: ['database', 'network', 'credentials', 'advanced'] },
  { label: 'Deployment', steps: ['preflight', 'deploy', 'complete'] },
];

export function getStepSections(platform: DeployPlatform): { label: string; steps: WizardStep[] }[] {
  return platform === 'openshift' ? OPENSHIFT_SECTIONS : CONTAINERIZED_SECTIONS;
}

const CONTAINERIZED_STEPS: { id: WizardStep; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'eula', label: 'License Agreement' },
  { id: 'subscription', label: 'Image Source' },
  { id: 'topology', label: 'Topology' },
  { id: 'target', label: 'SSH Target' },
  { id: 'hosts', label: 'Hosts' },
  { id: 'database', label: 'Database' },
  { id: 'network', label: 'Network & TLS' },
  { id: 'credentials', label: 'Admin Passwords' },
  { id: 'advanced', label: 'Advanced Variables' },
  { id: 'preflight', label: 'Pre-flight Checks' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'complete', label: 'Complete' },
];

const OPENSHIFT_STEPS: { id: WizardStep; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'eula', label: 'License Agreement' },
  { id: 'cluster', label: 'Cluster Connection' },
  { id: 'namespace', label: 'Namespace & Storage' },
  { id: 'operator', label: 'AAP Operator' },
  { id: 'replicas', label: 'Replicas & Resources' },
  { id: 'database', label: 'Database' },
  { id: 'network', label: 'Routes & TLS' },
  { id: 'credentials', label: 'Admin Passwords' },
  { id: 'advanced', label: 'Advanced Variables' },
  { id: 'preflight', label: 'Pre-flight Checks' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'complete', label: 'Complete' },
];

export function getWizardSteps(platform: DeployPlatform): { id: WizardStep; label: string }[] {
  return platform === 'openshift' ? OPENSHIFT_STEPS : CONTAINERIZED_STEPS;
}

// Legacy exports for backward compatibility during transition
export const STEP_SECTIONS = CONTAINERIZED_SECTIONS;
export const WIZARD_STEPS = CONTAINERIZED_STEPS;

export const STORAGE_KEY = 'aap-wizard-config';
export const STORAGE_STEP_KEY = 'aap-wizard-step';

export function getDefaultAdvancedConfig(): AdvancedVariablesConfig {
  return {
    common: {
      ca_tls_cert: '', ca_tls_key: '', ca_tls_key_passphrase: '', ca_tls_remote: false,
      client_request_timeout: 30, container_compress: 'gzip', container_keep_images: false,
      container_pull_images: true, feature_flags: '', images_tmp_dir: '',
      registry_auth: true, registry_ns_aap: 'ansible-automation-platform-26',
      registry_ns_rhel: 'rhel9', registry_tls_verify: true, registry_url: 'registry.redhat.io',
    },
    host_tuning: {
      tune_host_limits: true,
      host_tuning_sysctl_fs_inotify_max_user_instances: 8192,
      host_tuning_sysctl_fs_inotify_max_user_watches: 524288,
      host_tuning_nofile_limit_soft: 524288,
      host_tuning_nofile_limit_hard: 524288,
    },
    controller: {
      admin_user: 'admin', create_preload_data: true, event_workers: 4,
      extra_settings: '', license_file: '', nginx_client_max_body_size: '5m',
      nginx_disable_hsts: false, nginx_disable_https: false, nginx_hsts_max_age: 63072000,
      nginx_http_port: 8080, nginx_https_port: 8443, nginx_https_protocols: 'TLSv1.2,TLSv1.3',
      pg_cert_auth: false, pg_port: 5432, pg_sslmode: 'prefer',
      pg_tls_cert: '', pg_tls_key: '', postinstall: false, postinstall_dir: '',
      postinstall_repo_url: '', postinstall_repo_ref: 'main', secret_key: '',
      tls_cert: '', tls_key: '', tls_remote: false,
      uwsgi_listen_queue_size: 2048, uwsgi_processes: '',
    },
    gateway: {
      admin_user: 'admin', extra_settings: '', main_url: '',
      nginx_client_max_body_size: '5m', nginx_disable_hsts: false,
      nginx_disable_https: false, nginx_hsts_max_age: 63072000,
      nginx_http_port: 8083, nginx_https_port: 8446, nginx_https_protocols: 'TLSv1.2,TLSv1.3',
      pg_cert_auth: false, pg_port: 5432, pg_sslmode: 'prefer',
      pg_tls_cert: '', pg_tls_key: '',
      redis_disable_tls: false, redis_host: '', redis_password: '',
      redis_port: 6379, redis_tls_cert: '', redis_tls_key: '', redis_username: 'gateway',
      secret_key: '', tls_cert: '', tls_key: '', tls_remote: false,
      uwsgi_listen_queue_size: 4096, uwsgi_processes: '',
      grpc_server_processes: 5, grpc_server_max_threads_per_process: 10,
    },
    hub: {
      extra_settings: '', galaxy_importer: '',
      nginx_client_max_body_size: '20m', nginx_disable_hsts: false,
      nginx_disable_https: false, nginx_hsts_max_age: 63072000,
      nginx_http_port: 8081, nginx_https_port: 8444, nginx_https_protocols: 'TLSv1.2,TLSv1.3',
      pg_cert_auth: false, pg_port: 5432, pg_sslmode: 'prefer',
      pg_tls_cert: '', pg_tls_key: '',
      secret_key: '', storage_backend: 'file',
      tls_cert: '', tls_key: '', tls_remote: false,
      workers: 2, api_workers: '',
      shared_data_path: '', shared_data_mount_opts: 'rw,sync,hard',
      collection_signing: false, collection_signing_key: '',
      container_signing: false, container_signing_key: '',
      postinstall: false, postinstall_dir: '',
      postinstall_repo_url: '', postinstall_repo_ref: 'main',
    },
    eda: {
      activation_workers: 2, debug: false, extra_settings: '',
      nginx_client_max_body_size: '1m', nginx_disable_hsts: false,
      nginx_disable_https: false, nginx_hsts_max_age: 63072000,
      nginx_http_port: 8082, nginx_https_port: 8445, nginx_https_protocols: 'TLSv1.2,TLSv1.3',
      pg_cert_auth: false, pg_port: 5432, pg_sslmode: 'prefer',
      pg_tls_cert: '', pg_tls_key: '',
      redis_disable_tls: false, redis_host: '', redis_password: '',
      redis_port: 6379, redis_tls_cert: '', redis_tls_key: '', redis_username: 'eda',
      secret_key: '', tls_cert: '', tls_key: '', tls_remote: false,
      type: 'hybrid', workers: 2, gunicorn_workers: '',
    },
    database: {
      postgresql_admin_database: 'postgres', postgresql_disable_tls: false,
      postgresql_effective_cache_size: '', postgresql_extra_settings: '',
      postgresql_keep_databases: false, postgresql_max_connections: 1024,
      postgresql_log_destination: '/dev/stderr', postgresql_password_encryption: 'scram-sha-256',
      postgresql_port: 5432, postgresql_shared_buffers: '',
      postgresql_tls_cert: '', postgresql_tls_key: '',
    },
    receptor: {
      disable_signing: false, disable_tls: false, log_level: 'info',
      mintls13: false, port: 27199, protocol: 'tcp',
      signing_private_key: '', signing_public_key: '',
      tls_cert: '', tls_key: '',
    },
    redis: {
      cluster_ip: '', disable_tls: false, port: 6379,
      prefer_ipv6: false, tls_cert: '', tls_key: '',
    },
    lightspeed: {
      enabled: false, admin_password: '', admin_user: 'admin',
      pg_host: '', pg_password: '', pg_database: 'lightspeed',
      pg_username: 'lightspeed', pg_port: 5432,
      secret_key: '', tls_cert: '', tls_key: '',
      chatbot_enabled: false, chatbot_default_provider: 'rhoai',
      chatbot_model_url: '', chatbot_model_api_key: '', chatbot_model_id: '',
      wca_model_api_key: '', wca_model_id: '',
      mcp_controller_enabled: false, mcp_lightspeed_enabled: false,
    },
    monitoring: {
      setup_monitoring: false, pcp_pmcd_port: 44321,
      pcp_pmproxy_port: 44322, pcp_firewall_zone: 'public',
      metrics_utility_enabled: false,
    },
  };
}

export function getDefaultConfig(): DeploymentConfig {
  return {
    platform: 'containerized',
    topology: 'enterprise',
    installation_type: 'online',
    registry: { username: '', password: '' },
    database: {
      type: 'managed',
      host: '',
      port: 5432,
      admin_username: 'postgres',
      admin_password: '',
    },
    gateway: {
      hosts: ['aap.example.org'],
      admin_password: '',
      pg_host: '',
      pg_database: 'gateway',
      pg_username: 'gateway',
      pg_password: '',
    },
    controller: {
      hosts: ['aap.example.org'],
      admin_password: '',
      pg_host: '',
      pg_database: 'controller',
      pg_username: 'controller',
      pg_password: '',
      percent_memory_capacity: 0.5,
    },
    hub: {
      hosts: ['aap.example.org'],
      admin_password: '',
      pg_host: '',
      pg_database: 'hub',
      pg_username: 'hub',
      pg_password: '',
      seed_collections: false,
    },
    eda: {
      hosts: ['aap.example.org'],
      admin_password: '',
      pg_host: '',
      pg_database: 'eda',
      pg_username: 'eda',
      pg_password: '',
      safe_plugins: ['ansible.eda.webhook', 'ansible.eda.alertmanager'],
    },
    execution_nodes: [],
    hosts: [],
    network: {
      http_port: 80,
      https_port: 443,
      receptor_port: 27199,
      tls: {
        custom_ca_cert: '',
        custom_server_cert: '',
        custom_server_key: '',
        disable_https: false,
      },
    },
    redis_mode: 'standalone',
    bundle_dir: '',
    install_dir: '/opt/aap',
    eula_accepted: false,
    dry_run: false,
    target_host: '',
    target_user: 'aap',
    target_password: '',
    target_ssh_port: 22,
    advanced: getDefaultAdvancedConfig(),
    ocp: getDefaultOCPConfig(),
    onboarding: getDefaultOnboardingProgress(),
  };
}

/** Fields that must never be persisted to localStorage. */
export function stripSensitiveFields(config: DeploymentConfig): DeploymentConfig {
  const clone = JSON.parse(JSON.stringify(config)) as DeploymentConfig;
  // SSH / target credentials
  clone.target_password = '';
  // Registry credentials
  clone.registry.password = '';
  // Component admin & DB passwords
  for (const comp of ['gateway', 'controller', 'hub', 'eda'] as const) {
    clone[comp].admin_password = '';
    clone[comp].pg_password = '';
  }
  clone.database.admin_password = '';
  // OCP token
  if (clone.ocp) clone.ocp.token = '';
  // Advanced secrets
  if (clone.advanced?.lightspeed) {
    clone.advanced.lightspeed.chatbot_model_api_key = '';
    clone.advanced.lightspeed.wca_model_api_key = '';
    clone.advanced.lightspeed.admin_password = '';
    clone.advanced.lightspeed.pg_password = '';
    clone.advanced.lightspeed.secret_key = '';
  }
  if (clone.advanced?.gateway) clone.advanced.gateway.secret_key = '';
  if (clone.advanced?.controller) clone.advanced.controller.secret_key = '';
  if (clone.advanced?.hub) clone.advanced.hub.secret_key = '';
  if (clone.advanced?.eda) clone.advanced.eda.secret_key = '';
  return clone;
}

export function saveConfig(config: DeploymentConfig, step: WizardStep) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripSensitiveFields(config)));
    localStorage.setItem(STORAGE_STEP_KEY, step);
  } catch {}
}

export function loadSavedConfig(): { config: DeploymentConfig; step: WizardStep } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const step = localStorage.getItem(STORAGE_STEP_KEY) as WizardStep | null;
    if (raw && step) {
      const parsed = JSON.parse(raw);
      const defaults = getDefaultConfig();
      const config: DeploymentConfig = {
        ...defaults,
        ...parsed,
        ocp: { ...defaults.ocp, ...(parsed.ocp ?? {}) },
        onboarding: { ...defaults.onboarding, ...(parsed.onboarding ?? {}) },
        advanced: {
          ...defaults.advanced,
          ...(parsed.advanced ?? {}),
          common: { ...defaults.advanced.common, ...(parsed.advanced?.common ?? {}) },
          host_tuning: { ...defaults.advanced.host_tuning, ...(parsed.advanced?.host_tuning ?? {}) },
          controller: { ...defaults.advanced.controller, ...(parsed.advanced?.controller ?? {}) },
          gateway: { ...defaults.advanced.gateway, ...(parsed.advanced?.gateway ?? {}) },
          hub: { ...defaults.advanced.hub, ...(parsed.advanced?.hub ?? {}) },
          eda: { ...defaults.advanced.eda, ...(parsed.advanced?.eda ?? {}) },
          database: { ...defaults.advanced.database, ...(parsed.advanced?.database ?? {}) },
          receptor: { ...defaults.advanced.receptor, ...(parsed.advanced?.receptor ?? {}) },
          redis: { ...defaults.advanced.redis, ...(parsed.advanced?.redis ?? {}) },
          lightspeed: { ...defaults.advanced.lightspeed, ...(parsed.advanced?.lightspeed ?? {}) },
          monitoring: { ...defaults.advanced.monitoring, ...(parsed.advanced?.monitoring ?? {}) },
        },
      };
      return { config, step };
    }
  } catch {}
  return null;
}

export function clearSavedConfig() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_STEP_KEY);
}

// ============================================================
// Deployment History — persists completed deployment details
// ============================================================

const DEPLOY_HISTORY_KEY = 'aap_wizard_deploy_history';

export interface DeploymentRecord {
  id: string;           // session ID
  timestamp: string;    // ISO date
  topology: string;
  target_host: string;
  gateway_url: string;
  components: string[];
  status: 'completed' | 'failed';
  config: DeploymentConfig; // passwords stripped
}

export function saveDeploymentRecord(
  sessionId: string,
  config: DeploymentConfig,
  status: 'completed' | 'failed',
) {
  const isOCP = config.platform === 'openshift';
  const host = config.target_host || config.gateway.hosts[0];
  const port = config.network.https_port;
  const gatewayUrl = isOCP
    ? config.ocp.access_url || `https://aap-${config.ocp.namespace || 'aap'}.apps.${config.ocp.api_url.replace(/^https?:\/\/api\./, '').replace(/:6443\/?$/, '')}`
    : `https://${host}${port === 443 ? '' : `:${port}`}`;

  const record: DeploymentRecord = {
    id: sessionId,
    timestamp: new Date().toISOString(),
    topology: config.topology,
    target_host: host,
    gateway_url: gatewayUrl,
    components: ['Gateway', 'Controller', 'Hub', 'EDA'],
    status,
    config: stripSensitiveFields(config),
  };

  try {
    const existing = loadDeploymentHistory();
    // Keep last 10 records, newest first
    const updated = [record, ...existing.filter(r => r.id !== sessionId)].slice(0, 10);
    localStorage.setItem(DEPLOY_HISTORY_KEY, JSON.stringify(updated));
  } catch {}
}

export function loadDeploymentHistory(): DeploymentRecord[] {
  try {
    const raw = localStorage.getItem(DEPLOY_HISTORY_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function getLastSuccessfulDeployment(): DeploymentRecord | null {
  const history = loadDeploymentHistory();
  return history.find(r => r.status === 'completed') || null;
}

export function deleteDeploymentRecord(id: string) {
  try {
    const existing = loadDeploymentHistory();
    const updated = existing.filter(r => r.id !== id);
    localStorage.setItem(DEPLOY_HISTORY_KEY, JSON.stringify(updated));
  } catch {}
}

export function clearDeploymentHistory() {
  localStorage.removeItem(DEPLOY_HISTORY_KEY);
}

export function exportConfigToFile(config: DeploymentConfig) {
  const safe = stripSensitiveFields(config);
  const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aap-wizard-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
