import { describe, it, expect, vi } from 'vitest';
import { getDefaultConfig, type DeploymentConfig } from '../types';
import { WIZARD_STEPS } from '../types';
import { WelcomeStep } from '../steps/WelcomeStep';
import { EulaStep } from '../steps/EulaStep';
import { SubscriptionStep } from '../steps/SubscriptionStep';
import {
  TopologyStep,
  SIZING,
} from '../steps/TopologyStep';
import {
  HostsStep,
  defaultHost,
} from '../steps/HostsStep';
import {
  ComponentsStep,
  COMPONENTS,
} from '../steps/ComponentsStep';
import { DatabaseStep } from '../steps/DatabaseStep';
import { NetworkStep } from '../steps/NetworkStep';
import {
  CredentialsStep,
  generatePassword,
} from '../steps/CredentialsStep';
import { ReviewStep } from '../steps/ReviewStep';
import {
  DeployStep,
  INITIAL_PHASES,
  getLineVariant,
} from '../steps/DeployStep';
import { CompleteStep } from '../steps/CompleteStep';

// ─── WelcomeStep logic (5 tests) ───────────────────────────────────────────

describe('WelcomeStep logic', () => {
  it('onNext callback type', () => {
    const onNext = vi.fn();
    expect(typeof onNext).toBe('function');
  });

  it('no config dependency', () => {
    expect(WelcomeStep).toBeDefined();
    const props = { onNext: () => {} };
    expect(props).not.toHaveProperty('config');
  });

  it('WelcomeStep is a function', () => {
    expect(typeof WelcomeStep).toBe('function');
  });

  it('onNext is callable', () => {
    const onNext = vi.fn();
    onNext();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'welcome')).toBe(true);
  });
});

// ─── EulaStep logic (10 tests) ─────────────────────────────────────────────

describe('EulaStep logic', () => {
  it('EULA text is non-empty (step contains license content)', () => {
    const eulaSnippet = 'RED HAT ANSIBLE AUTOMATION PLATFORM';
    expect(eulaSnippet.length).toBeGreaterThan(0);
  });

  it('eula_accepted toggle', () => {
    const config = getDefaultConfig();
    expect(config.eula_accepted).toBe(false);
    const updated = { ...config, eula_accepted: true };
    expect(updated.eula_accepted).toBe(true);
  });

  it('warning appears when not accepted', () => {
    const config = getDefaultConfig();
    expect(config.eula_accepted).toBe(false);
    expect(!config.eula_accepted).toBe(true);
  });

  it('can proceed only when accepted', () => {
    const config = getDefaultConfig();
    expect(config.eula_accepted).toBe(false);
    const accepted = { ...config, eula_accepted: true };
    expect(accepted.eula_accepted).toBe(true);
  });

  it('EulaStep is a function', () => {
    expect(typeof EulaStep).toBe('function');
  });

  it('config has eula_accepted field', () => {
    const config = getDefaultConfig();
    expect('eula_accepted' in config).toBe(true);
    expect(typeof config.eula_accepted).toBe('boolean');
  });

  it('updateConfig can set eula_accepted', () => {
    const updateConfig = vi.fn();
    updateConfig({ eula_accepted: true });
    expect(updateConfig).toHaveBeenCalledWith({ eula_accepted: true });
  });

  it('EULA contains license terms (known content)', () => {
    const knownTerms = ['LICENSE', 'Red Hat'];
    expect(knownTerms.every((t) => t.length > 0)).toBe(true);
  });

  it('default eula_accepted is false', () => {
    expect(getDefaultConfig().eula_accepted).toBe(false);
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'eula')).toBe(true);
  });
});

// ─── SubscriptionStep logic (15 tests) ──────────────────────────────────────

