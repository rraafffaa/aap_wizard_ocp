import React, { useState } from 'react';
import {
  AngleDownIcon,
  AngleRightIcon,
  ExternalLinkAltIcon,
  InfoCircleIcon,
} from '@patternfly/react-icons';
import type {
  DeploymentConfig,
  AdvancedVariablesConfig,
  AdvancedCommonConfig,
  HostTuningConfig,
  AdvancedControllerConfig,
  AdvancedGatewayConfig,
  AdvancedHubConfig,
  AdvancedEDAConfig,
  AdvancedDatabaseConfig,
  AdvancedReceptorConfig,
  AdvancedRedisConfig,
  LightspeedConfig,
  MonitoringConfig,
} from '../types';

interface Props {
  config: DeploymentConfig;
  updateConfig: (partial: Partial<DeploymentConfig>) => void;
}

const DOC_BASE = 'https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.6/html/containerized_installation';
const DOC_LINKS = {
  common: `${DOC_BASE}/appendix-inventory-files-vars#general-variables`,
  controller: `${DOC_BASE}/appendix-inventory-files-vars#controller-variables`,
  gateway: `${DOC_BASE}/appendix-inventory-files-vars#platform-gateway-variables`,
  hub: `${DOC_BASE}/appendix-inventory-files-vars#hub-variables`,
  eda: `${DOC_BASE}/appendix-inventory-files-vars#event-driven-ansible-variables`,
  lightspeed: `${DOC_BASE}/appendix-inventory-files-vars#lightspeed-variables`,
  database: `${DOC_BASE}/appendix-inventory-files-vars#general-variables`,
  receptor: `${DOC_BASE}/appendix-inventory-files-vars#general-variables`,
  redis: `${DOC_BASE}/appendix-inventory-files-vars#general-variables`,
  monitoring: `${DOC_BASE}/appendix-inventory-files-vars#general-variables`,
  host_tuning: `${DOC_BASE}/appendix-inventory-files-vars#general-variables`,
} as const;

type FieldType = 'text' | 'number' | 'boolean' | 'select' | 'textarea';

