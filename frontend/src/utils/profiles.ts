import type { DeploymentConfig } from '../types';
import { getDefaultConfig } from '../types';
import { deepClone, deepEqual, generateId } from './formatters';

export interface ConfigProfile {
  id: string;
  name: string;
  description: string;
  category: 'preset' | 'custom';
  icon: string;
  topology: 'growth' | 'enterprise';
  config: Partial<DeploymentConfig>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ConfigDiff {
  path: string;
  label: string;
  oldValue: any;
  newValue: any;
  category: string;
}

const PROFILE_STORAGE_KEY = 'aap-wizard-profiles';

const FIELD_LABELS: Record<string, [string, string]> = {
  topology: ['Deployment Topology', 'General'],
  installation_type: ['Installation Type', 'General'],
  eula_accepted: ['EULA Accepted', 'General'],
  dry_run: ['Dry Run Mode', 'General'],
  redis_mode: ['Redis Mode', 'General'],
  bundle_dir: ['Bundle Directory', 'General'],
  install_dir: ['Install Directory', 'General'],
  target_host: ['Target Host', 'General'],
  target_user: ['Target User', 'General'],
  target_password: ['Target Password', 'General'],
  target_ssh_port: ['Target SSH Port', 'General'],
  'registry.username': ['Registry Username', 'Subscription'],
  'registry.password': ['Registry Password', 'Subscription'],
  'database.type': ['Database Type', 'Database'],
  'database.host': ['Database Host', 'Database'],
  'database.port': ['Database Port', 'Database'],
  'database.admin_username': ['Database Admin User', 'Database'],
  'database.admin_password': ['Database Admin Password', 'Database'],
  'gateway.hosts': ['Gateway Hosts', 'Components'],
  'gateway.admin_password': ['Gateway Admin Password', 'Credentials'],
  'gateway.pg_host': ['Gateway DB Host', 'Database'],
  'gateway.pg_database': ['Gateway DB Name', 'Database'],
  'gateway.pg_username': ['Gateway DB User', 'Database'],
  'gateway.pg_password': ['Gateway DB Password', 'Database'],
  'controller.hosts': ['Controller Hosts', 'Components'],
  'controller.admin_password': ['Controller Admin Password', 'Credentials'],
  'controller.pg_host': ['Controller DB Host', 'Database'],
  'controller.pg_database': ['Controller DB Name', 'Database'],
  'controller.pg_username': ['Controller DB User', 'Database'],
  'controller.pg_password': ['Controller DB Password', 'Database'],
  'controller.percent_memory_capacity': ['Controller Memory %', 'Components'],
  'hub.hosts': ['Hub Hosts', 'Components'],
  'hub.admin_password': ['Hub Admin Password', 'Credentials'],
  'hub.pg_host': ['Hub DB Host', 'Database'],
  'hub.pg_database': ['Hub DB Name', 'Database'],
  'hub.pg_username': ['Hub DB User', 'Database'],
  'hub.pg_password': ['Hub DB Password', 'Database'],
  'hub.seed_collections': ['Seed Collections', 'Components'],
  'eda.hosts': ['EDA Hosts', 'Components'],
  'eda.admin_password': ['EDA Admin Password', 'Credentials'],
  'eda.pg_host': ['EDA DB Host', 'Database'],
  'eda.pg_database': ['EDA DB Name', 'Database'],
  'eda.pg_username': ['EDA DB User', 'Database'],
  'eda.pg_password': ['EDA DB Password', 'Database'],
  'eda.safe_plugins': ['EDA Safe Plugins', 'Components'],
  'network.http_port': ['HTTP Port', 'Network'],
  'network.https_port': ['HTTPS Port', 'Network'],
  'network.receptor_port': ['Receptor Port', 'Network'],
  'network.tls.custom_ca_cert': ['Custom CA Certificate', 'Network'],
  'network.tls.custom_server_cert': ['Custom Server Certificate', 'Network'],
  'network.tls.custom_server_key': ['Custom Server Key', 'Network'],
  'network.tls.disable_https': ['Disable HTTPS', 'Network'],
  execution_nodes: ['Execution Nodes', 'Components'],
  hosts: ['Host Inventory', 'Hosts'],
};

export const PRESET_PROFILES: ConfigProfile[] = [
  {
    id: 'preset-development',
    name: 'Development',
    description: 'Minimal single-node setup for local development and testing.',
    category: 'preset',
    icon: 'code',
    topology: 'growth',
    config: {
      topology: 'growth',
      installation_type: 'online',
      database: { type: 'managed', host: '', port: 5432, admin_username: 'postgres', admin_password: '' },
      gateway: { hosts: ['localhost'], admin_password: '', pg_host: '', pg_database: 'gateway', pg_username: 'gateway', pg_password: '' },
      controller: { hosts: ['localhost'], admin_password: '', pg_host: '', pg_database: 'controller', pg_username: 'controller', pg_password: '', percent_memory_capacity: 0.5 },
      hub: { hosts: ['localhost'], admin_password: '', pg_host: '', pg_database: 'hub', pg_username: 'hub', pg_password: '', seed_collections: true },
      eda: { hosts: ['localhost'], admin_password: '', pg_host: '', pg_database: 'eda', pg_username: 'eda', pg_password: '', safe_plugins: ['ansible.eda.webhook'] },
      redis_mode: 'standalone',
      network: { http_port: 8080, https_port: 8443, receptor_port: 27199, tls: { custom_ca_cert: '', custom_server_cert: '', custom_server_key: '', disable_https: true } },
    },
    tags: ['dev', 'minimal', 'single-node'],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'preset-qa-staging',
    name: 'QA / Staging',
    description: 'Growth topology for QA and staging environments with online connectivity.',
    category: 'preset',
    icon: 'flask',
    topology: 'growth',
    config: {
      topology: 'growth',
      installation_type: 'online',
      database: { type: 'managed', host: '', port: 5432, admin_username: 'postgres', admin_password: '' },
      gateway: { hosts: ['aap-staging.example.com'], admin_password: '', pg_host: '', pg_database: 'gateway', pg_username: 'gateway', pg_password: '' },
      controller: { hosts: ['aap-staging.example.com'], admin_password: '', pg_host: '', pg_database: 'controller', pg_username: 'controller', pg_password: '', percent_memory_capacity: 0.5 },
      hub: { hosts: ['aap-staging.example.com'], admin_password: '', pg_host: '', pg_database: 'hub', pg_username: 'hub', pg_password: '', seed_collections: true },
      eda: { hosts: ['aap-staging.example.com'], admin_password: '', pg_host: '', pg_database: 'eda', pg_username: 'eda', pg_password: '', safe_plugins: ['ansible.eda.webhook', 'ansible.eda.alertmanager'] },
      redis_mode: 'standalone',
      network: { http_port: 80, https_port: 443, receptor_port: 27199, tls: { custom_ca_cert: '', custom_server_cert: '', custom_server_key: '', disable_https: false } },
    },
    tags: ['qa', 'staging', 'online'],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'preset-prod-single',
    name: 'Production Single-Node',
    description: 'Production-grade single-node deployment with full security and custom TLS.',
    category: 'preset',
    icon: 'server',
    topology: 'growth',
    config: {
      topology: 'growth',
      installation_type: 'online',
      database: { type: 'managed', host: '', port: 5432, admin_username: 'postgres', admin_password: '' },
      gateway: { hosts: ['aap.example.com'], admin_password: '', pg_host: '', pg_database: 'gateway', pg_username: 'gateway', pg_password: '' },
      controller: { hosts: ['aap.example.com'], admin_password: '', pg_host: '', pg_database: 'controller', pg_username: 'controller', pg_password: '', percent_memory_capacity: 0.75 },
      hub: { hosts: ['aap.example.com'], admin_password: '', pg_host: '', pg_database: 'hub', pg_username: 'hub', pg_password: '', seed_collections: false },
      eda: { hosts: ['aap.example.com'], admin_password: '', pg_host: '', pg_database: 'eda', pg_username: 'eda', pg_password: '', safe_plugins: ['ansible.eda.webhook', 'ansible.eda.alertmanager'] },
      redis_mode: 'standalone',
      network: { http_port: 80, https_port: 443, receptor_port: 27199, tls: { custom_ca_cert: '', custom_server_cert: '', custom_server_key: '', disable_https: false } },
    },
    tags: ['production', 'single-node', 'tls'],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'preset-prod-ha',
    name: 'Production HA',
    description: 'Enterprise high-availability deployment with multi-node topology, external database, and Redis cluster.',
    category: 'preset',
    icon: 'cluster',
    topology: 'enterprise',
    config: {
      topology: 'enterprise',
      installation_type: 'online',
      database: { type: 'external', host: 'db.example.com', port: 5432, admin_username: 'postgres', admin_password: '' },
      gateway: { hosts: ['gw-1.example.com', 'gw-2.example.com'], admin_password: '', pg_host: 'db.example.com', pg_database: 'gateway', pg_username: 'gateway', pg_password: '' },
      controller: { hosts: ['ctrl-1.example.com', 'ctrl-2.example.com'], admin_password: '', pg_host: 'db.example.com', pg_database: 'controller', pg_username: 'controller', pg_password: '', percent_memory_capacity: 0.75 },
      hub: { hosts: ['hub-1.example.com', 'hub-2.example.com'], admin_password: '', pg_host: 'db.example.com', pg_database: 'hub', pg_username: 'hub', pg_password: '', seed_collections: false },
      eda: { hosts: ['eda-1.example.com', 'eda-2.example.com'], admin_password: '', pg_host: 'db.example.com', pg_database: 'eda', pg_username: 'eda', pg_password: '', safe_plugins: ['ansible.eda.webhook', 'ansible.eda.alertmanager'] },
      redis_mode: 'cluster',
      execution_nodes: [
        { host: 'exec-1.example.com', receptor_type: 'execution' },
        { host: 'exec-2.example.com', receptor_type: 'execution' },
        { host: 'hop-1.example.com', receptor_type: 'hop' },
      ],
      network: { http_port: 80, https_port: 443, receptor_port: 27199, tls: { custom_ca_cert: '', custom_server_cert: '', custom_server_key: '', disable_https: false } },
    },
    tags: ['production', 'ha', 'enterprise', 'external-db', 'redis-cluster'],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'preset-airgapped',
    name: 'Air-Gapped',
    description: 'Disconnected single-node deployment for air-gapped environments with installer bundle.',
    category: 'preset',
    icon: 'lock',
    topology: 'growth',
    config: {
      topology: 'growth',
      installation_type: 'disconnected',
      bundle_dir: '/opt/aap-bundle',
      database: { type: 'managed', host: '', port: 5432, admin_username: 'postgres', admin_password: '' },
      gateway: { hosts: ['aap.internal.local'], admin_password: '', pg_host: '', pg_database: 'gateway', pg_username: 'gateway', pg_password: '' },
      controller: { hosts: ['aap.internal.local'], admin_password: '', pg_host: '', pg_database: 'controller', pg_username: 'controller', pg_password: '', percent_memory_capacity: 0.5 },
      hub: { hosts: ['aap.internal.local'], admin_password: '', pg_host: '', pg_database: 'hub', pg_username: 'hub', pg_password: '', seed_collections: false },
      eda: { hosts: ['aap.internal.local'], admin_password: '', pg_host: '', pg_database: 'eda', pg_username: 'eda', pg_password: '', safe_plugins: ['ansible.eda.webhook'] },
      redis_mode: 'standalone',
      network: { http_port: 80, https_port: 443, receptor_port: 27199, tls: { custom_ca_cert: '', custom_server_cert: '', custom_server_key: '', disable_https: false } },
    },
    tags: ['air-gapped', 'disconnected', 'bundle'],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: 'preset-airgapped-enterprise',
    name: 'Air-Gapped Enterprise',
    description: 'Full enterprise HA deployment for disconnected environments with external database and multi-node.',
    category: 'preset',
    icon: 'shield-alt',
    topology: 'enterprise',
    config: {
      topology: 'enterprise',
      installation_type: 'disconnected',
      bundle_dir: '/opt/aap-bundle',
      database: { type: 'external', host: 'db.internal.local', port: 5432, admin_username: 'postgres', admin_password: '' },
      gateway: { hosts: ['gw-1.internal.local', 'gw-2.internal.local'], admin_password: '', pg_host: 'db.internal.local', pg_database: 'gateway', pg_username: 'gateway', pg_password: '' },
      controller: { hosts: ['ctrl-1.internal.local', 'ctrl-2.internal.local'], admin_password: '', pg_host: 'db.internal.local', pg_database: 'controller', pg_username: 'controller', pg_password: '', percent_memory_capacity: 0.75 },
      hub: { hosts: ['hub-1.internal.local', 'hub-2.internal.local'], admin_password: '', pg_host: 'db.internal.local', pg_database: 'hub', pg_username: 'hub', pg_password: '', seed_collections: false },
      eda: { hosts: ['eda-1.internal.local', 'eda-2.internal.local'], admin_password: '', pg_host: 'db.internal.local', pg_database: 'eda', pg_username: 'eda', pg_password: '', safe_plugins: ['ansible.eda.webhook', 'ansible.eda.alertmanager'] },
      redis_mode: 'cluster',
      execution_nodes: [
        { host: 'exec-1.internal.local', receptor_type: 'execution' },
        { host: 'exec-2.internal.local', receptor_type: 'execution' },
      ],
      network: { http_port: 80, https_port: 443, receptor_port: 27199, tls: { custom_ca_cert: '', custom_server_cert: '', custom_server_key: '', disable_https: false } },
    },
    tags: ['air-gapped', 'disconnected', 'enterprise', 'ha', 'external-db'],
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
];

function loadCustomProfiles(): ConfigProfile[] {
  try {
    const stored = localStorage.getItem(PROFILE_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveCustomProfiles(profiles: ConfigProfile[]): void {
  localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
}

export function getProfiles(): ConfigProfile[] {
  return [...PRESET_PROFILES, ...loadCustomProfiles()];
}

export function getProfile(id: string): ConfigProfile | undefined {
  return getProfiles().find((p) => p.id === id);
}

export function saveCustomProfile(
  name: string,
  description: string,
  config: DeploymentConfig,
): ConfigProfile {
  const now = new Date().toISOString();
  const profile: ConfigProfile = {
    id: generateId('profile'),
    name,
    description,
    category: 'custom',
    icon: 'user',
    topology: config.topology,
    config: deepClone(config),
    tags: ['custom'],
    createdAt: now,
    updatedAt: now,
  };

  const custom = loadCustomProfiles();
  custom.push(profile);
  saveCustomProfiles(custom);
  return profile;
}

export function deleteCustomProfile(id: string): void {
  const custom = loadCustomProfiles().filter((p) => p.id !== id);
  saveCustomProfiles(custom);
}

export function updateCustomProfile(id: string, updates: Partial<ConfigProfile>): void {
  const custom = loadCustomProfiles();
  const idx = custom.findIndex((p) => p.id === id);
  if (idx === -1) return;

  custom[idx] = {
    ...custom[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  saveCustomProfiles(custom);
}

export function exportProfile(profile: ConfigProfile): string {
  return JSON.stringify(profile, null, 2);
}

export function importProfile(json: string): ConfigProfile {
  const parsed = JSON.parse(json);
  if (!parsed.name || !parsed.config) {
    throw new Error('Invalid profile format: missing name or config');
  }

  const now = new Date().toISOString();
  const profile: ConfigProfile = {
    id: generateId('imported'),
    name: parsed.name,
    description: parsed.description || '',
    category: 'custom',
    icon: parsed.icon || 'upload',
    topology: parsed.topology || parsed.config.topology || 'growth',
    config: parsed.config,
    tags: parsed.tags || ['imported'],
    createdAt: now,
    updatedAt: now,
  };

  const custom = loadCustomProfiles();
  custom.push(profile);
  saveCustomProfiles(custom);
  return profile;
}

export function applyProfile(
  profile: ConfigProfile,
  currentConfig: DeploymentConfig,
): DeploymentConfig {
  const base = deepClone(currentConfig);
  const partial = profile.config;

  function merge(target: any, source: any): any {
    for (const key of Object.keys(source)) {
      if (
        source[key] !== null &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null
      ) {
        merge(target[key], source[key]);
      } else {
        target[key] = deepClone(source[key]);
      }
    }
    return target;
  }

  return merge(base, partial);
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

function formatValue(val: any): string {
  if (val === null || val === undefined) return '(empty)';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';
  if (Array.isArray(val)) return val.length === 0 ? '(none)' : val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

export function diffConfigs(a: DeploymentConfig, b: DeploymentConfig): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];

  function walk(objA: any, objB: any, prefix: string): void {
    const allKeys = new Set([...Object.keys(objA || {}), ...Object.keys(objB || {})]);

    for (const key of allKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      const valA = objA?.[key];
      const valB = objB?.[key];

      if (
        valA !== null &&
        valB !== null &&
        typeof valA === 'object' &&
        typeof valB === 'object' &&
        !Array.isArray(valA) &&
        !Array.isArray(valB)
      ) {
        walk(valA, valB, path);
        continue;
      }

      if (!deepEqual(valA, valB)) {
        const meta = FIELD_LABELS[path];
        diffs.push({
          path,
          label: meta ? meta[0] : path,
          oldValue: valA,
          newValue: valB,
          category: meta ? meta[1] : 'Other',
        });
      }
    }
  }

  walk(a, b, '');
  return diffs;
}

function indent(level: number): string {
  return '  '.repeat(level);
}

function toYAMLValue(val: any, level: number): string {
  if (val === null || val === undefined) return '""';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    if (val === '') return '""';
    if (val.includes('\n')) {
      const lines = val.split('\n');
      return '|\n' + lines.map((l) => indent(level + 1) + l).join('\n');
    }
    if (/[:#{}[\],&*?|>!%@`]/.test(val) || val.startsWith(' ') || val.endsWith(' ')) {
      return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return val;
  }
  return String(val);
}

function objectToYAML(obj: any, level: number): string {
  const lines: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${indent(level)}${key}: ""`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${indent(level)}${key}: []`);
      } else if (typeof value[0] === 'object') {
        lines.push(`${indent(level)}${key}:`);
        for (const item of value) {
          const entries = Object.entries(item);
          if (entries.length > 0) {
            lines.push(`${indent(level + 1)}- ${entries[0][0]}: ${toYAMLValue(entries[0][1], level + 2)}`);
            for (let i = 1; i < entries.length; i++) {
              lines.push(`${indent(level + 2)}${entries[i][0]}: ${toYAMLValue(entries[i][1], level + 2)}`);
            }
          }
        }
      } else {
        lines.push(`${indent(level)}${key}:`);
        for (const item of value) {
          lines.push(`${indent(level + 1)}- ${toYAMLValue(item, level + 1)}`);
        }
      }
    } else if (typeof value === 'object') {
      lines.push(`${indent(level)}${key}:`);
      lines.push(objectToYAML(value, level + 1));
    } else {
      lines.push(`${indent(level)}${key}: ${toYAMLValue(value, level)}`);
    }
  }

  return lines.join('\n');
}

export function configToYAML(config: DeploymentConfig): string {
  return '---\n' + objectToYAML(config, 0) + '\n';
}

function parseYAMLValue(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === '""' || trimmed === "''") return '';
  if (trimmed === '[]') return [];
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function yamlToConfig(yaml: string): DeploymentConfig {
  const base = getDefaultConfig();
  const lines = yaml.split('\n');
  const stack: { obj: any; indent: number }[] = [{ obj: base, indent: -1 }];
  let currentArray: any[] | null = null;
  let currentArrayKey = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim() === '---' || line.trim().startsWith('#')) continue;

    const stripped = line.replace(/\t/g, '  ');
    const indentLevel = stripped.search(/\S/);

    if (stripped.trim().startsWith('- ')) {
      const itemStr = stripped.trim().slice(2).trim();
      if (currentArray) {
        if (itemStr.includes(': ')) {
          const obj: any = {};
          const [firstKey, ...rest] = itemStr.split(': ');
          obj[firstKey.trim()] = parseYAMLValue(rest.join(': '));

          for (let j = i + 1; j < lines.length; j++) {
            const nextLine = lines[j].replace(/\t/g, '  ');
            const nextIndent = nextLine.search(/\S/);
            if (nextLine.trim() === '' || nextIndent <= indentLevel) break;
            if (nextLine.trim().startsWith('- ')) break;
            const [nk, ...nv] = nextLine.trim().split(': ');
            obj[nk.trim()] = parseYAMLValue(nv.join(': '));
            i = j;
          }
          currentArray.push(obj);
        } else {
          currentArray.push(parseYAMLValue(itemStr));
        }
      }
      continue;
    }

    currentArray = null;

    while (stack.length > 1 && stack[stack.length - 1].indent >= indentLevel) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    const colonIdx = stripped.indexOf(':');
    if (colonIdx === -1) continue;

    const key = stripped.slice(0, colonIdx).trim();
    const valueStr = stripped.slice(colonIdx + 1).trim();

    if (valueStr === '' || valueStr === '|') {
      if (parent[key] !== undefined && typeof parent[key] === 'object' && !Array.isArray(parent[key])) {
        stack.push({ obj: parent[key], indent: indentLevel });
      } else if (Array.isArray(parent[key])) {
        currentArray = parent[key];
        currentArrayKey = key;
        parent[key] = [];
        currentArray = parent[key];
      } else {
        parent[key] = {};
        stack.push({ obj: parent[key], indent: indentLevel });
      }
    } else if (valueStr === '[]') {
      parent[key] = [];
    } else {
      parent[key] = parseYAMLValue(valueStr);
    }
  }

  return base;
}