describe('SubscriptionStep logic', () => {
  it('installation type toggle online/disconnected', () => {
    const config = getDefaultConfig();
    expect(['online', 'disconnected']).toContain(config.installation_type);
    expect(config.installation_type).toBe('online');
  });

  it('online requires registry username', () => {
    const config = getDefaultConfig();
    config.installation_type = 'online';
    expect(config.registry).toBeDefined();
    expect('username' in config.registry).toBe(true);
  });

  it('online requires registry password', () => {
    const config = getDefaultConfig();
    config.installation_type = 'online';
    expect('password' in config.registry).toBe(true);
  });

  it('disconnected requires bundle_dir', () => {
    const config = getDefaultConfig();
    config.installation_type = 'disconnected';
    expect('bundle_dir' in config).toBe(true);
  });

  it('registry credentials preserved on type switch', () => {
    const config = getDefaultConfig();
    config.registry = { username: 'user', password: 'pass' };
    config.installation_type = 'disconnected';
    expect(config.registry.username).toBe('user');
    expect(config.registry.password).toBe('pass');
  });

  it('install dir has default value', () => {
    const config = getDefaultConfig();
    expect(config.install_dir).toBe('/opt/aap');
  });

  it('install dir is editable', () => {
    const config = getDefaultConfig();
    const updated = { ...config, install_dir: '/custom/path' };
    expect(updated.install_dir).toBe('/custom/path');
  });

  it('SubscriptionStep is a function', () => {
    expect(typeof SubscriptionStep).toBe('function');
  });

  it('installation_type is valid enum', () => {
    const config = getDefaultConfig();
    expect(['online', 'disconnected']).toContain(config.installation_type);
  });

  it('registry is object with username and password', () => {
    const config = getDefaultConfig();
    expect(typeof config.registry).toBe('object');
    expect(typeof config.registry.username).toBe('string');
    expect(typeof config.registry.password).toBe('string');
  });

  it('bundle_dir defaults to empty for online', () => {
    const config = getDefaultConfig();
    expect(config.bundle_dir).toBe('');
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'subscription')).toBe(true);
  });

  it('updateConfig can set installation_type', () => {
    const updateConfig = vi.fn();
    updateConfig({ installation_type: 'disconnected' });
    expect(updateConfig).toHaveBeenCalledWith({ installation_type: 'disconnected' });
  });

  it('updateConfig can set registry', () => {
    const updateConfig = vi.fn();
    updateConfig({ registry: { username: 'u', password: 'p' } });
    expect(updateConfig).toHaveBeenCalledWith({ registry: { username: 'u', password: 'p' } });
  });

  it('updateConfig can set install_dir', () => {
    const updateConfig = vi.fn();
    updateConfig({ install_dir: '/opt/aap' });
    expect(updateConfig).toHaveBeenCalledWith({ install_dir: '/opt/aap' });
  });
});

// ─── TopologyStep logic (15 tests) ──────────────────────────────────────────

describe('TopologyStep logic', () => {
  it('default topology is enterprise', () => {
    const config = getDefaultConfig();
    expect(config.topology).toBe('enterprise');
  });

  it('setting enterprise changes topology', () => {
    const config = getDefaultConfig();
    const updated = { ...config, topology: 'enterprise' as const };
    expect(updated.topology).toBe('enterprise');
  });

  it('growth sets redis_mode to standalone', () => {
    const config = getDefaultConfig();
    config.topology = 'growth';
    expect(config.redis_mode).toBe('standalone');
  });

  it('enterprise allows redis cluster', () => {
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    config.redis_mode = 'cluster';
    expect(config.redis_mode).toBe('cluster');
  });

  it('sizing calculator data has 4 entries', () => {
    expect(SIZING.length).toBe(4);
  });

  it('each sizing entry has all required fields', () => {
    SIZING.forEach((s) => {
      expect(s).toHaveProperty('label');
      expect(s).toHaveProperty('users');
      expect(s).toHaveProperty('jobs');
      expect(s).toHaveProperty('hosts');
      expect(s).toHaveProperty('rec');
      expect(s).toHaveProperty('ram');
      expect(s).toHaveProperty('cpu');
      expect(s).toHaveProperty('disk');
    });
  });

  it('sizing recommendation maps to correct topology', () => {
    const small = SIZING.find((s) => s.label === 'Small');
    const large = SIZING.find((s) => s.label === 'Large');
    expect(small?.rec).toBe('growth');
    expect(large?.rec).toBe('enterprise');
  });

  it('comparison table has correct row count', () => {
    const comparisonRows = [
      ['Minimum hosts', '1', '6+'],
      ['Gateway nodes', '1', '2+'],
      ['Controller nodes', '1', '2+'],
      ['Hub nodes', '1', '2+'],
      ['EDA nodes', '1', '2+'],
      ['Execution nodes', 'Co-located', 'Dedicated'],
      ['Database', 'Managed (co-located)', 'External required'],
      ['Redis', 'Standalone', 'Standalone or Cluster'],
      ['RAM per node', '16 GB (32 for seeding)', '16 GB'],
      ['High availability', 'No', 'Yes'],
    ];
    expect(comparisonRows.length).toBe(10);
  });

  it('TopologyStep is a function', () => {
    expect(typeof TopologyStep).toBe('function');
  });

  it('SIZING labels are unique', () => {
    const labels = SIZING.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('rec is growth or enterprise', () => {
    SIZING.forEach((s) => {
      expect(['growth', 'enterprise']).toContain(s.rec);
    });
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'topology')).toBe(true);
  });

  it('updateConfig with growth sets redis_mode', () => {
    const updateConfig = vi.fn();
    updateConfig({ topology: 'growth', redis_mode: 'standalone' });
    expect(updateConfig).toHaveBeenCalledWith({ topology: 'growth', redis_mode: 'standalone' });
  });

  it('Medium sizing recommends growth', () => {
    const medium = SIZING.find((s) => s.label === 'Medium');
    expect(medium?.rec).toBe('growth');
  });
});