interface FieldDef {
  key: string;
  label: string;
  inventoryVar: string;
  description: string;
  type: FieldType;
  defaultValue?: string | number | boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

function DocLink({ section }: { section: keyof typeof DOC_LINKS }) {
  return (
    <a
      href={DOC_LINKS[section]}
      target="_blank"
      rel="noopener noreferrer"
      className="aap-btn aap-btn--link aap-btn--sm"
    >
      View documentation <ExternalLinkAltIcon />
    </a>
  );
}

function Section({
  id,
  title,
  subtitle,
  docSection,
  fields,
  values,
  onChange,
  defaultOpen,
}: {
  id: string;
  title: string;
  subtitle: string;
  docSection: keyof typeof DOC_LINKS;
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const nonDefaultCount = fields.filter((f) => {
    const val = values[f.key];
    if (f.type === 'boolean') return val !== (f.defaultValue ?? false);
    if (f.type === 'number') return val !== f.defaultValue && val !== 0;
    return val !== '' && val !== f.defaultValue;
  }).length;

  return (
    <div className="aap-card" style={{ marginBottom: 12 }}>
      <button
        type="button"
        className="aap-section-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`section-${id}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
          fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{ color: 'var(--aap-text-muted)' }}>
          {open ? <AngleDownIcon /> : <AngleRightIcon />}
        </span>
        <span style={{ flex: 1 }}>
          <span className="aap-card__title">{title}</span>
          <span className="aap-card__description" style={{ display: 'block' }}>{subtitle}</span>
        </span>
        {nonDefaultCount > 0 && (
          <span className="aap-badge aap-badge--info">{nonDefaultCount} modified</span>
        )}
        <span style={{ fontSize: 12, color: 'var(--aap-text-muted)' }}>
          {fields.length} variables
        </span>
      </button>

      {open && (
        <div id={`section-${id}`} style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <DocLink section={docSection} />
          </div>
          <div style={{ display: 'grid', gap: 16 }}>
            {fields.map((f) => (
              <FieldRow key={f.key} field={f} value={values[f.key]} onChange={onChange} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const isModified = (() => {
    if (field.type === 'boolean') return value !== (field.defaultValue ?? false);
    if (field.type === 'number') return value !== field.defaultValue && value !== 0;
    return value !== '' && value !== field.defaultValue;
  })();

  return (
    <div className="aap-form-group" style={{ marginBottom: 0 }}>
      <div className="aap-form-group__label" style={{ justifyContent: 'space-between' }}>
        <span>
          {field.label}
          {isModified && <span style={{ color: 'var(--aap-blue)', marginLeft: 6, fontSize: 10 }}>modified</span>}
        </span>
        <code style={{ fontSize: 11, color: 'var(--aap-text-muted)', fontFamily: 'var(--aap-font-mono)' }}>
          {field.inventoryVar}
        </code>
      </div>

      {field.type === 'boolean' ? (
        <label className="aap-switch" style={{ marginTop: 4 }}>
          <span className={`aap-switch__track ${value ? 'aap-switch--on' : ''}`} style={value ? { background: 'var(--aap-blue)' } : {}}>
            <span className="aap-switch__thumb" style={value ? { transform: 'translateX(18px)' } : {}} />
          </span>
          <span className="aap-switch__label">{value ? 'Enabled' : 'Disabled'}</span>
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(field.key, e.target.checked)}
            style={{ display: 'none' }}
          />
        </label>
      ) : field.type === 'select' ? (
        <select
          className="aap-select"
          value={String(value ?? '')}
          onChange={(e) => onChange(field.key, e.target.value)}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : field.type === 'textarea' ? (
        <textarea
          className="aap-input aap-input--mono"
          rows={3}
          value={String(value ?? '')}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder ?? `Default: ${field.defaultValue ?? 'none'}`}
        />
      ) : field.type === 'number' ? (
        <input
          type="number"
          className="aap-input"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(field.key, e.target.value === '' ? 0 : Number(e.target.value))}
          placeholder={`Default: ${field.defaultValue ?? ''}`}
        />
      ) : (
        <input
          type="text"
          className="aap-input aap-input--mono"
          value={String(value ?? '')}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder ?? `Default: ${field.defaultValue ?? 'none'}`}
        />
      )}
      <div className="aap-form-group__helper">{field.description}</div>
    </div>
  );
}

const COMMON_FIELDS: FieldDef[] = [
  { key: 'registry_url', label: 'Registry URL', inventoryVar: 'registry_url', description: 'The container registry URL to pull images from.', type: 'text', defaultValue: 'registry.redhat.io' },
  { key: 'registry_auth', label: 'Registry Authentication', inventoryVar: 'registry_auth', description: 'Use registry authentication when pulling images.', type: 'boolean', defaultValue: true },
  { key: 'registry_tls_verify', label: 'Registry TLS Verify', inventoryVar: 'registry_tls_verify', description: 'Verify TLS certificates when connecting to the registry.', type: 'boolean', defaultValue: true },
  { key: 'registry_ns_aap', label: 'AAP Registry Namespace', inventoryVar: 'registry_ns_aap', description: 'Registry namespace for AAP container images.', type: 'text', defaultValue: 'ansible-automation-platform-26' },
  { key: 'registry_ns_rhel', label: 'RHEL Registry Namespace', inventoryVar: 'registry_ns_rhel', description: 'Registry namespace for RHEL base images.', type: 'text', defaultValue: 'rhel9' },
  { key: 'ca_tls_cert', label: 'CA TLS Certificate', inventoryVar: 'ca_tls_cert', description: 'Path to custom TLS CA certificate file.', type: 'text' },
  { key: 'ca_tls_key', label: 'CA TLS Key', inventoryVar: 'ca_tls_key', description: 'Path to custom TLS CA private key file.', type: 'text' },
  { key: 'ca_tls_key_passphrase', label: 'CA TLS Key Passphrase', inventoryVar: 'ca_tls_key_passphrase', description: 'Passphrase for the CA TLS private key.', type: 'text' },
  { key: 'ca_tls_remote', label: 'CA TLS Remote', inventoryVar: 'ca_tls_remote', description: 'Whether the CA TLS files are already on the remote hosts.', type: 'boolean', defaultValue: false },
  { key: 'client_request_timeout', label: 'Client Request Timeout', inventoryVar: 'client_request_timeout', description: 'End user HTTP request timeout in seconds (minimum 10).', type: 'number', defaultValue: 30 },
  { key: 'container_compress', label: 'Container Compression', inventoryVar: 'container_compress', description: 'Compression software for container images.', type: 'select', defaultValue: 'gzip', options: [{ value: 'gzip', label: 'gzip' }, { value: 'zstd', label: 'zstd' }] },
  { key: 'container_keep_images', label: 'Keep Container Images', inventoryVar: 'container_keep_images', description: 'Keep container images after uninstall.', type: 'boolean', defaultValue: false },
  { key: 'container_pull_images', label: 'Pull Container Images', inventoryVar: 'container_pull_images', description: 'Pull newer container images during install.', type: 'boolean', defaultValue: true },
  { key: 'feature_flags', label: 'Feature Flags', inventoryVar: 'feature_flags', description: 'Feature flags dictionary (YAML format).', type: 'textarea' },
  { key: 'images_tmp_dir', label: 'Images Temp Directory', inventoryVar: 'images_tmp_dir', description: 'Path to extract bundled images. Defaults to system TMPDIR.', type: 'text' },
];

const HOST_TUNING_FIELDS: FieldDef[] = [
  { key: 'tune_host_limits', label: 'Enable Host Tuning', inventoryVar: 'tune_host_limits', description: 'Apply kernel and user-limit tuning for higher concurrency during install.', type: 'boolean', defaultValue: true },
  { key: 'host_tuning_sysctl_fs_inotify_max_user_instances', label: 'Max Inotify User Instances', inventoryVar: 'host_tuning_sysctl_fs_inotify_max_user_instances', description: 'Kernel sysctl: fs.inotify.max_user_instances.', type: 'number', defaultValue: 8192 },
  { key: 'host_tuning_sysctl_fs_inotify_max_user_watches', label: 'Max Inotify User Watches', inventoryVar: 'host_tuning_sysctl_fs_inotify_max_user_watches', description: 'Kernel sysctl: fs.inotify.max_user_watches.', type: 'number', defaultValue: 524288 },
  { key: 'host_tuning_nofile_limit_soft', label: 'Nofile Soft Limit', inventoryVar: 'host_tuning_nofile_limit_soft', description: 'Soft limit for open files (nofile) for the AAP service user.', type: 'number', defaultValue: 524288 },
  { key: 'host_tuning_nofile_limit_hard', label: 'Nofile Hard Limit', inventoryVar: 'host_tuning_nofile_limit_hard', description: 'Hard limit for open files (nofile) for the AAP service user.', type: 'number', defaultValue: 524288 },
];

const CONTROLLER_FIELDS: FieldDef[] = [
  { key: 'admin_user', label: 'Admin User', inventoryVar: 'controller_admin_user', description: 'Username for the Controller admin account.', type: 'text', defaultValue: 'admin' },
  { key: 'create_preload_data', label: 'Create Preload Data', inventoryVar: 'controller_create_preload_data', description: 'Create default demo project, credential, and job template after install.', type: 'boolean', defaultValue: true },
  { key: 'event_workers', label: 'Event Workers', inventoryVar: 'controller_event_workers', description: 'Number of event processing workers.', type: 'number', defaultValue: 4 },
  { key: 'license_file', label: 'License File', inventoryVar: 'controller_license_file', description: 'Path to the Controller license/manifest file.', type: 'text' },
  { key: 'nginx_client_max_body_size', label: 'Nginx Max Body Size', inventoryVar: 'controller_nginx_client_max_body_size', description: 'Maximum HTTP request body size for Nginx.', type: 'text', defaultValue: '5m' },
  { key: 'nginx_disable_hsts', label: 'Disable HSTS', inventoryVar: 'controller_nginx_disable_hsts', description: 'Disable HTTP Strict Transport Security header.', type: 'boolean', defaultValue: false },
  { key: 'nginx_disable_https', label: 'Disable HTTPS', inventoryVar: 'controller_nginx_disable_https', description: 'Disable HTTPS on the Controller Nginx.', type: 'boolean', defaultValue: false },
  { key: 'nginx_hsts_max_age', label: 'HSTS Max Age', inventoryVar: 'controller_nginx_hsts_max_age', description: 'HSTS max-age header value in seconds.', type: 'number', defaultValue: 63072000 },
  { key: 'nginx_http_port', label: 'Nginx HTTP Port', inventoryVar: 'controller_nginx_http_port', description: 'Internal HTTP port for Controller Nginx.', type: 'number', defaultValue: 8080 },
  { key: 'nginx_https_port', label: 'Nginx HTTPS Port', inventoryVar: 'controller_nginx_https_port', description: 'Internal HTTPS port for Controller Nginx.', type: 'number', defaultValue: 8443 },
  { key: 'nginx_https_protocols', label: 'HTTPS Protocols', inventoryVar: 'controller_nginx_https_protocols', description: 'Comma-separated TLS protocols to enable.', type: 'text', defaultValue: 'TLSv1.2,TLSv1.3' },
  { key: 'pg_cert_auth', label: 'PostgreSQL Cert Auth', inventoryVar: 'controller_pg_cert_auth', description: 'Use TLS certificate authentication for PostgreSQL.', type: 'boolean', defaultValue: false },
  { key: 'pg_port', label: 'PostgreSQL Port', inventoryVar: 'controller_pg_port', description: 'PostgreSQL port for Controller database.', type: 'number', defaultValue: 5432 },
  { key: 'pg_sslmode', label: 'PostgreSQL SSL Mode', inventoryVar: 'controller_pg_sslmode', description: 'PostgreSQL SSL connection mode.', type: 'select', defaultValue: 'prefer', options: [{ value: 'disable', label: 'disable' }, { value: 'allow', label: 'allow' }, { value: 'prefer', label: 'prefer' }, { value: 'require', label: 'require' }, { value: 'verify-ca', label: 'verify-ca' }, { value: 'verify-full', label: 'verify-full' }] },
  { key: 'pg_tls_cert', label: 'PostgreSQL TLS Cert', inventoryVar: 'controller_pg_tls_cert', description: 'Path to PostgreSQL client TLS certificate.', type: 'text' },
  { key: 'pg_tls_key', label: 'PostgreSQL TLS Key', inventoryVar: 'controller_pg_tls_key', description: 'Path to PostgreSQL client TLS private key.', type: 'text' },
  { key: 'secret_key', label: 'Secret Key', inventoryVar: 'controller_secret_key', description: 'Secret key for Controller encryption. Auto-generated if empty.', type: 'text' },
  { key: 'tls_cert', label: 'TLS Certificate', inventoryVar: 'controller_tls_cert', description: 'Path to custom TLS certificate for Controller.', type: 'text' },
  { key: 'tls_key', label: 'TLS Key', inventoryVar: 'controller_tls_key', description: 'Path to custom TLS private key for Controller.', type: 'text' },
  { key: 'tls_remote', label: 'TLS Remote', inventoryVar: 'controller_tls_remote', description: 'Whether TLS files are already on the remote host.', type: 'boolean', defaultValue: false },
  { key: 'uwsgi_listen_queue_size', label: 'uWSGI Listen Queue', inventoryVar: 'controller_uwsgi_listen_queue_size', description: 'uWSGI listen queue size.', type: 'number', defaultValue: 2048 },
  { key: 'uwsgi_processes', label: 'uWSGI Processes', inventoryVar: 'controller_uwsgi_processes', description: 'Number of uWSGI worker processes. Blank = auto (2*CPU+1).', type: 'text', placeholder: 'Auto (2*CPU+1)' },
  { key: 'postinstall', label: 'Enable Postinstall', inventoryVar: 'controller_postinstall', description: 'Run postinstall automation (requires license file).', type: 'boolean', defaultValue: false },
  { key: 'postinstall_dir', label: 'Postinstall Directory', inventoryVar: 'controller_postinstall_dir', description: 'Local directory with postinstall configuration.', type: 'text' },
  { key: 'postinstall_repo_url', label: 'Postinstall Repo URL', inventoryVar: 'controller_postinstall_repo_url', description: 'Git repository URL for postinstall config.', type: 'text' },
  { key: 'postinstall_repo_ref', label: 'Postinstall Repo Ref', inventoryVar: 'controller_postinstall_repo_ref', description: 'Git branch or tag for the postinstall repository.', type: 'text', defaultValue: 'main' },
  { key: 'extra_settings', label: 'Extra Settings', inventoryVar: 'controller_extra_settings', description: 'YAML list of extra settings (e.g., USE_X_FORWARDED_HOST).', type: 'textarea' },
];

const GATEWAY_FIELDS: FieldDef[] = [
  { key: 'admin_user', label: 'Admin User', inventoryVar: 'gateway_admin_user', description: 'Username for the Gateway admin account.', type: 'text', defaultValue: 'admin' },
  { key: 'main_url', label: 'Main URL', inventoryVar: 'gateway_main_url', description: 'Override the main URL for the Gateway.', type: 'text' },
  { key: 'nginx_client_max_body_size', label: 'Nginx Max Body Size', inventoryVar: 'gateway_nginx_client_max_body_size', description: 'Maximum HTTP request body size.', type: 'text', defaultValue: '5m' },
  { key: 'nginx_disable_hsts', label: 'Disable HSTS', inventoryVar: 'gateway_nginx_disable_hsts', description: 'Disable HTTP Strict Transport Security header.', type: 'boolean', defaultValue: false },
  { key: 'nginx_disable_https', label: 'Disable HTTPS', inventoryVar: 'gateway_nginx_disable_https', description: 'Disable HTTPS on the Gateway Nginx.', type: 'boolean', defaultValue: false },
  { key: 'nginx_hsts_max_age', label: 'HSTS Max Age', inventoryVar: 'gateway_nginx_hsts_max_age', description: 'HSTS max-age value in seconds.', type: 'number', defaultValue: 63072000 },
  { key: 'nginx_http_port', label: 'Nginx HTTP Port', inventoryVar: 'gateway_nginx_http_port', description: 'Internal HTTP port for Gateway Nginx.', type: 'number', defaultValue: 8083 },
  { key: 'nginx_https_port', label: 'Nginx HTTPS Port', inventoryVar: 'gateway_nginx_https_port', description: 'Internal HTTPS port for Gateway Nginx.', type: 'number', defaultValue: 8446 },
  { key: 'nginx_https_protocols', label: 'HTTPS Protocols', inventoryVar: 'gateway_nginx_https_protocols', description: 'Comma-separated TLS protocols.', type: 'text', defaultValue: 'TLSv1.2,TLSv1.3' },
  { key: 'pg_cert_auth', label: 'PostgreSQL Cert Auth', inventoryVar: 'gateway_pg_cert_auth', description: 'Use TLS certificate authentication for PostgreSQL.', type: 'boolean', defaultValue: false },
  { key: 'pg_port', label: 'PostgreSQL Port', inventoryVar: 'gateway_pg_port', description: 'PostgreSQL port for Gateway database.', type: 'number', defaultValue: 5432 },
  { key: 'pg_sslmode', label: 'PostgreSQL SSL Mode', inventoryVar: 'gateway_pg_sslmode', description: 'PostgreSQL SSL connection mode.', type: 'select', defaultValue: 'prefer', options: [{ value: 'disable', label: 'disable' }, { value: 'allow', label: 'allow' }, { value: 'prefer', label: 'prefer' }, { value: 'require', label: 'require' }, { value: 'verify-ca', label: 'verify-ca' }, { value: 'verify-full', label: 'verify-full' }] },
  { key: 'pg_tls_cert', label: 'PostgreSQL TLS Cert', inventoryVar: 'gateway_pg_tls_cert', description: 'Path to PostgreSQL client TLS certificate.', type: 'text' },
  { key: 'pg_tls_key', label: 'PostgreSQL TLS Key', inventoryVar: 'gateway_pg_tls_key', description: 'Path to PostgreSQL client TLS private key.', type: 'text' },
  { key: 'redis_disable_tls', label: 'Disable Redis TLS', inventoryVar: 'gateway_redis_disable_tls', description: 'Disable TLS for Gateway Redis connection.', type: 'boolean', defaultValue: false },
  { key: 'redis_host', label: 'Redis Host', inventoryVar: 'gateway_redis_host', description: 'External Redis host for Gateway.', type: 'text' },
  { key: 'redis_password', label: 'Redis Password', inventoryVar: 'gateway_redis_password', description: 'Redis password for Gateway.', type: 'text' },
  { key: 'redis_port', label: 'Redis Port', inventoryVar: 'gateway_redis_port', description: 'Redis port for Gateway.', type: 'number', defaultValue: 6379 },
  { key: 'redis_username', label: 'Redis Username', inventoryVar: 'gateway_redis_username', description: 'Redis username for Gateway.', type: 'text', defaultValue: 'gateway' },
  { key: 'secret_key', label: 'Secret Key', inventoryVar: 'gateway_secret_key', description: 'Secret key for Gateway. Auto-generated if empty.', type: 'text' },
  { key: 'tls_cert', label: 'TLS Certificate', inventoryVar: 'gateway_tls_cert', description: 'Path to custom TLS certificate.', type: 'text' },
  { key: 'tls_key', label: 'TLS Key', inventoryVar: 'gateway_tls_key', description: 'Path to custom TLS private key.', type: 'text' },
  { key: 'tls_remote', label: 'TLS Remote', inventoryVar: 'gateway_tls_remote', description: 'TLS files already on remote host.', type: 'boolean', defaultValue: false },
  { key: 'uwsgi_listen_queue_size', label: 'uWSGI Listen Queue', inventoryVar: 'gateway_uwsgi_listen_queue_size', description: 'uWSGI listen queue size.', type: 'number', defaultValue: 4096 },
  { key: 'uwsgi_processes', label: 'uWSGI Processes', inventoryVar: 'gateway_uwsgi_processes', description: 'uWSGI workers. Blank = auto (2*CPU+1).', type: 'text', placeholder: 'Auto (2*CPU+1)' },
  { key: 'grpc_server_processes', label: 'gRPC Server Processes', inventoryVar: 'gateway_grpc_server_processes', description: 'Number of gRPC auth server processes.', type: 'number', defaultValue: 5 },
  { key: 'grpc_server_max_threads_per_process', label: 'gRPC Max Threads', inventoryVar: 'gateway_grpc_server_max_threads_per_process', description: 'Max threads per gRPC server process.', type: 'number', defaultValue: 10 },
  { key: 'extra_settings', label: 'Extra Settings', inventoryVar: 'gateway_extra_settings', description: 'YAML list of extra Gateway settings.', type: 'textarea' },
];

const HUB_FIELDS: FieldDef[] = [
  { key: 'storage_backend', label: 'Storage Backend', inventoryVar: 'hub_storage_backend', description: 'Storage backend for collections and containers.', type: 'select', defaultValue: 'file', options: [{ value: 'file', label: 'File (local)' }, { value: 'azure', label: 'Azure Blob Storage' }, { value: 's3', label: 'AWS S3' }] },
  { key: 'shared_data_path', label: 'Shared Data Path', inventoryVar: 'hub_shared_data_path', description: 'NFS share (host:dir) for multi-node Hub with file storage. Required for >1 Hub.', type: 'text', placeholder: 'nfs-host:/path/to/share' },
  { key: 'shared_data_mount_opts', label: 'NFS Mount Options', inventoryVar: 'hub_shared_data_mount_opts', description: 'NFS mount options.', type: 'text', defaultValue: 'rw,sync,hard' },
  { key: 'nginx_client_max_body_size', label: 'Nginx Max Body Size', inventoryVar: 'hub_nginx_client_max_body_size', description: 'Maximum HTTP request body size.', type: 'text', defaultValue: '20m' },
  { key: 'nginx_disable_hsts', label: 'Disable HSTS', inventoryVar: 'hub_nginx_disable_hsts', description: 'Disable HSTS header.', type: 'boolean', defaultValue: false },
  { key: 'nginx_disable_https', label: 'Disable HTTPS', inventoryVar: 'hub_nginx_disable_https', description: 'Disable HTTPS.', type: 'boolean', defaultValue: false },
  { key: 'nginx_hsts_max_age', label: 'HSTS Max Age', inventoryVar: 'hub_nginx_hsts_max_age', description: 'HSTS max-age in seconds.', type: 'number', defaultValue: 63072000 },
  { key: 'nginx_http_port', label: 'Nginx HTTP Port', inventoryVar: 'hub_nginx_http_port', description: 'Internal HTTP port.', type: 'number', defaultValue: 8081 },
  { key: 'nginx_https_port', label: 'Nginx HTTPS Port', inventoryVar: 'hub_nginx_https_port', description: 'Internal HTTPS port.', type: 'number', defaultValue: 8444 },
  { key: 'pg_cert_auth', label: 'PostgreSQL Cert Auth', inventoryVar: 'hub_pg_cert_auth', description: 'Use TLS cert auth for PostgreSQL.', type: 'boolean', defaultValue: false },
  { key: 'pg_port', label: 'PostgreSQL Port', inventoryVar: 'hub_pg_port', description: 'PostgreSQL port.', type: 'number', defaultValue: 5432 },
  { key: 'pg_sslmode', label: 'PostgreSQL SSL Mode', inventoryVar: 'hub_pg_sslmode', description: 'SSL mode.', type: 'select', defaultValue: 'prefer', options: [{ value: 'disable', label: 'disable' }, { value: 'allow', label: 'allow' }, { value: 'prefer', label: 'prefer' }, { value: 'require', label: 'require' }, { value: 'verify-ca', label: 'verify-ca' }, { value: 'verify-full', label: 'verify-full' }] },
  { key: 'secret_key', label: 'Secret Key', inventoryVar: 'hub_secret_key', description: 'Secret key. Auto-generated if empty.', type: 'text' },
  { key: 'tls_cert', label: 'TLS Certificate', inventoryVar: 'hub_tls_cert', description: 'Path to custom TLS certificate.', type: 'text' },
  { key: 'tls_key', label: 'TLS Key', inventoryVar: 'hub_tls_key', description: 'Path to custom TLS key.', type: 'text' },
  { key: 'workers', label: 'Workers', inventoryVar: 'hub_workers', description: 'Number of Hub background workers.', type: 'number', defaultValue: 2 },
  { key: 'api_workers', label: 'API Workers', inventoryVar: 'hub_api_workers', description: 'Gunicorn API workers. Blank = auto.', type: 'text', placeholder: 'Auto (2*CPU+1)' },
  { key: 'collection_signing', label: 'Collection Signing', inventoryVar: 'hub_collection_signing', description: 'Enable GPG signing for collections.', type: 'boolean', defaultValue: false },
  { key: 'collection_signing_key', label: 'Collection Signing Key', inventoryVar: 'hub_collection_signing_key', description: 'Path to GPG key for collection signing.', type: 'text' },
  { key: 'container_signing', label: 'Container Signing', inventoryVar: 'hub_container_signing', description: 'Enable GPG signing for containers.', type: 'boolean', defaultValue: false },
  { key: 'container_signing_key', label: 'Container Signing Key', inventoryVar: 'hub_container_signing_key', description: 'Path to GPG key for container signing.', type: 'text' },
  { key: 'postinstall', label: 'Enable Postinstall', inventoryVar: 'hub_postinstall', description: 'Run Hub postinstall automation.', type: 'boolean', defaultValue: false },
  { key: 'postinstall_dir', label: 'Postinstall Directory', inventoryVar: 'hub_postinstall_dir', description: 'Local directory with Hub postinstall config.', type: 'text' },
  { key: 'postinstall_repo_url', label: 'Postinstall Repo URL', inventoryVar: 'hub_postinstall_repo_url', description: 'Git repo URL for Hub postinstall.', type: 'text' },
  { key: 'postinstall_repo_ref', label: 'Postinstall Repo Ref', inventoryVar: 'hub_postinstall_repo_ref', description: 'Git branch/tag.', type: 'text', defaultValue: 'main' },
  { key: 'extra_settings', label: 'Extra Settings', inventoryVar: 'hub_extra_settings', description: 'YAML list of extra Hub settings.', type: 'textarea' },
];

const EDA_FIELDS: FieldDef[] = [
  { key: 'activation_workers', label: 'Activation Workers', inventoryVar: 'eda_activation_workers', description: 'Number of EDA rulebook activation workers.', type: 'number', defaultValue: 2 },
  { key: 'workers', label: 'Workers', inventoryVar: 'eda_workers', description: 'Number of EDA background workers.', type: 'number', defaultValue: 2 },
  { key: 'gunicorn_workers', label: 'Gunicorn Workers', inventoryVar: 'eda_gunicorn_workers', description: 'Gunicorn workers. Blank = auto.', type: 'text', placeholder: 'Auto (2*CPU+1)' },
  { key: 'debug', label: 'Debug Mode', inventoryVar: 'eda_debug', description: 'Enable EDA debug logging.', type: 'boolean', defaultValue: false },
  { key: 'type', label: 'Node Type', inventoryVar: 'eda_type', description: 'EDA node type.', type: 'select', defaultValue: 'hybrid', options: [{ value: 'hybrid', label: 'Hybrid' }, { value: 'api', label: 'API' }, { value: 'worker', label: 'Worker' }] },
  { key: 'nginx_client_max_body_size', label: 'Nginx Max Body Size', inventoryVar: 'eda_nginx_client_max_body_size', description: 'Maximum HTTP request body size.', type: 'text', defaultValue: '1m' },
  { key: 'nginx_disable_hsts', label: 'Disable HSTS', inventoryVar: 'eda_nginx_disable_hsts', description: 'Disable HSTS header.', type: 'boolean', defaultValue: false },
  { key: 'nginx_disable_https', label: 'Disable HTTPS', inventoryVar: 'eda_nginx_disable_https', description: 'Disable HTTPS.', type: 'boolean', defaultValue: false },
  { key: 'nginx_hsts_max_age', label: 'HSTS Max Age', inventoryVar: 'eda_nginx_hsts_max_age', description: 'HSTS max-age in seconds.', type: 'number', defaultValue: 63072000 },
  { key: 'nginx_http_port', label: 'Nginx HTTP Port', inventoryVar: 'eda_nginx_http_port', description: 'Internal HTTP port.', type: 'number', defaultValue: 8082 },
  { key: 'nginx_https_port', label: 'Nginx HTTPS Port', inventoryVar: 'eda_nginx_https_port', description: 'Internal HTTPS port.', type: 'number', defaultValue: 8445 },
  { key: 'pg_cert_auth', label: 'PostgreSQL Cert Auth', inventoryVar: 'eda_pg_cert_auth', description: 'TLS cert auth for PostgreSQL.', type: 'boolean', defaultValue: false },
  { key: 'pg_port', label: 'PostgreSQL Port', inventoryVar: 'eda_pg_port', description: 'PostgreSQL port.', type: 'number', defaultValue: 5432 },
  { key: 'pg_sslmode', label: 'PostgreSQL SSL Mode', inventoryVar: 'eda_pg_sslmode', description: 'SSL mode.', type: 'select', defaultValue: 'prefer', options: [{ value: 'disable', label: 'disable' }, { value: 'allow', label: 'allow' }, { value: 'prefer', label: 'prefer' }, { value: 'require', label: 'require' }, { value: 'verify-ca', label: 'verify-ca' }, { value: 'verify-full', label: 'verify-full' }] },
  { key: 'redis_disable_tls', label: 'Disable Redis TLS', inventoryVar: 'eda_redis_disable_tls', description: 'Disable TLS for Redis.', type: 'boolean', defaultValue: false },
  { key: 'redis_host', label: 'Redis Host', inventoryVar: 'eda_redis_host', description: 'External Redis host for EDA.', type: 'text' },
  { key: 'redis_password', label: 'Redis Password', inventoryVar: 'eda_redis_password', description: 'Redis password for EDA.', type: 'text' },
  { key: 'redis_port', label: 'Redis Port', inventoryVar: 'eda_redis_port', description: 'Redis port for EDA.', type: 'number', defaultValue: 6379 },
  { key: 'redis_username', label: 'Redis Username', inventoryVar: 'eda_redis_username', description: 'Redis username for EDA.', type: 'text', defaultValue: 'eda' },
  { key: 'secret_key', label: 'Secret Key', inventoryVar: 'eda_secret_key', description: 'Secret key. Auto-generated if empty.', type: 'text' },
  { key: 'tls_cert', label: 'TLS Certificate', inventoryVar: 'eda_tls_cert', description: 'Custom TLS certificate path.', type: 'text' },
  { key: 'tls_key', label: 'TLS Key', inventoryVar: 'eda_tls_key', description: 'Custom TLS key path.', type: 'text' },
  { key: 'extra_settings', label: 'Extra Settings', inventoryVar: 'eda_extra_settings', description: 'YAML list of extra EDA settings.', type: 'textarea' },
];

const DATABASE_FIELDS: FieldDef[] = [
  { key: 'postgresql_admin_database', label: 'Admin Database', inventoryVar: 'postgresql_admin_database', description: 'PostgreSQL admin database name.', type: 'text', defaultValue: 'postgres' },
  { key: 'postgresql_max_connections', label: 'Max Connections', inventoryVar: 'postgresql_max_connections', description: 'Maximum number of PostgreSQL connections.', type: 'number', defaultValue: 1024 },
  { key: 'postgresql_shared_buffers', label: 'Shared Buffers', inventoryVar: 'postgresql_shared_buffers', description: 'PostgreSQL shared_buffers setting (e.g., 256MB).', type: 'text', placeholder: 'Auto' },
  { key: 'postgresql_effective_cache_size', label: 'Effective Cache Size', inventoryVar: 'postgresql_effective_cache_size', description: 'PostgreSQL effective_cache_size (e.g., 1GB).', type: 'text', placeholder: 'Auto' },
  { key: 'postgresql_port', label: 'Port', inventoryVar: 'postgresql_port', description: 'PostgreSQL listen port.', type: 'number', defaultValue: 5432 },
  { key: 'postgresql_disable_tls', label: 'Disable TLS', inventoryVar: 'postgresql_disable_tls', description: 'Disable TLS for PostgreSQL connections.', type: 'boolean', defaultValue: false },
  { key: 'postgresql_password_encryption', label: 'Password Encryption', inventoryVar: 'postgresql_password_encryption', description: 'Password encryption method.', type: 'select', defaultValue: 'scram-sha-256', options: [{ value: 'scram-sha-256', label: 'scram-sha-256' }, { value: 'md5', label: 'md5' }] },
  { key: 'postgresql_log_destination', label: 'Log Destination', inventoryVar: 'postgresql_log_destination', description: 'Where PostgreSQL logs are sent.', type: 'text', defaultValue: '/dev/stderr' },
  { key: 'postgresql_keep_databases', label: 'Keep Databases', inventoryVar: 'postgresql_keep_databases', description: 'Keep databases during uninstall.', type: 'boolean', defaultValue: false },
  { key: 'postgresql_tls_cert', label: 'TLS Certificate', inventoryVar: 'postgresql_tls_cert', description: 'PostgreSQL server TLS certificate path.', type: 'text' },
  { key: 'postgresql_tls_key', label: 'TLS Key', inventoryVar: 'postgresql_tls_key', description: 'PostgreSQL server TLS key path.', type: 'text' },
  { key: 'postgresql_extra_settings', label: 'Extra Settings', inventoryVar: 'postgresql_extra_settings', description: 'YAML list of extra PostgreSQL settings.', type: 'textarea' },
];

const RECEPTOR_FIELDS: FieldDef[] = [
  { key: 'port', label: 'Receptor Port', inventoryVar: 'receptor_port', description: 'Port for Receptor mesh communication.', type: 'number', defaultValue: 27199 },
  { key: 'protocol', label: 'Protocol', inventoryVar: 'receptor_protocol', description: 'Receptor transport protocol.', type: 'select', defaultValue: 'tcp', options: [{ value: 'tcp', label: 'TCP' }, { value: 'ws', label: 'WebSocket' }] },
  { key: 'log_level', label: 'Log Level', inventoryVar: 'receptor_log_level', description: 'Receptor logging level.', type: 'select', defaultValue: 'info', options: [{ value: 'debug', label: 'Debug' }, { value: 'info', label: 'Info' }, { value: 'warning', label: 'Warning' }, { value: 'error', label: 'Error' }] },
  { key: 'disable_tls', label: 'Disable TLS', inventoryVar: 'receptor_disable_tls', description: 'Disable TLS for Receptor connections.', type: 'boolean', defaultValue: false },
  { key: 'disable_signing', label: 'Disable Signing', inventoryVar: 'receptor_disable_signing', description: 'Disable Receptor work signing.', type: 'boolean', defaultValue: false },
  { key: 'mintls13', label: 'Minimum TLS 1.3', inventoryVar: 'receptor_mintls13', description: 'Require TLS 1.3 minimum for Receptor.', type: 'boolean', defaultValue: false },
  { key: 'tls_cert', label: 'TLS Certificate', inventoryVar: 'receptor_tls_cert', description: 'Custom Receptor TLS certificate path.', type: 'text' },
  { key: 'tls_key', label: 'TLS Key', inventoryVar: 'receptor_tls_key', description: 'Custom Receptor TLS key path.', type: 'text' },
  { key: 'signing_private_key', label: 'Signing Private Key', inventoryVar: 'receptor_signing_private_key', description: 'Path to Receptor signing private key.', type: 'text' },
  { key: 'signing_public_key', label: 'Signing Public Key', inventoryVar: 'receptor_signing_public_key', description: 'Path to Receptor signing public key.', type: 'text' },
];

const REDIS_FIELDS: FieldDef[] = [
  { key: 'port', label: 'Redis Port', inventoryVar: 'redis_port', description: 'Redis listen port.', type: 'number', defaultValue: 6379 },
  { key: 'disable_tls', label: 'Disable TLS', inventoryVar: 'redis_disable_tls', description: 'Disable TLS for Redis.', type: 'boolean', defaultValue: false },
  { key: 'cluster_ip', label: 'Cluster IP', inventoryVar: 'redis_cluster_ip', description: 'Redis cluster announcement IP address.', type: 'text' },
  { key: 'prefer_ipv6', label: 'Prefer IPv6', inventoryVar: 'redis_prefer_ipv6', description: 'Prefer IPv6 in dual-stack environments.', type: 'boolean', defaultValue: false },
  { key: 'tls_cert', label: 'TLS Certificate', inventoryVar: 'redis_tls_cert', description: 'Custom Redis TLS certificate path.', type: 'text' },
  { key: 'tls_key', label: 'TLS Key', inventoryVar: 'redis_tls_key', description: 'Custom Redis TLS key path.', type: 'text' },
];

const LIGHTSPEED_FIELDS: FieldDef[] = [
  { key: 'enabled', label: 'Enable Lightspeed', inventoryVar: '[ansiblelightspeed]', description: 'Enable Ansible Lightspeed component (Tech Preview).', type: 'boolean', defaultValue: false },
  { key: 'admin_password', label: 'Admin Password', inventoryVar: 'lightspeed_admin_password', description: 'Lightspeed admin password.', type: 'text' },
  { key: 'admin_user', label: 'Admin User', inventoryVar: 'lightspeed_admin_user', description: 'Lightspeed admin username.', type: 'text', defaultValue: 'admin' },
  { key: 'pg_host', label: 'PostgreSQL Host', inventoryVar: 'lightspeed_pg_host', description: 'PostgreSQL host for Lightspeed.', type: 'text' },
  { key: 'pg_password', label: 'PostgreSQL Password', inventoryVar: 'lightspeed_pg_password', description: 'PostgreSQL password for Lightspeed.', type: 'text' },
  { key: 'pg_database', label: 'PostgreSQL Database', inventoryVar: 'lightspeed_pg_database', description: 'PostgreSQL database name.', type: 'text', defaultValue: 'lightspeed' },
  { key: 'pg_username', label: 'PostgreSQL User', inventoryVar: 'lightspeed_pg_username', description: 'PostgreSQL username.', type: 'text', defaultValue: 'lightspeed' },
  { key: 'chatbot_enabled', label: 'Enable Chatbot', inventoryVar: 'lightspeed_chatbot_*', description: 'Enable the Lightspeed chatbot feature.', type: 'boolean', defaultValue: false },
  { key: 'chatbot_default_provider', label: 'Chatbot Provider', inventoryVar: 'lightspeed_chatbot_default_provider', description: 'Chatbot AI model provider.', type: 'select', defaultValue: 'rhoai', options: [{ value: 'rhoai', label: 'Red Hat OpenShift AI' }, { value: 'openai', label: 'OpenAI' }, { value: 'azure', label: 'Azure' }] },
  { key: 'chatbot_model_url', label: 'Chatbot Model URL', inventoryVar: 'lightspeed_chatbot_model_url', description: 'URL to the chatbot model server.', type: 'text' },
  { key: 'chatbot_model_api_key', label: 'Chatbot API Key', inventoryVar: 'lightspeed_chatbot_model_api_key', description: 'API key for the chatbot model.', type: 'text' },
  { key: 'chatbot_model_id', label: 'Chatbot Model ID', inventoryVar: 'lightspeed_chatbot_model_id', description: 'Model identifier for the chatbot.', type: 'text' },
  { key: 'wca_model_api_key', label: 'WCA Model API Key', inventoryVar: 'lightspeed_wca_model_api_key', description: 'IBM watsonx Code Assistant model API key.', type: 'text' },
  { key: 'wca_model_id', label: 'WCA Model ID', inventoryVar: 'lightspeed_wca_model_id', description: 'IBM watsonx Code Assistant model ID.', type: 'text' },
  { key: 'mcp_controller_enabled', label: 'MCP Controller', inventoryVar: 'lightspeed_mcp_controller_enabled', description: 'Enable MCP tools for Controller.', type: 'boolean', defaultValue: false },
  { key: 'mcp_lightspeed_enabled', label: 'MCP Lightspeed', inventoryVar: 'lightspeed_mcp_lightspeed_enabled', description: 'Enable MCP tools for Lightspeed.', type: 'boolean', defaultValue: false },
];

const MONITORING_FIELDS: FieldDef[] = [
  { key: 'setup_monitoring', label: 'Enable PCP Monitoring', inventoryVar: 'setup_monitoring', description: 'Set up Performance Co-Pilot on AAP control plane nodes.', type: 'boolean', defaultValue: false },
  { key: 'pcp_pmcd_port', label: 'PMCD Port', inventoryVar: 'pcp_pmcd_port', description: 'Performance Metrics Collection Daemon port.', type: 'number', defaultValue: 44321 },
  { key: 'pcp_pmproxy_port', label: 'PM Proxy Port', inventoryVar: 'pcp_pmproxy_port', description: 'Performance Metrics Proxy port.', type: 'number', defaultValue: 44322 },
  { key: 'pcp_firewall_zone', label: 'Firewall Zone', inventoryVar: 'pcp_firewall_zone', description: 'Firewall zone for PCP services.', type: 'text', defaultValue: 'public' },
  { key: 'metrics_utility_enabled', label: 'Metrics Utility', inventoryVar: 'metrics_utility_enabled', description: 'Enable metrics utility integration for usage reporting.', type: 'boolean', defaultValue: false },
];

// Fields that only apply to containerized (not OCP)
const CONTAINERIZED_ONLY_FIELD_PREFIXES = ['nginx_', 'uwsgi_'];

function filterFieldsForPlatform(fields: FieldDef[], platform: string): FieldDef[] {
  if (platform !== 'openshift') return fields;
  return fields.filter(f => !CONTAINERIZED_ONLY_FIELD_PREFIXES.some(p => f.key.startsWith(p)));
}

export function AdvancedVariablesStep({ config, updateConfig }: Props) {
  const adv = config.advanced;
  const isOCP = config.platform === 'openshift';

  function updateSection<K extends keyof AdvancedVariablesConfig>(
    section: K,
    key: string,
    value: unknown,
  ) {
    updateConfig({
      advanced: {
        ...adv,
        [section]: { ...adv[section], [key]: value },
      },
    });
  }

  return (
    <div className="aap-step">
      <div className="aap-step__header">
        <h2 className="aap-step__title">Advanced Variables</h2>
        <p className="aap-step__description">
          Optional {isOCP ? 'operator CR' : 'installer'} variables for fine-grained control. Each section links to the official
          AAP 2.6 documentation. Only modify these if you need to override defaults.
        </p>
      </div>

      <div className="aap-alert aap-alert--info" style={{ marginBottom: 24 }}>
        <InfoCircleIcon className="aap-alert__icon" />
        <div className="aap-alert__content">
          <div className="aap-alert__title">All variables are optional</div>
          Variables left at their defaults will not be written to the {isOCP ? 'custom resource' : 'inventory file'}.
          Only modified values are included. Expand a section to view and edit its variables.
        </div>
      </div>

      {/* Common / Registry — containerized only (podman registry settings) */}
      {!isOCP && (
        <Section
          id="common" title="Common / Registry" subtitle="Registry, TLS CA, container, and general installer settings."
          docSection="common" fields={COMMON_FIELDS}
          values={adv.common as unknown as Record<string, unknown>}
          onChange={(k, v) => updateSection('common', k, v)}
        />
      )}

      {/* Host Tuning — containerized only (kernel sysctl on RHEL hosts) */}
      {!isOCP && (
        <Section
          id="host_tuning" title="Host Tuning" subtitle="Kernel sysctl and user-limit tuning for higher concurrency."
          docSection="host_tuning" fields={HOST_TUNING_FIELDS}
          values={adv.host_tuning as unknown as Record<string, unknown>}
          onChange={(k, v) => updateSection('host_tuning', k, v)}
        />
      )}

      <Section
        id="controller" title="Automation Controller" subtitle="Admin, PostgreSQL, TLS, postinstall, and extra settings."
        docSection="controller" fields={filterFieldsForPlatform(CONTROLLER_FIELDS, config.platform)}
        values={adv.controller as unknown as Record<string, unknown>}
        onChange={(k, v) => updateSection('controller', k, v)}
      />

      <Section
        id="gateway" title="Automation Gateway" subtitle="Admin, PostgreSQL, Redis, TLS, gRPC, and extra settings."
        docSection="gateway" fields={filterFieldsForPlatform(GATEWAY_FIELDS, config.platform)}
        values={adv.gateway as unknown as Record<string, unknown>}
        onChange={(k, v) => updateSection('gateway', k, v)}
      />

      <Section
        id="hub" title="Automation Hub" subtitle="Storage, PostgreSQL, TLS, signing, postinstall, and workers."
        docSection="hub" fields={filterFieldsForPlatform(HUB_FIELDS, config.platform)}
        values={adv.hub as unknown as Record<string, unknown>}
        onChange={(k, v) => updateSection('hub', k, v)}
      />

      <Section
        id="eda" title="Event-Driven Ansible" subtitle="Workers, PostgreSQL, Redis, TLS, gunicorn, and debug."
        docSection="eda" fields={filterFieldsForPlatform(EDA_FIELDS, config.platform)}
        values={adv.eda as unknown as Record<string, unknown>}
        onChange={(k, v) => updateSection('eda', k, v)}
      />

      <Section
        id="database" title="PostgreSQL Database" subtitle="Global PostgreSQL settings: connections, TLS, buffers, encryption."
        docSection="database" fields={DATABASE_FIELDS}
        values={adv.database as unknown as Record<string, unknown>}
        onChange={(k, v) => updateSection('database', k, v)}
      />

      {/* Receptor Mesh — containerized only (receptor runs on RHEL hosts, not in OCP pods) */}
      {!isOCP && (
        <Section
          id="receptor" title="Receptor Mesh" subtitle="Port, protocol, TLS, signing, and log level for the automation mesh."
          docSection="receptor" fields={RECEPTOR_FIELDS}
          values={adv.receptor as unknown as Record<string, unknown>}
          onChange={(k, v) => updateSection('receptor', k, v)}
        />
      )}

      {/* Redis — containerized only (OCP operator manages Redis internally) */}
      {!isOCP && (
        <Section
          id="redis" title="Redis" subtitle="Port, TLS, cluster IP, and IPv6 preferences."
          docSection="redis" fields={REDIS_FIELDS}
          values={adv.redis as unknown as Record<string, unknown>}
          onChange={(k, v) => updateSection('redis', k, v)}
        />
      )}

      <Section
        id="lightspeed" title="Ansible Lightspeed (Tech Preview)" subtitle="Lightspeed, chatbot, WCA model, and MCP tools."
        docSection="lightspeed" fields={LIGHTSPEED_FIELDS}
        values={adv.lightspeed as unknown as Record<string, unknown>}
        onChange={(k, v) => updateSection('lightspeed', k, v)}
      />

      {/* Monitoring (PCP) — containerized only (PCP runs on RHEL hosts) */}
      {!isOCP && (
        <Section
          id="monitoring" title="Monitoring (PCP)" subtitle="Performance Co-Pilot and metrics utility."
          docSection="monitoring" fields={MONITORING_FIELDS}
          values={adv.monitoring as unknown as Record<string, unknown>}
          onChange={(k, v) => updateSection('monitoring', k, v)}
        />
      )}
    </div>
  );
}