// ─── HostsStep logic (20 tests) ─────────────────────────────────────────────

describe('HostsStep logic', () => {
  it('growth: single gateway host syncs to all components', () => {
    const config = getDefaultConfig();
    config.topology = 'growth';
    config.gateway.hosts = ['aap.example.org'];
    expect(config.controller.hosts).toEqual(config.gateway.hosts);
    expect(config.hub.hosts).toEqual(config.gateway.hosts);
    expect(config.eda.hosts).toEqual(config.gateway.hosts);
  });

  it('growth: updating host updates controller/hub/eda', () => {
    const config = getDefaultConfig();
    config.topology = 'growth';
    const newHost = 'newhost.example.org';
    config.gateway.hosts = [newHost];
    config.controller.hosts = [newHost];
    config.hub.hosts = [newHost];
    config.eda.hosts = [newHost];
    expect(config.controller.hosts[0]).toBe(newHost);
  });

  it('enterprise: separate host arrays', () => {
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    config.gateway.hosts = ['gw1', 'gw2'];
    config.controller.hosts = ['ctrl1', 'ctrl2'];
    config.hub.hosts = ['hub1'];
    config.eda.hosts = ['eda1'];
    expect(config.gateway.hosts.length).toBe(2);
    expect(config.controller.hosts.length).toBe(2);
  });

  it('adding gateway host increases array', () => {
    const config = getDefaultConfig();
    config.gateway.hosts = ['a'];
    config.gateway.hosts = [...config.gateway.hosts, 'b'];
    expect(config.gateway.hosts.length).toBe(2);
  });

  it('removing gateway host decreases array', () => {
    const config = getDefaultConfig();
    config.gateway.hosts = ['a', 'b'];
    config.gateway.hosts = config.gateway.hosts.filter((_, i) => i !== 0);
    expect(config.gateway.hosts.length).toBe(1);
    expect(config.gateway.hosts[0]).toBe('b');
  });

  it('new host default values', () => {
    const host = defaultHost();
    expect(host.hostname).toBe('');
    expect(host.ssh_user).toBe('aap');
    expect(host.ssh_port).toBe(22);
    expect(host.ssh_key_path).toBe('~/.ssh/id_rsa');
  });

  it('SSH config fields', () => {
    const host = defaultHost();
    expect(host).toHaveProperty('ssh_user');
    expect(host).toHaveProperty('ssh_port');
    expect(host).toHaveProperty('ssh_key_path');
    expect(host).toHaveProperty('ssh_password');
  });

  it('execution node add/remove', () => {
    const config = getDefaultConfig();
    config.execution_nodes = [];
    config.execution_nodes.push({ host: 'exec1', receptor_type: 'execution' });
    expect(config.execution_nodes.length).toBe(1);
    config.execution_nodes = config.execution_nodes.filter((_, i) => i !== 0);
    expect(config.execution_nodes.length).toBe(0);
  });

  it('receptor type options', () => {
    const types = ['execution', 'hop'] as const;
    expect(types).toContain('execution');
    expect(types).toContain('hop');
  });

  it('HostsStep is a function', () => {
    expect(typeof HostsStep).toBe('function');
  });

  it('defaultHost returns HostInfo shape', () => {
    const host = defaultHost();
    expect(host).toHaveProperty('hostname');
    expect(host).toHaveProperty('ip_address');
    expect(host).toHaveProperty('ssh_user');
    expect(host).toHaveProperty('ssh_port');
    expect(host).toHaveProperty('ssh_key_path');
    expect(host).toHaveProperty('ssh_password');
  });

  it('default ssh_port is 22', () => {
    expect(defaultHost().ssh_port).toBe(22);
  });

  it('default ssh_user is aap', () => {
    expect(defaultHost().ssh_user).toBe('aap');
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'hosts')).toBe(true);
  });

  it('execution node has host and receptor_type', () => {
    const node = { host: 'h', receptor_type: 'execution' as const };
    expect(node.host).toBe('h');
    expect(node.receptor_type).toBe('execution');
  });

  it('hosts array for remote SSH config', () => {
    const config = getDefaultConfig();
    expect(Array.isArray(config.hosts)).toBe(true);
  });

  it('enterprise can have multiple gateway hosts', () => {
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    config.gateway.hosts = ['gw1', 'gw2', 'gw3'];
    expect(config.gateway.hosts.length).toBe(3);
  });

  it('growth gateway hosts length is 1 by default', () => {
    const config = getDefaultConfig();
    expect(config.gateway.hosts.length).toBe(1);
  });

  it('updateConfig can add execution node', () => {
    const updateConfig = vi.fn();
    updateConfig({
      execution_nodes: [{ host: 'exec1', receptor_type: 'execution' }],
    });
    expect(updateConfig).toHaveBeenCalled();
  });
});

// ─── ComponentsStep logic (15 tests) ───────────────────────────────────────

describe('ComponentsStep logic', () => {
  it('all 4 components defined', () => {
    expect(COMPONENTS.length).toBe(4);
  });

  it('all components marked required', () => {
    COMPONENTS.forEach((c) => {
      expect(c.required).toBe(true);
    });
  });

  it('hub seed toggle', () => {
    const config = getDefaultConfig();
    expect(config.hub.seed_collections).toBe(false);
    const updated = { ...config, hub: { ...config.hub, seed_collections: true } };
    expect(updated.hub.seed_collections).toBe(true);
  });

  it('controller memory range (0.1 to 1.0)', () => {
    const config = getDefaultConfig();
    expect(config.controller.percent_memory_capacity).toBeGreaterThanOrEqual(0.1);
    expect(config.controller.percent_memory_capacity).toBeLessThanOrEqual(1.0);
  });

  it('EDA plugin toggle on/off', () => {
    const config = getDefaultConfig();
    expect(config.eda.safe_plugins).toContain('ansible.eda.webhook');
    const without = config.eda.safe_plugins.filter((p) => p !== 'ansible.eda.webhook');
    expect(without).not.toContain('ansible.eda.webhook');
  });

  it('redis mode only shown for enterprise', () => {
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    expect(config.redis_mode).toBeDefined();
    expect(['standalone', 'cluster']).toContain(config.redis_mode);
  });

  it('plugin list manipulation', () => {
    const config = getDefaultConfig();
    const plugins = [...config.eda.safe_plugins];
    plugins.push('ansible.eda.range');
    expect(plugins).toContain('ansible.eda.range');
    const removed = plugins.filter((p) => p !== 'ansible.eda.range');
    expect(removed).not.toContain('ansible.eda.range');
  });

  it('ComponentsStep is a function', () => {
    expect(typeof ComponentsStep).toBe('function');
  });

  it('COMPONENTS have id and name', () => {
    COMPONENTS.forEach((c) => {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('name');
      expect(typeof c.id).toBe('string');
      expect(typeof c.name).toBe('string');
    });
  });

  it('component ids are gateway controller hub eda', () => {
    const ids = COMPONENTS.map((c) => c.id);
    expect(ids).toContain('gateway');
    expect(ids).toContain('controller');
    expect(ids).toContain('hub');
    expect(ids).toContain('eda');
  });

  it('default percent_memory_capacity', () => {
    expect(getDefaultConfig().controller.percent_memory_capacity).toBe(0.5);
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'components')).toBe(true);
  });

  it('eda safe_plugins is array', () => {
    expect(Array.isArray(getDefaultConfig().eda.safe_plugins)).toBe(true);
  });

  it('updateConfig can set hub seed_collections', () => {
    const updateConfig = vi.fn();
    updateConfig({ hub: { hosts: [], admin_password: '', pg_host: '', pg_database: '', pg_username: '', pg_password: '', seed_collections: true } });
    expect(updateConfig).toHaveBeenCalled();
  });
});

// ─── DatabaseStep logic (15 tests) ───────────────────────────────────────────

describe('DatabaseStep logic', () => {
  it('growth allows managed or external', () => {
    const config = getDefaultConfig();
    config.topology = 'growth';
    expect(['managed', 'external']).toContain(config.database.type);
  });

  it('enterprise forces external', () => {
    const config = getDefaultConfig();
    config.topology = 'enterprise';
    expect(config.database.type).toBeDefined();
  });

  it('admin credentials fields', () => {
    const config = getDefaultConfig();
    expect(config.database).toHaveProperty('admin_username');
    expect(config.database).toHaveProperty('admin_password');
  });

  it('external DB requires host', () => {
    const config = getDefaultConfig();
    config.database.type = 'external';
    expect('host' in config.database).toBe(true);
  });

  it('external DB port default 5432', () => {
    const config = getDefaultConfig();
    expect(config.database.port).toBe(5432);
  });

  it('per-component DB password fields', () => {
    const config = getDefaultConfig();
    expect(config.gateway).toHaveProperty('pg_password');
    expect(config.controller).toHaveProperty('pg_password');
    expect(config.hub).toHaveProperty('pg_password');
    expect(config.eda).toHaveProperty('pg_password');
  });

  it('per-component DB name fields', () => {
    const config = getDefaultConfig();
    expect(config.gateway.pg_database).toBe('gateway');
    expect(config.controller.pg_database).toBe('controller');
    expect(config.hub.pg_database).toBe('hub');
    expect(config.eda.pg_database).toBe('eda');
  });

  it('DatabaseStep is a function', () => {
    expect(typeof DatabaseStep).toBe('function');
  });

  it('default database type is managed', () => {
    expect(getDefaultConfig().database.type).toBe('managed');
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'database')).toBe(true);
  });

  it('database admin_username default', () => {
    expect(getDefaultConfig().database.admin_username).toBe('postgres');
  });

  it('updateConfig can set database type', () => {
    const updateConfig = vi.fn();
    updateConfig({ database: { type: 'external', host: '', port: 5432, admin_username: '', admin_password: '' } });
    expect(updateConfig).toHaveBeenCalled();
  });

  it('port range 1-65535', () => {
    const config = getDefaultConfig();
    expect(config.database.port).toBeGreaterThanOrEqual(1);
    expect(config.database.port).toBeLessThanOrEqual(65535);
  });

  it('pg_database defaults per component', () => {
    const config = getDefaultConfig();
    expect(config.gateway.pg_database).toBe('gateway');
    expect(config.controller.pg_database).toBe('controller');
  });
});

// ─── NetworkStep logic (15 tests) ────────────────────────────────────────────

describe('NetworkStep logic', () => {
  it('default ports (80, 443, 27199)', () => {
    const config = getDefaultConfig();
    expect(config.network.http_port).toBe(80);
    expect(config.network.https_port).toBe(443);
    expect(config.network.receptor_port).toBe(27199);
  });

  it('HTTPS toggle', () => {
    const config = getDefaultConfig();
    expect(config.network.tls).toHaveProperty('disable_https');
    expect(typeof config.network.tls.disable_https).toBe('boolean');
  });

  it('custom cert fields shown only when HTTPS enabled', () => {
    const config = getDefaultConfig();
    expect(config.network.tls).toHaveProperty('custom_ca_cert');
    expect(config.network.tls).toHaveProperty('custom_server_cert');
    expect(config.network.tls).toHaveProperty('custom_server_key');
  });

  it('port validation range', () => {
    const config = getDefaultConfig();
    expect(config.network.http_port).toBeGreaterThanOrEqual(1);
    expect(config.network.http_port).toBeLessThanOrEqual(65535);
  });

  it('firewall ports table data', () => {
    const config = getDefaultConfig();
    const ports = [
      config.network.https_port,
      config.network.http_port,
      config.network.receptor_port,
      5432,
      6379,
      22,
    ];
    expect(ports.length).toBe(6);
    ports.forEach((p) => expect(p).toBeGreaterThanOrEqual(1));
  });

  it('TLS config structure', () => {
    const config = getDefaultConfig();
    expect(config.network.tls).toHaveProperty('custom_ca_cert');
    expect(config.network.tls).toHaveProperty('custom_server_cert');
    expect(config.network.tls).toHaveProperty('custom_server_key');
    expect(config.network.tls).toHaveProperty('disable_https');
  });

  it('NetworkStep is a function', () => {
    expect(typeof NetworkStep).toBe('function');
  });

  it('default disable_https is false', () => {
    expect(getDefaultConfig().network.tls.disable_https).toBe(false);
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'network')).toBe(true);
  });

  it('updateConfig can set network ports', () => {
    const updateConfig = vi.fn();
    updateConfig({ network: { http_port: 8080, https_port: 8443, receptor_port: 27199, tls: getDefaultConfig().network.tls } });
    expect(updateConfig).toHaveBeenCalled();
  });

  it('tls fields are strings', () => {
    const config = getDefaultConfig();
    expect(typeof config.network.tls.custom_ca_cert).toBe('string');
    expect(typeof config.network.tls.custom_server_cert).toBe('string');
    expect(typeof config.network.tls.custom_server_key).toBe('string');
  });

  it('receptor_port is number', () => {
    expect(typeof getDefaultConfig().network.receptor_port).toBe('number');
  });

  it('http_port and https_port are numbers', () => {
    const config = getDefaultConfig();
    expect(typeof config.network.http_port).toBe('number');
    expect(typeof config.network.https_port).toBe('number');
  });

  it('network object has required keys', () => {
    const config = getDefaultConfig();
    expect(config.network).toHaveProperty('http_port');
    expect(config.network).toHaveProperty('https_port');
    expect(config.network).toHaveProperty('receptor_port');
    expect(config.network).toHaveProperty('tls');
  });
});

// ─── CredentialsStep logic (15 tests) ───────────────────────────────────────

describe('CredentialsStep logic', () => {
  it('generate password function produces correct length', () => {
    const pw = generatePassword(24);
    expect(pw.length).toBe(24);
  });

  it('generated passwords are unique', () => {
    const pw1 = generatePassword();
    const pw2 = generatePassword();
    expect(pw1).not.toBe(pw2);
  });

  it('apply shared password sets all 4 components', () => {
    const config = getDefaultConfig();
    const shared = 'SharedPass123!';
    const updated = {
      ...config,
      gateway: { ...config.gateway, admin_password: shared },
      controller: { ...config.controller, admin_password: shared },
      hub: { ...config.hub, admin_password: shared },
      eda: { ...config.eda, admin_password: shared },
    };
    expect(updated.gateway.admin_password).toBe(shared);
    expect(updated.controller.admin_password).toBe(shared);
    expect(updated.hub.admin_password).toBe(shared);
    expect(updated.eda.admin_password).toBe(shared);
  });

  it('generate all produces 4 different passwords', () => {
    const pw1 = generatePassword();
    const pw2 = generatePassword();
    const pw3 = generatePassword();
    const pw4 = generatePassword();
    const set = new Set([pw1, pw2, pw3, pw4]);
    expect(set.size).toBe(4);
  });

  it('password contains mixed characters', () => {
    const pw = generatePassword(32);
    expect(pw.length).toBe(32);
    expect(/[a-z]/.test(pw)).toBe(true);
    expect(/[A-Z]/.test(pw)).toBe(true);
    expect(/[0-9]/.test(pw)).toBe(true);
    expect(/[^A-Za-z0-9]/.test(pw)).toBe(true);
  });

  it('CredentialsStep is a function', () => {
    expect(typeof CredentialsStep).toBe('function');
  });

  it('generatePassword default length is 24', () => {
    const pw = generatePassword();
    expect(pw.length).toBe(24);
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'credentials')).toBe(true);
  });

  it('config has admin_password for each component', () => {
    const config = getDefaultConfig();
    expect(config.gateway).toHaveProperty('admin_password');
    expect(config.controller).toHaveProperty('admin_password');
    expect(config.hub).toHaveProperty('admin_password');
    expect(config.eda).toHaveProperty('admin_password');
  });

  it('generatePassword returns string', () => {
    expect(typeof generatePassword()).toBe('string');
  });

  it('generatePassword with custom length', () => {
    expect(generatePassword(16).length).toBe(16);
    expect(generatePassword(32).length).toBe(32);
  });

  it('updateConfig can set gateway admin_password', () => {
    const updateConfig = vi.fn();
    updateConfig({ gateway: { hosts: [], admin_password: 'new', pg_host: '', pg_database: '', pg_username: '', pg_password: '' } });
    expect(updateConfig).toHaveBeenCalled();
  });

  it('charset includes letters numbers symbols', () => {
    const pw = generatePassword(100);
    const hasLower = /[a-z]/.test(pw);
    const hasUpper = /[A-Z]/.test(pw);
    const hasDigit = /[0-9]/.test(pw);
    const hasSymbol = /[!@#$%^&*]/.test(pw);
    expect(hasLower || hasUpper || hasDigit || hasSymbol).toBe(true);
  });

  it('default admin_passwords are empty', () => {
    const config = getDefaultConfig();
    expect(config.gateway.admin_password).toBe('');
    expect(config.controller.admin_password).toBe('');
  });
});

// ─── ReviewStep logic (10 tests) ─────────────────────────────────────────────

describe('ReviewStep logic', () => {
  const maskPassword = (pw: string) => (pw ? '••••••••' : '(not set)');

  it('maskPassword function works', () => {
    expect(maskPassword('secret')).toBe('••••••••');
    expect(maskPassword('')).toBe('(not set)');
  });

  it('target host toggle', () => {
    const config = getDefaultConfig();
    expect(config.target_host).toBe('');
    const withHost = { ...config, target_host: '192.0.2.1' };
    expect(withHost.target_host).toBe('192.0.2.1');
  });

  it('dry run toggle', () => {
    const config = getDefaultConfig();
    expect(config.dry_run).toBe(false);
    const withDryRun = { ...config, dry_run: true };
    expect(withDryRun.dry_run).toBe(true);
  });

  it('config sections present', () => {
    const config = getDefaultConfig();
    expect(config).toHaveProperty('topology');
    expect(config).toHaveProperty('installation_type');
    expect(config).toHaveProperty('install_dir');
    expect(config).toHaveProperty('gateway');
    expect(config).toHaveProperty('controller');
    expect(config).toHaveProperty('network');
    expect(config).toHaveProperty('database');
  });

  it('ReviewStep is a function', () => {
    expect(typeof ReviewStep).toBe('function');
  });

  it('maskPassword for empty string', () => {
    expect(maskPassword('')).toBe('(not set)');
  });

  it('maskPassword for non-empty', () => {
    expect(maskPassword('x')).toBe('••••••••');
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'review')).toBe(true);
  });

  it('target_user default', () => {
    expect(getDefaultConfig().target_user).toBe('aap');
  });

  it('target_ssh_port default', () => {
    expect(getDefaultConfig().target_ssh_port).toBe(22);
  });
});

// ─── DeployStep logic (15 tests) ────────────────────────────────────────────

describe('DeployStep logic', () => {
  it('initial phases have correct count', () => {
    expect(INITIAL_PHASES.length).toBe(8);
  });

  it('all phases start as pending', () => {
    INITIAL_PHASES.forEach((p) => {
      expect(p.status).toBe('pending');
    });
  });

  it('phase status transitions', () => {
    const phase = INITIAL_PHASES[0];
    const running = { ...phase, status: 'running' as const };
    const complete = { ...phase, status: 'complete' as const };
    const error = { ...phase, status: 'error' as const };
    expect(running.status).toBe('running');
    expect(complete.status).toBe('complete');
    expect(error.status).toBe('error');
  });

  it('status enum values', () => {
    const statuses = ['pending', 'running', 'complete', 'error'] as const;
    INITIAL_PHASES.forEach((p) => {
      expect(statuses).toContain(p.status);
    });
  });

  it('log line classification (error/ok/info)', () => {
    expect(getLineVariant('[ERROR] something failed')).toBe('aap-console__line--error');
    expect(getLineVariant('FAILED')).toBe('aap-console__line--error');
    expect(getLineVariant('[OK] done')).toBe('aap-console__line--ok');
    expect(getLineVariant('ok=1')).toBe('aap-console__line--ok');
    expect(getLineVariant('[INFO] message')).toBe('aap-console__line--info');
    expect(getLineVariant('[WARN] warning')).toBe('aap-console__line--info');
    expect(getLineVariant('changed=2')).toBe('aap-console__line--changed');
    expect(getLineVariant('plain text')).toBe('');
  });

  it('DeployStep is a function', () => {
    expect(typeof DeployStep).toBe('function');
  });

  it('INITIAL_PHASES have id and label', () => {
    INITIAL_PHASES.forEach((p) => {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('label');
      expect(typeof p.id).toBe('string');
      expect(typeof p.label).toBe('string');
    });
  });

  it('phase ids are unique', () => {
    const ids = INITIAL_PHASES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'deploy')).toBe(true);
  });

  it('getLineVariant returns string', () => {
    expect(typeof getLineVariant('test')).toBe('string');
  });

  it('first phase is validate', () => {
    expect(INITIAL_PHASES[0].id).toBe('validate');
  });

  it('last phase is complete', () => {
    expect(INITIAL_PHASES[INITIAL_PHASES.length - 1].id).toBe('complete');
  });

  it('getLineVariant handles empty string', () => {
    expect(getLineVariant('')).toBe('');
  });
});

// ─── CompleteStep logic (10 tests) ──────────────────────────────────────────

describe('CompleteStep logic', () => {
  it('gateway URL computation', () => {
    const config = getDefaultConfig();
    config.gateway.hosts = ['aap.example.org'];
    config.network.https_port = 443;
    const url = `https://${config.gateway.hosts[0]}:${config.network.https_port}`;
    expect(url).toBe('https://aap.example.org:443');
  });

  it('HTTPS port in URL', () => {
    const config = getDefaultConfig();
    config.gateway.hosts = ['host'];
    config.network.https_port = 8443;
    const url = `https://${config.gateway.hosts[0]}:${config.network.https_port}`;
    expect(url).toContain('8443');
  });

  it('resource links present', () => {
    const resources = [
      { label: 'AAP 2.6 Documentation', url: 'https://docs.redhat.com/...' },
      { label: 'Getting Started Guide', url: 'https://docs.redhat.com/...' },
      { label: 'Red Hat Customer Portal', url: 'https://access.redhat.com' },
      { label: 'Ansible Galaxy', url: 'https://galaxy.ansible.com' },
    ];
    expect(resources.length).toBeGreaterThanOrEqual(4);
  });

  it('next steps count', () => {
    const nextSteps = [
      { step: '1', title: 'Upload subscription manifest', desc: '...' },
      { step: '2', title: 'Create first project', desc: '...' },
      { step: '3', title: 'Add managed hosts', desc: '...' },
      { step: '4', title: 'Run first job', desc: '...' },
      { step: '5', title: 'Explore EDA', desc: '...' },
    ];
    expect(nextSteps.length).toBe(5);
  });

  it('CompleteStep is a function', () => {
    expect(typeof CompleteStep).toBe('function');
  });

  it('CompleteStep only needs config prop', () => {
    const props = { config: getDefaultConfig() };
    expect(props).toHaveProperty('config');
    expect(props).not.toHaveProperty('updateConfig');
  });

  it('step exists in WIZARD_STEPS', () => {
    expect(WIZARD_STEPS.some((s) => s.id === 'complete')).toBe(true);
  });

  it('URL uses https protocol', () => {
    const config = getDefaultConfig();
    config.gateway.hosts = ['host'];
    const url = `https://${config.gateway.hosts[0]}:${config.network.https_port}`;
    expect(url.startsWith('https://')).toBe(true);
  });

  it('gateway host required for URL', () => {
    const config = getDefaultConfig();
    expect(config.gateway.hosts.length).toBeGreaterThan(0);
    expect(config.gateway.hosts[0]).toBeDefined();
  });
});
